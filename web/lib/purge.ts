/**
 * Effacement de tous les fichiers d'un utilisateur dans R2, à la suppression
 * de son compte (RGPD : ses notes JW Library sont des données personnelles).
 *
 * Les lignes `Backup` et `Merge` partent avec le compte (`onDelete: Cascade`),
 * mais les fichiers, eux, vivent dans R2 : sans cette purge, ils y
 * resteraient sans plus aucune trace en base.
 *
 * Réservé au serveur.
 */
import 'server-only';

import { removePrefix, userPrefixes } from '@/lib/r2';

export interface PurgeOptions {
  /** Nombre d'essais avant d'abandonner. */
  attempts?: number;
  /** Attente avant le deuxième essai ; elle double ensuite. */
  delayMs?: number;
  /** Remplaçable dans les tests. */
  remove?: (prefix: string) => Promise<number>;
  wait?: (ms: number) => Promise<void>;
  log?: (message: string, err: unknown) => void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Vide `backups/{userId}/` puis `merges/{userId}/`. Chaque échec est
 * journalisé, et l'ensemble est retenté, les objets déjà effacés ne
 * revenant pas. Lève la dernière erreur si tous les essais échouent :
 * l'appelant doit alors renoncer à supprimer le compte, pour que les
 * fichiers gardent un propriétaire et puissent être effacés plus tard.
 *
 * Renvoie le nombre d'objets effacés.
 */
export async function purgeUserFiles(userId: string, options: PurgeOptions = {}): Promise<number> {
  const {
    attempts = 3,
    delayMs = 500,
    remove = removePrefix,
    wait = sleep,
    log = (message, err) => console.error(message, err),
  } = options;
  // Valide l'identifiant avant tout appel réseau.
  const prefixes = userPrefixes(userId);
  let removed = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      for (const prefix of prefixes) removed += await remove(prefix);
      return removed;
    } catch (err) {
      log(`[compte] purge R2 de ${userId} : essai ${attempt}/${attempts} en échec`, err);
      if (attempt >= attempts) throw err;
      await wait(delayMs * 2 ** (attempt - 1));
    }
  }
}
