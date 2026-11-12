/**
 * Ce que l'API de synchronisation échange avec l'app et le site.
 *
 * Partagé par le serveur (`web/app/api/*`) et les clients : ces types ne
 * dépendent d'aucune plateforme et n'importent rien de Prisma, pour que le
 * bundle Expo n'atteigne jamais le client de base de données. YKO-44 y ajoute
 * les fusions et le client HTTP.
 */
import type { BackupCounts } from '../backup-info';
import type { ConflictStrategy, MergeReport } from '../merge';

export type Slot = 'a' | 'b';

/** Type de fichier envoyé : une sauvegarde à poser dans un emplacement, ou une fusion. */
export type UploadKind = 'backup' | 'merge';

/** Taille maximale d'un fichier envoyé : 200 Mo. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Réponse de `POST /api/uploads` : où envoyer le fichier, et sous quel identifiant le confirmer. */
export interface UploadTicket {
  id: string;
  /** URL présignée, valable 10 minutes. Le corps doit faire exactement la taille annoncée. */
  putUrl: string;
}

/** Une sauvegarde déposée et confirmée. */
export interface BackupDto {
  id: string;
  slot: Slot | null;
  name: string;
  size: number;
  sha256: string;
  deviceName: string;
  /** Date de la sauvegarde selon JW Library, ISO 8601. */
  backupCreatedAt: string;
  counts: BackupCounts | null;
  /** Appareil d'où elle a été envoyée (« iPhone », « Chrome sur Windows »…). */
  uploadedFrom: string | null;
  /** Date du dépôt, ISO 8601. */
  createdAt: string;
}

/** Réponse de `GET /api/slots`. */
export interface Slots {
  a: BackupDto | null;
  b: BackupDto | null;
}

/** Une fusion enregistrée et confirmée. */
export interface MergeDto {
  id: string;
  /** Nom du fichier produit, celui sous lequel il se télécharge. */
  fileName: string;
  size: number;
  sha256: string;
  /** Les sauvegardes d'origine, telles que l'historique les affiche (« iPad + Pixel »). */
  sources: string;
  strategy: ConflictStrategy;
  report: MergeReport;
  /** Date de l'enregistrement, ISO 8601. */
  createdAt: string;
}

/** Ce que le client envoie pour enregistrer une fusion (`POST /api/merges/:id/confirm`). */
export interface MergeMeta {
  fileName: string;
  report: MergeReport;
  sources: string;
  strategy: ConflictStrategy;
  /**
   * Les sauvegardes déposées qui ont servi, par emplacement. Le serveur libère
   * un emplacement seulement s'il contient **encore** celle-là ; si une autre
   * y a été déposée pendant la fusion, elle reste (voir `SavedMerge`).
   */
  backups: Partial<Record<Slot, string>>;
}

/** Un emplacement laissé en place : une autre sauvegarde y a été déposée pendant la fusion. */
export interface KeptSlot {
  slot: Slot;
  /** La sauvegarde qui occupe maintenant l'emplacement. */
  backup: BackupDto;
}

/** Réponse de `POST /api/merges/:id/confirm`. */
export interface SavedMerge extends MergeDto {
  /** Vide dans le cas courant, où les emplacements consommés sont libérés. */
  slotsKept: KeptSlot[];
}

/**
 * Ce que l'écran dit d'un emplacement laissé en place :
 * « Un nouveau fichier A a été déposé entre-temps depuis iPhone. »
 */
export function describeKeptSlot({ slot, backup }: KeptSlot): string {
  const from = backup.uploadedFrom ? ` depuis ${backup.uploadedFrom}` : '';
  return `Un nouveau fichier ${slot.toUpperCase()} a été déposé entre-temps${from}. Il reste dans le compte pour la prochaine fusion.`;
}

/** Une page de `GET /api/merges`, du plus récent au plus ancien. */
export interface MergePage {
  items: MergeDto[];
  /** À repasser en `?cursor=` pour la page suivante ; absent sur la dernière. */
  next?: string;
}

/** Réponse de `GET /api/files/:kind/:id`. */
export interface DownloadLink {
  /** URL présignée, valable 5 minutes, qui enregistre le fichier sous son nom. */
  url: string;
}

/** Corps d'une réponse d'erreur de l'API. */
export interface ApiError {
  /** Code stable, à tester côté client (`not_found`, `upload_missing`…). */
  error: string;
  /** Message en français, montrable tel quel. */
  message: string;
}
