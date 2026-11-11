/**
 * Le client de synchronisation de l'app (`src/cloud/client.ts`), sur le
 * `fetch` d'Expo et la session gardée par Better Auth dans le trousseau.
 *
 * `expo/fetch` plutôt que le `fetch` de React Native : il accepte des octets
 * (`Uint8Array`) comme corps d'envoi vers R2, sans passer par une chaîne
 * base64, et rend les réponses en `arrayBuffer()` directement.
 */
import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { API_URL, cloudHeaders } from '../auth-client';
import { createCloudClient } from '../cloud/client';

/** « iPhone », « iPad », « Android » : d'où part un dépôt, pour l'afficher ailleurs. */
export function deviceLabel(): string {
  if (Platform.OS === 'ios') return (Platform as { isPad?: boolean }).isPad ? 'iPad' : 'iPhone';
  if (Platform.OS === 'android') return 'Android';
  return 'l’app';
}

export const cloud = createCloudClient({
  baseUrl: API_URL,
  fetch: (url, init) => expoFetch(url, init as Parameters<typeof expoFetch>[1]) as unknown as Promise<Response>,
  headers: cloudHeaders,
  // Le cookie vient du trousseau par `headers` ; celui de la pile réseau
  // native ne doit pas s'y ajouter.
  credentials: 'omit',
  uploadedFrom: deviceLabel(),
});
