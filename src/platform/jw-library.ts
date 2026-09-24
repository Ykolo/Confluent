/**
 * Remettre le fichier fusionné à JW Library.
 *
 * JW Library ne publie aucune ouverture directe : sa procédure documentée est
 * de restaurer depuis l'app elle-même (icône nuage › Restaurer une
 * sauvegarde). Rien ne dit qu'elle déclare savoir ouvrir un `.jwlibrary` reçu
 * d'ailleurs. On passe donc par le système, qui est le seul à savoir ce que
 * les apps installées acceptent, et on dit clairement quoi faire si personne
 * ne prend le fichier.
 *
 * - Android : `ACTION_VIEW` sur une URI `content://` de notre FileProvider.
 *   L'intention est implicite — sans `packageName` —, ce qui affiche le
 *   sélecteur « Ouvrir avec » et évite au passage le filtrage de visibilité
 *   des paquets d'Android 11+. `FLAG_GRANT_READ_URI_PERMISSION` est
 *   indispensable : sans lui, l'app choisie n'a pas le droit de lire l'URI.
 * - iOS : aucune intention de ce genre. La feuille de partage est le seul
 *   chemin, JW Library y apparaît sous « Copier vers ».
 */
import { Platform } from 'react-native';
import { getContentUriAsync } from 'expo-file-system/legacy';
import type { File } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';

import { AppError, isCancellation, logInfo } from '../errors';

/** Ce que l'utilisateur doit faire une fois dans JW Library. */
export const RESTORE_STEPS = 'Dans JW Library : icône nuage › Restaurer une sauvegarde.';

/** `FLAG_GRANT_READ_URI_PERMISSION` — le droit de lire notre fichier, le temps de l'ouvrir. */
const GRANT_READ = 1;

function noHandler(cause: unknown): AppError {
  return new AppError({
    title: 'Aucune app pour ce fichier',
    message: 'Le système n’a trouvé aucune app capable d’ouvrir une sauvegarde .jwlibrary.',
    hint: `Enregistre le fichier, puis restaure-le depuis JW Library. ${RESTORE_STEPS}`,
    cause,
  });
}

/**
 * Propose le fichier aux apps de l'appareil. Rend la main dès que le
 * sélecteur est refermé — on ne sait pas, et on ne peut pas savoir, ce que
 * l'app choisie en a fait.
 */
export async function openInJwLibrary(file: File): Promise<void> {
  if (Platform.OS === 'android') {
    const contentUri = await getContentUriAsync(file.uri);
    logInfo('ouverture', `ACTION_VIEW sur ${contentUri}`);
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        type: 'application/octet-stream',
        flags: GRANT_READ,
      });
    } catch (err) {
      // Refermer le sélecteur sans choisir n'est pas un échec.
      if (isCancellation(err)) return;
      throw noHandler(err);
    }
    return;
  }

  if (!await Sharing.isAvailableAsync()) throw noHandler('Sharing.isAvailableAsync() a répondu false');

  logInfo('ouverture', `feuille de partage pour ${file.name}`);
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    UTI: 'public.data',
    dialogTitle: 'Ouvrir dans JW Library',
  });
}
