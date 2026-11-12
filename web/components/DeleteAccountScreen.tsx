/**
 * Suppression du compte : le compte, ses sauvegardes et ses fusions partent
 * du serveur. Le mot de passe sert de confirmation explicite ; le serveur
 * l'exige aussi, et n'efface le compte qu'une fois les fichiers effacés.
 */
'use client';

import { useState, type FormEvent } from 'react';

import { describeAuthError } from '@core/auth-errors';
import { logError, type ErrorView } from '@core/errors';

import { deleteUser } from '@/lib/auth-client';

import { DangerButton, ErrorNotice, Eyebrow, TextButton, TextField } from './kit';
import s from './screens.module.css';

export function DeleteAccountScreen({ email, onCancel, onDeleted }: {
  email: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: failure } = await deleteUser({ password });
      if (failure) {
        const view = describeAuthError(failure);
        setError(logError('suppression du compte', new Error(view.technical), view));
        return;
      }
      onDeleted();
    } catch (err) {
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError('suppression du compte', err, view));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.screen}>
      <form className={s.scroll} onSubmit={(e) => void submit(e)}>
        <header className={s.header}>
          <Eyebrow>Compte Confluent</Eyebrow>
          <h1 className={s.title}>Supprimer mon compte</h1>
          <p className={s.lead}>
            Le compte <strong className={s.deleteEmail}>{email}</strong> sera supprimé, avec tout ce qu’il garde sur le serveur :
          </p>
        </header>

        <ul className={s.deleteList}>
          <li>les sauvegardes déposées dans les emplacements A et B ;</li>
          <li>toutes les fusions enregistrées dans l’historique du compte.</li>
        </ul>
        <p className={s.deleteNote}>
          Les fichiers déjà enregistrés sur tes appareils ne sont pas touchés. La suppression est définitive.
        </p>

        <div className={s.authForm}>
          <TextField
            label="Mot de passe, pour confirmer"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />

          {error && <ErrorNotice error={error} onDismiss={() => setError(null)} />}

          <DangerButton
            type="submit"
            label={busy ? 'Suppression…' : 'Supprimer définitivement'}
            disabled={busy || !password}
          />
          <TextButton label="Annuler" onClick={onCancel} disabled={busy} />
        </div>
      </form>
    </div>
  );
}
