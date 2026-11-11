/**
 * Sonde de vie du serveur : répond tant que Next tourne. Ne touche ni à la
 * base ni à R2, pour qu'une panne de l'un des deux ne se confonde pas avec
 * un serveur arrêté.
 */
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
