/**
 * `POST /api/merges/:id/promote` → `200 BackupDto`
 *
 * Place une fusion du compte dans l'emplacement A : le fichier fusionné doit
 * être restauré sur chaque appareil, et la prochaine fusion part de lui. Le
 * fichier est copié dans R2 (`backups/{userId}/{nouvel id}.jwlibrary`), sans
 * passer par le client ni par le serveur ; la fusion, elle, reste dans
 * l'historique.
 *
 * Si l'emplacement A contient déjà ce fichier, rien n'est copié et la réponse
 * est la sauvegarde en place.
 */
import type { MergeReport } from '@core/merge';

import { notFound, toBackupDto } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { backupKey, copy, remove } from '@/lib/r2';

/** « Déposé depuis une fusion » sous la carte A. */
const FROM_MERGE = 'une fusion';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const { id } = await params;

  const merge = await prisma.merge.findFirst({ where: { id, userId: user.id, status: 'ready' } });
  if (!merge || !merge.fileName) return notFound();

  const current = await prisma.backup.findFirst({
    where: { userId: user.id, slot: 'a', status: 'ready', sha256: merge.sha256, size: merge.size },
  });
  if (current) return Response.json(toBackupDto(current));

  const backupId = crypto.randomUUID();
  const objectKey = backupKey(user.id, backupId);
  await copy(merge.objectKey, objectKey);

  const totals = (merge.report as unknown as MergeReport | null)?.totals ?? null;
  try {
    const backup = await prisma.$transaction(async (tx) => {
      // D'abord libérer l'emplacement, sinon l'unicité (userId, slot) refuse.
      await tx.backup.updateMany({ where: { userId: user.id, slot: 'a' }, data: { slot: null } });
      return tx.backup.create({
        data: {
          id: backupId,
          userId: user.id,
          slot: 'a',
          objectKey,
          size: merge.size,
          sha256: merge.sha256,
          name: merge.fileName!,
          deviceName: merge.sources || 'Fusion Confluent',
          backupCreatedAt: merge.createdAt,
          counts: totals ? { notes: totals.notes, highlights: totals.highlights, bookmarks: totals.bookmarks } : undefined,
          uploadedFrom: FROM_MERGE,
          status: 'ready',
        },
      });
    });
    return Response.json(toBackupDto(backup));
  } catch (err) {
    // La copie ne doit pas survivre sans ligne qui la désigne.
    await remove(objectKey).catch((cleanup) => console.error(`[promotion] copie ${objectKey} orpheline`, cleanup));
    throw err;
  }
}
