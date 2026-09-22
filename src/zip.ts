/**
 * Écriture d'une archive ZIP par tranches.
 *
 * `zipSync` de fflate compressait tout d'un seul bloc, au niveau 6 : c'était
 * le dernier gros blocage du parcours (3,85 s mesurées sur téléphone, écran
 * figé). Deux choses changent ici :
 *
 * - **Seules les entrées qui y gagnent sont compressées.** La base SQLite se
 *   compresse très bien ; les pièces jointes sont des médias (miniatures,
 *   images) déjà compressés, que le deflate faisait mouliner pour ne gagner
 *   quasiment rien. Elles sont rangées telles quelles.
 * - **La compression avance par tranches**, avec `onSlice` entre chacune,
 *   comme la décompression dans `extract()` : l'appelant peut rendre la main
 *   à l'écran, et la barre avance au lieu de rester figée.
 *
 * Pourquoi écrire l'enveloppe soi-même, plutôt que le `Zip` en flux de
 * fflate : celui-ci ne connaît pas les tailles à l'avance et termine chaque
 * entrée par un descripteur de données (bit 3 des drapeaux). Or le lecteur
 * `ZipInputStream` de Java refuse une entrée *rangée* suivie d'un tel
 * descripteur, et rien ne dit que JW Library ne s'en sert pas. Ici, tout est
 * compressé avant d'être écrit : les tailles et le CRC vont directement dans
 * l'en-tête local, comme le faisait `zipSync`. Pas de descripteur, pas de
 * ZIP64 (une sauvegarde est très loin des 4 Go).
 */
import { Deflate } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** `true` : deflate niveau 6. `false` : rangée telle quelle. */
  compress: boolean;
}

export interface ZipOptions {
  /**
   * Appelé entre deux tranches compressées : `done` octets traités sur
   * `total`, qui ne compte que les entrées à compresser — les autres sont
   * rangées sans calcul notable. Le retour peut être une promesse.
   */
  onSlice?: (done: number, total: number) => void | Promise<void>;
  /** Appelé après chaque entrée, pour le journal. */
  onEntry?: (entry: { name: string; stored: boolean; size: number; written: number }) => void;
  /** Date inscrite dans les en-têtes. Défaut : maintenant. */
  date?: Date;
}

/**
 * Taille des tranches, la même que pour la décompression : une trentaine de
 * tranches pour une base typique, quelques dizaines de millisecondes chacune.
 */
const SLICE = 128 * 1024;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/** Version 2.0 : deflate. Suffit aussi pour les entrées rangées. */
const VERSION = 20;
/** Bit 11 : nom encodé en UTF-8. Posé seulement s'il le faut. */
const FLAG_UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC-32 incrémental : `crc32(crc32(0, a), b)` vaut `crc32(0, a + b)`. */
export function crc32(crc: number, data: Uint8Array): number {
  let c = crc ^ -1;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Heure et date au format MS-DOS, en heure locale comme le veut l'usage. */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Compresse `data` par tranches, en calculant son CRC au passage. */
async function deflateInSlices(
  data: Uint8Array,
  onSlice: (bytes: number) => Promise<void>,
): Promise<{ body: Uint8Array; crc: number }> {
  const out: Uint8Array[] = [];
  let size = 0;
  const deflate = new Deflate({ level: 6 }, (chunk) => {
    out.push(chunk);
    size += chunk.length;
  });

  let crc = 0;
  if (data.length === 0) deflate.push(new Uint8Array(0), true);
  for (let at = 0; at < data.length; at += SLICE) {
    const end = Math.min(at + SLICE, data.length);
    const slice = data.subarray(at, end);
    crc = crc32(crc, slice);
    deflate.push(slice, end === data.length);
    await onSlice(end - at);
  }
  return { body: concat(out, size), crc };
}

export async function zipEntries(entries: ZipEntry[], options: ZipOptions = {}): Promise<Uint8Array> {
  const { onSlice, onEntry } = options;
  const { time, date } = dosDateTime(options.date ?? new Date());
  const encoder = new TextEncoder();

  const total = entries.reduce((sum, e) => sum + (e.compress ? e.data.length : 0), 0);
  let done = 0;
  const advance = async (bytes: number) => {
    done += bytes;
    await onSlice?.(done, total);
  };

  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  let directorySize = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const flags = name.length !== entry.name.length ? FLAG_UTF8 : 0;
    const method = entry.compress ? METHOD_DEFLATE : METHOD_STORED;
    const { body, crc } = entry.compress
      ? await deflateInSlices(entry.data, advance)
      : { body: entry.data, crc: crc32(0, entry.data) };

    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, VERSION, true);
    l.setUint16(6, flags, true);
    l.setUint16(8, method, true);
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, body.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, name.length, true);
    l.setUint16(28, 0, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, VERSION, true); // créé par : MS-DOS, version 2.0
    c.setUint16(6, VERSION, true);
    c.setUint16(8, flags, true);
    c.setUint16(10, method, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, body.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    // Extra, commentaire, disque, attributs : tous nuls.
    c.setUint32(42, offset, true);
    central.set(name, 46);

    parts.push(local, body);
    directory.push(central);
    offset += local.length + body.length;
    directorySize += central.length;
    onEntry?.({ name: entry.name, stored: !entry.compress, size: entry.data.length, written: body.length });
  }

  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true);
  e.setUint32(16, offset, true);

  return concat([...parts, ...directory, end], offset + directorySize + end.length);
}
