/**
 * `DELETE /api/slots/:slot` → `204`
 *
 * Vide l'emplacement. La sauvegarde reste en base, détachée (`slot = null`),
 * et son fichier expire dans R2 avec la règle de cycle de vie. Vider un
 * emplacement déjà vide réussit aussi.
 */
import { notFound, slotSchema } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function DELETE(req: Request, { params }: { params: Promise<{ slot: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const slot = slotSchema.safeParse((await params).slot);
  if (!slot.success) return notFound();

  await prisma.backup.updateMany({ where: { userId: user.id, slot: slot.data }, data: { slot: null } });
  return new Response(null, { status: 204 });
}
