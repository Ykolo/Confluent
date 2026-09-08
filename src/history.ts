/**
 * Historique des fusions, conservé sur l'appareil (écran « Fusions
 * précédentes »). On n'y garde que des métadonnées : les fichiers produits,
 * eux, sont enregistrés là où l'utilisateur les a rangés.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'confluent.history.v1';
const LIMIT = 30;

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
