/**
 * Fusion de sauvegardes JW Library (.jwlibrary).
 *
 * Fichier autonome : aucune dépendance à React Native ni à Node. Il reçoit un
 * `SqliteHost` et une fonction de hash, ce qui permet de le tester en Node avec
 * `node:sqlite` et de le faire tourner dans l'app avec `expo-sqlite`, sans le
 * modifier d'une ligne.
 *
 * Seule dépendance externe : fflate (ZIP en JS pur).
 *
 * Validé sur de vraies sauvegardes iOS + Android, schemaVersion 16.
 */
import { Unzip, UnzipInflate, unzipSync } from 'fflate';

import { AppError, stopwatch, timed } from './errors';
import { zipEntries, type ZipEntry } from './zip';

// ---------------------------------------------------------------------------
// Contrats de la couche plateforme
// ---------------------------------------------------------------------------

export type SqlValue = string | number | null;

export interface SqlDatabase {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  /** Renvoie l'identifiant de la ligne insérée. */
  run(sql: string, params?: SqlValue[]): Promise<number>;
  /** Plusieurs instructions, sans paramètres (PRAGMA, BEGIN, VACUUM...). */
  exec(sql: string): Promise<void>;
}

export interface OpenDatabase extends SqlDatabase {
  /** Octets bruts du fichier .db, WAL déjà intégré. */
  serialize(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface SqliteHost {
  /**
   * Écrit `bytes` dans un fichier temporaire et l'ouvre.
   * `name` doit être unique par appel (base et source ouvertes en parallèle).
   *
   * `sidecars` est indexé par suffixe (`-wal`, `-shm`) : chaque entrée doit
   * être écrite sous `name + suffixe`, à côté de la base, sans quoi SQLite ne
   * verra pas le journal et les données les plus récentes resteront invisibles.
   */
  open(
    name: string,
    bytes: Uint8Array,
    sidecars?: Record<string, Uint8Array>,
  ): Promise<OpenDatabase>;
}

/** SHA-256 des octets, en hexadécimal minuscule. */
export type Sha256 = (bytes: Uint8Array) => Promise<string>;

export interface MergeReport {
  /** Nombre de lignes ajoutées, par table. */
  added: Record<string, number>;
  /** Lignes de `source` déjà présentes dans `base`, donc non recopiées. */
  duplicates: number;
  /** Notes présentes des deux côtés avec un contenu divergent. */
  noteConflicts: number;
  /** Signets écartés faute de slot libre (10 max par publication). */
  bookmarksSkipped: number;
  /** Contenu du fichier produit, une fois la fusion terminée. */
  totals: { notes: number; highlights: number; bookmarks: number };
}

/**
 * Que faire d'une note modifiée des deux côtés.
 *
 * - `keep-both` : la version la plus récente devient le contenu, l'ancienne
 *   est conservée en annexe. Rien de ce qui a été écrit à la main n'est perdu.
 * - `newest` : seule la version la plus récente est conservée.
 */
export type ConflictStrategy = 'keep-both' | 'newest';

/**
 * Signalement d'avancement. La fusion tourne sur le thread JS et le bloque ;
 * le retour peut être une promesse, ce qui permet à l'appelant de rendre la
 * main à la boucle d'événements (`new Promise(r => setTimeout(r, 0))`) pour
 * que sa barre de progression se rafraîchisse réellement.
 */
export type ProgressCallback = (
  step: string,
  done: number,
  total: number,
) => void | Promise<void>;

export interface MergeOptions {
  host: SqliteHost;
  sha256: Sha256;
  /** Nom du fichier produit, écrit dans le manifeste. */
  outputName?: string;
  /** Défaut : `keep-both`. */
  conflictStrategy?: ConflictStrategy;
  onProgress?: ProgressCallback;
}

// ---------------------------------------------------------------------------
// Conteneur .jwlibrary
// ---------------------------------------------------------------------------

export interface Manifest {
  name: string;
  creationDate: string;
  version: number;
  type: number;
  userDataBackup: {
    lastModifiedDate: string;
    deviceName: string;
    databaseName: string;
    hash: string;
    schemaVersion: number;
  };
}

export interface Backup {
  manifest: Manifest;
  database: Uint8Array;
  /**
   * Journal SQLite livré à côté de la base, indexé par suffixe (`-wal`,
   * `-shm`). Les sauvegardes Android en contiennent souvent un. Il n'est
   * jamais réécrit dans l'archive produite, mais il doit être remis à côté de
   * la base avant de la lire.
   */
  sidecars: Record<string, Uint8Array>;
  /** Pièces jointes (miniatures de playlists), nommées en UUID. */
  attachments: Record<string, Uint8Array>;
  /**
   * Archive d'origine, conservée lorsque les pièces jointes n'ont pas encore
   * été décompressées. Elles ne servent qu'à la fusion : les inflater à la
   * sélection allongerait le gel pour des vignettes que l'écran n'affiche pas.
   * `resolveAttachments` s'en charge le moment venu — et tant que ce champ est
   * renseigné, `attachments` est vide *parce qu'il reste à lire*, non parce
   * que l'archive n'en contient pas.
   */
  pendingAttachments?: Uint8Array;
}

export const SUPPORTED_SCHEMA_VERSION = 16;

const DB_SIDECARS = ['-wal', '-shm'];

/**
 * Signalé entre deux tranches décompressées, `done` octets d'archive sur
 * `total` traités. Le retour peut être une promesse : c'est ce qui permet à
 * l'appelant de rendre la main à la boucle d'événements.
 */
export type SliceCallback = (done: number, total: number) => void | Promise<void>;

export interface ReadOptions {
  /**
   * Décompresser aussi les pièces jointes. À laisser à `false` quand on ne
   * vient que lire le manifeste et compter des lignes : elles pèsent le tiers
   * de l'archive, pour des vignettes que l'écran de choix n'affiche pas.
   */
  withAttachments?: boolean;
  /** Voir `SliceCallback`. Absent, la décompression se fait d'un seul bloc. */
  onSlice?: SliceCallback;
}

/**
 * Taille des tranches poussées dans le décompresseur en flux.
 *
 * C'est un compromis : plus la tranche est petite, plus l'écran se rafraîchit
 * souvent, mais plus on paie d'allers-retours vers la boucle d'événements.
 * 128 Ko découpe une sauvegarde typique en une trentaine de tranches, soit
 * quelques dizaines de millisecondes de travail chacune sur un téléphone.
 */
const SLICE = 128 * 1024;

function join(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Extrait d'une archive les entrées retenues par `wanted`.
 *
 * Sans `onSlice`, tout est décompressé d'un bloc : c'est le plus rapide, et
 * c'est ce que font les tests. Avec, l'archive est poussée par tranches dans
 * le décompresseur en flux de fflate, `onSlice` étant appelé entre chacune —
 * l'appelant peut alors laisser l'écran se rafraîchir au lieu de voir le
 * thread JS retenu plusieurs secondes d'affilée.
 *
 * Dans les deux cas, une entrée que `wanted` rejette n'est jamais décompressée.
 */
async function extract(
  zipBytes: Uint8Array,
  wanted: (name: string) => boolean,
  onSlice?: SliceCallback,
): Promise<Record<string, Uint8Array>> {
  if (!onSlice) {
    return unzipSync(zipBytes, { filter: (entry) => wanted(entry.name) });
  }

  const out: Record<string, Uint8Array> = {};
  const parser = new Unzip();
  // Sans ce décodeur, seules les entrées stockées telles quelles s'ouvrent ;
  // celles en deflate — dont la base — feraient lever `start()`.
  parser.register(UnzipInflate);
  let failure: unknown;

  parser.onfile = (file) => {
    if (!wanted(file.name)) return; // jamais démarrée, donc jamais décompressée
    const parts: Uint8Array[] = [];
    let size = 0;
    file.ondata = (err, chunk, final) => {
      if (err) {
        if (!failure) failure = err;
        return;
      }
      if (chunk.length > 0) {
        parts.push(chunk);
        size += chunk.length;
      }
      if (final) out[file.name] = join(parts, size);
    };
    file.start();
  };

  for (let offset = 0; offset < zipBytes.length; offset += SLICE) {
    const end = Math.min(offset + SLICE, zipBytes.length);
    parser.push(zipBytes.subarray(offset, end), end === zipBytes.length);
    if (failure) throw failure;
    await onSlice(end, zipBytes.length);
  }
  if (failure) throw failure;
  return out;
}

/**
 * Le manifeste seul.
 *
 * Il pèse quelques centaines d'octets et se lit instantanément, alors que la
 * base demande des secondes : de quoi afficher tout de suite l'appareil, la
 * date et la taille d'une sauvegarde qu'on vient de choisir, sans attendre.
 */
export function readManifest(zipBytes: Uint8Array): Manifest {
  const head = unzipSync(zipBytes, { filter: (entry) => entry.name === 'manifest.json' });

  const manifestBytes = head['manifest.json'];
  if (!manifestBytes) {
    throw new AppError({
      title: 'Fichier non reconnu',
      message: 'Ce fichier n’est pas une sauvegarde JW Library.',
      hint: 'Dans JW Library : Réglages › Sauvegarde et restauration › Sauvegarder.',
      technical: 'manifest.json absent de l’archive',
    });
  }
  return JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
}

export async function readBackup(
  zipBytes: Uint8Array,
  options: ReadOptions = {},
): Promise<Backup> {
  const { withAttachments = true, onSlice } = options;

  const manifest = readManifest(zipBytes);
  const dbName = manifest.userDataBackup?.databaseName ?? 'userData.db';
  const files = await extract(
    zipBytes,
    withAttachments
      ? (name) => name !== 'manifest.json'
      : (name) => name === dbName || DB_SIDECARS.some((sfx) => name === dbName + sfx),
    onSlice,
  );

  const database = files[dbName];
  if (!database) {
    throw new AppError({
      title: 'Sauvegarde incomplète',
      message: 'L’archive ne contient pas la base de données annoncée par son manifeste.',
      hint: 'Réexporte la sauvegarde depuis JW Library : le transfert a dû être interrompu.',
      technical: `Fichier "${dbName}" introuvable dans l'archive`,
    });
  }

  // On ne vérifie surtout PAS manifest.userDataBackup.hash : certaines
  // sauvegardes iOS embarquent un hash tronqué à 62 caractères qui ne
  // correspond pas au SHA-256 réel du fichier. Le rejeter casserait l'app sur
  // des sauvegardes parfaitement valides.

  const sidecars: Record<string, Uint8Array> = {};
  const attachments: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(files)) {
    if (name === 'manifest.json' || name === dbName) continue;
    const sidecar = DB_SIDECARS.find((s) => name === dbName + s);
    if (sidecar) {
      sidecars[sidecar] = bytes; // remis à côté de la base, puis intégré au checkpoint
      continue;
    }
    attachments[name] = bytes;
  }

  return withAttachments
    ? { manifest, database, sidecars, attachments }
    : { manifest, database, sidecars, attachments, pendingAttachments: zipBytes };
}

/** Vrai pour les entrées qui ne sont ni le manifeste, ni la base, ni son journal. */
function isAttachment(name: string, dbName: string): boolean {
  return name !== 'manifest.json'
    && name !== dbName
    && !DB_SIDECARS.some((s) => name === dbName + s);
}

/**
 * Complète une sauvegarde lue sans ses pièces jointes.
 *
 * Sans effet si elles sont déjà là : c'est ce qui permet de passer à la fusion
 * une sauvegarde déjà décompressée à la sélection, sans la relire en entier.
 */
export async function resolveAttachments(
  backup: Backup,
  onSlice?: SliceCallback,
): Promise<Backup> {
  const zip = backup.pendingAttachments;
  if (!zip) return backup;

  const dbName = backup.manifest.userDataBackup?.databaseName ?? 'userData.db';
  const attachments = await extract(zip, (name) => isAttachment(name, dbName), onSlice);
  return { ...backup, attachments, pendingAttachments: undefined };
}

/**
 * Écrit l'archive `.jwlibrary`. `onSlice` suit la compression de la base,
 * seule étape longue : voir `zip.ts`.
 */
export async function writeBackup(
  backup: Backup,
  outputName: string,
  sha256: Sha256,
  onSlice?: SliceCallback,
): Promise<Uint8Array> {
  const lap = stopwatch('archive', outputName);
  const now = new Date();
  const iso = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  const manifest: Manifest = {
    name: outputName,
    creationDate: iso.slice(0, 10),
    version: 1,
    type: 0,
    userDataBackup: {
      lastModifiedDate: iso,
      deviceName: backup.manifest.userDataBackup.deviceName,
      databaseName: 'userData.db',
      hash: await sha256(backup.database),
      schemaVersion: backup.manifest.userDataBackup.schemaVersion,
    },
  };
  lap(`SHA-256 de ${backup.database.byteLength} octets`);

  // Les pièces jointes sont des médias déjà compressés : les passer au
  // deflate coûtait l'essentiel du temps d'archivage pour un gain nul. Elles
  // sont rangées telles quelles ; seuls le manifeste et la base se compressent.
  const entries: ZipEntry[] = [
    { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest)), compress: true },
    { name: 'userData.db', data: backup.database, compress: true },
    ...Object.entries(backup.attachments).map(([name, data]) => ({ name, data, compress: false })),
  ];

