/**
 * Le client de synchronisation contre un faux serveur : un `fetch` simulé qui
 * joue à la fois l'API (`/api/*`) et R2 (les URL présignées), en mémoire.
 *
 * Le vrai serveur se vérifie à part, de bout en bout, contre `next start`.
 */
import { describe, expect, test } from 'bun:test';

import { CloudError, createCloudClient } from '../src/cloud/client';
import { describeKeptSlot, type BackupDto, type MergeDto } from '../src/cloud/types';
import { describeError } from '../src/errors';

const API = 'https://confluent.test';
const R2 = 'https://r2.test';
const SESSION = 'session=abc';

interface Seen {
  method: string;
  url: string;
  cookie: string | null;
  credentials?: RequestCredentials;
}

/** Un faux serveur, avec ses fichiers dans `objects` et chaque requête reçue dans `seen`. */
function fakeServer(opts: { failWith?: (path: string, method: string) => Response | undefined } = {}) {
  const seen: Seen[] = [];
  const objects = new Map<string, Uint8Array>();
  const pending = new Map<string, { kind: string; size: number; sha256: string }>();
  const backups: BackupDto[] = [];
  const merges: MergeDto[] = [];
  let serial = 0;

  const json = (body: unknown, status = 200) => Response.json(body, { status });

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    seen.push({ method, url, cookie: headers.get('cookie'), credentials: init.credentials });

    // --- R2 ---
    if (url.startsWith(R2)) {
      const key = new URL(url).pathname;
      if (method === 'PUT') {
        const body = init.body instanceof Uint8Array ? init.body : new Uint8Array(await (init.body as Blob).arrayBuffer());
        objects.set(key, body);
        return new Response(null, { status: 200 });
      }
      const obj = objects.get(key);
      // Bun accepte des octets en corps de réponse ; les types de React Native, non.
      return obj ? new Response(obj as unknown as BodyInit) : new Response('<Error/>', { status: 404 });
    }

    // --- API ---
    const path = url.slice(API.length);
    const failure = opts.failWith?.(path, method);
    if (failure) return failure;
    if (headers.get('cookie') !== SESSION) return json({ error: 'unauthorized', message: 'Non connecté.' }, 401);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;

    if (method === 'POST' && path === '/api/uploads') {
      const same = body.slot && backups.find((b) => b.slot === body.slot && b.sha256 === body.sha256 && b.size === body.size);
      if (same) return json({ existing: same });
      const id = `id${++serial}`;
      pending.set(id, { kind: body.kind, size: body.size, sha256: body.sha256 });
      return json({ id, putUrl: `${R2}/${body.kind}s/${id}` }, 201);
    }
    let m = path.match(/^\/api\/backups\/(\w+)\/confirm$/);
    if (method === 'POST' && m) {
      const p = pending.get(m[1]!);
      if (!p) return json({ error: 'not_found', message: 'Introuvable.' }, 404);
      if (!objects.has(`/backups/${m[1]}`)) return json({ error: 'upload_missing', message: 'Le fichier n’est pas arrivé : recommence l’envoi.' }, 422);
      for (const b of backups) if (b.slot === body.slot) b.slot = null;
      const dto: BackupDto = {
        id: m[1]!, slot: body.slot, name: body.name, size: p.size, sha256: p.sha256, deviceName: body.deviceName,
        backupCreatedAt: body.backupCreatedAt, counts: body.counts, uploadedFrom: body.uploadedFrom, createdAt: 'now',
      };
      backups.push(dto);
      return json(dto);
    }
    m = path.match(/^\/api\/merges\/(\w+)\/confirm$/);
    if (method === 'POST' && m) {
      const p = pending.get(m[1]!)!;
      const slotsKept: { slot: 'a' | 'b'; backup: BackupDto }[] = [];
      for (const slot of ['a', 'b'] as const) {
        const used = body.backups?.[slot];
        if (!used) continue;
        const current = backups.find((b) => b.slot === slot);
        if (current && current.id === used) current.slot = null;
        else if (current) slotsKept.push({ slot, backup: current });
      }
      const { backups: _used, ...meta } = body;
      const dto: MergeDto = { id: m[1]!, size: p.size, sha256: 'x', createdAt: 'now', ...meta };
      merges.unshift(dto);
      return json({ ...dto, slotsKept });
    }
    if (method === 'GET' && path === '/api/slots') {
      return json({ a: backups.find((b) => b.slot === 'a') ?? null, b: backups.find((b) => b.slot === 'b') ?? null });
    }
    if (method === 'GET' && path.startsWith('/api/merges')) {
      const cursor = new URL(url).searchParams.get('cursor');
      const start = cursor ? merges.findIndex((x) => x.id === cursor) + 1 : 0;
      const items = merges.slice(start, start + 2);
      return json(start + 2 < merges.length ? { items, next: items.at(-1)!.id } : { items });
    }
    m = path.match(/^\/api\/files\/(backup|merge)\/(\w+)$/);
    if (method === 'GET' && m) {
      return objects.has(`/${m[1]}s/${m[2]}`) ? json({ url: `${R2}/${m[1]}s/${m[2]}` }) : json({ error: 'not_found', message: 'Introuvable.' }, 404);
    }
    m = path.match(/^\/api\/slots\/([ab])$/);
    if (method === 'DELETE' && m) {
      for (const b of backups) if (b.slot === m[1]) b.slot = null;
      return new Response(null, { status: 204 });
    }
    m = path.match(/^\/api\/merges\/(\w+)$/);
    if (method === 'DELETE' && m) {
      const i = merges.findIndex((x) => x.id === m![1]);
      if (i < 0) return json({ error: 'not_found', message: 'Introuvable.' }, 404);
      merges.splice(i, 1);
      objects.delete(`/merges/${m[1]}`);
      return new Response(null, { status: 204 });
    }
    return json({ error: 'not_found', message: 'Introuvable.' }, 404);
  }) as typeof fetch;

  return { fetch: fetchImpl, seen, objects };
}

