/** Les erreurs de Better Auth, telles que l'écran de connexion les affiche. */
import { describe, expect, test } from 'bun:test';

import { describeAuthError, MIN_PASSWORD } from '../src/auth-errors';

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

  test('429 : trop de tentatives', () => {
    expect(describeAuthError({ status: 429, message: 'Too many requests' }).title).toBe('Trop de tentatives');
  });

  test('sans statut : serveur injoignable', () => {
    expect(describeAuthError({ message: 'Failed to fetch' }).title).toBe('Pas de connexion');
    expect(describeAuthError(null).title).toBe('Pas de connexion');
  });

  test('code inconnu : vue générique', () => {
    const view = describeAuthError({ code: 'SOMETHING_NEW', status: 500 });
    expect(view.title).toBe('Connexion impossible');
    expect(view.technical).toBe('500 · SOMETHING_NEW');
  });
});
