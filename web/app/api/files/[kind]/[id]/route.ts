/**
 * `GET /api/files/:kind/:id` → `{ url }`
 *
 * Lien de téléchargement d'une sauvegarde déposée (`kind = backup`) ou d'une
 * fusion (`kind = merge`) : URL présignée de 5 minutes, qui enregistre le
 * fichier sous son nom. Le fichier ne transite pas par le serveur.
 */
import type { DownloadLink } from '@core/cloud/types';

import { notFound } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { presignGet } from '@/lib/r2';

export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const { kind, id } = await params;

  const where = { id, userId: user.id, status: 'ready' as const };
  let file: { objectKey: string; name: string | null } | null = null;
  if (kind === 'backup') {
    file = await prisma.backup.findFirst({ where, select: { objectKey: true, name: true } });
  } else if (kind === 'merge') {
    const merge = await prisma.merge.findFirst({ where, select: { objectKey: true, fileName: true } });
    file = merge && { objectKey: merge.objectKey, name: merge.fileName };
  }
  if (!file?.name) return notFound();

  const link: DownloadLink = { url: await presignGet(file.objectKey, file.name) };
  return Response.json(link, { headers: { 'Cache-Control': 'no-store' } });
}
