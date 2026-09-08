/**
 * Adaptateur `SqliteHost` pour Bun — uniquement destiné aux tests.
 *
 * `merge.ts` n'importe rien de React Native : il tourne tel quel dans un
 * runtime pur, sans preset RN ni mock de module natif. `bun:sqlite` et
 * `crypto.subtle` sont intégrés au runtime, il n'y a donc rien à installer et
 * rien de natif à compiler. Ce fichier n'entre jamais dans le bundle mobile.
 */
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OpenDatabase, Sha256, SqliteHost, SqlValue } from '../merge';

/** Hôte SQLite adossé à un répertoire temporaire, nettoyé par `dispose()`. */
export function createBunHost(): SqliteHost & { dispose(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'confluent-'));

  return {
    async open(
      name: string,
      bytes: Uint8Array,
      sidecars: Record<string, Uint8Array> = {},
    ): Promise<OpenDatabase> {
      const path = join(dir, name);
      writeFileSync(path, bytes);
      // Le journal doit être posé à côté de la base avant l'ouverture, sinon
      // SQLite ne le voit pas et le checkpoint n'a rien à intégrer.
      for (const [suffix, sidecarBytes] of Object.entries(sidecars)) {
        writeFileSync(path + suffix, sidecarBytes);
      }
      const db = new Database(path);

      return {
        async all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
          return db.query(sql).all(...(params as never[])) as T[];
        },
        async run(sql: string, params: SqlValue[] = []) {
          return Number(db.run(sql, params as never[]).lastInsertRowid);
        },
        async exec(sql: string) {
          db.exec(sql);
        },
        async serialize() {
          // Les octets sont demandés après COMMIT et VACUUM : le WAL est déjà
          // intégré, rien ne reste en dehors du fichier principal.
          return new Uint8Array(db.serialize());
        },
        async close() {
          db.close();
        },
      };
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const sha256Bun: Sha256 = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
