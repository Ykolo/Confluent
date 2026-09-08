/**
 * Adaptateur `SqliteHost` pour Expo.
 *
 * Les bases sont posées dans un fichier, jamais ouvertes en mémoire : une
 * sauvegarde Android arrive en mode WAL, et une base WAL déserialisée en
 * mémoire ne s'ouvre pas — SQLite cherche un fichier `-wal` qui n'existe pas
 * et renvoie `SQLITE_CANTOPEN`. Le journal doit donc pouvoir vivre à côté de
 * la base, le temps que le checkpoint l'intègre.
 *
 * Le répertoire de travail est le cache de l'app, et non le répertoire de
 * bases d'expo-sqlite : ce dernier est `context.filesDir/SQLite`, celui
 * d'Expo Go lui-même, alors que l'API fichiers ne donne accès qu'au
 * répertoire cloisonné de l'expérience en cours. `openDatabaseAsync` accepte
 * un répertoire, on lui passe donc celui où l'on a le droit d'écrire.
 *
 * Reste à traduire l'URI de l'API fichiers en chemin natif — c'est là que se
 * jouait le bug « no such table: Note » : `sqlite3_open` crée une base vide
 * quand le chemin ne désigne pas le fichier qu'on vient d'écrire, sans jamais
 * se plaindre. Voir `nativePathOf`.
 */
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';

import { AppError, logInfo, stopwatch, timed, withTimeout } from '../errors';
import type { OpenDatabase, Sha256, SqliteHost, SqlValue } from '../merge';

function workspace(): Directory {
  const dir = new Directory(Paths.cache, 'merge-db');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Chemins natifs plausibles pour un répertoire de l'API fichiers.
 *
 * `Directory.uri` est une URI percent-encodée, `sqlite3_open` attend un
 * chemin nu — d'où la tentation de décoder. Sauf que sous Expo Go le
 * répertoire cloisonné porte sur le disque un nom qui *contient* déjà des
 * séquences `%xx` (`%40anonymous%2Fconfluent-…`) : décoder donne alors
 * `@anonymous/confluent-…`, un chemin qui n'existe pas. Impossible de trancher
 * a priori — on essaie donc les deux et on garde celui qui répond.
 */
function pathCandidates(dir: Directory): string[] {
  const raw = dir.uri.replace(/^file:\/\//, '').replace(/\/+$/, '');
  const candidates = [raw];
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) candidates.push(decoded);
  } catch {
    // URI non décodable : le chemin brut est le seul candidat.
  }
  return candidates;
}

const PROBE = 'confluent-probe.db';

/**
 * Vrai si une base créée par expo-sqlite sous `path` réapparaît bien dans
 * `dir` du point de vue de l'API fichiers. C'est le seul test qui prouve que
 * les deux API désignent le même répertoire.
 */
async function roundTrips(dir: Directory, path: string): Promise<boolean> {
  const lap = stopwatch('sqlite', `sonde ${path}`);
  try {
    const db = await SQLite.openDatabaseAsync(PROBE, { useNewConnection: true }, path);
    lap('ouverture');
    try {
      // Une écriture, pour que le fichier existe vraiment sur le disque.
      await db.execAsync('PRAGMA user_version = 1');
    } finally {
      await db.closeAsync();
    }
    lap('écriture et fermeture');
  } catch {
    lap('échec');
    return false;
  }

  try {
    const probe = new File(dir, PROBE);
    if (!probe.exists) {
      lap('fichier absent côté API fichiers');
      return false;
    }
    probe.delete();
    lap('retrouvé et nettoyé');
    return true;
  } catch {
    lap('échec du contrôle');
    return false;
  }
}

/** Résolu une fois par session : la sonde coûte une ouverture de base. */
let nativePath: string | null = null;

async function nativePathOf(dir: Directory): Promise<string> {
  if (nativePath) return nativePath;

  logInfo('sqlite', 'résolution du répertoire de travail (une fois par session)');
  const candidates = pathCandidates(dir);
  for (const candidate of candidates) {
    if (await roundTrips(dir, candidate)) {
      logInfo('sqlite', `répertoire de travail résolu : ${candidate}`);
      nativePath = candidate;
      return candidate;
    }
  }

  throw new AppError({
    title: 'Espace de travail inaccessible',
    message: 'L’app n’a pas pu créer sa base de travail dans son propre cache.',
    hint: 'Ferme puis rouvre l’app ; si cela persiste, vérifie l’espace de stockage disponible.',
    technical: `Aucun chemin natif ne correspond à ${dir.uri} (essayés : ${candidates.join(' | ')})`,
  });
}

/**
 * Au-delà de ces délais, un appel natif est considéré comme bloqué. Ils sont
 * larges à dessein : il ne s'agit pas de brider un appareil lent, mais de
 * remplacer un gel silencieux par une erreur qui nomme l'étape fautive.
 */
const STATEMENT_TIMEOUT = 60_000;
const SERIALIZE_TIMEOUT = 180_000;

