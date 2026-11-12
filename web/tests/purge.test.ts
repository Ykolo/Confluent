/** La purge R2 à la suppression d'un compte : ordre, reprises, abandon. */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

// `server-only` lève une erreur hors du rendu serveur de Next : neutralisé ici.
mock.module('server-only', () => ({}));

type Purge = typeof import('../lib/purge');
let purge: Purge;

beforeAll(async () => {
  purge = await import('../lib/purge');
});

const silent = () => {};
const noWait = async () => {};

describe('purgeUserFiles', () => {
  test('vide les sauvegardes puis les fusions de l’utilisateur', async () => {
    const seen: string[] = [];
    const removed = await purge.purgeUserFiles('u1', {
      remove: async (prefix) => { seen.push(prefix); return prefix.startsWith('backups') ? 2 : 5; },
      wait: noWait,
      log: silent,
    });
    expect(seen).toEqual(['backups/u1/', 'merges/u1/']);
    expect(removed).toBe(7);
  });

  test('reprend après un échec passager, en doublant l’attente', async () => {
    let calls = 0;
    const waits: number[] = [];
    const logs: string[] = [];
    await purge.purgeUserFiles('u1', {
      remove: async () => { calls++; if (calls === 1) throw new Error('R2 indisponible'); return 0; },
      wait: async (ms) => { waits.push(ms); },
      log: (message) => logs.push(message),
      delayMs: 100,
    });
    expect(waits).toEqual([100]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('essai 1/3');
  });

  test('abandonne après le dernier essai, en levant l’erreur', async () => {
    const waits: number[] = [];
    const logs: string[] = [];
    const attempt = purge.purgeUserFiles('u1', {
      remove: async () => { throw new Error('R2 indisponible'); },
      wait: async (ms) => { waits.push(ms); },
      log: (message) => logs.push(message),
      delayMs: 100,
    });
    await expect(attempt).rejects.toThrow('R2 indisponible');
    expect(waits).toEqual([100, 200]);
    expect(logs).toHaveLength(3);
  });

  test('refuse un identifiant qui sortirait du dossier, sans rien appeler', async () => {
    let called = false;
    const attempt = purge.purgeUserFiles('../u2', { remove: async () => { called = true; return 0; }, log: silent });
    await expect(attempt).rejects.toThrow();
    expect(called).toBe(false);
  });
});
