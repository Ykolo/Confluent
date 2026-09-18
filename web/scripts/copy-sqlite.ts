/**
 * Pose SQLite WebAssembly dans `public/sqlite/`, tel que publié.
 *
 * Turbopack ne sait pas empaqueter ce module : il y trouve des `new Worker()`
 * aux URL calculées et refuse de construire. Ses auteurs recommandent de le
 * servir tel quel — le module retrouve alors son `.wasm` à côté de lui, par
 * `import.meta.url`. Lancé avant `dev` et `build`, ce qui garde la copie
 * alignée sur la version installée.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const dist = join(dirname(require.resolve('@sqlite.org/sqlite-wasm/package.json')), 'dist');
const target = join(import.meta.dir, '..', 'public', 'sqlite');

mkdirSync(target, { recursive: true });
// Les workers (OPFS, API Worker1) ne sont jamais démarrés : seuls le module
// et son binaire servent.
for (const file of ['index.mjs', 'sqlite3.wasm']) {
  copyFileSync(join(dist, file), join(target, file));
}
