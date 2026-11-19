/** Les erreurs de Better Auth, telles que l'écran de connexion les affiche. */
import { describe, expect, test } from 'bun:test';

import { confirmationError, describeAuthError, MIN_PASSWORD } from '../src/auth-errors';

describe('describeAuthError', () => {
  test('identifiants faux : message en français, l’anglais dans le détail', () => {
    const view = describeAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password', status: 401 });
    expect(view.title).toBe('Connexion refusée');
    expect(view.message).toBe('L’adresse e-mail ou le mot de passe ne correspond pas.');
    expect(view.technical).toBe('401 · INVALID_EMAIL_OR_PASSWORD · Invalid email or password');
  });

  test('adresse déjà prise, sous ses deux codes', () => {
    expect(describeAuthError({ code: 'USER_ALREADY_EXISTS', status: 422 }).title).toBe('Adresse déjà utilisée');
    expect(describeAuthError({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 }).title).toBe('Adresse déjà utilisée');
  });

  test('mot de passe trop court : rappelle la longueur minimale', () => {
    expect(describeAuthError({ code: 'PASSWORD_TOO_SHORT', status: 400 }).message).toContain(`${MIN_PASSWORD} caractères`);
  });

  test('suppression du compte : mot de passe faux, manquant, fichiers non effacés', () => {
    expect(describeAuthError({ code: 'INVALID_PASSWORD', status: 400 }).hint).toBe('Le compte n’a pas été supprimé.');
    expect(describeAuthError({ code: 'PASSWORD_REQUIRED', status: 400 }).title).toBe('Mot de passe requis');
    expect(describeAuthError({ code: 'STORAGE_PURGE_FAILED', status: 503 }).message).toContain('ton compte est donc conservé');
  });

  test('429 : trop de tentatives', () => {
    expect(describeAuthError({ status: 429, message: 'Too many requests' }).title).toBe('Trop de tentatives');
  });

  test('sans statut : serveur injoignable', () => {
    expect(describeAuthError({ message: 'Failed to fetch' }).title).toBe('Pas de connexion');
    expect(describeAuthError(null).title).toBe('Pas de connexion');
  });

  test('codes reçus par e-mail : faux, expiré, trop d’essais, compte non confirmé', () => {
    expect(describeAuthError({ code: 'INVALID_OTP', status: 400 }).title).toBe('Code incorrect');
    expect(describeAuthError({ code: 'OTP_EXPIRED', status: 400 }).hint).toBe('Demande un nouveau code.');
    expect(describeAuthError({ code: 'TOO_MANY_ATTEMPTS', status: 403 }).title).toBe('Trop d’essais');
    expect(describeAuthError({ code: 'EMAIL_NOT_VERIFIED', status: 403 }).hint).toBe('Saisis le code reçu par e-mail.');
    // 429 avec un code connu : pas le « patiente une minute » générique.
    expect(describeAuthError({ code: 'TOO_MANY_CODE_REQUESTS', status: 429 }).hint).toContain('une heure');
  });

  test('code inconnu : vue générique', () => {
    const view = describeAuthError({ code: 'SOMETHING_NEW', status: 500 });
    expect(view.title).toBe('Connexion impossible');
    expect(view.technical).toBe('500 · SOMETHING_NEW');
  });
});

describe('confirmationError', () => {
  test('rien tant que la confirmation est vide ou identique', () => {
    expect(confirmationError('secret-123', '')).toBeNull();
    expect(confirmationError('secret-123', 'secret-123')).toBeNull();
  });

  test('un message dès que les deux diffèrent', () => {
    expect(confirmationError('secret-123', 'secret-12')).toBe('Les deux mots de passe ne sont pas identiques.');
  });
});
