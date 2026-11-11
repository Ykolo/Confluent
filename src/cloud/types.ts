/**
 * Ce que l'API de synchronisation échange avec l'app et le site.
 *
 * Partagé par le serveur (`web/app/api/*`) et les clients : ces types ne
 * dépendent d'aucune plateforme et n'importent rien de Prisma, pour que le
 * bundle Expo n'atteigne jamais le client de base de données. YKO-44 y ajoute
 * les fusions et le client HTTP.
 */
import type { BackupCounts } from '../backup-info';

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

/** Corps d'une réponse d'erreur de l'API. */
export interface ApiError {
  /** Code stable, à tester côté client (`not_found`, `upload_missing`…). */
  error: string;
  /** Message en français, montrable tel quel. */
  message: string;
}
