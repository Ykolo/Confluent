/**
 * L'hôte navigateur doit se comporter comme ceux de l'app et des tests : même
 * journal WAL à intégrer, mêmes identifiants renvoyés, même fusion.
 *
 *     cd web && bun test
 *
 * `@sqlite.org/sqlite-wasm` tourne aussi sous Bun : c'est exactement le code
 * que le navigateur exécute, sans navigateur.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mergeBackups, readBackup } from '@core/merge';
import { createBunHost, sha256Bun } from '@core/platform/sqlite-bun';

import { createWasmHost, sha256Web } from '../lib/sqlite-wasm';

// Le site charge le module depuis `public/` ; ici, directement depuis le paquet.
const wasmHost = createWasmHost(() => import('@sqlite.org/sqlite-wasm').then((m) => m.default()));

const scratch = mkdtempSync(join(tmpdir(), 'confluent-web-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Base en mode WAL dont les écritures ne sont *pas* encore dans le fichier principal. */
let serial = 0;
function databaseWithPendingWal() {
  const path = join(scratch, `pending-${serial++}.db`);
  const db = new Database(path);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('CREATE TABLE t(x INTEGER)');
  db.exec('BEGIN');
  for (let i = 0; i < 500; i++) db.run('INSERT INTO t(x) VALUES(?)', [i]);
  db.exec('COMMIT');
  // On lit les octets sans fermer : fermer déclencherait un checkpoint.
  const bytes = new Uint8Array(readFileSync(path));
  const wal = new Uint8Array(readFileSync(`${path}-wal`));
  const shm = new Uint8Array(readFileSync(`${path}-shm`));
  db.close();
  return { bytes, wal, shm };
}

describe('hôte WebAssembly', () => {
  test('ouvre une base WAL et intègre son journal', async () => {
    const { bytes, wal, shm } = databaseWithPendingWal();
    expect([bytes[18], bytes[19]]).toEqual([2, 2]);
    const db = await wasmHost.open('wal.db', bytes, { '-wal': wal, '-shm': shm });
    try {
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const [row] = await db.all<{ c: number }>('SELECT COUNT(*) AS c FROM t');
      expect(Number(row.c)).toBe(500);
    } finally {
      await db.close();
    }
  });

  test('les octets sérialisés contiennent le journal intégré', async () => {
    const { bytes, wal } = databaseWithPendingWal();
    const db = await wasmHost.open('serialize.db', bytes, { '-wal': wal });
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const out = await db.serialize();
    await db.close();

    const path = join(scratch, 'reopened.db');
    await Bun.write(path, out);
    const reopened = new Database(path);
    expect(reopened.query('SELECT COUNT(*) AS c FROM t').get()).toEqual({ c: 500 });
    reopened.close();
  });

  test('run renvoie l’identifiant inséré, all accepte des paramètres', async () => {
    const empty = new Database(':memory:').serialize();
    const db = await wasmHost.open('run.db', new Uint8Array(empty));
    try {
      await db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
      expect(await db.run('INSERT INTO t(v) VALUES(?)', ['a'])).toBe(1);
      expect(await db.run('INSERT INTO t(v) VALUES(?)', ['b'])).toBe(2);
      expect(await db.run('INSERT INTO t(v) VALUES(NULL)')).toBe(3);
      const rows = await db.all<{ id: number; v: string }>('SELECT id, v FROM t WHERE v = ?', ['b']);
      expect(rows.map((r) => ({ ...r }))).toEqual([{ id: 2, v: 'b' }]);
    } finally {
      await db.close();
    }
  });

  test('un nom déjà utilisé repart d’une base neuve', async () => {
    const first = new Database(':memory:');
    first.exec('CREATE TABLE premier(x)');
    const second = new Database(':memory:');
    second.exec('CREATE TABLE second(x)');

    const a = await wasmHost.open('reuse.db', new Uint8Array(first.serialize()));
    await a.close();
    const b = await wasmHost.open('reuse.db', new Uint8Array(second.serialize()));
    try {
      const tables = await b.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
      expect(tables.map((t) => t.name)).toEqual(['second']);
    } finally {
      await b.close();
    }
  });

  test('SHA-256 identique à celui de l’app', async () => {
    const bytes = new TextEncoder().encode('Confluent');
    expect(await sha256Web(bytes)).toBe(await sha256Bun(bytes));
  });
});

// Les vraies sauvegardes restent hors du dépôt (voir .gitignore) : ces tests
// ne tournent que sur le poste qui les a.
const root = join(import.meta.dir, '..', '..');
const IPAD = join(root, 'UserdataBackup_2026-09-05_iPad.jwlibrary');
const ANDROID = join(root, 'UserdataBackup_2026-09-06_Samsung_SM-S911B.jwlibrary');
const real = existsSync(IPAD) && existsSync(ANDROID);

describe.skipIf(!real)('sur de vraies sauvegardes', () => {
  test('la fusion donne les mêmes totaux dans le navigateur et sous Bun', async () => {
    const a = new Uint8Array(readFileSync(IPAD));
    const b = new Uint8Array(readFileSync(ANDROID));
    const bun = createBunHost();
    try {
      const web = await mergeBackups(a, b, { host: wasmHost, sha256: sha256Web });
      const ref = await mergeBackups(a, b, { host: bun, sha256: sha256Bun });
      expect(web.report).toEqual(ref.report);
      // Le fichier produit dans le navigateur est cohérent avec son manifeste.
      const out = await readBackup(web.file);
      expect(out.manifest.userDataBackup.hash).toBe(await sha256Web(out.database));
    } finally {
      bun.dispose();
    }
  }, 120_000);
});