const info = { name: 'ipad.jwlibrary', deviceName: 'iPad', createdAt: '2026-11-10T09:30:00Z', counts: { notes: 6, highlights: 100, bookmarks: 2 } };
const bytes = (text: string) => new TextEncoder().encode(text);
const report = {
  added: { Note: 2 }, duplicates: 52, noteConflicts: 2, bookmarksSkipped: 0,
  totals: { notes: 8, highlights: 160, bookmarks: 3 },
};

function setup(server = fakeServer()) {
  const client = createCloudClient({
    baseUrl: `${API}/`, // la barre finale est tolérée
    fetch: server.fetch,
    headers: () => ({ cookie: SESSION }),
    uploadedFrom: 'Essai',
  });
  return { server, client };
}

describe('parcours de dépôt', () => {
  test('ticket, envoi vers R2, confirmation, puis lecture des emplacements', async () => {
    const { server, client } = setup();
    const file = bytes('sauvegarde A');
    const { backup: dto } = await client.uploadBackup('a', info, file, 'f'.repeat(64));

    expect(dto).toMatchObject({ slot: 'a', name: 'ipad.jwlibrary', size: file.byteLength, uploadedFrom: 'Essai' });
    expect(server.seen.map((s) => `${s.method} ${s.url.replace(/^https:\/\/[^/]+/, '')}`)).toEqual([
      'POST /api/uploads',
      `PUT /backups/${dto.id}`,
      `POST /api/backups/${dto.id}/confirm`,
    ]);
    const slots = await client.slots();
    expect(slots.a?.id).toBe(dto.id);
    expect(slots.b).toBeNull();
  });

  test('un fichier déjà dans l’emplacement n’est pas renvoyé', async () => {
    const { server, client } = setup();
    const file = bytes('sauvegarde A');
    const sha = 'a'.repeat(64);
    const first = await client.uploadBackup('a', info, file, sha);
    expect(first.alreadyThere).toBe(false);
    server.seen.length = 0;
    const again = await client.uploadBackup('a', info, file, sha);
    expect(again).toEqual({ backup: first.backup, alreadyThere: true });
    expect(server.seen.map((s) => `${s.method} ${s.url.replace(/^https:\/\/[^/]+/, '')}`)).toEqual(['POST /api/uploads']);
    // Même fichier, autre emplacement : il est déposé.
    expect((await client.uploadBackup('b', info, file, sha)).alreadyThere).toBe(false);
  });

  test('R2 ne reçoit ni cookie ni identifiants ; l’API reçoit la session', async () => {
    const { server, client } = setup();
    await client.uploadBackup('a', info, new Blob([bytes('blob')]), 'f'.repeat(64));
    const put = server.seen.find((s) => s.method === 'PUT')!;
    expect(put.cookie).toBeNull();
    expect(put.credentials).toBe('omit');
    for (const s of server.seen.filter((s) => s.url.startsWith(API))) expect(s.cookie).toBe(SESSION);
  });

  test('downloadBackup rend les octets déposés', async () => {
    const { client } = setup();
    const file = bytes('sauvegarde à relire');
    const { backup: dto } = await client.uploadBackup('b', info, file, 'f'.repeat(64));
    expect(await client.downloadBackup(dto)).toEqual(file);
  });

  test('downloadBackup refuse un fichier tronqué', async () => {
    const { server, client } = setup();
    const { backup: dto } = await client.uploadBackup('a', info, bytes('complet'), 'f'.repeat(64));
    server.objects.set(`/backups/${dto.id}`, bytes('tro'));
    const err = await client.downloadBackup(dto).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudError);
    expect((err as CloudError).title).toBe('Téléchargement incomplet');
  });

  test('clearSlot vide l’emplacement', async () => {
    const { client } = setup();
    await client.uploadBackup('a', info, bytes('a'), 'f'.repeat(64));
    await client.clearSlot('a');
    expect((await client.slots()).a).toBeNull();
  });
});

