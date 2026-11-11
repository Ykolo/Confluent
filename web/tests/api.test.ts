/**
 * Les briques des routes, sans base ni réseau : DTO, lecture des corps,
 * réponses d'erreur.
 *
 * Le parcours complet (dépôt, confirmation, emplacements, isolation entre
 * utilisateurs) se vérifie contre un serveur local et la branche Neon `dev`.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { z } from 'zod';

import type { Backup } from '@/generated/prisma/client';

mock.module('server-only', () => ({}));

type Api = typeof import('../lib/api');
let api: Api;

beforeAll(async () => {
  api = await import('../lib/api');
});

const row = (over: Partial<Backup> = {}): Backup => ({
  id: 'b1',
  userId: 'u1',
  slot: 'a',
  objectKey: 'backups/u1/b1.jwlibrary',
  size: 1234,
  sha256: 'a'.repeat(64),
  name: 'ipad.jwlibrary',
  deviceName: 'iPad',
  backupCreatedAt: new Date('2026-11-10T08:30:00Z'),
  counts: { notes: 6, highlights: 100, bookmarks: 2 },
  uploadedFrom: null,
  status: 'ready',
  createdAt: new Date('2026-11-11T10:00:00Z'),
  ...over,
});

describe('toBackupDto', () => {
  test('ne garde que ce que le client doit voir', () => {
    const dto = api.toBackupDto(row());
    expect(dto).toEqual({
      id: 'b1',
      slot: 'a',
      name: 'ipad.jwlibrary',
      size: 1234,
      sha256: 'a'.repeat(64),
      deviceName: 'iPad',
      backupCreatedAt: '2026-11-10T08:30:00.000Z',
      counts: { notes: 6, highlights: 100, bookmarks: 2 },
      uploadedFrom: null,
      createdAt: '2026-11-11T10:00:00.000Z',
    });
  });

  test('refuse une ligne non confirmée', () => {
    expect(() => api.toBackupDto(row({ status: 'pending' }))).toThrow('non confirmée');
    expect(() => api.toBackupDto(row({ name: null }))).toThrow('non confirmée');
  });
});

describe('readBody', () => {
  const schema = z.object({ size: z.number().int().positive() });
  const req = (body: string) => new Request('http://x/', { method: 'POST', body });

  test('corps valide', async () => {
    expect(await api.readBody(req('{"size":3}'), schema)).toEqual({ size: 3 });
  });

  test('JSON cassé → 400 invalid_json', async () => {
    const res = (await api.readBody(req('{'), schema)) as Response;
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_json');
  });

  test('champ invalide → 400 invalid_body, qui nomme le champ', async () => {
    const res = (await api.readBody(req('{"size":-1}'), schema)) as Response;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_body', message: 'Requête invalide (size).' });
  });
});

test('notFound : même 404 pour l’absent et pour la ressource d’un autre', async () => {
  const res = api.notFound();
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'not_found', message: 'Introuvable.' });
});
