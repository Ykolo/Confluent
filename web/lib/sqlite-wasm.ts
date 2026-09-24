/**
 * Adaptateur `SqliteHost` pour le navigateur, sur le SQLite WebAssembly
 * officiel (`@sqlite.org/sqlite-wasm`).
 *
 * Tout se passe dans la mémoire de l'onglet : les bases sont écrites dans le
 * système de fichiers virtuel du module, jamais sur le disque ni sur un
 * serveur. Les sauvegardes ne quittent donc pas le navigateur.
 *
 * Le piège du WAL se pose ici aussi. Le VFS par défaut (`unix-none`) n'a pas
 * de mémoire partagée : une base dont l'en-tête annonce le mode WAL y échoue
 * sur `SQLITE_CANTOPEN` à la première lecture, journal posé à côté ou non. En
 * `locking_mode=EXCLUSIVE`, SQLite tient l'index du WAL dans le tas au lieu du
 * fichier `-shm` : le journal se lit, et le checkpoint l'intègre. Le pragma
 * doit précéder toute lecture, sinon le verrou est déjà pris en mode normal.
 */
import type sqlite3InitModule from '@sqlite.org/sqlite-wasm';

import type { OpenDatabase, Sha256, SqliteHost, SqlValue } from '@core/merge';

export type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

type Unlink = (vfs: number, name: string) => number;

/**
 * Hôte adossé au module que `init` charge. Le module ne se charge qu'une
 * fois, au premier besoin — ou plus tôt avec `preload()`.
 */
export function createWasmHost(init: () => Promise<Sqlite3>): SqliteHost & { preload(): void } {
  let module: Promise<Sqlite3> | null = null;
  let unlink: Unlink | null = null;

  const load = () => {
    module ??= init().catch((err: unknown) => {
      // Un échec de chargement (réseau coupé) ne doit pas condamner l'onglet.
      module = null;
      throw err;
    });
    return module;
  };

  const remove = (sqlite3: Sqlite3, name: string) => {
    // Une sauvegarde pèse plusieurs mégaoctets, et la mémoire de l'onglet n'est
    // rendue qu'au rechargement : on ne laisse rien traîner entre deux fusions.
    // La fonction C existe mais n'est pas exposée par l'API publique : on la
    // lie soi-même. Un VFS nul désigne le VFS par défaut.
    unlink ??= sqlite3.wasm.xWrap('sqlite3__wasm_vfs_unlink', 'int', ['sqlite3_vfs*', 'string']) as Unlink;
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      try {
        unlink(0, name + suffix);
      } catch {
        // Le ménage est un confort, pas une condition de réussite.
      }
    }
  };

  return {
    preload() {
      void load().catch(() => {});
    },

    async open(
      name: string,
      bytes: Uint8Array,
      sidecars: Record<string, Uint8Array> = {},
    ): Promise<OpenDatabase> {
      const sqlite3 = await load();
      const { capi } = sqlite3;

      remove(sqlite3, name);
      capi.sqlite3_js_posix_create_file(name, bytes);
      // Le `-shm` n'a pas de sens en mode exclusif : l'index est reconstruit en
      // mémoire à partir du WAL. On ne pose que le journal.
      if (sidecars['-wal']) capi.sqlite3_js_posix_create_file(`${name}-wal`, sidecars['-wal']);

      const db = new sqlite3.oo1.DB(name, 'w');
      db.exec('PRAGMA locking_mode=EXCLUSIVE');

      return {
        async all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
          return db.selectObjects(sql, params) as T[];
        },
        async run(sql: string, params: SqlValue[] = []) {
          db.exec({ sql, bind: params });
          return Number(capi.sqlite3_last_insert_rowid(db.pointer!));
        },
        async exec(sql: string) {
          db.exec(sql);
        },
        async serialize() {
          return capi.sqlite3_js_db_export(db.pointer!);
        },
        async close() {
          db.close();
          remove(sqlite3, name);
        },
      };
    },
  };
}

/**
 * L'hôte du site. Le module est servi tel quel depuis `public/sqlite/` (voir
 * `scripts/copy-sqlite.ts`) et importé hors bundler : Turbopack ne sait pas
 * l'empaqueter. L'import dynamique le garde aussi hors du rendu statique.
 */
export const wasmHost = createWasmHost(async () => {
  const url = '/sqlite/index.mjs';
  const { default: init } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ url) as {
    default: typeof sqlite3InitModule;
  };
  return init();
});

export const sha256Web: Sha256 = async (bytes) => {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
