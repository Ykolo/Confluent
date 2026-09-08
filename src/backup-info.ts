/**
 * Lecture d'une sauvegarde choisie par l'utilisateur, pour alimenter la carte
 * « Fichier A / Fichier B » de l'écran d'accueil.
 *
 * La lecture se fait en deux temps, parce que les deux moitiés n'ont pas du
 * tout le même coût : le manifeste pèse quelques centaines d'octets et se lit
 * instantanément, la base pèse plusieurs mégaoctets et demande des secondes.
 * L'écran affiche donc la carte dès le manifeste — appareil, date, taille —
 * et les compteurs la complètent ensuite.
 */
import { AppError, logInfo, timed } from './errors';
import {
  readBackup, readManifest, SUPPORTED_SCHEMA_VERSION,
  type Backup, type Manifest, type SliceCallback, type SqliteHost,
} from './merge';

export interface BackupCounts {
  notes: number;
  highlights: number;
  bookmarks: number;
}

export interface BackupInfo {
  /** Nom du fichier tel que choisi. */
  name: string;
  /** Taille de l'archive, en octets. */
  size: number;
  deviceName: string;
  createdAt: string;
  /** Ce que contient la sauvegarde, `null` tant que la base n'a pas été lue. */
  counts: BackupCounts | null;
  /**
   * La sauvegarde décompressée : manifeste, base et journal. `null` tant que
   * la lecture est en cours. Les pièces jointes, elles, restent à lire — la
   * fusion les réclamera. C'est cet objet, et non l'archive brute, qu'on lui
   * passe : la base est ce qu'il y a de plus long à décompresser, et la relire
   * doublerait l'attente.
   */
  backup: Backup | null;
}

/** Compteur unique par appel : `host.open` exige un nom de fichier distinct. */
let serial = 0;

/**
 * Signalement d'étape. La lecture enchaîne des phases qui retiennent le thread
 * JS ; le retour peut être une promesse, ce qui permet à l'appelant de rendre
 * la main à la boucle d'événements et de laisser l'écran se rafraîchir.
 */
export type StepCallback = (step: string) => void | Promise<void>;

export interface InspectHooks {
  /**
   * Appelé dès le manifeste lu, donc quasi immédiatement, avec une fiche sans
   * compteurs. De quoi peupler la carte pendant que la base se décompresse.
   */
  onOutline?: (info: BackupInfo) => void;
  onStep?: StepCallback;
  /** Voir `SliceCallback` : appelé pendant la décompression de la base. */
  onSlice?: SliceCallback;
}

function outlineOf(name: string, size: number, manifest: Manifest): BackupInfo {
  return {
    name,
    size,
    deviceName: manifest.userDataBackup.deviceName,
    createdAt: manifest.userDataBackup.lastModifiedDate,
    counts: null,
    backup: null,
  };
}

function checkVersion(manifest: Manifest): void {
  const version = manifest.userDataBackup.schemaVersion;
  if (version === SUPPORTED_SCHEMA_VERSION) return;
  throw new AppError({
    title: 'Format non pris en charge',
    message: 'Cette sauvegarde a été produite par une version de JW Library que Confluent ne sait pas encore lire.',
    hint: 'Mets Confluent à jour ; en attendant, la fusion risquerait de perdre des données.',
    technical: `schemaVersion ${version}, attendu ${SUPPORTED_SCHEMA_VERSION}`,
  });
}

/**
 * Vérifie l'archive et compte ce que l'écran d'accueil affiche. Lève une
 * erreur lisible si le fichier n'est pas une sauvegarde exploitable — mieux
 * vaut le dire au moment du choix qu'au bout de la fusion.
 */
export async function inspectBackup(
  name: string,
  bytes: Uint8Array,
  host: SqliteHost,
  hooks: InspectHooks = {},
): Promise<BackupInfo> {
  const { onOutline, onStep = () => {}, onSlice } = hooks;

  // Le manifeste d'abord : c'est ce qui permet de refuser tout de suite un
  // fichier qui n'est pas une sauvegarde, et d'afficher la carte sans attendre.
  const manifest = readManifest(bytes);
  checkVersion(manifest);
  const outline = outlineOf(name, bytes.byteLength, manifest);
  onOutline?.(outline);

  await onStep('décompression');
  // Les pièces jointes ne servent qu'à la fusion : les inflater ici
  // n'allongerait l'attente que pour des vignettes que cet écran n'affiche pas.
  const backup = await timed('lecture', 'décompression',
    () => readBackup(bytes, { withAttachments: false, onSlice }));

  logInfo('lecture', `${name} — ${bytes.byteLength} octets, appareil ${manifest.userDataBackup.deviceName}, `
    + `annexes : ${Object.keys(backup.sidecars).join(', ') || 'aucune'}`);

  await onStep('ouverture de la base');
  const db = await timed('lecture', 'base prête',
    () => host.open(`inspect-${serial++}.db`, backup.database, backup.sidecars));
  try {
    await onStep('comptage');
    // Une sauvegarde Android peut arriver avec un WAL non intégré : sans
    // checkpoint, les données les plus récentes seraient invisibles ici aussi,
    // et les compteurs affichés seraient faux. Sans journal à côté de la base,
    // en revanche, le checkpoint n'a rien à intégrer : on ne le demande pas.
    if (Object.keys(backup.sidecars).length > 0) {
      await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      logInfo('lecture', 'journal WAL intégré');
    }
    const one = async (table: string) => {
      const [r] = await db.all<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`);
      logInfo('lecture', `${table} : ${r.c}`);
      return Number(r.c);
    };
    return await timed('lecture', 'comptage', async () => ({
      ...outline,
      backup,
      counts: {
        notes: await one('Note'),
        highlights: await one('UserMark'),
        bookmarks: await one('Bookmark'),
      },
    }));
  } finally {
    await db.close();
  }
}
