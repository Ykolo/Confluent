/**
 * Les routes de l'API, appelées directement, sur une vraie base Postgres.
 *
 * En CI, la base est une branche Neon créée pour le job (voir
 * `.github/workflows/ci.yml`). En local, sur la branche `dev`, depuis `web/` :
 *
 *     ROUTE_TESTS=1 bun test --env-file=.env.local tests/routes.test.ts
 *
 * (`bun test` ne lit pas `.env.local` de lui-même.) Sans `ROUTE_TESTS`, elles
 * sont ignorées : un simple `bun test` ne touche à aucune base. Les lancer à
 * part : le faux R2 ci-dessous remplace le module pour tout le processus.
 *
 * R2 est simulé en mémoire : un « envoi » écrit directement dans la table des
 * objets, ce que ferait le PUT du client sur l'URL signée. Les comptes de test
 * sont supprimés à la fin, par la route de Better Auth.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

import { MAX_UPLOAD_BYTES } from '@core/cloud/types';

const enabled = !!process.env.ROUTE_TESTS;

// --- R2 en mémoire ----------------------------------------------------------

const objects = new Map<string, number>();
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const seg = (v: string) => { if (!SEGMENT.test(v)) throw new Error(`segment invalide : ${v}`); return v; };
const objectKey = (kind: 'backups' | 'merges', userId: string, id: string) => `${kind}/${seg(userId)}/${seg(id)}.jwlibrary`;

// `mock.module` vaut pour tout le processus : sans `ROUTE_TESTS`, on ne
// touche à rien, pour ne pas fausser `tests/r2.test.ts` qui teste le vrai.
if (enabled) mock.module('server-only', () => ({}));
if (enabled) mock.module('@/lib/r2', () => ({
  objectKey,
  backupKey: (u: string, id: string) => objectKey('backups', u, id),
  mergeKey: (u: string, id: string) => objectKey('merges', u, id),
  userPrefixes: (u: string) => [`backups/${seg(u)}/`, `merges/${seg(u)}/`],
  attachment: (name: string) => `attachment; filename="${name}"`,
  presignPut: async (key: string, size: number) => `memory://${key}?size=${size}`,
  presignGet: async (key: string) => `memory://${key}`,
  head: async (key: string) => objects.get(key) ?? null,
  remove: async (key: string) => { objects.delete(key); },
  copy: async (from: string, to: string) => {
    const size = objects.get(from);
    if (size === undefined) throw new Error(`copie : ${from} absent`);
    objects.set(to, size);
  },
  removePrefix: async (prefix: string) => {
    let n = 0;
    for (const key of [...objects.keys()]) if (key.startsWith(prefix)) { objects.delete(key); n++; }
    return n;
  },
}));

/** Ce que fait le client avec l'URL signée : déposer `size` octets à la clé. */
function put(putUrl: string, size?: number) {
  const url = new URL(putUrl);
  objects.set(`${url.host}${url.pathname}`, size ?? Number(url.searchParams.get('size')));
}

// --- Appels ------------------------------------------------------------------

const ORIGIN = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let routes: Record<string, Record<string, Handler>>;

interface User { id: string; cookie: string; password: string }

