/** Les étapes de l'écran de compte : saisie du code, boutons, renvoi. */
import { describe, expect, test } from 'bun:test';

import {
  canSubmit, codeSentLead, isOtpComplete, normalizeOtp, OTP_LENGTH, RESEND_DELAY_S, resendLabel, resendRemaining,
  stepAfterSignInFailure, type AccountFields,
} from '../src/account-flow';
import { MIN_PASSWORD } from '../src/auth-errors';

const fields = (over: Partial<AccountFields> = {}): AccountFields => ({
  email: 'a@example.test', password: '', confirmation: '', otp: '', ...over,
});
const good = 'x'.repeat(MIN_PASSWORD);

describe('normalizeOtp', () => {
  test('garde les chiffres d’un code collé avec espaces ou retour à la ligne', () => {
    expect(normalizeOtp(' 123 456\n')).toBe('123456');
    expect(normalizeOtp('12-34-56')).toBe('123456');
  });

  test('coupe au-delà de la longueur du code', () => {
    expect(normalizeOtp('1234567890')).toHaveLength(OTP_LENGTH);
  });

  test('isOtpComplete : exactement six chiffres', () => {
    expect(isOtpComplete('123456')).toBe(true);
    expect(isOtpComplete('12345')).toBe(false);
    expect(isOtpComplete('12345a')).toBe(false);
  });
});

describe('stepAfterSignInFailure', () => {
  test('compte non confirmé : saisie du code', () => {
    expect(stepAfterSignInFailure('EMAIL_NOT_VERIFIED')).toBe('verify');
  });

  test('autres échecs : on reste sur la connexion', () => {
    expect(stepAfterSignInFailure('INVALID_EMAIL_OR_PASSWORD')).toBeNull();
    expect(stepAfterSignInFailure(undefined)).toBeNull();
  });
});

describe('canSubmit', () => {
  test('connexion : adresse et mot de passe', () => {
    expect(canSubmit('sign-in', fields({ password: 'p' }))).toBe(true);
    expect(canSubmit('sign-in', fields({ email: '  ', password: 'p' }))).toBe(false);
  });

  test('inscription : mot de passe assez long et confirmé', () => {
    expect(canSubmit('sign-up', fields({ password: good, confirmation: good }))).toBe(true);
    expect(canSubmit('sign-up', fields({ password: good, confirmation: `${good}!` }))).toBe(false);
    expect(canSubmit('sign-up', fields({ password: 'court', confirmation: 'court' }))).toBe(false);
  });

  test('saisie du code : six chiffres', () => {
    expect(canSubmit('verify', fields({ otp: '123456' }))).toBe(true);
    expect(canSubmit('verify', fields({ otp: '123' }))).toBe(false);
  });

  test('mot de passe oublié : l’adresse, puis le code et un nouveau mot de passe confirmé', () => {
    expect(canSubmit('forgot-email', fields())).toBe(true);
    expect(canSubmit('forgot-email', fields({ email: '' }))).toBe(false);
    expect(canSubmit('forgot-reset', fields({ otp: '123456', password: good, confirmation: good }))).toBe(true);
    expect(canSubmit('forgot-reset', fields({ otp: '123456', password: good, confirmation: '' }))).toBe(false);
    expect(canSubmit('forgot-reset', fields({ otp: '', password: good, confirmation: good }))).toBe(false);
  });
});

describe('renvoi du code', () => {
  test('rien envoyé : renvoi possible tout de suite', () => {
    expect(resendRemaining(null, 1_000)).toBe(0);
  });

  test('compte à rebours depuis l’envoi, arrondi à la seconde supérieure', () => {
    const sentAt = 10_000;
    expect(resendRemaining(sentAt, sentAt)).toBe(RESEND_DELAY_S);
    expect(resendRemaining(sentAt, sentAt + 500)).toBe(RESEND_DELAY_S);
    expect(resendRemaining(sentAt, sentAt + 59_001)).toBe(1);
    expect(resendRemaining(sentAt, sentAt + RESEND_DELAY_S * 1000)).toBe(0);
  });

  test('libellé du bouton', () => {
    expect(resendLabel(12)).toBe('Renvoyer le code (12 s)');
    expect(resendLabel(0)).toBe('Renvoyer le code');
  });

  test('le texte nomme l’adresse, sans dire si elle a un compte lors d’une réinitialisation', () => {
    expect(codeSentLead('verify', ' a@example.test ')).toContain('a@example.test.');
    expect(codeSentLead('forgot-reset', 'a@example.test')).toStartWith('Si un compte existe');
  });
});
