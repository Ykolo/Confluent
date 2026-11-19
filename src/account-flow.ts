/**
 * Les étapes de l'écran de compte, communes à l'app et au site : seul
 * l'affichage diffère (`src/ui/AccountScreen.tsx`, `web/components/AccountScreen.tsx`).
 *
 *   - sign-up → verify → connecté
 *   - sign-in → connecté, ou verify si le compte n'est pas encore confirmé
 *   - sign-in → forgot-email → forgot-reset → connecté
 *
 * Les codes arrivent par e-mail (plugin `emailOTP` de Better Auth, voir
 * `web/lib/auth.ts`). Rien ici ne dépend de React Native ni du DOM.
 */
import { useEffect, useState } from 'react';

import { confirmationError, describeAuthError, MIN_PASSWORD, type AuthFailure } from './auth-errors';
import { logError, type ErrorView } from './errors';

export type AccountStep = 'sign-in' | 'sign-up' | 'verify' | 'forgot-email' | 'forgot-reset';

/** Longueur des codes envoyés (`otpLength` côté serveur). */
export const OTP_LENGTH = 6;

/** Attente imposée avant de redemander un code, en secondes. */
export const RESEND_DELAY_S = 60;

/**
 * Ce qui reste d'une saisie de code : les chiffres seulement, au plus
 * `OTP_LENGTH`. Un code collé depuis l'e-mail (« 123 456 », avec espaces ou
 * retour à la ligne) passe ainsi tel quel.
 */
export function normalizeOtp(input: string): string {
  return input.replace(/\D/g, '').slice(0, OTP_LENGTH);
}

export function isOtpComplete(otp: string): boolean {
  return otp.length === OTP_LENGTH && /^\d+$/.test(otp);
}

/** Les étapes vers lesquelles un échec de connexion fait basculer. */
export function stepAfterSignInFailure(code: string | undefined): AccountStep | null {
  // Le serveur vient d'envoyer un code (`sendOnSignIn`) : on passe à sa saisie.
  return code === 'EMAIL_NOT_VERIFIED' ? 'verify' : null;
}

export interface AccountFields {
  email: string;
  password: string;
  confirmation: string;
  otp: string;
}

/** Le bouton principal de l'étape peut-il partir ? */
export function canSubmit(step: AccountStep, f: AccountFields): boolean {
  const email = f.email.trim().length > 0;
  const newPassword = f.password.length >= MIN_PASSWORD && f.confirmation === f.password;
  switch (step) {
    case 'sign-in': return email && f.password.length > 0;
    case 'sign-up': return email && newPassword;
    case 'verify': return email && isOtpComplete(f.otp);
    case 'forgot-email': return email;
    case 'forgot-reset': return email && isOtpComplete(f.otp) && newPassword;
  }
}

/** Secondes restant avant de pouvoir redemander un code envoyé à `sentAt`. */
export function resendRemaining(sentAt: number | null, now: number): number {
  if (sentAt === null) return 0;
  return Math.max(0, Math.ceil((sentAt + RESEND_DELAY_S * 1000 - now) / 1000));
}

/** Le libellé du bouton « Renvoyer le code », compte à rebours compris. */
export function resendLabel(remaining: number): string {
  return remaining > 0 ? `Renvoyer le code (${remaining} s)` : 'Renvoyer le code';
}

/** Le texte qui accompagne la saisie du code. */
export function codeSentLead(step: 'verify' | 'forgot-reset', email: string): string {
  const to = email.trim();
  return step === 'verify'
    ? `Un code à ${OTP_LENGTH} chiffres vient d’être envoyé à ${to}. Saisis-le pour activer ton compte. Si cette adresse a déjà un compte, tu reçois à la place un e-mail qui te le rappelle.`
    : `Si un compte existe pour ${to}, un code à ${OTP_LENGTH} chiffres vient de lui être envoyé. Saisis-le avec ton nouveau mot de passe.`;
}

/**
 * Le compte à rebours avant de pouvoir redemander un code. `markSent()` le
 * relance ; `remaining` vaut 0 quand le bouton peut repartir.
 */
export function useResendCooldown(): { remaining: number; markSent: () => void; reset: () => void } {
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const remaining = resendRemaining(sentAt, now);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    remaining,
    markSent: () => { const t = Date.now(); setSentAt(t); setNow(t); },
    reset: () => setSentAt(null),
  };
}

// --- Le déroulé complet -------------------------------------------------------

type Call = Promise<{ error: AuthFailure | null }>;

/**
 * Les appels Better Auth dont l'écran a besoin. Chaque plateforme les branche
 * sur son propre client (`src/auth-client.ts`, `web/lib/auth-client.ts`).
 */
