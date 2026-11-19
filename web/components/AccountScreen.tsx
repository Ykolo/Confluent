/**
 * Connexion et inscription par e-mail et mot de passe, confirmation de
 * l'adresse par un code reçu par e-mail, et mot de passe oublié.
 *
 * Le compte reste facultatif : la fusion marche sans, il ne sert qu'à
 * retrouver ses sauvegardes et ses fusions d'un appareil à l'autre. On arrive
 * ici depuis « Se connecter pour synchroniser », et on en repart à tout moment.
 *
 * Le déroulé (étapes, appels, renvoi du code) est celui de l'app :
 * `useAccountFlow`, dans `src/account-flow.ts`.
 */
'use client';

import type { FormEvent } from 'react';

import { codeSentLead, resendLabel, useAccountFlow, type AccountClient, type AccountStep } from '@core/account-flow';
import { MIN_PASSWORD } from '@core/auth-errors';

import { emailOtp, signIn, signUp } from '@/lib/auth-client';

import { ErrorNotice, Eyebrow, OtpField, PasswordField, PrimaryButton, Segmented, TextButton, TextField } from './kit';
import s from './screens.module.css';

const MODES = [
  { value: 'sign-in', label: 'Se connecter' },
  { value: 'sign-up', label: 'Créer un compte' },
] as const;

const client: AccountClient = {
  signIn: (body) => signIn.email(body),
  signUp: (body) => signUp.email(body),
  verifyEmail: (body) => emailOtp.verifyEmail(body),
  sendVerificationOtp: ({ email }) => emailOtp.sendVerificationOtp({ email, type: 'email-verification' }),
  requestPasswordReset: (body) => emailOtp.requestPasswordReset(body),
  resetPassword: (body) => emailOtp.resetPassword(body),
};

const TITLES: Record<AccountStep, string> = {
  'sign-in': 'Se connecter',
  'sign-up': 'Créer un compte',
  verify: 'Confirme ton adresse',
  'forgot-email': 'Mot de passe oublié',
  'forgot-reset': 'Nouveau mot de passe',
};

const ACTIONS: Record<AccountStep, string> = {
  'sign-in': 'Se connecter',
  'sign-up': 'Créer mon compte',
  verify: 'Confirmer',
  'forgot-email': 'Recevoir un code',
  'forgot-reset': 'Changer le mot de passe',
};

const LEAD = 'Pour retrouver tes sauvegardes et tes fusions sur tous tes appareils. La fusion, elle, marche sans compte.';

export function AccountScreen({ onDone }: { onDone: () => void }) {
  const flow = useAccountFlow(client, onDone);
  const { step, busy } = flow;
  const entering = step === 'sign-in' || step === 'sign-up';
  const codeStep = step === 'verify' || step === 'forgot-reset';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void flow.submit();
  };

  const lead = codeStep
    ? codeSentLead(step, flow.email)
    : step === 'forgot-email'
      ? 'Saisis l’adresse de ton compte : tu y recevras un code pour choisir un nouveau mot de passe.'
      : LEAD;

  return (
    <div className={s.screen}>
      <form className={s.scroll} onSubmit={submit}>
        <header className={s.header}>
          <Eyebrow>Compte Tserohr</Eyebrow>
          <h1 className={s.title}>{TITLES[step]}</h1>
          <p className={s.lead}>{lead}</p>
        </header>

        <div className={s.authForm}>
          {entering && (
            <Segmented
              label="Connexion ou inscription"
              options={MODES}
              value={step}
              onChange={flow.go}
              disabled={busy}
            />
          )}

          {(entering || step === 'forgot-email') && (
            <TextField
              label="Adresse e-mail"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              autoFocus
              value={flow.email}
              onChange={(e) => flow.setEmail(e.target.value)}
              disabled={busy}
            />
          )}

          {codeStep && (
            <OtpField
              key={step}
              label="Code reçu par e-mail"
              value={flow.otp}
              onChange={flow.setOtp}
              disabled={busy}
              autoFocus
            />
          )}

          {step === 'sign-in' && (
            <>
              <PasswordField
                label="Mot de passe"
                name="password"
                autoComplete="current-password"
                required
                value={flow.password}
                onChange={(e) => flow.setPassword(e.target.value)}
                disabled={busy}
              />
              <TextButton label="Mot de passe oublié ?" align="end" onClick={() => flow.go('forgot-email')} disabled={busy} />
            </>
          )}

          {(step === 'sign-up' || step === 'forgot-reset') && (
            <>
              <PasswordField
                label={step === 'sign-up' ? 'Mot de passe' : 'Nouveau mot de passe'}
                name="password"
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                hint={`${MIN_PASSWORD} caractères au moins.`}
                value={flow.password}
                onChange={(e) => flow.setPassword(e.target.value)}
                disabled={busy}
              />
              <PasswordField
                label="Confirmer le mot de passe"
                name="password-confirmation"
                autoComplete="new-password"
                required
                value={flow.confirmation}
                onChange={(e) => flow.setConfirmation(e.target.value)}
                error={flow.mismatch}
                disabled={busy}
              />
            </>
          )}

          {flow.error && <ErrorNotice error={flow.error} onDismiss={flow.dismissError} />}

          <PrimaryButton type="submit" label={busy ? 'Un instant…' : ACTIONS[step]} disabled={busy || !flow.ready} />

          {codeStep && (
            <TextButton
              label={resendLabel(flow.resendRemaining)}
              onClick={() => void flow.resend()}
              disabled={busy || flow.resendRemaining > 0}
            />
          )}
          {step === 'verify' && <TextButton label="Changer d’adresse" onClick={flow.leaveVerify} disabled={busy} />}
          {(step === 'forgot-email' || step === 'forgot-reset') && (
            <TextButton label="Retour à la connexion" onClick={() => flow.go('sign-in')} disabled={busy} />
          )}
          {entering && <TextButton label="Continuer sans compte" onClick={onDone} disabled={busy} />}
        </div>
      </form>
    </div>
  );
}
