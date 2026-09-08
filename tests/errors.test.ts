/** Traduction des erreurs : ce que l'écran montre à partir d'une erreur brute. */
import { describe, expect, test } from 'bun:test';

import { AppError, describeError, isCancellation } from '../src/errors';

describe('describeError', () => {
  test('laisse passer une erreur déjà rédigée', () => {
    const view = describeError(new AppError({
      title: 'Format non pris en charge',
      message: 'Version de JW Library trop récente.',
      hint: 'Mets Confluent à jour.',
      technical: 'schemaVersion 17, attendu 16',
    }));

    expect(view.title).toBe('Format non pris en charge');
    expect(view.technical).toBe('schemaVersion 17, attendu 16');
  });

  test('traduit le rejet natif d’expo-sqlite sans perdre le message d’origine', () => {
    const raw = new Error(
      "Call to function 'NativeDatabase.prepareAsync' has been rejected."
      + '\n→ Caused by: Error code : no such table: Note',
    );
    const view = describeError(raw);

    expect(view.title).toBe('Sauvegarde illisible');
    expect(view.message).not.toMatch(/prepareAsync/);
    expect(view.technical).toMatch(/no such table: Note/);
  });

  test('remonte la chaîne de causes pour reconnaître l’erreur', () => {
    const inner = new Error('SQLITE_FULL: database or disk is full');
    const outer = new AppError({ title: 'x', message: 'y', cause: inner });
    // L'AppError est rédigée : c'est elle qui l'emporte.
    expect(describeError(outer).title).toBe('x');
    // Une erreur brute enveloppant la même cause, en revanche, est traduite.
    const wrapped = new Error('échec');
    (wrapped as { cause?: unknown }).cause = inner;
    expect(describeError(wrapped).title).toBe('Stockage plein');
  });

  test('donne un repli lisible pour une erreur inconnue', () => {
    const view = describeError(new Error('kaboom'));
    expect(view.title).toBe('Quelque chose s’est mal passé');
    expect(view.technical).toBe('Error: kaboom');
  });

  test('reconnaît une annulation de l’utilisateur', () => {
    expect(isCancellation(new Error('User canceled the document picker'))).toBe(true);
    expect(isCancellation(new Error('SQLITE_FULL'))).toBe(false);
  });
});