export interface AccountClient {
  signIn(body: { email: string; password: string }): Call;
  signUp(body: { email: string; password: string; name: string }): Call;
  verifyEmail(body: { email: string; otp: string }): Call;
  sendVerificationOtp(body: { email: string }): Call;
  requestPasswordReset(body: { email: string }): Call;
  resetPassword(body: { email: string; otp: string; password: string }): Call;
}

/**
 * L'état et les actions de l'écran de compte. L'écran n'a plus qu'à afficher
 * les champs de `step` et à brancher `submit`, `resend` et `go`.
 */
export function useAccountFlow(client: AccountClient, onDone: () => void) {
  const [step, setStep] = useState<AccountStep>('sign-in');
  // Où ramène « Changer d'adresse » depuis la saisie du code.
  const [verifyFrom, setVerifyFrom] = useState<'sign-in' | 'sign-up'>('sign-up');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [otp, setOtpRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);
  const cooldown = useResendCooldown();

  const address = email.trim();
  const choosingPassword = step === 'sign-up' || step === 'forgot-reset';

  /** Change d'étape, en vidant ce qui n'a plus de sens dans la suivante. */
  const go = (next: AccountStep) => {
    setStep(next);
    setError(null);
    setOtpRaw('');
    setConfirmation('');
    // Le mot de passe tapé à la connexion n'est pas le nouveau.
    if (next === 'forgot-reset') setPassword('');
  };

  /**
   * Lance un appel ; un échec s'affiche dans l'encart d'erreur, sauf si
   * `handled` le prend en charge. Renvoie `true` si l'appel a réussi.
   */
  const request = async (scope: string, call: () => Call, handled?: (f: AuthFailure) => boolean): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      const { error: failure } = await call();
      if (!failure) return true;
      if (!handled?.(failure)) {
        const view = describeAuthError(failure);
        setError(logError(scope, new Error(view.technical), view));
      }
      return false;
    } catch (err) {
      // Serveur injoignable : le client Better Auth rejette sans statut.
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError(scope, err, view));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Passe à la saisie d'un code qui vient de partir. */
  const awaitCode = (next: 'verify' | 'forgot-reset') => {
    go(next);
    cooldown.markSent();
  };

  const submit = async () => {
    if (busy || !canSubmit(step, { email, password, confirmation, otp })) return;
    switch (step) {
      case 'sign-in': {
        let unverified = false;
        const ok = await request('connexion', () => client.signIn({ email: address, password }), (f) => {
          unverified = stepAfterSignInFailure(f.code) === 'verify';
          return unverified;
        });
        if (ok) onDone();
        else if (unverified) { setVerifyFrom('sign-in'); awaitCode('verify'); }
        return;
      }
      case 'sign-up': {
        const ok = await request('inscription', () => client.signUp({
          email: address,
          password,
          // Better Auth exige un nom ; on ne le demande pas pour garder le
          // formulaire court, la partie locale de l'adresse en tient lieu.
          name: address.split('@')[0] || address,
        }));
        if (ok) { setVerifyFrom('sign-up'); awaitCode('verify'); }
        return;
      }
      case 'verify':
        // Le code validé ouvre la session (`autoSignInAfterVerification`).
        if (await request('confirmation', () => client.verifyEmail({ email: address, otp }))) onDone();
        return;
      case 'forgot-email':
        if (await request('mot de passe oublié', () => client.requestPasswordReset({ email: address }))) awaitCode('forgot-reset');
        return;
      case 'forgot-reset': {
        if (!await request('réinitialisation', () => client.resetPassword({ email: address, otp, password }))) return;
        // Toutes les sessions viennent d'être révoquées : on se reconnecte.
        if (await request('connexion', () => client.signIn({ email: address, password }))) onDone();
        else setStep('sign-in'); // l'erreur reste affichée
        return;
      }
    }
  };

  const resend = async () => {
    if (busy || cooldown.remaining > 0) return;
    const ok = step === 'verify'
      ? await request('renvoi du code', () => client.sendVerificationOtp({ email: address }))
      : await request('renvoi du code', () => client.requestPasswordReset({ email: address }));
    if (ok) { cooldown.markSent(); setOtpRaw(''); }
  };

  return {
    step,
    go,
    /** Quitte la saisie du code, pour corriger l'adresse. */
    leaveVerify: () => go(verifyFrom),
    email, setEmail,
    password, setPassword,
    confirmation, setConfirmation,
    otp, setOtp: (value: string) => setOtpRaw(normalizeOtp(value)),
    busy,
    error,
    dismissError: () => setError(null),
    ready: canSubmit(step, { email, password, confirmation, otp }),
    mismatch: choosingPassword ? confirmationError(password, confirmation) : null,
    submit,
    resend,
    resendRemaining: cooldown.remaining,
  };
}