  // Deux chronos distincts dans le journal : si l'archivage reste lent, ils
  // disent tout de suite si c'est la base ou les pièces jointes.
  let stored = 0;
  let storedBytes = 0;
  const file = await zipEntries(entries, {
    onSlice,
    onEntry: (entry) => {
      if (entry.name === 'userData.db') {
        lap(`base compressée : ${entry.size} → ${entry.written} octets`);
      } else if (entry.stored) {
        stored++;
        storedBytes += entry.size;
      }
    },
  });
  lap(`${stored} pièce(s) jointe(s) rangée(s) sans compression (${storedBytes} octets), `
    + `archive de ${entries.length} entrées → ${file.byteLength} octets`);
  return file;
}

// ---------------------------------------------------------------------------
// Moteur de fusion
// ---------------------------------------------------------------------------

/**
 * Colonnes signifiantes de Location. `Title` est exclu de la clé : ce n'est
 * qu'un libellé d'affichage, il peut différer d'un appareil à l'autre pour un
 * même lieu.
 *
 * Attention : on n'utilise PAS les index UNIQUE de la table. SQLite considère
 * chaque NULL comme distinct, si bien qu'ils n'identifient pas réellement une
 * ligne — sur un cas réel, 1 723 lieux se réduisaient à 913 clés, ce qui
 * fusionnait des lieux différents et déplaçait des signets.
 */
