/**
 * Mon compte : l'adresse du compte, la déconnexion, et tout en bas la
 * suppression du compte.
 *
 * La suppression passe par une boîte de confirmation (`<dialog>` modal) qui
 * dit ce qui part et demande le mot de passe : le serveur l'exige aussi, et
 * n'efface le compte qu'une fois les fichiers effacés.
 */
'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { describeAuthError } from '@core/auth-errors';
import { logError, type ErrorView } from '@core/errors';

import { deleteUser } from '@/lib/auth-client';

import { DangerButton, ErrorNotice, Eyebrow, PasswordField, SecondaryButton, TextButton } from './kit';
import s from './screens.module.css';

export function MyAccountScreen({ email, busy, onBack, onSignOut, onDeleted }: {
  email: string;
  busy: boolean;
  onBack: () => void;
  onSignOut: () => void;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={s.screen}>
      <div className={s.scroll}>
        <header className={s.header}>
          <Eyebrow>Compte Tserohr</Eyebrow>
          <h1 className={s.title}>Mon compte</h1>
          <p className={s.lead}>
            Connecté en tant que <strong className={s.deleteEmail}>{email}</strong>.
          </p>
        </header>

        <div className={s.authForm}>
          <SecondaryButton label="Se déconnecter" onClick={onSignOut} disabled={busy} />
          <TextButton label="Retour" onClick={onBack} disabled={busy} />
        </div>

        <section className={s.dangerZone} aria-labelledby="danger-zone-title">
          <h2 id="danger-zone-title" className={s.dangerTitle}>Supprimer mon compte</h2>
          <p className={s.deleteNote}>
            Efface le compte, les sauvegardes déposées et les fusions enregistrées. Définitif.
          </p>
          <DangerButton solid label="Supprimer mon compte" onClick={() => setConfirming(true)} disabled={busy} />
        </section>
      </div>

      {confirming && (
        <DeleteDialog email={email} onCancel={() => setConfirming(false)} onDeleted={onDeleted} />
      )}
    </div>
  );
}

/** La confirmation : ce qui part, ce qui reste, et le mot de passe. */
function DeleteDialog({ email, onCancel, onDeleted }: {
  email: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  // `showModal` : le reste de la page devient inerte, Échap ferme, le focus
  // reste dans la boîte.
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

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
      dialog.current?.close();
      onDeleted();
    } catch (err) {
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError('suppression du compte', err, view));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      className={s.dialog}
      role="alertdialog"
      aria-labelledby="delete-title"
      aria-describedby="delete-desc"
      onCancel={(e) => { if (busy) e.preventDefault(); else onCancel(); }}
    >
      <form className={s.dialogBody} onSubmit={(e) => void submit(e)}>
        <h2 id="delete-title" className={s.dialogTitle}>Supprimer ton compte ?</h2>
        <div id="delete-desc">
          <p className={s.lead}>
            Le compte <strong className={s.deleteEmail}>{email}</strong> sera supprimé, avec tout ce qu’il garde sur le serveur :
          </p>
          <ul className={s.deleteList}>
            <li>les sauvegardes déposées dans les emplacements A et B ;</li>
            <li>toutes les fusions enregistrées dans l’historique du compte.</li>
          </ul>
          <p className={s.deleteNote}>
            Les fichiers déjà enregistrés sur tes appareils ne sont pas touchés. La suppression est définitive.
          </p>
        </div>

        <PasswordField
          label="Mot de passe, pour confirmer"
          name="delete-password"
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
        <TextButton label="Annuler" onClick={() => { dialog.current?.close(); onCancel(); }} disabled={busy} />
      </form>
    </dialog>
  );
}
