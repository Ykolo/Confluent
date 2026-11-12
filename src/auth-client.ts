/**
 * Client Better Auth de l'app.
 *
 * Le plugin `expoClient` garde la session dans le trousseau du téléphone
 * (`expo-secure-store`) : elle survit au redémarrage de l'app. Il la renvoie
 * au serveur en en-tête `Cookie`, ce que fait aussi `cloudHeaders()` pour les
 * appels de synchronisation.
 */
import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';

/**
 * Adresse du serveur Next. Fixée par profil dans `eas.json` pour les builds,
 * et par `.env` en développement (l'IP du PC sur le réseau local, voir
 * `.env.example`). À défaut, le site en production.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://confluent-web.vercel.app').replace(/\/+$/, '');

export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({
      // Le schéma déclaré dans `app.json` ; le serveur l'admet dans `trustedOrigins`.
      scheme: 'confluent',
      storagePrefix: 'confluent',
      storage: SecureStore,
    }),
  ],
});

export const { useSession, signIn, signUp, signOut, deleteUser } = authClient;

/** En-têtes de session pour les appels à l'API de synchronisation (`createCloudClient`). */
export async function cloudHeaders(): Promise<Record<string, string>> {
  const cookie = await authClient.getCookie();
  return cookie ? { cookie } : {};
}
