/**
 * Briques communes aux routes `app/api/*` : réponses d'erreur, lecture d'un
 * corps JSON validé par Zod, et conversion des lignes Prisma en DTO.
 *
 * Une route ne renvoie jamais un modèle Prisma brut : `userId`, `objectKey`
 * et le statut interne restent côté serveur.
 */
import 'server-only';

import { z } from 'zod';

import type { ApiError, BackupDto, Slot } from '@core/cloud/types';

import type { Backup } from '@/generated/prisma/client';

export function apiError(status: number, error: string, message: string): Response {
  return Response.json({ error, message } satisfies ApiError, { status });
}

/**
 * Une ressource absente **ou appartenant à un autre utilisateur** : même
 * réponse dans les deux cas, pour ne rien révéler de ce qui existe.
 */
export const notFound = () => apiError(404, 'not_found', 'Introuvable.');

/** Le corps JSON de la requête, validé ; ou une réponse 400 à renvoyer telle quelle. */
export async function readBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return apiError(400, 'invalid_json', 'Le corps de la requête doit être du JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.') || 'corps').join(', ');
    return apiError(400, 'invalid_body', `Requête invalide (${where}).`);
  }
  return parsed.data;
}

export const slotSchema = z.enum(['a', 'b']);
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'SHA-256 en hexadécimal minuscule');

/** Une ligne `ready` en DTO. Les champs de confirmation y sont toujours présents. */
export function toBackupDto(row: Backup): BackupDto {
  if (row.status !== 'ready' || !row.name || !row.deviceName || !row.backupCreatedAt) {
    throw new Error(`backup ${row.id} : DTO demandé pour une ligne non confirmée`);
  }
  return {
    id: row.id,
    slot: row.slot as Slot | null,
    name: row.name,
    size: row.size,
    sha256: row.sha256,
    deviceName: row.deviceName,
    backupCreatedAt: row.backupCreatedAt.toISOString(),
    counts: (row.counts as BackupDto['counts']) ?? null,
    uploadedFrom: row.uploadedFrom,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Code d'erreur Prisma d'une violation d'unicité (deux confirmations simultanées sur un emplacement). */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}
