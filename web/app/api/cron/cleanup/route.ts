/**
 * `GET /api/cron/cleanup` → `200 CleanupReport`
 *
 * Appelée chaque jour par le Cron Vercel (`vercel.json`), qui envoie
 * `Authorization: Bearer $CRON_SECRET`. Sans `CRON_SECRET` configuré, la
 * route refuse tout : personne d'autre ne peut déclencher le ménage.
 */
import { timingSafeEqual } from 'node:crypto';

import { apiError } from '@/lib/api';
import { cleanup } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) return apiError(401, 'unauthorized', 'Réservé au Cron Vercel.');
  const report = await cleanup();
  console.log('[ménage]', JSON.stringify(report));
  return Response.json(report, { headers: { 'cache-control': 'no-store' } });
}
