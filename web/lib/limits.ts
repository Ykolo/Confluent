/**
 * Les bornes d'un compte : combien de fusions il garde, et à quel rythme il
 * peut déposer des fichiers.
 *
 * Réservé au serveur.
 */
import 'server-only';

import { prisma } from '@/lib/db';
import { remove } from '@/lib/r2';

/** Fusions gardées par compte, comme l'historique local (`LIMIT` de `history.ts`). */
export const MERGE_QUOTA = 30;

/**
 * Au-delà de `MERGE_QUOTA` fusions enregistrées, supprime les plus anciennes :
 * d'abord le fichier dans R2, puis la ligne, comme `DELETE /api/merges/:id`.
 * Un échec laisse la fusion en place ; la prochaine confirmation retentera.
 *
 * Renvoie les identifiants supprimés.
 */
export async function enforceMergeQuota(userId: string): Promise<string[]> {
  const extra = await prisma.merge.findMany({
    where: { userId, status: 'ready' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: MERGE_QUOTA,
    select: { id: true, objectKey: true },
  });
  const removed: string[] = [];
  for (const merge of extra) {
    await remove(merge.objectKey);
    await prisma.merge.delete({ where: { id: merge.id } });
    removed.push(merge.id);
  }
  return removed;
}

/** Envois autorisés par fenêtre, et durée de la fenêtre. */
export const UPLOADS_PER_WINDOW = 20;
export const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export type UploadAllowance = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Compte un envoi pour l'utilisateur, par fenêtre fixe d'une heure. Le compteur
 * vit dans la table `rateLimit` de Better Auth (clé `upload:{userId}`, que
 * Better Auth n'utilise pas) : en mémoire, il repartirait de zéro à chaque
 * fonction Vercel. Ici `lastRequest` porte le début de la fenêtre.
 *
 * Une seule requête, atomique : deux envois simultanés ne peuvent pas lire le
 * même compteur.
 */
export async function takeUploadToken(userId: string, now = Date.now()): Promise<UploadAllowance> {
  const key = `upload:${userId}`;
  const start = BigInt(now);
  const expired = BigInt(now - UPLOAD_WINDOW_MS);
  const [row] = await prisma.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${key}, ${key}, 1, ${start})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rateLimit"."lastRequest" <= ${expired} THEN 1 ELSE "rateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "rateLimit"."lastRequest" <= ${expired} THEN ${start} ELSE "rateLimit"."lastRequest" END
    RETURNING "count", "lastRequest"`;
  if (!row || row.count <= UPLOADS_PER_WINDOW) return { allowed: true };
  const endsAt = Number(row.lastRequest) + UPLOAD_WINDOW_MS;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((endsAt - now) / 1000)) };
}