describe('fusions', () => {
  test('saveMerge libère les emplacements consommés', async () => {
    const { client } = setup();
    const { backup: a } = await client.uploadBackup('a', info, bytes('a'), 'f'.repeat(64));
    const { backup: b } = await client.uploadBackup('b', info, bytes('b'), 'f'.repeat(64));
    const merge = await client.saveMerge(bytes('fusion'), {
      fileName: 'Fusion.jwlibrary', report, sources: 'iPad + Pixel', strategy: 'keep-both', backups: { a: a.id, b: b.id },
    }, 'e'.repeat(64));
    expect(merge).toMatchObject({ fileName: 'Fusion.jwlibrary', strategy: 'keep-both', size: 6 });
    expect(await client.slots()).toEqual({ a: null, b: null });
  });

  test('saveMerge laisse un emplacement redéposé pendant la fusion, et le dit', async () => {
    const { client } = setup();
    const { backup: a } = await client.uploadBackup('a', info, bytes('a'), 'f'.repeat(64));
    const { backup: b } = await client.uploadBackup('b', info, bytes('b'), 'f'.repeat(64));
    // Pendant la fusion, un autre appareil redépose un A.
    const { backup: newer } = await client.uploadBackup('a', { ...info, name: 'nouveau A' }, bytes('a2'), 'f'.repeat(64));
    const merge = await client.saveMerge(bytes('fusion'), {
      fileName: 'Fusion.jwlibrary', report, sources: 'iPad + Pixel', strategy: 'keep-both', backups: { a: a.id, b: b.id },
    }, 'e'.repeat(64));
    expect(merge.slotsKept.map((k) => [k.slot, k.backup.id])).toEqual([['a', newer.id]]);
    expect(await client.slots()).toEqual({ a: newer, b: null });
  });

  test('merges suit le curseur jusqu’à la dernière page', async () => {
    const { client } = setup();
    for (let i = 0; i < 5; i++) {
      await client.saveMerge(bytes(`f${i}`), { fileName: `F${i}`, report, sources: '', strategy: 'newest', backups: {} }, 'e'.repeat(64));
    }
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.merges(cursor);
      names.push(...page.items.map((m) => m.fileName));
      cursor = page.next;
    } while (cursor);
    expect(names).toEqual(['F4', 'F3', 'F2', 'F1', 'F0']);
  });

  test('downloadUrl et deleteMerge', async () => {
    const { client } = setup();
    const m = await client.saveMerge(bytes('x'), { fileName: 'F', report, sources: '', strategy: 'newest', backups: {} }, 'e'.repeat(64));
    expect(await client.downloadUrl('merge', m.id)).toBe(`${R2}/merges/${m.id}`);
    await client.deleteMerge(m.id);
    expect((await client.merges()).items).toEqual([]);
  });
});

