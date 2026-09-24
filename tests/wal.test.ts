/**
 * Le journal SQLite livré à côté de la base.
 *
 * Une sauvegarde Android arrive en mode WAL, souvent accompagnée d'un
 * `userData.db-wal`. Deux choses en découlent, et les deux ont cassé l'app une
 * fois : le journal doit être reposé à côté de la base avant l'ouverture, et
 * une base en mode WAL ne peut pas être ouverte depuis la mémoire.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBackup } from '../src/merge';
import { createBunHost } from '../src/platform/sqlite-bun';
import { androidBackup, ipadBackup } from './fixtures/backups';

const host = createBunHost();
const scratch = mkdtempSync(join(tmpdir(), 'confluent-wal-'));
afterAll(() => {
  host.dispose();
  rmSync(scratch, { recursive: true, force: true });
});

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
  db.close();
  return { bytes, wal };
}

describe('readBackup', () => {
  test('expose le journal de la sauvegarde Android au lieu de le jeter', async () => {
    const android = await readBackup(androidBackup());
    expect(Object.keys(android.sidecars).sort()).toEqual(['-shm', '-wal']);
    expect(android.sidecars['-wal'].byteLength).toBeGreaterThan(0);
    // Le journal ne doit jamais se retrouver parmi les pièces jointes.
    expect(Object.keys(android.attachments).some((n) => n.includes('userData'))).toBe(false);

    const ios = await readBackup(ipadBackup());
    expect(ios.sidecars).toEqual({});
  });

  test('la base Android est en mode WAL', async () => {
    const { database } = await readBackup(androidBackup());
    // En-tête SQLite : octets 18 et 19, versions d'écriture et de lecture. 2 = WAL.
    expect([database[18], database[19]]).toEqual([2, 2]);
  });
});

describe('hôte SQLite', () => {
  test('sans le journal, les écritures en attente sont invisibles', async () => {
    const { bytes } = databaseWithPendingWal();
    const db = await host.open('sans-wal.db', bytes);
    try {
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const rows = await db.all<{ c: number }>(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='t'");
      expect(Number(rows[0].c)).toBe(0);
    } finally {
      await db.close();
    }
  });

  test('avec le journal, le checkpoint les rend visibles', async () => {
    const { bytes, wal } = databaseWithPendingWal();
    const db = await host.open('avec-wal.db', bytes, { '-wal': wal });
    try {
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      const [row] = await db.all<{ c: number }>('SELECT COUNT(*) AS c FROM t');
      expect(Number(row.c)).toBe(500);
    } finally {
      await db.close();
    }
  });
});
