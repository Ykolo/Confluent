/**
 * `GET /api/slots` → `{ a: BackupDto | null, b: BackupDto | null }`
 *
 * Les deux sauvegardes déposées de l'utilisateur, prêtes à fusionner.
 */
import type { Slots } from '@core/cloud/types';

import { toBackupDto } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const rows = await prisma.backup.findMany({
    where: { userId: user.id, status: 'ready', slot: { not: null } },
  });
  const slots: Slots = { a: null, b: null };
  for (const row of rows) slots[row.slot!] = toBackupDto(row);
  return Response.json(slots, { headers: { 'Cache-Control': 'no-store' } });
}
