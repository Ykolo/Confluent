/**
 * `POST /api/backups/:id/confirm`
 * `{ slot, name, deviceName, backupCreatedAt, counts, uploadedFrom }` → `200 BackupDto`
 *
 * Seconde étape d'un envoi de sauvegarde. Vérifie chez R2 que le fichier est
 * bien arrivé, à la taille annoncée, puis le pose dans l'emplacement : la
 * sauvegarde qui l'occupait est libérée dans la même transaction (son fichier
 * reste dans R2, où la règle de cycle de vie l'efface au bout de 30 jours).
 *
 * Rejouer la même confirmation renvoie la même réponse : un client dont la
 * réponse s'est perdue peut réessayer sans risque.
 */
import { z } from 'zod';

import { apiError, isUniqueViolation, notFound, readBody, slotSchema, toBackupDto } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { head } from '@/lib/r2';

const count = z.number().int().nonnegative();

const body = z.object({
  slot: slotSchema,
  name: z.string().trim().min(1).max(255),
  deviceName: z.string().trim().min(1).max(255),
  // La date du manifeste JW Library, ISO 8601 avec ou sans fuseau.
  backupCreatedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'date ISO 8601'),
  counts: z.object({ notes: count, highlights: count, bookmarks: count }).nullable(),
  uploadedFrom: z.string().trim().max(255).nullish(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const input = await readBody(req, body);
  if (input instanceof Response) return input;
  const { id } = await params;

  const row = await prisma.backup.findFirst({ where: { id, userId: user.id } });
  if (!row) return notFound();
  if (row.status === 'ready') {
    // Déjà confirmée : même réponse si c'est la même demande, conflit sinon.
    if (row.slot === input.slot) return Response.json(toBackupDto(row));
    return apiError(409, 'already_confirmed', 'Cette sauvegarde a déjà été déposée.');
  }

  const stored = await head(row.objectKey);
  if (stored === null) {
    return apiError(422, 'upload_missing', 'Le fichier n’est pas arrivé : recommence l’envoi.');
  }
  if (stored !== row.size) {
    return apiError(422, 'size_mismatch', 'Le fichier reçu n’a pas la taille annoncée : recommence l’envoi.');
  }

  try {
    const confirmed = await prisma.$transaction(async (tx) => {
      // D'abord libérer l'emplacement, sinon l'unicité (userId, slot) refuse.
      await tx.backup.updateMany({ where: { userId: user.id, slot: input.slot }, data: { slot: null } });
      return tx.backup.update({
        where: { id: row.id },
        data: {
          status: 'ready',
          slot: input.slot,
          name: input.name,
          deviceName: input.deviceName,
          backupCreatedAt: new Date(input.backupCreatedAt),
          counts: input.counts ?? undefined,
          uploadedFrom: input.uploadedFrom ?? null,
        },
      });
    });
    return Response.json(toBackupDto(confirmed));
  } catch (err) {
    // Une autre confirmation a pris l'emplacement entre-temps.
    if (isUniqueViolation(err)) {
      return apiError(409, 'slot_busy', 'L’emplacement vient d’être occupé par un autre envoi : réessaie.');
    }
    throw err;
  }
}
