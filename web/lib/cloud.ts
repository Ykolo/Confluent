/**
 * Le client de synchronisation du site (`@core/cloud/client`), sur la même
 * origine que l'API : la session suit dans le cookie, sans rien à configurer.
 */
'use client';

import { createCloudClient } from '@core/cloud/client';

/** « Chrome sur Windows », « Safari sur iPhone » : d'où part un dépôt, pour l'afficher ailleurs. */
export function browserLabel(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'un navigateur';
  const system = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Linux/.test(ua) ? 'Linux'
    : null;
  return system ? `${browser} sur ${system}` : browser;
}

export const cloud = createCloudClient({
  baseUrl: '',
  // Lié à `window` : appelé détaché, `fetch` lève « Illegal invocation ».
  fetch: (input, init) => fetch(input, init),
  uploadedFrom: browserLabel(),
});
