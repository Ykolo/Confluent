/**
 * `DELETE /api/merges/:id` → `204`
 *
 * Supprime la fusion : d'abord son fichier dans R2, puis sa ligne. Dans cet
 * ordre, un échec de R2 laisse la ligne en place et la suppression peut être
 * retentée ; l'inverse laisserait un fichier orphelin que plus rien ne vise.
 */
import { notFound } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { remove } from '@/lib/r2';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const { id } = await params;

  const row = await prisma.merge.findFirst({ where: { id, userId: user.id }, select: { id: true, objectKey: true } });
  if (!row) return notFound();

  await remove(row.objectKey);
  await prisma.merge.delete({ where: { id: row.id } });
  return new Response(null, { status: 204 });
}
