/**
 * Deux sauvegardes factices, fabriquées à la volée pour les tests.
 *
 * Les vraies sauvegardes portent des notes et des surlignages personnels :
 * elles restent hors du dépôt, et donc hors de la CI. Celles-ci reprennent le
 * schéma réel (`schema.sql`) et les particularités qui ont déjà cassé la
 * fusion une fois :
 *
 * - iPad : base en mode `delete`, hash du manifeste tronqué à 62 caractères ;
 * - Android : base en mode WAL, avec un journal dont les écritures ne sont
 *   *pas* dans le fichier principal ;
 * - des lieux qui ne diffèrent que par une colonne, les autres étant NULL ;
 * - un même lieu titré différemment d'un appareil à l'autre ;
 * - des notes modifiées des deux côtés, des signets sur le même slot ;
 * - des identifiants internes différents pour les mêmes lignes.
 *
 * Pour rejouer les tests sur de vraies sauvegardes, en local :
 *
 *     CONFLUENT_IPAD=chemin.jwlibrary CONFLUENT_ANDROID=chemin.jwlibrary bun test
 */
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, type Zippable } from 'fflate';

const SCHEMA = readFileSync(join(import.meta.dir, 'schema.sql'), 'utf8');
/** Ce déclencheur interdit d'insérer dans LastModified : la ligne doit exister avant lui. */
const LOCK = 'CREATE TRIGGER TR_Raise_Error_Before_Insert_LastModified';

type Value = string | number | null;
type Rows = Record<string, Value>[];

interface Side {
  locations: Rows;
  marks: Rows;
  ranges: Rows;
  notes: Rows;
  tags: Rows;
  tagMaps: Rows;
  bookmarks: Rows;
  fields: Rows;
  media: Rows;
}

