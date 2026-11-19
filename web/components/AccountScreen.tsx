/**
 * Connexion et inscription, par e-mail et mot de passe.
 *
 * Le compte reste facultatif : la fusion marche sans, il ne sert qu'à
 * retrouver ses sauvegardes et ses fusions d'un appareil à l'autre. On arrive
 * ici depuis « Se connecter pour synchroniser », et on en repart à tout moment.
 */
'use client';

import { useState, type FormEvent } from 'react';

import { logError, type ErrorView } from '@core/errors';

import { signIn, signUp } from '@/lib/auth-client';
import { confirmationError, describeAuthError, MIN_PASSWORD } from '@core/auth-errors';

import { ErrorNotice, Eyebrow, PasswordField, PrimaryButton, Segmented, TextButton, TextField } from './kit';
import s from './screens.module.css';

type Mode = 'sign-in' | 'sign-up';

const MODES = [
  { value: 'sign-in', label: 'Se connecter' },
  { value: 'sign-up', label: 'Créer un compte' },
] as const;

export function AccountScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const signingUp = mode === 'sign-up';
  const mismatch = signingUp ? confirmationError(password, confirmation) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // Le compte n'est créé que si les deux saisies concordent.
    if (signingUp && (mismatch || confirmation !== password)) return;
    setError(null);
    setBusy(true);
    try {
      const { error: failure } = mode === 'sign-in'
        ? await signIn.email({ email, password })
        : await signUp.email({
          email,
          password,
          // Better Auth exige un nom ; on ne le demande pas pour garder le
          // formulaire court, la partie locale de l'adresse en tient lieu.
          name: email.split('@')[0] || email,
        });
      if (failure) {
        const view = describeAuthError(failure);
        setError(logError(mode === 'sign-in' ? 'connexion' : 'inscription', new Error(view.technical), view));
        return;
      }
      onDone();
    } catch (err) {
      // Serveur injoignable : le client Better Auth rejette sans statut.
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError('compte', err, view));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.screen}>
      <form className={s.scroll} onSubmit={(e) => void submit(e)}>
        <header className={s.header}>
          <Eyebrow>Compte Tserohr</Eyebrow>
          <h1 className={s.title}>{signingUp ? 'Créer un compte' : 'Se connecter'}</h1>
          <p className={s.lead}>
            Pour retrouver tes sauvegardes et tes fusions sur tous tes appareils. La fusion, elle, marche sans compte.
          </p>
        </header>

        <div className={s.authForm}>
          <Segmented
            label="Connexion ou inscription"
            options={MODES}
            value={mode}
            onChange={(next) => { setMode(next); setError(null); setConfirmation(''); }}
            disabled={busy}
          />
          <TextField
            label="Adresse e-mail"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
          <PasswordField
            label="Mot de passe"
            name="password"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            required
            minLength={signingUp ? MIN_PASSWORD : undefined}
            hint={signingUp ? `${MIN_PASSWORD} caractères au moins.` : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {signingUp && (
            <PasswordField
              label="Confirmer le mot de passe"
              name="password-confirmation"
              autoComplete="new-password"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              error={mismatch}
              disabled={busy}
            />
          )}

          {error && <ErrorNotice error={error} onDismiss={() => setError(null)} />}

          <PrimaryButton
            type="submit"
            label={busy ? 'Un instant…' : signingUp ? 'Créer mon compte' : 'Se connecter'}
            disabled={busy || !email || !password || (signingUp && (!confirmation || !!mismatch))}
          />
          <TextButton label="Continuer sans compte" onClick={onDone} disabled={busy} />
        </div>
      </form>
    </div>
  );
}