const LOC_COLS = [
  'BookNumber', 'ChapterNumber', 'DocumentId', 'Track', 'IssueTagNumber',
  'KeySymbol', 'MepsLanguage', 'Type', 'Title', 'Specialty', 'Edition',
] as const;
const LOC_KEY = LOC_COLS.filter((c) => c !== 'Title');

type Row = Record<string, SqlValue>;

const key = (row: Row, cols: readonly string[]) => JSON.stringify(cols.map((c) => row[c] ?? null));

/** Chunk pour rester sous la limite de variables liées de SQLite. */
const MAX_PARAMS = 900;

/**
 * Insertion groupée en `INSERT ... VALUES (..),(..)`. Sur expo-sqlite chaque
 * appel traverse le pont natif : passer de 22 000 appels à ~150 change tout.
 */
async function insertMany(db: SqlDatabase, table: string, cols: string[], rows: SqlValue[][]) {
  if (rows.length === 0) return;
  const perRow = cols.length;
  const chunk = Math.max(1, Math.floor(MAX_PARAMS / perRow));
  const tuple = `(${cols.map(() => '?').join(',')})`;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    await db.run(
      `INSERT INTO ${table}(${cols.join(',')}) VALUES ${slice.map(() => tuple).join(',')}`,
      slice.flat(),
    );
  }
}