function insert(db: Database, table: string, rows: Rows) {
  for (const row of rows) {
    const cols = Object.keys(row);
    db.run(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`,
      cols.map((c) => row[c]) as never[]);
  }
}

function createSchema(db: Database, lastModified: string) {
  const at = SCHEMA.indexOf(LOCK);
  db.exec(SCHEMA.slice(0, at));
  db.run('INSERT INTO LastModified VALUES(?)', [lastModified]);
  db.exec(SCHEMA.slice(at));
  db.exec('PRAGMA user_version = 16');
}

/** Tables dans l'ordre des clés étrangères. */
function fill(db: Database, side: Partial<Side>) {
  insert(db, 'Location', side.locations ?? []);
  insert(db, 'UserMark', side.marks ?? []);
  insert(db, 'BlockRange', side.ranges ?? []);
  insert(db, 'Note', side.notes ?? []);
  insert(db, 'Tag', side.tags ?? []);
  insert(db, 'TagMap', side.tagMaps ?? []);
  insert(db, 'Bookmark', side.bookmarks ?? []);
  insert(db, 'InputField', side.fields ?? []);
  insert(db, 'IndependentMedia', side.media ?? []);
}

// ---------------------------------------------------------------------------
// Contenu
// ---------------------------------------------------------------------------

/** Lieux, identifiés par un nom stable ; chaque côté leur donne ses propres IDs. */
const PLACES: Record<string, Record<string, Value>> = {
  bible: { KeySymbol: 'nwtsty', MepsLanguage: 0, Type: 1, Title: 'Bible' },
  gen1: { BookNumber: 1, ChapterNumber: 1, KeySymbol: 'nwtsty', MepsLanguage: 0, Type: 0, Title: 'Genèse 1' },
  jn3: { BookNumber: 43, ChapterNumber: 3, KeySymbol: 'nwtsty', MepsLanguage: 0, Type: 0, Title: 'Jean 3' },
  ps23: { BookNumber: 19, ChapterNumber: 23, KeySymbol: 'nwtsty', MepsLanguage: 0, Type: 0, Title: 'Psaume 23' },
  w1: { DocumentId: 1102023101, KeySymbol: 'w', IssueTagNumber: 20230100, MepsLanguage: 0, Type: 0, Title: 'Article 1' },
  w2: { DocumentId: 1102023102, KeySymbol: 'w', IssueTagNumber: 20230100, MepsLanguage: 0, Type: 0, Title: 'Article 2' },
  // Ne diffèrent que par DocumentId, le reste à NULL : un index UNIQUE les
  // confondrait, la clé de fusion ne doit pas.
  doc200: { DocumentId: 200, MepsLanguage: 0, Type: 0 },
  doc201: { DocumentId: 201, MepsLanguage: 0, Type: 0 },
};

/** Octets pseudo-aléatoires mais reproductibles : des médias qui ne se compressent pas. */
function noise(seed: number, size: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed || 1;
  for (let i = 0; i < size; i++) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

const MEDIA: Record<string, { file: string; bytes: Uint8Array }> = {
  cover: { file: '1f0c3a52-9d1e-4b7a-8c11-0a2b3c4d5e01', bytes: noise(1, 90_000) },
  map: { file: '1f0c3a52-9d1e-4b7a-8c11-0a2b3c4d5e02', bytes: noise(2, 70_000) },
  photo: { file: '1f0c3a52-9d1e-4b7a-8c11-0a2b3c4d5e03', bytes: noise(3, 80_000) },
};
const THUMBNAIL = noise(4, 2_000);

interface Spec {
  /** Premier identifiant interne : les deux côtés numérotent différemment. */
  firstId: number;
  places: string[];
  /** Titre propre à ce côté, pour un lieu partagé. */
  titles?: Record<string, string>;
  /** Surlignages : [guid, lieu, nombre de plages]. */
  marks: [string, string, number][];
  /** Notes : [guid, contenu, dernière modification, surlignage ou null]. */
  notes: [string, string, string, string | null][];
  tags: string[];
  /** Étiquettes : [tag, guid de note]. */
  noteTags: [string, string][];
  /** Étiquettes posées sur un lieu : [tag, lieu]. */
  placeTags: [string, string][];
  /** Signets de la Bible : [slot, lieu, titre]. */
  bookmarks: [number, string, string][];
  fields: [string, string, string][];
  media: string[];
}

function build(spec: Spec): Side {
  let id = spec.firstId;
  const loc = new Map<string, number>();
  const locations = spec.places.map((name) => {
    loc.set(name, id);
    return { LocationId: id++, ...PLACES[name], Title: spec.titles?.[name] ?? PLACES[name].Title ?? null };
  });

  const markId = new Map<string, number>();
  const marks: Rows = [];
  const ranges: Rows = [];
  spec.marks.forEach(([guid, place, count], i) => {
    const m = id++;
    markId.set(guid, m);
    marks.push({ UserMarkId: m, ColorIndex: 1 + (i % 6), LocationId: loc.get(place)!, StyleIndex: 0,
      UserMarkGuid: guid, Version: 1 });
    for (let r = 0; r < count; r++) {
      ranges.push({ BlockRangeId: id++, BlockType: 2, Identifier: 1 + i + r, StartToken: 0,
        EndToken: 5 + r, UserMarkId: m });
    }
  });

  const noteId = new Map<string, number>();
  const notes = spec.notes.map(([guid, content, modified, mark], i) => {
    noteId.set(guid, id);
    const m = mark === null ? null : marks.find((r) => r.UserMarkGuid === mark)!;
    return {
      NoteId: id++, Guid: guid, UserMarkId: m ? m.UserMarkId : null, LocationId: m ? m.LocationId : null,
      Title: `Note ${guid.slice(-4)}`, Content: content, LastModified: modified,
      Created: '2026-01-01T08:00:00Z', BlockType: m ? 2 : 0, BlockIdentifier: m ? 1 + i : null,
    };
  });

  const tagId = new Map<string, number>();
  const tags = spec.tags.map((name) => {
    tagId.set(name, id);
    return { TagId: id++, Type: 1, Name: name };
  });
  const position = new Map<string, number>();
  const next = (tag: string) => {
    const p = position.get(tag) ?? 0;
    position.set(tag, p + 1);
    return p;
  };
  const tagMaps: Rows = [
    ...spec.noteTags.map(([tag, guid]) => ({ TagMapId: id++, TagId: tagId.get(tag)!,
      NoteId: noteId.get(guid)!, Position: next(tag) })),
    ...spec.placeTags.map(([tag, place]) => ({ TagMapId: id++, TagId: tagId.get(tag)!,
      LocationId: loc.get(place)!, Position: next(tag) })),
  ];

  const bookmarks = spec.bookmarks.map(([slot, place, title]) => ({
    BookmarkId: id++, LocationId: loc.get(place)!, PublicationLocationId: loc.get('bible')!,
    Slot: slot, Title: title, Snippet: null, BlockType: 0, BlockIdentifier: null,
  }));

  const fields = spec.fields.map(([place, tag, value]) => ({
    LocationId: loc.get(place)!, TextTag: tag, Value: value,
  }));

  const media = spec.media.map((name) => ({
    IndependentMediaId: id++, OriginalFilename: `${name}.jpg`, FilePath: MEDIA[name].file,
    MimeType: 'image/jpeg', Hash: createHash('sha256').update(MEDIA[name].bytes).digest('hex'),
  }));

  return { locations, marks, ranges, notes, tags, tagMaps, bookmarks, fields, media };
}

/** Surlignages en série : assez de lignes pour que la fusion ait du travail. */
const series = (prefix: string, places: string[], n: number): [string, string, number][] =>
  Array.from({ length: n }, (_, i) =>
    [`${prefix}-${String(i).padStart(4, '0')}`, places[i % places.length], 1 + (i % 2)]);

const SHARED_MARKS = series('00000000-share', ['gen1', 'jn3', 'w1'], 40);

const IPAD: Spec = {
  firstId: 1,
  places: ['bible', 'gen1', 'jn3', 'ps23', 'w1', 'w2', 'doc200'],
  marks: [...SHARED_MARKS, ...series('aaaaaaaa-ipad', ['ps23', 'w2', 'doc200'], 60)],
  notes: [
    ['note-same-0001', 'Au commencement', '2026-02-01T10:00:00Z', '00000000-share-0000'],
    ['note-same-0002', 'Note libre, identique partout', '2026-02-02T10:00:00Z', null],
    // Modifiées des deux côtés : la plus récente est ici pour la première.
    ['note-conf-0001', 'Version iPad, la plus récente', '2026-03-10T10:00:00Z', '00000000-share-0001'],
    ['note-conf-0002', 'Version iPad, la plus ancienne', '2026-03-01T10:00:00Z', null],
    ['note-ipad-0001', 'Seulement sur l’iPad', '2026-04-01T10:00:00Z', 'aaaaaaaa-ipad-0000'],
    ['note-ipad-0002', 'Psaume 23, seulement sur l’iPad', '2026-04-02T10:00:00Z', 'aaaaaaaa-ipad-0003'],
  ],
  tags: ['Étude', 'Prière'],
  noteTags: [['Étude', 'note-same-0001'], ['Étude', 'note-conf-0001'], ['Prière', 'note-ipad-0001']],
  placeTags: [['Étude', 'gen1']],
  bookmarks: [[0, 'gen1', 'Genèse 1'], [1, 'jn3', 'Jean 3']],
  fields: [['w1', 'q1', 'Réponse commune'], ['w2', 'q1', 'Réponse iPad']],
  media: ['cover', 'map'],
};

const ANDROID: Spec = {
  firstId: 500,
  // Le même lieu que sur l'iPad, dans un autre ordre, sous un autre titre.
  places: ['w1', 'jn3', 'gen1', 'bible', 'doc201'],
  titles: { jn3: 'John 3' },
  marks: [...SHARED_MARKS.slice().reverse(), ...series('bbbbbbbb-andr', ['jn3', 'doc201'], 60)],
  notes: [
    ['note-same-0001', 'Au commencement', '2026-02-01T10:00:00Z', '00000000-share-0000'],
    ['note-same-0002', 'Note libre, identique partout', '2026-02-02T10:00:00Z', null],
    ['note-conf-0001', 'Version Android, la plus ancienne', '2026-03-05T10:00:00Z', '00000000-share-0001'],
    ['note-conf-0002', 'Version Android, la plus récente', '2026-03-20T10:00:00Z', null],
    ['note-andr-0001', 'Seulement sur Android', '2026-05-01T10:00:00Z', 'bbbbbbbb-andr-0000'],
    ['note-andr-0002', 'Note libre, seulement sur Android', '2026-05-02T10:00:00Z', null],
  ],
  tags: ['Famille', 'Étude'],
  noteTags: [['Étude', 'note-same-0001'], ['Famille', 'note-andr-0002'], ['Étude', 'note-andr-0001']],
  placeTags: [['Étude', 'gen1']],
  // Slot 0 identique à l'iPad, slot 1 pris par un autre lieu : il faudra le déplacer.
  bookmarks: [[0, 'gen1', 'Genèse 1'], [1, 'w1', 'Article 1']],
  fields: [['w1', 'q1', 'Réponse commune'], ['doc201', 'q2', 'Réponse Android']],
  media: ['cover', 'photo'],
};

// ---------------------------------------------------------------------------
// Archives
// ---------------------------------------------------------------------------

function archive(deviceName: string, name: string, lastModified: string, db: Record<string, Uint8Array>,
  media: string[], hash: (h: string) => string): Uint8Array {
  const manifest = {
    name,
    creationDate: lastModified.slice(0, 10),
    version: 1,
    type: 0,
    userDataBackup: {
      lastModifiedDate: lastModified,
      deviceName,
      databaseName: 'userData.db',
      hash: hash(createHash('sha256').update(db['userData.db']).digest('hex')),
      schemaVersion: 16,
    },
  };
  const files: Zippable = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'default_thumbnail.png': [THUMBNAIL, { level: 0 }],
  };
  for (const [entry, bytes] of Object.entries(db)) files[entry] = bytes;
  for (const m of media) files[MEDIA[m].file] = [MEDIA[m].bytes, { level: 0 }];
  return zipSync(files, { level: 6 });
}

function ipadDatabase(): Uint8Array {
  const db = new Database(':memory:');
  createSchema(db, '2026-04-02T10:00:00Z');
  fill(db, build(IPAD));
  const bytes = new Uint8Array(db.serialize());
  db.close();
  return bytes;
}

/**
 * Base Android en mode WAL. Les données propres à Android sont écrites *après*
 * le dernier checkpoint : sans le journal, elles sont invisibles.
 */
function androidDatabase(): Record<string, Uint8Array> {
  const side = build(ANDROID);
  const own = (guid: Value) => String(guid).startsWith('bbbbbbbb') || String(guid).startsWith('note-andr');
  const dir = mkdtempSync(join(tmpdir(), 'confluent-fixture-'));
  const path = join(dir, 'userData.db');
  try {
    const db = new Database(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA wal_autocheckpoint = 0');
    createSchema(db, '2026-05-02T10:00:00Z');
    db.exec('INSERT INTO android_metadata VALUES(\'fr_FR\')');

    const early = side.marks.filter((m) => !own(m.UserMarkGuid));
    const earlyIds = new Set(early.map((m) => m.UserMarkId));
    const notes = side.notes.filter((n) => !own(n.Guid));
    fill(db, {
      locations: side.locations, marks: early,
      ranges: side.ranges.filter((r) => earlyIds.has(r.UserMarkId)), notes,
    });
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');

    // Tout le reste ne vit que dans le journal.
    db.exec('BEGIN');
    fill(db, {
      marks: side.marks.filter((m) => !earlyIds.has(m.UserMarkId)),
      ranges: side.ranges.filter((r) => !earlyIds.has(r.UserMarkId)),
      notes: side.notes.filter((n) => own(n.Guid)),
      tags: side.tags, tagMaps: side.tagMaps, bookmarks: side.bookmarks,
      fields: side.fields, media: side.media,
    });
    db.exec('COMMIT');

    // On lit les octets sans fermer : fermer déclencherait un checkpoint.
    const files = {
      'userData.db': new Uint8Array(readFileSync(path)),
      'userData.db-wal': new Uint8Array(readFileSync(`${path}-wal`)),
      'userData.db-shm': new Uint8Array(readFileSync(`${path}-shm`)),
    };
    db.close();
    return files;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let ipad: Uint8Array | undefined;
let android: Uint8Array | undefined;

/** Sauvegarde iPad : `CONFLUENT_IPAD` si défini, sinon la fausse. */
export function ipadBackup(): Uint8Array {
  const real = process.env.CONFLUENT_IPAD;
  if (real) return new Uint8Array(readFileSync(real));
  // Certaines sauvegardes iOS embarquent un hash tronqué : voir `readBackup`.
  ipad ??= archive('iPad', 'UserdataBackup_2026-04-02_iPad.jwlibrary', '2026-04-02T12:00:00+0200',
    { 'userData.db': ipadDatabase() }, IPAD.media, (h) => h.slice(0, 62));
  return ipad;
}

/** Sauvegarde Android : `CONFLUENT_ANDROID` si défini, sinon la fausse. */
export function androidBackup(): Uint8Array {
  const real = process.env.CONFLUENT_ANDROID;
  if (real) return new Uint8Array(readFileSync(real));
  android ??= archive('Samsung_SM-S911B', 'UserdataBackup_2026-05-02_Samsung_SM-S911B.jwlibrary',
    '2026-05-02T10:00:00Z', androidDatabase(), ANDROID.media, (h) => h);
  return android;
}
