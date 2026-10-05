/**
 * Historique des fusions, conservé dans ce navigateur (écran « Fusions
 * précédentes »). Même forme que celui de l'app mobile : les métadonnées en
 * `localStorage` au lieu d'`AsyncStorage`, et les fichiers produits en
 * IndexedDB — `localStorage` ne tient que du texte, et quelques mégaoctets au
 * plus — pour pouvoir les retélécharger depuis l'historique.
 */
const KEY = 'confluent.history.v1';
const LIMIT = 30;

/**
 * Nombre de fusions dont on garde le fichier. Une sauvegarde pèse de quelques
 * mégaoctets à plusieurs dizaines avec ses pièces jointes : les plus
 * anciennes entrées ne gardent que leurs métadonnées.
 */
export const FILES_KEPT = 10;

const DB_NAME = 'confluent';
const STORE = 'fusions';

export interface HistoryEntry {
  id: string;
  /** Nom du fichier produit. */
  name: string;
  /** ISO 8601. */
  createdAt: string;
  /** Les deux sauvegardes fusionnées, telles qu'affichées : « iPad 05/09 + Samsung 06/09 ». */
  sources: string;
  notes: number;
  /** Taille du fichier produit, en octets. */
  size: number;
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // Un historique illisible — ou un stockage bloqué, en navigation privée —
    // ne doit pas empêcher de fusionner.
    return [];
  }
}

/** Ajoute une entrée en tête et renvoie l'historique à jour. */
export function addToHistory(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory()].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Idem : l'échec d'écriture ne remet pas la fusion en cause.
  }
  return next;
}

function openFiles(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openFiles();
  try {
    return await run(db.transaction(STORE, mode).objectStore(STORE));
  } finally {
    db.close();
  }
}

/**
 * Range le fichier d'une fusion, puis retire ceux des entrées sorties des
 * `FILES_KEPT` plus récentes. Renvoie les identifiants dont le fichier est
 * disponible.
 */
export async function storeFile(id: string, file: Blob): Promise<Set<string>> {
  const kept = new Set(loadHistory().slice(0, FILES_KEPT).map((entry) => entry.id));
  kept.add(id);
  await withStore('readwrite', async (store) => {
    await settle(store.put(file, id));
    const keys = await settle(store.getAllKeys());
    await Promise.all(keys.filter((key) => !kept.has(String(key))).map((key) => settle(store.delete(key))));
  });
  return storedFiles();
}

/** Le fichier d'une fusion, ou `null` s'il n'a pas été conservé. */
export async function loadFile(id: string): Promise<Blob | null> {
  const file = await withStore('readonly', (store) => settle<unknown>(store.get(id)));
  return file instanceof Blob ? file : null;
}

/** Identifiants des fusions dont le fichier est encore là. */
export async function storedFiles(): Promise<Set<string>> {
  try {
    const keys = await withStore('readonly', (store) => settle(store.getAllKeys()));
    return new Set(keys.map(String));
  } catch {
    // IndexedDB indisponible (navigation privée sur certains navigateurs) :
    // l'historique s'affiche quand même, sans téléchargement.
    return new Set();
  }
}
