/**
 * Ménage quotidien (Cron Vercel, `GET /api/cron/cleanup`) :
 *
 * - les envois abandonnés : lignes `pending` de plus d'une heure, dont l'URL
 *   signée (10 minutes) a expiré depuis longtemps ;
 * - les sauvegardes sorties de leur emplacement depuis plus de 30 jours :
 *   la règle de cycle de vie de R2 a déjà effacé leur fichier, la ligne ne
 *   vise plus rien.
 *
 * Pour chaque ligne, le fichier d'abord, puis la ligne : un échec de R2 laisse
 * la ligne, et donc la trace du fichier, pour le prochain passage.
 *
 * Réservé au serveur.
 */
import 'server-only';

import { prisma } from '@/lib/db';
import { remove } from '@/lib/r2';

/** Âge au-delà duquel un envoi non confirmé est abandonné. */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
/** Durée de vie d'une sauvegarde dans R2 (règle de cycle de vie sur `backups/`). */
export const BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Lignes traitées par table et par passage, pour tenir dans le temps d'une fonction. */
export const BATCH = 500;

export interface CleanupReport {
  pendingBackups: number;
  pendingMerges: number;
  releasedBackups: number;
  failures: number;
}

type Row = { id: string; objectKey: string };

async function sweep(rows: Row[], drop: (id: string) => Promise<unknown>, report: CleanupReport): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      await remove(row.objectKey);
      await drop(row.id);
      done++;
    } catch (err) {
      report.failures++;
      console.error(`[ménage] ${row.objectKey} : échec, nouvel essai au prochain passage`, err);
    }
  }
  return done;
}

export async function cleanup(now = new Date()): Promise<CleanupReport> {
  const report: CleanupReport = { pendingBackups: 0, pendingMerges: 0, releasedBackups: 0, failures: 0 };
  const pendingBefore = new Date(now.getTime() - PENDING_MAX_AGE_MS);
  const releasedBefore = new Date(now.getTime() - BACKUP_MAX_AGE_MS);
  const select = { id: true, objectKey: true } as const;

  const pendingBackups = await prisma.backup.findMany({
    where: { status: 'pending', createdAt: { lt: pendingBefore } },
    select,
    take: BATCH,
  });
  report.pendingBackups = await sweep(pendingBackups, (id) => prisma.backup.delete({ where: { id } }), report);

  const pendingMerges = await prisma.merge.findMany({
    where: { status: 'pending', createdAt: { lt: pendingBefore } },
    select,
    take: BATCH,
  });
  report.pendingMerges = await sweep(pendingMerges, (id) => prisma.merge.delete({ where: { id } }), report);

  const released = await prisma.backup.findMany({
    where: { status: 'ready', slot: null, createdAt: { lt: releasedBefore } },
    select,
    take: BATCH,
  });
  report.releasedBackups = await sweep(released, (id) => prisma.backup.delete({ where: { id } }), report);

  return report;
}