async function call(user: User | null, method: string, path: string, body?: unknown) {
  const pattern = Object.keys(routes).find((p) => new RegExp(`^${p.replace(/:\w+/g, '[^/]+')}$`).test(path.split('?')[0]!))!;
  const names = [...pattern.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  const values = new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`).exec(path.split('?')[0]!)!.slice(1);
  const params = Object.fromEntries(names.map((n, i) => [n, values[i]!]));
  const handler = routes[pattern]![method]!;
  const res = await handler(new Request(`${ORIGIN}${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(user ? { cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signUp(label: string): Promise<User> {
  const password = crypto.randomUUID();
  const res = await routes['/api/auth/x']!.POST!(new Request(`${ORIGIN}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email: `routes-${label}-${Date.now()}@example.test`, password, name: label }),
  }), { params: Promise.resolve({}) });
  if (res.status !== 200) throw new Error(`inscription ${label} : ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  return { id: ((await res.json()) as { user: { id: string } }).user.id, cookie, password };
}

const SHA = (c: string) => c.repeat(64);
const report = { added: {}, duplicates: 0, noteConflicts: 0, bookmarksSkipped: 0, totals: { notes: 3, highlights: 2, bookmarks: 1 } };

/** Dépose une sauvegarde dans un emplacement : ticket, objet, confirmation. */
async function deposit(user: User, slot: 'a' | 'b', size = 1000, from = 'iPad') {
  const ticket = await call(user, 'POST', '/api/uploads', { kind: 'backup', size, sha256: SHA(String(size % 10)) });
  put(ticket.body.putUrl);
  const res = await call(user, 'POST', `/api/backups/${ticket.body.id}/confirm`, {
    slot, name: `${slot}.jwlibrary`, deviceName: from, backupCreatedAt: '2026-11-01T10:00:00Z', counts: null, uploadedFrom: from,
  });
  expect(res.status).toBe(200);
  return res.body as { id: string; slot: string };
}

async function saveMerge(user: User, backups: Record<string, string>, size = 2000) {
  const ticket = await call(user, 'POST', '/api/uploads', { kind: 'merge', size, sha256: SHA('e') });
  put(ticket.body.putUrl);
  return call(user, 'POST', `/api/merges/${ticket.body.id}/confirm`, {
    fileName: 'Fusion.jwlibrary', report, sources: 'iPad + Pixel', strategy: 'keep-both', backups,
  });
}

// --- Tests -------------------------------------------------------------------

describe.skipIf(!enabled)('routes de l’API', () => {
  let alice: User;
  let bob: User;

  beforeAll(async () => {
    const auth = await import('@/app/api/auth/[...all]/route');
    routes = {
      '/api/auth/x': { POST: auth.POST as unknown as Handler },
      '/api/uploads': { POST: (await import('@/app/api/uploads/route')).POST as unknown as Handler },
      '/api/backups/:id/confirm': { POST: (await import('@/app/api/backups/[id]/confirm/route')).POST as unknown as Handler },
      '/api/slots': { GET: (await import('@/app/api/slots/route')).GET as unknown as Handler },
      '/api/slots/:slot': { DELETE: (await import('@/app/api/slots/[slot]/route')).DELETE as unknown as Handler },
      '/api/merges': { GET: (await import('@/app/api/merges/route')).GET as unknown as Handler },
      '/api/merges/:id': { DELETE: (await import('@/app/api/merges/[id]/route')).DELETE as unknown as Handler },
      '/api/merges/:id/confirm': { POST: (await import('@/app/api/merges/[id]/confirm/route')).POST as unknown as Handler },
      '/api/merges/:id/promote': { POST: (await import('@/app/api/merges/[id]/promote/route')).POST as unknown as Handler },
      '/api/files/:kind/:id': { GET: (await import('@/app/api/files/[kind]/[id]/route')).GET as unknown as Handler },
    };
    alice = await signUp('alice');
    bob = await signUp('bob');
  });

  afterAll(async () => {
    if (!routes) return;
    const auth = routes['/api/auth/x']!.POST!;
    for (const user of [alice, bob].filter(Boolean)) {
      await auth(new Request(`${ORIGIN}/api/auth/delete-user`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: user.cookie },
        body: JSON.stringify({ password: user.password }),
      }), { params: Promise.resolve({}) });
    }
    const { prisma } = await import('@/lib/db');
    await prisma.rateLimit.deleteMany({ where: { key: { in: [alice, bob].filter(Boolean).map((u) => `upload:${u.id}`) } } });
  });

  test('sans session : 401', async () => {
    expect((await call(null, 'GET', '/api/slots')).status).toBe(401);
    expect((await call(null, 'POST', '/api/uploads', { kind: 'backup', size: 1, sha256: SHA('a') })).status).toBe(401);
  });

  test('parcours complet : dépôts, fusion, historique, téléchargement', async () => {
    const a = await deposit(alice, 'a', 1001);
    const b = await deposit(alice, 'b', 1002);
    expect((await call(alice, 'GET', '/api/slots')).body).toMatchObject({ a: { id: a.id }, b: { id: b.id } });

    const saved = await saveMerge(alice, { a: a.id, b: b.id });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ fileName: 'Fusion.jwlibrary', strategy: 'keep-both', slotsKept: [] });
    expect(saved.body.userId).toBeUndefined();
    expect(saved.body.objectKey).toBeUndefined();
    expect((await call(alice, 'GET', '/api/slots')).body).toEqual({ a: null, b: null });

    const page = await call(alice, 'GET', '/api/merges');
    expect(page.body.items[0].id).toBe(saved.body.id);
    const file = await call(alice, 'GET', `/api/files/merge/${saved.body.id}`);
    expect(file.body.url).toBe(`memory://merges/${alice.id}/${saved.body.id}.jwlibrary`);
  });

  test('isolation : Bob reçoit 404 sur tout ce qui est à Alice', async () => {
    const a = await deposit(alice, 'a', 1003);
    const merge = await saveMerge(alice, {});
    expect((await call(bob, 'GET', `/api/files/backup/${a.id}`)).status).toBe(404);
    expect((await call(bob, 'GET', `/api/files/merge/${merge.body.id}`)).status).toBe(404);
    expect((await call(bob, 'DELETE', `/api/merges/${merge.body.id}`)).status).toBe(404);
    expect((await call(bob, 'POST', `/api/merges/${merge.body.id}/promote`)).status).toBe(404);
    expect((await call(bob, 'POST', `/api/backups/${a.id}/confirm`, {
      slot: 'a', name: 'x', deviceName: 'x', backupCreatedAt: '2026-11-01T10:00:00Z', counts: null,
    })).status).toBe(404);
    expect((await call(bob, 'GET', '/api/slots')).body).toEqual({ a: null, b: null });
    expect((await call(bob, 'GET', '/api/merges')).body.items).toEqual([]);
    // Et rien n'a bougé chez Alice.
    expect((await call(alice, 'GET', '/api/slots')).body.a.id).toBe(a.id);
    expect((await call(alice, 'GET', `/api/files/merge/${merge.body.id}`)).status).toBe(200);
  });

  test('refus au-delà de 200 Mo, et confirmation sans objet R2', async () => {
    const big = await call(alice, 'POST', '/api/uploads', { kind: 'backup', size: MAX_UPLOAD_BYTES + 1, sha256: SHA('b') });
    expect(big.status).toBe(400);

    const ticket = await call(alice, 'POST', '/api/uploads', { kind: 'backup', size: 500, sha256: SHA('c') });
    const missing = await call(alice, 'POST', `/api/backups/${ticket.body.id}/confirm`, {
      slot: 'b', name: 'b', deviceName: 'b', backupCreatedAt: '2026-11-01T10:00:00Z', counts: null,
    });
    expect(missing).toMatchObject({ status: 422, body: { error: 'upload_missing' } });

    put(ticket.body.putUrl, 499);
    const short = await call(alice, 'POST', `/api/backups/${ticket.body.id}/confirm`, {
      slot: 'b', name: 'b', deviceName: 'b', backupCreatedAt: '2026-11-01T10:00:00Z', counts: null,
    });
    expect(short).toMatchObject({ status: 422, body: { error: 'size_mismatch' } });
  });

  test('emplacement écrasé pendant une fusion : gardé et signalé', async () => {
    const a = await deposit(alice, 'a', 1004, 'iPad');
    const b = await deposit(alice, 'b', 1005, 'iPad');
    const newer = await deposit(alice, 'a', 1006, 'iPhone');
    const saved = await saveMerge(alice, { a: a.id, b: b.id });
    expect(saved.status).toBe(200);
    expect(saved.body.slotsKept).toHaveLength(1);
    expect(saved.body.slotsKept[0]).toMatchObject({ slot: 'a', backup: { id: newer.id, uploadedFrom: 'iPhone' } });
    const slots = (await call(alice, 'GET', '/api/slots')).body;
    expect(slots.a.id).toBe(newer.id);
    expect(slots.b).toBeNull();
  });

  test('même fichier, même emplacement : rien n’est renvoyé', async () => {
    const a = await deposit(alice, 'a', 1007);
    const again = await call(alice, 'POST', '/api/uploads', { kind: 'backup', size: 1007, sha256: SHA('7'), slot: 'a' });
    expect(again).toMatchObject({ status: 200, body: { existing: { id: a.id } } });
  });

  test('une fusion placée en A', async () => {
    const merge = await saveMerge(alice, {}, 2222);
    const promoted = await call(alice, 'POST', `/api/merges/${merge.body.id}/promote`);
    expect(promoted).toMatchObject({ status: 200, body: { slot: 'a', size: 2222, uploadedFrom: 'une fusion' } });
    expect(objects.get(`backups/${alice.id}/${promoted.body.id}.jwlibrary`)).toBe(2222);
    expect((await call(alice, 'GET', '/api/slots')).body.a.id).toBe(promoted.body.id);
  });
});
