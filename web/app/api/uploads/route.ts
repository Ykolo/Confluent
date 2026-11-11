/**
 * `POST /api/uploads` `{ kind, size, sha256 }` → `201 { id, putUrl }`
 *
 * Première étape d'un envoi : réserve une ligne `pending` et signe l'URL où le
 * client dépose le fichier, directement chez R2. Le serveur choisit la clé ;
 * le client confirme ensuite (`/api/backups/:id/confirm`, ou
 * `/api/merges/:id/confirm` pour une fusion), ce qui vérifie l'objet.
 */
import { z } from 'zod';

import { MAX_UPLOAD_BYTES, type UploadTicket } from '@core/cloud/types';

import { readBody, sha256Schema } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { backupKey, mergeKey, presignPut } from '@/lib/r2';

const body = z.object({
  kind: z.enum(['backup', 'merge']),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  sha256: sha256Schema,
});

export async function POST(req: Request) {
  const user = await requireUser(req);
  if (user instanceof Response) return user;
  const input = await readBody(req, body);
  if (input instanceof Response) return input;

  const id = crypto.randomUUID();
  const { size, sha256 } = input;
  let objectKey: string;
  if (input.kind === 'backup') {
    objectKey = backupKey(user.id, id);
    await prisma.backup.create({ data: { id, userId: user.id, objectKey, size, sha256 } });
  } else {
    objectKey = mergeKey(user.id, id);
    await prisma.merge.create({ data: { id, userId: user.id, objectKey, size, sha256 } });
  }

  const ticket: UploadTicket = { id, putUrl: await presignPut(objectKey, size) };
  return Response.json(ticket, { status: 201 });
}
