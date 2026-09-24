/**
 * Historique des fusions, conservé sur l'appareil (écran « Fusions
 * précédentes »). Les métadonnées vont en `AsyncStorage` ; les fichiers
 * produits dans les documents de l'app — pas dans le cache, que le système
 * vide quand il manque de place — pour pouvoir les réenregistrer ou les
 * repartager depuis l'historique.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

const KEY = 'confluent.history.v1';
const LIMIT = 30;

/**
 * Nombre de fusions dont on garde le fichier. Une sauvegarde pèse de quelques
 * mégaoctets à plusieurs dizaines avec ses pièces jointes : les plus
 * anciennes entrées ne gardent que leurs métadonnées.
 */
export const FILES_KEPT = 10;

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

export async function loadHistory(): Promise<HistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // Un historique illisible ne doit pas empêcher de fusionner.
    return [];
  }
}

/** Ajoute une entrée en tête et renvoie l'historique à jour. */
export async function addToHistory(entry: HistoryEntry): Promise<HistoryEntry[]> {
  const next = [entry, ...await loadHistory()].slice(0, LIMIT);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Idem : l'échec d'écriture ne remet pas la fusion en cause.
  }
  return next;
}

export async function clearHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

/** Répertoire des fichiers produits : un sous-dossier par fusion. */
function archiveDirectory(): Directory {
  const dir = new Directory(Paths.document, 'fusions');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Emplacement du fichier d'une fusion. Le sous-dossier porte l'identifiant
 * de l'entrée, le fichier garde son nom : deux fusions du même jour ne se
 * marchent pas dessus, et le partage propose le nom attendu.
 */
export function archivedFile(entry: Pick<HistoryEntry, 'id' | 'name'>): File {
  const dir = new Directory(archiveDirectory(), entry.id);
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, entry.name);
}

/** Le fichier d'une fusion, ou `null` s'il n'a pas été conservé. */
export function findArchivedFile(entry: HistoryEntry): File | null {
  try {
    const file = new File(new Directory(archiveDirectory(), entry.id), entry.name);
    return file.exists ? file : null;
  } catch {
    return null;
  }
}

/** Retire les fichiers des fusions sorties des `FILES_KEPT` plus récentes. */
export function pruneArchive(history: HistoryEntry[]): void {
  const kept = new Set(history.slice(0, FILES_KEPT).map((entry) => entry.id));
  try {
    for (const item of archiveDirectory().list()) {
      if (!kept.has(item.name)) item.delete();
    }
  } catch {
    // Un fichier qu'on n'arrive pas à supprimer sera retenté à la prochaine fusion.
  }
}
