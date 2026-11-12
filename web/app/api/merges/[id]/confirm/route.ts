/**
 * `POST /api/merges/:id/confirm`
 * `{ fileName, report, sources, strategy, backups }` → `200 SavedMerge`
 *
 * Seconde étape de l'enregistrement d'une fusion (la première est
 * `POST /api/uploads` avec `kind: 'merge'`). Vérifie chez R2 que le fichier
 * est arrivé à la taille annoncée, passe la fusion en `ready`, puis libère
 * les emplacements des sauvegardes qu'elle a consommées.
 *
 * Un emplacement n'est libéré que s'il contient **encore** la sauvegarde
 * fusionnée. Si une autre y a été déposée pendant la fusion (la tablette
 * fusionne, le téléphone redépose un A), elle reste, et la réponse le dit
 * dans `slotsKept`.
 *
 * Le compte garde `MERGE_QUOTA` fusions : au-delà, les plus anciennes sont
 * supprimées, fichier et ligne.
 */
import { z } from 'zod';

import type { KeptSlot, SavedMerge } from '@core/cloud/types';

import {
  apiError,
  mergeReportSchema,
  notFound,
  readBody,
  strategyToDb,
  toBackupDto,
  toMergeDto,
} from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enforceMergeQuota } from '@/lib/limits';
import { head } from '@/lib/r2';

const SLOTS = ['a', 'b'] as const;
const backupId = z.string().min(1).max(128);

const body = z.object({
  fileName: z.string().trim().min(1).max(255),
  report: mergeReportSchema,
  sources: z.string().trim().max(500),
  strategy: z.enum(['keep-both', 'newest']),
  // Les sauvegardes déposées qui ont servi, par emplacement : aucune si la
  // fusion part de fichiers locaux.
  backups: z.object({ a: backupId.optional(), b: backupId.optional() }).optional(),
  // Forme d'avant YKO-54, encore envoyée par les apps déjà installées : les
  // identifiants seuls, sans leur emplacement.
  backupIds: z.array(backupId).max(2).optional(),
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
    if (row.fileName === input.fileName) return Response.json({ ...toMergeDto(row), slotsKept: [] } satisfies SavedMerge);
    return apiError(409, 'already_confirmed', 'Cette fusion a déjà été enregistrée.');
  }

  const stored = await head(row.objectKey);
  if (stored === null) {
    return apiError(422, 'upload_missing', 'Le fichier n’est pas arrivé : recommence l’envoi.');
  }
  if (stored !== row.size) {
    return apiError(422, 'size_mismatch', 'Le fichier reçu n’a pas la taille annoncée : recommence l’envoi.');
  }

  const { confirmed, slotsKept } = await prisma.$transaction(async (tx) => {
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

    const kept: KeptSlot[] = [];
    for (const slot of SLOTS) {
      const used = input.backups?.[slot];
      if (!used) continue;
      // Libérer seulement si l'emplacement tient encore cette sauvegarde : la
      // condition est dans la même requête, rien ne peut s'intercaler.
      const freed = await tx.backup.updateMany({
        where: { id: used, userId: user.id, slot },
        data: { slot: null },
      });
      if (freed.count > 0) continue;
      const current = await tx.backup.findFirst({ where: { userId: user.id, slot, status: 'ready' } });
      if (current) kept.push({ slot, backup: toBackupDto(current) });
    }

    // Anciens clients : on ne sait pas d'où venait chaque sauvegarde, on libère
    // celles qui ont encore un emplacement, sans rien signaler.
    if (input.backupIds?.length) {
      await tx.backup.updateMany({
        where: { id: { in: input.backupIds }, userId: user.id, slot: { not: null } },
        data: { slot: null },
      });
    }
    return { confirmed: merge, slotsKept: kept };
  });

  // Au-delà du quota, les plus anciennes partent. La fusion est déjà
  // enregistrée : un échec ici se journalise sans faire échouer la réponse,
  // et la prochaine confirmation retentera.
  try {
    await enforceMergeQuota(user.id);
  } catch (err) {
    console.error(`[quota] fusions de ${user.id} : suppression des plus anciennes en échec`, err);
  }
  return Response.json({ ...toMergeDto(confirmed), slotsKept } satisfies SavedMerge);
}
