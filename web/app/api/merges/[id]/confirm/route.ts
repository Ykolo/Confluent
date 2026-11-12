/**
 * `POST /api/merges/:id/confirm`
 * `{ fileName, report, sources, strategy, backupIds }` → `200 MergeDto`
 *
 * Seconde étape de l'enregistrement d'une fusion (la première est
 * `POST /api/uploads` avec `kind: 'merge'`). Vérifie chez R2 que le fichier
 * est arrivé à la taille annoncée, passe la fusion en `ready`, puis libère
 * les emplacements des sauvegardes qu'elle a consommées.
 *
 * Un emplacement n'est libéré que s'il contient **encore** la sauvegarde
 * fusionnée : si une autre a été déposée pendant la fusion, elle reste.
 *
 * Le compte garde `MERGE_QUOTA` fusions : au-delà, les plus anciennes sont
 * supprimées, fichier et ligne.
 */
import { z } from 'zod';

import {
  apiError,
  mergeReportSchema,
  notFound,
  readBody,
  strategyToDb,
  toMergeDto,
} from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enforceMergeQuota } from '@/lib/limits';
import { head } from '@/lib/r2';

const body = z.object({
  fileName: z.string().trim().min(1).max(255),
  report: mergeReportSchema,
  sources: z.string().trim().max(500),
  strategy: z.enum(['keep-both', 'newest']),
  // Les sauvegardes déposées qui ont servi : aucune si la fusion part de
  // fichiers locaux, deux au plus.
  backupIds: z.array(z.string().min(1).max(128)).max(2),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const input = await readBody(req, body);
  if (input instanceof Response) return input;
  const { id } = await params;

  const row = await prisma.merge.findFirst({ where: { id, userId: user.id } });
  if (!row) return notFound();
  if (row.status === 'ready') {
    // Déjà confirmée : même réponse si c'est la même demande, conflit sinon.
    if (row.fileName === input.fileName) return Response.json(toMergeDto(row));
    return apiError(409, 'already_confirmed', 'Cette fusion a déjà été enregistrée.');
  }

  const stored = await head(row.objectKey);
  if (stored === null) {
    return apiError(422, 'upload_missing', 'Le fichier n’est pas arrivé : recommence l’envoi.');
  }
  if (stored !== row.size) {
    return apiError(422, 'size_mismatch', 'Le fichier reçu n’a pas la taille annoncée : recommence l’envoi.');
  }

  const confirmed = await prisma.$transaction(async (tx) => {
    const merge = await tx.merge.update({
      where: { id: row.id },
      data: {
        status: 'ready',
        fileName: input.fileName,
        sources: input.sources,
        strategy: strategyToDb(input.strategy),
        report: input.report as object,
      },
    });
    // Filtrer sur l'id **et** l'utilisateur : une sauvegarde remplacée entre-temps
    // n'a plus d'emplacement, et celle d'un autre utilisateur n'est jamais touchée.
    if (input.backupIds.length) {
      await tx.backup.updateMany({
        where: { id: { in: input.backupIds }, userId: user.id, slot: { not: null } },
        data: { slot: null },
      });
    }
    return merge;
  });

  // Au-delà du quota, les plus anciennes partent. La fusion est déjà
  // enregistrée : un échec ici se journalise sans faire échouer la réponse,
  // et la prochaine confirmation retentera.
  try {
    await enforceMergeQuota(user.id);
  } catch (err) {
    console.error(`[quota] fusions de ${user.id} : suppression des plus anciennes en échec`, err);
  }
  return Response.json(toMergeDto(confirmed));
}