describe('erreurs', () => {
  test('401 : CloudError « Connexion requise », marquée unauthorized', async () => {
    const server = fakeServer();
    const client = createCloudClient({ baseUrl: API, fetch: server.fetch }); // sans cookie
    const err = (await client.slots().catch((e: unknown) => e)) as CloudError;
    expect(err).toBeInstanceOf(CloudError);
    expect(err.status).toBe(401);
    expect(err.unauthorized).toBe(true);
    expect(describeError(err)).toMatchObject({ title: 'Connexion requise', message: 'Ta session a expiré.' });
  });

  test('404 : code et message du serveur', async () => {
    const { client } = setup();
    const err = (await client.downloadUrl('merge', 'nexistepas').catch((e: unknown) => e)) as CloudError;
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.title).toBe('Introuvable');
    expect(err.unauthorized).toBe(false);
  });

  test('422 : le message du serveur, déjà en français, est gardé', async () => {
    const server = fakeServer({
      failWith: (path) => (path.endsWith('/confirm')
        ? Response.json({ error: 'upload_missing', message: 'Le fichier n’est pas arrivé : recommence l’envoi.' }, { status: 422 })
        : undefined),
    });
    const { client } = setup(server);
    const err = (await client.uploadBackup('a', info, bytes('a'), 'f'.repeat(64)).catch((e: unknown) => e)) as CloudError;
    expect(err.code).toBe('upload_missing');
    expect(describeError(err)).toMatchObject({ title: 'Envoi incomplet', message: 'Le fichier n’est pas arrivé : recommence l’envoi.' });
  });

  test('500 : vue générique, même si le serveur renvoie du HTML', async () => {
    const server = fakeServer({ failWith: () => new Response('<h1>oups</h1>', { status: 502 }) });
    const err = (await setup(server).client.slots().catch((e: unknown) => e)) as CloudError;
    expect(err.status).toBe(502);
    expect(err.title).toBe('Serveur indisponible');
    expect(err.technical).toBe('GET /api/slots → 502');
  });

  test('réseau coupé : status 0, « Pas de connexion »', async () => {
    const client = createCloudClient({
      baseUrl: API,
      fetch: (async () => { throw new TypeError('Network request failed'); }) as unknown as typeof fetch,
    });
    const err = (await client.slots().catch((e: unknown) => e)) as CloudError;
    expect(err.status).toBe(0);
    expect(err.code).toBe('network');
    expect(err.title).toBe('Pas de connexion');
    expect(err.technical).toContain('Network request failed');
  });

  test('les en-têtes sont relus à chaque appel (cookie renouvelé)', async () => {
    const server = fakeServer();
    let cookie = 'session=perimee';
    const client = createCloudClient({ baseUrl: API, fetch: server.fetch, headers: () => ({ cookie }) });
    expect(await client.slots().catch((e: CloudError) => e.status)).toBe(401);
    cookie = SESSION;
    expect(await client.slots()).toEqual({ a: null, b: null });
  });
});

describe('describeKeptSlot', () => {
  test('nomme l’emplacement et l’appareil', () => {
    const backup = { uploadedFrom: 'iPhone' } as BackupDto;
    expect(describeKeptSlot({ slot: 'a', backup })).toBe(
      'Un nouveau fichier A a été déposé entre-temps depuis iPhone. Il reste dans le compte pour la prochaine fusion.',
    );
    expect(describeKeptSlot({ slot: 'b', backup: { uploadedFrom: null } as BackupDto })).toStartWith(
      'Un nouveau fichier B a été déposé entre-temps. ',
    );
  });
});