async function nextId(db: SqlDatabase, table: string, col: string): Promise<number> {
  const [r] = await db.all<{ n: number }>(`SELECT COALESCE(MAX(${col}), 0) + 1 AS n FROM ${table}`);
  return Number(r.n);
}

/**
 * Fusionne `source` dans `base`. `base` garde ses identifiants internes ;
 * tout ce qui n'existe que dans `source` y est ajouté avec de nouveaux IDs.
 * L'opération est symétrique : merge(A,B) et merge(B,A) donnent les mêmes
 * totaux par table.
 */
export async function mergeDatabases(
  base: SqlDatabase,
  source: SqlDatabase,
  options: { onProgress?: ProgressCallback; conflictStrategy?: ConflictStrategy } = {},
): Promise<MergeReport> {
  const { onProgress, conflictStrategy = 'keep-both' } = options;
  const tick = async (step: string, done: number, total: number) => {
    await onProgress?.(step, done, total);
  };

  const added: Record<string, number> = {};
  let duplicates = 0;
  let noteConflicts = 0;
  let bookmarksSkipped = 0;
  const bump = (t: string, n = 1) => { added[t] = (added[t] ?? 0) + n; };
  for (const t of ['Location', 'UserMark', 'BlockRange', 'Note', 'Tag', 'TagMap',
    'Bookmark', 'InputField', 'IndependentMedia']) added[t] = 0;

  await base.exec('PRAGMA foreign_keys = ON');
  await base.exec('BEGIN');

  try {
    // ---- Location ---------------------------------------------------------
    const known = new Map<string, number>();
    for (const r of await base.all<Row>('SELECT * FROM Location')) {
      const k = key(r, LOC_KEY);
      if (!known.has(k)) known.set(k, Number(r.LocationId));
    }

    const locMap = new Map<number, number>();
    const newLocations: SqlValue[][] = [];
    let locId = await nextId(base, 'Location', 'LocationId');
    const srcLocations = await source.all<Row>('SELECT * FROM Location');
    await tick('lieux', 0, srcLocations.length);
    for (const r of srcLocations) {
      const k = key(r, LOC_KEY);
      let target = known.get(k);
      if (target === undefined) {
        target = locId++;
        known.set(k, target);
        newLocations.push([target, ...LOC_COLS.map((c) => r[c] ?? null)]);
        bump('Location');
      } else {
        duplicates++;
      }
      locMap.set(Number(r.LocationId), target);
    }
    await tick('lieux', srcLocations.length, srcLocations.length);
    await insertMany(base, 'Location', ['LocationId', ...LOC_COLS], newLocations);

    // ---- UserMark + BlockRange -------------------------------------------
    const haveMarks = new Map<string, number>();
    for (const r of await base.all<Row>('SELECT UserMarkId, UserMarkGuid FROM UserMark')) {
      haveMarks.set(String(r.UserMarkGuid), Number(r.UserMarkId));
    }

    const srcMarks = await source.all<Row>('SELECT * FROM UserMark');
    const markMap = new Map<number, number>();
    const newMarks: SqlValue[][] = [];
    const missingMarkIds: number[] = [];
    let markId = await nextId(base, 'UserMark', 'UserMarkId');

    for (const r of srcMarks) {
      const guid = String(r.UserMarkGuid);
      const existing = haveMarks.get(guid);
      if (existing !== undefined) {
        markMap.set(Number(r.UserMarkId), existing);
        duplicates++;
        continue;
      }
      const id = markId++;
      markMap.set(Number(r.UserMarkId), id);
      missingMarkIds.push(Number(r.UserMarkId));
      newMarks.push([id, r.ColorIndex, locMap.get(Number(r.LocationId))!, r.StyleIndex, guid, r.Version]);
    }
    await tick('surlignages', 0, newMarks.length);
    await insertMany(base, 'UserMark',
      ['UserMarkId', 'ColorIndex', 'LocationId', 'StyleIndex', 'UserMarkGuid', 'Version'], newMarks);
    bump('UserMark', newMarks.length);

    // Un UserMark sans BlockRange est un surlignage invisible : les plages
    // doivent suivre systématiquement.
    const newRanges: SqlValue[][] = [];
    let rangeId = await nextId(base, 'BlockRange', 'BlockRangeId');
    for (let i = 0; i < missingMarkIds.length; i += 400) {
      const batch = missingMarkIds.slice(i, i + 400);
      const rows = await source.all<Row>(
        `SELECT * FROM BlockRange WHERE UserMarkId IN (${batch.map(() => '?').join(',')})`, batch);
      for (const br of rows) {
        newRanges.push([rangeId++, br.BlockType, br.Identifier, br.StartToken, br.EndToken,
          markMap.get(Number(br.UserMarkId))!]);
      }
      await tick('surlignages', Math.min(i + 400, missingMarkIds.length), missingMarkIds.length);
    }
    await insertMany(base, 'BlockRange',
      ['BlockRangeId', 'BlockType', 'Identifier', 'StartToken', 'EndToken', 'UserMarkId'], newRanges);
    bump('BlockRange', newRanges.length);

    // ---- Note -------------------------------------------------------------
    const baseNotes = new Map<string, Row>();
    for (const r of await base.all<Row>('SELECT * FROM Note')) baseNotes.set(String(r.Guid), r);

    const srcNotes = await source.all<Row>('SELECT * FROM Note');
    await tick('notes', 0, srcNotes.length);
    let notesSeen = 0;
    for (const r of srcNotes) {
      if (++notesSeen % 200 === 0) await tick('notes', notesSeen, srcNotes.length);
      const guid = String(r.Guid);
      const loc = r.LocationId === null ? null : locMap.get(Number(r.LocationId)) ?? null;
      const mark = r.UserMarkId === null ? null : markMap.get(Number(r.UserMarkId)) ?? null;
      const existing = baseNotes.get(guid);

      if (!existing) {
        await base.run(
          `INSERT INTO Note(Guid,UserMarkId,LocationId,Title,Content,LastModified,Created,BlockType,BlockIdentifier)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [guid, mark, loc, r.Title, r.Content, r.LastModified, r.Created, r.BlockType, r.BlockIdentifier]);
        bump('Note');
        continue;
      }

      const identical = existing.Title === r.Title && existing.Content === r.Content;
      if (identical) {
        duplicates++;
        continue;
      }
      noteConflicts++;

      // La version la plus récente devient le contenu. En `keep-both` l'autre
      // est conservée en annexe : on ne supprime jamais de texte écrit à la
      // main sans que l'utilisateur l'ait demandé.
      const srcNewer = String(r.LastModified ?? '') > String(existing.LastModified ?? '');
      const [winner, loser] = srcNewer ? [r, existing] : [existing, r];
      const content = conflictStrategy === 'newest'
        ? (winner.Content ?? '')
        : `${winner.Content ?? ''}\n\n--- version précédente (${loser.LastModified}) ---\n${loser.Content ?? ''}`;
      await base.run('UPDATE Note SET Title=?, Content=?, LastModified=? WHERE NoteId=?',
        [winner.Title, content, winner.LastModified, existing.NoteId]);
    }
    await tick('notes', srcNotes.length, srcNotes.length);

    // ---- Tag --------------------------------------------------------------
    const tags = new Map<string, number>();
    for (const r of await base.all<Row>('SELECT * FROM Tag')) {
      tags.set(key(r, ['Type', 'Name']), Number(r.TagId));
    }
    const tagMap = new Map<number, number>();
    for (const r of await source.all<Row>('SELECT * FROM Tag')) {
      const k = key(r, ['Type', 'Name']);
      let id = tags.get(k);
      if (id === undefined) {
        id = await base.run('INSERT INTO Tag(Type,Name) VALUES(?,?)', [r.Type, r.Name]);
        tags.set(k, id);
        bump('Tag');
      } else {
        duplicates++;
      }
      tagMap.set(Number(r.TagId), id);
    }

    // ---- TagMap -----------------------------------------------------------
    const noteIdByGuid = new Map<string, number>();
    for (const r of await base.all<Row>('SELECT NoteId, Guid FROM Note')) {
      noteIdByGuid.set(String(r.Guid), Number(r.NoteId));
    }
    const srcNoteGuid = new Map<number, string>();
    for (const r of await source.all<Row>('SELECT NoteId, Guid FROM Note')) {
      srcNoteGuid.set(Number(r.NoteId), String(r.Guid));
    }
    const existingMaps = new Set<string>();
    for (const r of await base.all<Row>('SELECT * FROM TagMap')) {
      existingMaps.add(key(r, ['TagId', 'NoteId', 'LocationId', 'PlaylistItemId']));
    }

    for (const r of await source.all<Row>('SELECT * FROM TagMap')) {
      if (r.PlaylistItemId !== null) continue; // playlists non remappées
      const tag = tagMap.get(Number(r.TagId))!;
      const note = r.NoteId === null ? null
        : noteIdByGuid.get(srcNoteGuid.get(Number(r.NoteId)) ?? '') ?? null;
      const loc = r.LocationId === null ? null : locMap.get(Number(r.LocationId)) ?? null;
      if (note === null && loc === null) continue;

      const k = key({ TagId: tag, NoteId: note, LocationId: loc, PlaylistItemId: null },
        ['TagId', 'NoteId', 'LocationId', 'PlaylistItemId']);
      if (existingMaps.has(k)) {
        duplicates++;
        continue;
      }

      // Position est soumise à UNIQUE(TagId, Position) : on renumérote.
      const [p] = await base.all<{ p: number }>(
        'SELECT COALESCE(MAX(Position), -1) + 1 AS p FROM TagMap WHERE TagId = ?', [tag]);
      await base.run(
        'INSERT INTO TagMap(PlaylistItemId,LocationId,NoteId,TagId,Position) VALUES(NULL,?,?,?,?)',
        [loc, note, tag, Number(p.p)]);
      existingMaps.add(k);
      bump('TagMap');
    }

    // ---- Bookmark ---------------------------------------------------------
    const bookmarks = await base.all<Row>('SELECT * FROM Bookmark');
    const usedSlots = new Set<string>();
    const sameBookmark = new Set<string>();
    const bmKey = ['PublicationLocationId', 'LocationId', 'Title', 'BlockType', 'BlockIdentifier'];
    for (const r of bookmarks) {
      usedSlots.add(`${r.PublicationLocationId}:${r.Slot}`);
      sameBookmark.add(key(r, bmKey));
    }

    const srcBookmarks = await source.all<Row>('SELECT * FROM Bookmark');
    await tick('signets', 0, srcBookmarks.length);
    for (const r of srcBookmarks) {
      const pub = locMap.get(Number(r.PublicationLocationId));
      const loc = locMap.get(Number(r.LocationId));
      if (pub === undefined || loc === undefined) continue;

      const k = key({ ...r, PublicationLocationId: pub, LocationId: loc }, bmKey);
      if (sameBookmark.has(k)) { // déjà présent à l'identique
        duplicates++;
        continue;
      }

      let slot = Number(r.Slot);
      if (usedSlots.has(`${pub}:${slot}`)) {
        const free = [...Array(10).keys()].find((s) => !usedSlots.has(`${pub}:${s}`));
        if (free === undefined) { bookmarksSkipped++; continue; } // 10 signets max
        slot = free;
      }
      await base.run(
        `INSERT INTO Bookmark(LocationId,PublicationLocationId,Slot,Title,Snippet,BlockType,BlockIdentifier)
         VALUES(?,?,?,?,?,?,?)`,
        [loc, pub, slot, r.Title, r.Snippet, r.BlockType, r.BlockIdentifier]);
      usedSlots.add(`${pub}:${slot}`);
      sameBookmark.add(k);
      bump('Bookmark');
    }
    await tick('signets', srcBookmarks.length, srcBookmarks.length);

    // ---- InputField -------------------------------------------------------
    const haveFields = new Set<string>();
    for (const r of await base.all<Row>('SELECT * FROM InputField')) {
      haveFields.add(`${r.LocationId}\u0000${r.TextTag}`);
    }
    const newFields: SqlValue[][] = [];
    for (const r of await source.all<Row>('SELECT * FROM InputField')) {
      const loc = locMap.get(Number(r.LocationId));
      if (loc === undefined) continue;
      const k = `${loc}\u0000${r.TextTag}`;
      if (haveFields.has(k)) {
        duplicates++;
        continue;
      }
      haveFields.add(k);
      newFields.push([loc, r.TextTag, r.Value]);
    }
    await insertMany(base, 'InputField', ['LocationId', 'TextTag', 'Value'], newFields);
    bump('InputField', newFields.length);

    // ---- IndependentMedia -------------------------------------------------
    const haveMedia = new Set<string>();
    for (const r of await base.all<Row>('SELECT FilePath FROM IndependentMedia')) {
      haveMedia.add(String(r.FilePath));
    }
    for (const r of await source.all<Row>('SELECT * FROM IndependentMedia')) {
      if (haveMedia.has(String(r.FilePath))) {
        duplicates++;
        continue;
      }
      await base.run(
        'INSERT INTO IndependentMedia(OriginalFilename,FilePath,MimeType,Hash) VALUES(?,?,?,?)',
        [r.OriginalFilename, r.FilePath, r.MimeType, r.Hash]);
      haveMedia.add(String(r.FilePath));
      bump('IndependentMedia');
    }

    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await base.run('UPDATE LastModified SET LastModified = ?', [now]);
    await base.exec('COMMIT');
  } catch (err) {
    await base.exec('ROLLBACK');
    throw err;
  }

  await tick('vérification', 0, 1);
  const problems = await base.all('PRAGMA foreign_key_check');
  if (problems.length > 0) {
    throw new AppError({
      title: 'Fusion abandonnée',
      message: 'Le fichier obtenu contenait des liens cassés : il n’a pas été conservé, rien n’a été modifié.',
      hint: 'Réexporte les deux sauvegardes depuis JW Library, puis recommence.',
      technical: `PRAGMA foreign_key_check : ${problems.length} référence(s) cassée(s)`,
    });
  }
  const [integrity] = await base.all<{ integrity_check: string }>('PRAGMA integrity_check');
  if (integrity.integrity_check !== 'ok') {
    throw new AppError({
      title: 'Fusion abandonnée',
      message: 'La vérification finale a trouvé la base abîmée : le fichier n’a pas été conservé.',
      hint: 'Réexporte les deux sauvegardes depuis JW Library, puis recommence.',
      technical: `PRAGMA integrity_check : ${integrity.integrity_check}`,
    });
  }
  await base.exec('VACUUM');
  await tick('vérification', 1, 1);

  const count = async (table: string) => {
    const [r] = await base.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
    return Number(r.c);
  };
  const totals = {
    notes: await count('Note'),
    highlights: await count('UserMark'),
    bookmarks: await count('Bookmark'),
  };

  return { added, duplicates, noteConflicts, bookmarksSkipped, totals };
}

/**
 * Une sauvegarde à fusionner : l'archive brute, ou une sauvegarde déjà lue.
 *
 * L'app passe la seconde forme : la base a été décompressée au moment du
 * choix, pour compter ce qu'affiche la carte fichier, et la relire à la fusion
 * doublerait le travail le plus coûteux de tout le parcours.
 */
export type BackupInput = Uint8Array | Backup;



/** Fusionne deux sauvegardes .jwlibrary et renvoie l'archive produite. */
export async function mergeBackups(
  baseInput: BackupInput,
  sourceInput: BackupInput,
  options: MergeOptions,
): Promise<{ file: Uint8Array; report: MergeReport; fileName: string }> {
  // Décompresser une archive bloque le thread JS d'un seul tenant : c'est la
  // phase la plus longue avant que la moindre ligne soit lue, et elle est
  // annoncée pour que l'appelant puisse rafraîchir son écran entre les deux.
  // D'où l'intérêt de recevoir des sauvegardes déjà lues : il ne reste alors
  // que les pièces jointes à inflater.
  const tick = async (step: string, done: number, total: number) => {
    await options.onProgress?.(step, done, total);
  };

  /**
   * Lit une sauvegarde en signalant l'avancement dans la moitié d'étape qui
   * lui revient — `half` vaut 0 pour la première, 1 pour la seconde.
   */
  const readSide = async (input: BackupInput, half: number): Promise<Backup> => {
    const onSlice: SliceCallback = async (done, total) => {
      await tick('lecture', half + (total > 0 ? done / total : 1), 2);
    };
    const parsed = input instanceof Uint8Array
      ? await readBackup(input, { onSlice })
      : input;
    return resolveAttachments(parsed, onSlice);
  };

  const lap = stopwatch('fusion', 'étape');
  await tick('lecture', 0, 2);
  const base = await readSide(baseInput, 0);
  lap('lecture de la première sauvegarde');
  const source = await readSide(sourceInput, 1);
  lap('lecture de la seconde sauvegarde');
  await tick('lecture', 2, 2);

  for (const b of [base, source]) {
    const v = b.manifest.userDataBackup.schemaVersion;
    if (v !== SUPPORTED_SCHEMA_VERSION) {
      throw new AppError({
        title: 'Format non pris en charge',
        message: 'Cette sauvegarde a été produite par une version de JW Library que Confluent ne sait pas encore lire.',
        hint: 'Mets Confluent à jour ; en attendant, la fusion risquerait de perdre des données.',
        technical: `schemaVersion ${v}, attendu ${SUPPORTED_SCHEMA_VERSION}`,
      });
    }
  }

  const baseDb = await options.host.open('merge-base.db', base.database, base.sidecars);
  const srcDb = await options.host.open('merge-source.db', source.database, source.sidecars);
  lap('ouverture des deux bases');

  try {
    // Une sauvegarde Android peut arriver avec un WAL non intégré : sans
    // checkpoint, les données les plus récentes seraient invisibles. Sans
    // journal à côté de la base, le checkpoint n'aurait rien à intégrer.
    if (Object.keys(base.sidecars).length > 0) await baseDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    if (Object.keys(source.sidecars).length > 0) await srcDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    const report = await mergeDatabases(baseDb, srcDb, {
      onProgress: options.onProgress,
      conflictStrategy: options.conflictStrategy,
    });
    lap('fusion des tables');
    const merged: Backup = {
      manifest: base.manifest,
      database: await timed('fusion', 'base sérialisée', () => baseDb.serialize()),
      // Le journal a été intégré par le checkpoint : l'archive produite n'en
      // porte pas, et `writeBackup` n'en écrit de toute façon jamais.
      sidecars: {},
      attachments: { ...source.attachments, ...base.attachments },
    };

    const fileName = options.outputName
      ?? `UserdataBackup_${new Date().toISOString().slice(0, 10)}_Merged.jwlibrary`;
    await tick('archive', 0, 1);
    // La compression de la base avance par tranches : la barre la suit.
    const file = await timed('fusion', 'archive écrite',
      () => writeBackup(merged, fileName, options.sha256, (done, total) => tick('archive', done, total)));
    await tick('archive', 1, 1);
    return { file, report, fileName };
  } finally {
    await baseDb.close();
    await srcDb.close();
  }
}
