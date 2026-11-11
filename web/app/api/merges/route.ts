/**
 * `GET /api/merges?cursor=` → `{ items: MergeDto[], next? }`
 *
 * L'historique des fusions enregistrées, du plus récent au plus ancien, par
 * pages de 20. `next` est l'identifiant de la dernière fusion de la page.
 */
import type { MergePage } from '@core/cloud/types';

import { apiError, toMergeDto } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

const PAGE_SIZE = 20;

export async function GET(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;

  const cursor = new URL(req.url).searchParams.get('cursor');
  if (cursor !== null) {
    // Un curseur doit désigner une fusion de l'utilisateur : sinon la page
    // partirait de la position d'une fusion qui ne lui appartient pas.
    const own = await prisma.merge.findFirst({ where: { id: cursor, userId: user.id }, select: { id: true } });
    if (!own) return apiError(400, 'invalid_cursor', 'Curseur de pagination invalide.');
  }

  // Une de plus que la page, pour savoir s'il en reste.
  const rows = await prisma.merge.findMany({
    where: { userId: user.id, status: 'ready' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, PAGE_SIZE).map(toMergeDto);
  const page: MergePage = rows.length > PAGE_SIZE ? { items, next: items.at(-1)!.id } : { items };
  return Response.json(page, { headers: { 'Cache-Control': 'no-store' } });
}
