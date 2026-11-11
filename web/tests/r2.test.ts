/**
 * Le module R2 sans réseau : construction des clés, garde-fous, et forme des
 * URL présignées (la signature se calcule hors ligne).
 *
 * Le comportement réel face au bucket (CORS, taille imposée, 404 après
 * suppression) se vérifie à la main, avec les clés de `web/.env.local`.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

// `server-only` lève une erreur hors du rendu serveur de Next : neutralisé ici.
mock.module('server-only', () => ({}));

type R2 = typeof import('../lib/r2');
let r2: R2;

beforeAll(async () => {
  Object.assign(process.env, {
    R2_ACCOUNT_ID: 'compte-de-test',
    R2_ACCESS_KEY_ID: 'AKIDTEST',
    R2_SECRET_ACCESS_KEY: 'secret-de-test',
    R2_BUCKET: 'bucket-de-test',
  });
  r2 = await import('../lib/r2');
});

describe('clés', () => {
  test('le type vient en tête, pour la règle de cycle de vie', () => {
    expect(r2.backupKey('u1', 'b-2')).toBe('backups/u1/b-2.jwlibrary');
    expect(r2.mergeKey('u1', 'm_3')).toBe('merges/u1/m_3.jwlibrary');
    expect(r2.userPrefixes('u1')).toEqual(['backups/u1/', 'merges/u1/']);
  });

  test('un identifiant ne peut pas sortir de son dossier', () => {
    for (const bad of ['', '../u2', 'u1/x', 'a b', 'é', 'x'.repeat(129)]) {
      expect(() => r2.backupKey(bad, 'id')).toThrow();
      expect(() => r2.mergeKey('u1', bad)).toThrow();
      expect(() => r2.userPrefixes(bad)).toThrow();
    }
  });
});

describe('removePrefix', () => {
  test('refuse un préfixe qui viderait plus que le dossier d’un utilisateur', async () => {
    for (const bad of ['', 'backups/', 'merges', 'backups/u1', 'autre/u1/', 'backups/../']) {
      expect(r2.removePrefix(bad)).rejects.toThrow('préfixe refusé');
    }
  });
});

describe('attachment', () => {
  test('nom ASCII de repli et nom UTF-8', () => {
    expect(r2.attachment('Fusion_2026-11-11.jwlibrary')).toBe(
      `attachment; filename="Fusion_2026-11-11.jwlibrary"; filename*=UTF-8''Fusion_2026-11-11.jwlibrary`,
    );
    expect(r2.attachment('Été "à" 2026.jwlibrary')).toBe(
      `attachment; filename="Ete _a_ 2026.jwlibrary"; filename*=UTF-8''%C3%89t%C3%A9%20%22%C3%A0%22%202026.jwlibrary`,
    );
  });
});

describe('URL présignées', () => {
  test('PUT : 10 minutes, taille signée, pas de somme de contrôle imposée', async () => {
    const url = new URL(await r2.presignPut(r2.backupKey('u1', 'b1'), 1234));
    expect(url.host).toBe('compte-de-test.r2.cloudflarestorage.com');
    expect(url.pathname).toBe('/bucket-de-test/backups/u1/b1.jwlibrary');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('content-length');
    expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
    // Le navigateur n'envoie pas de somme CRC32 : elle ne doit pas être exigée.
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes('checksum'))).toBe(false);
  });

  test('PUT : refuse une taille absurde', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(r2.presignPut('backups/u1/b1.jwlibrary', bad)).rejects.toThrow('taille invalide');
    }
  });

  test('GET : 5 minutes, enregistré sous le nom choisi', async () => {
    const url = new URL(await r2.presignGet(r2.mergeKey('u1', 'm1'), 'Fusion.jwlibrary'));
    expect(url.pathname).toBe('/bucket-de-test/merges/u1/m1.jwlibrary');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('response-content-disposition')).toBe(r2.attachment('Fusion.jwlibrary'));
  });
});
