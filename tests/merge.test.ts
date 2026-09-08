/**
 * Tests sur de vraies sauvegardes iOS + Android, sans simulateur.
 *
 *     bun test
 *
 * Les quatre propriétés vérifiées ici (symétrie, conservation, idempotence,
 * intégrité) attrapent l'essentiel des bugs de remappage d'identifiants.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

import {
  mergeBackups, readBackup, readManifest, resolveAttachments, type MergeReport,
} from '../src/merge';
import { createBunHost, sha256Bun } from '../src/platform/sqlite-bun';

const IPAD = 'UserdataBackup_2026-09-05_iPad.jwlibrary';
const ANDROID = 'UserdataBackup_2026-09-06_Samsung_SM-S911B.jwlibrary';

const host = createBunHost();
afterAll(() => host.dispose());

const COUNTED = ['Location', 'UserMark', 'BlockRange', 'Note', 'Tag', 'TagMap',
  'Bookmark', 'InputField', 'IndependentMedia'] as const;

/** Nombre de lignes par table dans la base d'une archive. */
async function tally(zip: Uint8Array, name: string): Promise<Record<string, number>> {
  const db = await host.open(name, (await readBackup(zip)).database);
  try {
    const out: Record<string, number> = {};
    for (const t of COUNTED) {
      const [r] = await db.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${t}`);
      out[t] = Number(r.c);
    }
    return out;
  } finally {
    await db.close();
  }
}

/** Valeurs d'une colonne, dans la base d'une archive. */
async function column(zip: Uint8Array, name: string, sql: string): Promise<Set<string>> {
  const db = await host.open(name, (await readBackup(zip)).database);
  try {
    const rows = await db.all<Record<string, unknown>>(sql);
    return new Set(rows.map((r) => String(Object.values(r)[0])));
  } finally {
    await db.close();
  }
}

let a: Uint8Array;
let b: Uint8Array;
let ab: { file: Uint8Array; report: MergeReport; fileName: string };
let ba: { file: Uint8Array; report: MergeReport; fileName: string };

beforeAll(async () => {
  a = new Uint8Array(readFileSync(IPAD));
  b = new Uint8Array(readFileSync(ANDROID));
  ab = await mergeBackups(a, b, { host, sha256: sha256Bun, outputName: 'AB.jwlibrary' });
  ba = await mergeBackups(b, a, { host, sha256: sha256Bun, outputName: 'BA.jwlibrary' });
}, 600_000);

describe('décompression en flux', () => {
  // Le mode en tranches sert à rendre la main entre deux morceaux pour ne pas
  // figer l'écran. Il ne doit rien changer au contenu produit.
  test('donne exactement les mêmes octets que d\'un seul bloc', async () => {
    const bloc = await readBackup(a);
    let slices = 0;
    const flux = await readBackup(a, { onSlice: () => { slices++; } });

    expect(slices).toBeGreaterThan(1);
    expect(Object.keys(flux.attachments).sort()).toEqual(Object.keys(bloc.attachments).sort());
    expect(flux.database).toEqual(bloc.database);
    for (const [key, value] of Object.entries(bloc.attachments)) {
      expect(flux.attachments[key]).toEqual(value);
    }
  }, 120_000);

  test('signale un avancement croissant, borné par la taille de l\'archive', async () => {
    const seen: number[] = [];
    await readBackup(b, {
      withAttachments: false,
      onSlice: (done, total) => {
        expect(total).toBe(b.byteLength);
        seen.push(done);
      },
    });
    expect(seen[seen.length - 1]).toBe(b.byteLength);
    expect([...seen].sort((x, y) => x - y)).toEqual(seen);
  }, 120_000);

  test('readManifest refuse un fichier qui n\'est pas une archive', () => {
    expect(() => readManifest(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });
});

describe('sauvegarde déjà lue', () => {
  // L'app décompresse la base au moment du choix et passe le résultat à la
  // fusion pour ne pas la relire. Les pièces jointes, elles, ne sont lues qu'à
  // la fusion : le risque de ce raccourci est de les perdre en silence.
  test('donne le même fichier qu\'en repartant de l\'archive', async () => {
    const prepared = await mergeBackups(
      await readBackup(a, { withAttachments: false }),
      await readBackup(b, { withAttachments: false }),
      { host, sha256: sha256Bun, outputName: 'AB.jwlibrary' },
    );

    expect(await tally(prepared.file, 'prep-ab.db')).toEqual(await tally(ab.file, 'prep-ref.db'));
    expect(Object.keys(unzipSync(prepared.file)).sort())
      .toEqual(Object.keys(unzipSync(ab.file)).sort());
  }, 600_000);

  test('resolveAttachments rend les pièces jointes que readBackup a laissées', async () => {
    const full = await readBackup(a);
    const partial = await readBackup(a, { withAttachments: false });

    expect(Object.keys(partial.attachments)).toHaveLength(0);
    expect(partial.pendingAttachments).toBeDefined();

    const resolved = await resolveAttachments(partial);
    expect(Object.keys(resolved.attachments).sort()).toEqual(Object.keys(full.attachments).sort());
    expect(resolved.pendingAttachments).toBeUndefined();
  });
});

describe('symétrie', () => {
  test('merge(A,B) et merge(B,A) donnent les mêmes totaux par table', async () => {
    expect(await tally(ab.file, 'sym-ab.db')).toEqual(await tally(ba.file, 'sym-ba.db'));
  }, 600_000);
});

describe('conservation', () => {
  test('les UserMarkGuid en sortie sont exactement l\'union des entrées', async () => {
    const sql = 'SELECT UserMarkGuid FROM UserMark';
    const union = new Set([
      ...await column(a, 'cons-a1.db', sql),
      ...await column(b, 'cons-b1.db', sql),
    ]);
    expect(await column(ab.file, 'cons-ab.db', sql)).toEqual(union);
  }, 600_000);

  test('les Guid de notes en sortie sont exactement l\'union des entrées', async () => {
    const sql = 'SELECT Guid FROM Note';
    const union = new Set([
      ...await column(a, 'cons-a2.db', sql),
      ...await column(b, 'cons-b2.db', sql),
    ]);
    expect(await column(ab.file, 'cons-ab2.db', sql)).toEqual(union);
  }, 600_000);
});

describe('idempotence', () => {
  test('merge(M, M) n\'ajoute rien', async () => {
    const again = await mergeBackups(ab.file, ab.file, {
      host, sha256: sha256Bun, outputName: 'MM.jwlibrary',
    });
    for (const [table, n] of Object.entries(again.report.added)) {
      expect(`${table}=${n}`).toBe(`${table}=0`);
    }
    expect(again.report.noteConflicts).toBe(0);
    expect(await tally(again.file, 'idem.db')).toEqual(await tally(ab.file, 'idem-ref.db'));
  }, 600_000);
});

describe('intégrité', () => {
  test('aucun surlignage orphelin, foreign_key_check et integrity_check passent', async () => {
    const db = await host.open('integ.db', (await readBackup(ab.file)).database);
    try {
      const [orphans] = await db.all<{ c: number }>(
        'SELECT COUNT(*) AS c FROM UserMark WHERE UserMarkId NOT IN (SELECT UserMarkId FROM BlockRange)');
      expect(Number(orphans.c)).toBe(0);
      expect(await db.all('PRAGMA foreign_key_check')).toEqual([]);
      const [integrity] = await db.all<{ integrity_check: string }>('PRAGMA integrity_check');
      expect(integrity.integrity_check).toBe('ok');
    } finally {
      await db.close();
    }
  }, 600_000);

  test('le hash du manifeste correspond à la base, et l\'archive n\'a pas de -wal', async () => {
    const files = unzipSync(ab.file);
    expect(Object.keys(files).filter((n) => n.endsWith('-wal') || n.endsWith('-shm'))).toEqual([]);
    const backup = await readBackup(ab.file);
    expect(backup.manifest.userDataBackup.hash).toBe(await sha256Bun(backup.database));
    expect(backup.manifest.name).toBe('AB.jwlibrary');
  }, 600_000);

  test('les pièces jointes des deux sauvegardes sont conservées', async () => {
    const union = new Set([
      ...Object.keys((await readBackup(a)).attachments),
      ...Object.keys((await readBackup(b)).attachments),
    ]);
    expect(new Set(Object.keys((await readBackup(ab.file)).attachments))).toEqual(union);
  });
});

describe('stratégie de conflit', () => {
  test('« version récente » ne conserve pas l\'annexe', async () => {
    const newest = await mergeBackups(a, b, {
      host, sha256: sha256Bun, outputName: 'N.jwlibrary', conflictStrategy: 'newest',
    });
    const db = await host.open('newest.db', (await readBackup(newest.file)).database);
    try {
      const [r] = await db.all<{ c: number }>(
        "SELECT COUNT(*) AS c FROM Note WHERE Content LIKE '%--- version précédente (%'");
      expect(Number(r.c)).toBe(0);
    } finally {
      await db.close();
    }
    expect(newest.report.noteConflicts).toBe(ab.report.noteConflicts);
  }, 600_000);
});
