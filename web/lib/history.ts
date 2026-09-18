/**
 * Historique des fusions, conservé dans ce navigateur (écran « Fusions
 * précédentes »). Même forme que celui de l'app mobile, en `localStorage`
 * au lieu d'`AsyncStorage` : on n'y garde que des métadonnées, les fichiers
 * produits sont là où l'utilisateur les a téléchargés.
 */
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
