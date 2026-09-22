/**
 * L'archive produite doit rester un ZIP que tout lecteur accepte : c'est
 * JW Library qui l'ouvre, et on ne sait pas avec quelle bibliothèque.
 */
import { describe, expect, test } from 'bun:test';
import { unzipSync } from 'fflate';

import { crc32, zipEntries, type ZipEntry } from '../src/zip';

/** Base factice : compressible, et assez grosse pour passer par plusieurs tranches. */
function fakeDatabase(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) out[i] = (i * 7) % 251 < 200 ? i % 13 : (i * 31) & 0xff;
  return out;
}

/** Octets pseudo-aléatoires : un média déjà compressé ne se compresse plus. */
function fakeMedia(size: number, seed: number): Uint8Array {
  const out = new Uint8Array(size);
  let x = seed;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

interface CentralRecord {
  name: string;
  flags: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** Relit le répertoire central, pour vérifier ce qu'un lecteur strict y trouvera. */
function readDirectory(zip: Uint8Array): CentralRecord[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const records: CentralRecord[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    records.push({
      name: new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength)),
      flags: view.getUint16(at + 8, true),
      method: view.getUint16(at + 10, true),
      compressed: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength;
  }
  return records;
}

const entries: ZipEntry[] = [
  { name: 'manifest.json', data: new TextEncoder().encode('{"name":"test"}'), compress: true },
  { name: 'userData.db', data: fakeDatabase(3 * 1024 * 1024 + 17), compress: true },
  { name: 'b1c2d3e4-0000-4000-8000-000000000001', data: fakeMedia(200_000, 1), compress: false },
  { name: 'b1c2d3e4-0000-4000-8000-000000000002', data: fakeMedia(5_000, 2), compress: false },
  { name: 'vide.bin', data: new Uint8Array(0), compress: true },
  { name: 'miniature-été.jpg', data: fakeMedia(1_000, 3), compress: false },
];

describe('zipEntries', () => {
  test('se relit à l’identique', async () => {
    const zip = await zipEntries(entries);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(entries.map((e) => e.name));
    for (const entry of entries) expect(Buffer.from(files[entry.name]).equals(entry.data)).toBe(true);
  });

  test('compresse la base, range les médias tels quels', async () => {
    const records = readDirectory(await zipEntries(entries));
    const byName = Object.fromEntries(records.map((r) => [r.name, r]));

    expect(byName['userData.db'].method).toBe(8);
    expect(byName['userData.db'].compressed).toBeLessThan(byName['userData.db'].size / 2);
    const media = byName['b1c2d3e4-0000-4000-8000-000000000001'];
    expect(media.method).toBe(0);
    expect(media.compressed).toBe(media.size);
  });

  test('aucun descripteur de données : les tailles sont dans l’en-tête local', async () => {
    const zip = await zipEntries(entries);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (const record of readDirectory(zip)) {
      // Bit 3 : ce que `ZipInputStream` de Java refuse sur une entrée rangée.
      expect(record.flags & 0x0008).toBe(0);
      expect(view.getUint32(record.offset, true)).toBe(0x04034b50);
      expect(view.getUint32(record.offset + 18, true)).toBe(record.compressed);
      expect(view.getUint32(record.offset + 22, true)).toBe(record.size);
    }
  });

  test('marque en UTF-8 les seuls noms qui en ont besoin', async () => {
    const byName = Object.fromEntries(readDirectory(await zipEntries(entries)).map((r) => [r.name, r]));
    expect(byName['miniature-été.jpg'].flags & 0x0800).toBe(0x0800);
    expect(byName['userData.db'].flags & 0x0800).toBe(0);
  });

  test('signale un avancement croissant qui finit au total à compresser', async () => {
    const seen: [number, number][] = [];
    await zipEntries(entries, { onSlice: (done, total) => { seen.push([done, total]); } });

    const total = entries.filter((e) => e.compress).reduce((sum, e) => sum + e.data.length, 0);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.every(([, t]) => t === total)).toBe(true);
    const done = seen.map(([d]) => d);
    expect([...done].sort((x, y) => x - y)).toEqual(done);
    expect(done[done.length - 1]).toBe(total);
  });
});

describe('crc32', () => {
  test('valeur de référence', () => {
    expect(crc32(0, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  test('incrémental', () => {
    const data = fakeMedia(10_000, 7);
    expect(crc32(crc32(0, data.subarray(0, 4321)), data.subarray(4321))).toBe(crc32(0, data));
  });
});