/** Début de la requête, pour situer un blocage sans noyer le terminal. */
function brief(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

/** Dernière instruction confiée au module natif, quel qu'en soit le sort. */
let lastStatement = '(aucune)';

/**
 * Trace *avant* l'appel natif, pas après.
 *
 * Un journal écrit après coup ne dit rien quand le processus meurt pendant
 * l'appel : la dernière ligne du terminal est celle de l'étape précédente, qui
 * a réussi, et l'étape fautive reste invisible. En annonçant l'instruction
 * avant de la lancer, la dernière ligne du terminal désigne toujours ce qui
 * était en cours au moment de l'arrêt.
 *
 * `run` en est exempté : il est appelé une fois par ligne insérée, et le
 * tracer noierait le terminal sous des dizaines de milliers de lignes. Son
 * intitulé est tout de même retenu dans `lastStatement`.
 */
function trace(label: string, silent = false): string {
  lastStatement = label;
  if (!silent) logInfo('sqlite', `→ ${label}`);
  return label;
}

/** Ce que le module natif était en train de faire — pour un rapport d'erreur. */
export function lastSqlStatement(): string {
  return lastStatement;
}

/**
 * Pose un fichier dans le répertoire de travail.
 *
 * Les quatre appels sont synchrones et retiennent le thread JS : aucun
 * garde-temps ne peut les surveiller, puisqu'ils bloquent la boucle qui
 * déclencherait la minuterie. D'où le chronomètre à tours — c'est la seule
 * façon de savoir lequel des quatre a pris le temps.
 */
function write(dir: Directory, name: string, bytes: Uint8Array) {
  const lap = stopwatch('fs', name);
  const file = new File(dir, name);
  const present = file.exists;
  lap(`exists → ${present}`);

  if (present) {
    file.delete();
    lap('delete');
  }
  file.create({ intermediates: true, overwrite: true });
  lap('create');
  file.write(bytes);
  lap(`write de ${bytes.byteLength} octets`);
}

function cleanUp(dir: Directory, name: string) {
  // Une sauvegarde pèse plusieurs mégaoctets : on ne laisse pas deux copies
  // traîner dans le cache entre deux fusions.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      const leftover = new File(dir, name + suffix);
      if (leftover.exists) leftover.delete();
    } catch {
      // Le ménage est un confort, pas une condition de réussite.
    }
  }
}

export const expoHost: SqliteHost = {
  async open(
    name: string,
    bytes: Uint8Array,
    sidecars: Record<string, Uint8Array> = {},
  ): Promise<OpenDatabase> {
    const dir = await timed('sqlite', `${name} · répertoire de travail`, workspace);
    const directory = await nativePathOf(dir);

    trace(`${name} · écriture de ${bytes.byteLength} octets`);
    await timed('sqlite', `${name} écrit`, () => write(dir, name, bytes));
    for (const [suffix, sidecarBytes] of Object.entries(sidecars)) {
      trace(`${name}${suffix} · écriture de ${sidecarBytes.byteLength} octets`);
      await timed('sqlite', `${name}${suffix} écrit`, () => write(dir, name + suffix, sidecarBytes));
    }

    // Deux bases sont ouvertes en parallèle : `useNewConnection` évite que le
    // cache de connexions d'expo-sqlite en rende une pour l'autre nom.
    const db = await timed('sqlite', `${name} ouvert`, () =>
      withTimeout(trace(`${name} · open`), STATEMENT_TIMEOUT,
        () => SQLite.openDatabaseAsync(name, { useNewConnection: true }, directory)));

    // Garde-fou : si SQLite avait ouvert autre chose que le fichier écrit
    // ci-dessus, la base serait vide et l'échec ne se manifesterait que bien
    // plus loin, sous la forme d'un « no such table » incompréhensible.
    const [{ tables }] = await withTimeout(trace(`${name} · sqlite_master`), STATEMENT_TIMEOUT,
      () => db.getAllAsync<{ tables: number }>(
        "SELECT COUNT(*) AS tables FROM sqlite_master WHERE type = 'table'",
      ));
    if (!Number(tables)) {
      await db.closeAsync();
      cleanUp(dir, name);
      throw new AppError({
        title: 'Sauvegarde illisible',
        message: 'La base de données contenue dans cette sauvegarde est vide.',
        hint: 'Réexporte la sauvegarde depuis JW Library, puis réessaie.',
        technical: `${name} ouvert depuis ${directory} : aucune table (${bytes.byteLength} octets écrits, `
          + `annexes : ${Object.keys(sidecars).join(', ') || 'aucune'})`,
      });
    }
    logInfo('sqlite', `${name} ouvert — ${tables} tables, ${bytes.byteLength} octets`);

    return {
      async all<T = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) {
        return withTimeout(trace(`${name} · ${brief(sql)}`), STATEMENT_TIMEOUT,
          () => db.getAllAsync<T>(sql, params));
      },
      async run(sql: string, params: SqlValue[] = []) {
        const result = await withTimeout(trace(`${name} · ${brief(sql)}`, true), STATEMENT_TIMEOUT,
          () => db.runAsync(sql, params));
        return result.lastInsertRowId;
      },
      async exec(sql: string) {
        await withTimeout(trace(`${name} · ${brief(sql)}`), STATEMENT_TIMEOUT,
          () => db.execAsync(sql));
      },
      async serialize() {
        return withTimeout(trace(`${name} · serialize`), SERIALIZE_TIMEOUT,
          () => db.serializeAsync());
      },
      async close() {
        const lap = stopwatch('sqlite', name);
        await withTimeout(trace(`${name} · close`), STATEMENT_TIMEOUT, () => db.closeAsync());
        lap('fermeture');
        cleanUp(dir, name);
        lap('ménage du cache');
      },
    };
  },
};

export const sha256Expo: Sha256 = async (bytes) => {
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as BufferSource,
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
