/**
 * Les bornes d'un compte : combien de fusions il garde, à quel rythme il
 * peut déposer des fichiers, et combien de codes une adresse peut recevoir.
 *
 * Réservé au serveur.
 */
import 'server-only';

import { createHash } from 'node:crypto';

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
  return takeToken(`upload:${userId}`, UPLOADS_PER_WINDOW, UPLOAD_WINDOW_MS, now);
}

/** Demandes de code par adresse e-mail et par fenêtre, pour chaque usage. */
export const CODES_PER_WINDOW = 5;
export const CODE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Compte une demande de code envoyé par e-mail, par adresse et par usage
 * (confirmation ou réinitialisation), qu'un compte existe ou non.
 *
 * Better Auth limite déjà par adresse IP ; mais en changeant d'IP, on
 * pourrait redemander des codes sans fin, et chaque nouveau code ouvre 5
 * essais. Par adresse, la porte se ferme. L'appel doit précéder la création
 * du code : un code créé mais non envoyé resterait attaquable.
 */
export async function takeEmailCodeToken(
  purpose: 'verify' | 'reset',
  email: string,
  now = Date.now(),
): Promise<UploadAllowance> {
  // L'adresse brute n'a pas besoin d'être lisible en base : une empreinte
  // courte suffit, et borne la longueur de la clé.
  const digest = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
  return takeToken(`otp:${purpose}:${digest}`, CODES_PER_WINDOW, CODE_WINDOW_MS, now);
}

/**
 * Compteur à fenêtre fixe dans la table `rateLimit` de Better Auth, sous une
 * clé qu'il n'utilise pas. Ici `lastRequest` porte le début de la fenêtre.
 *
 * Une seule requête, atomique : deux demandes simultanées ne peuvent pas lire
 * le même compteur.
 */
async function takeToken(key: string, max: number, windowMs: number, now: number): Promise<UploadAllowance> {
  const start = BigInt(now);
  const expired = BigInt(now - windowMs);
  const [row] = await prisma.$queryRaw<{ count: number; lastRequest: bigint }[]>`
    INSERT INTO "rateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${key}, ${key}, 1, ${start})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "rateLimit"."lastRequest" <= ${expired} THEN 1 ELSE "rateLimit"."count" + 1 END,
      "lastRequest" = CASE WHEN "rateLimit"."lastRequest" <= ${expired} THEN ${start} ELSE "rateLimit"."lastRequest" END
    RETURNING "count", "lastRequest"`;
  if (!row || row.count <= max) return { allowed: true };
  const endsAt = Number(row.lastRequest) + windowMs;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((endsAt - now) / 1000)) };
}
