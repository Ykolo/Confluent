/** Écran 2 — Récapitulatif : ce que contient le fichier produit, et quoi en faire. */
'use client';

import type { ErrorView } from '@core/errors';
import * as fmt from '@core/format';
import type { MergeReport } from '@core/merge';

import { Card, ErrorNotice, Eyebrow, PrimaryButton, SecondaryButton, Spinner, TextButton } from './kit';
import s from './screens.module.css';

export interface SummaryScreenProps {
  report: MergeReport;
  fileName: string;
  /** Taille de l'archive produite, en octets. */
  fileSize: number;
  busy: boolean;
  /** Confirmation de téléchargement ou de partage, affichée sous les boutons. */
  status: string | null;
  error: ErrorView | null;
  /** Absent quand le navigateur ne sait pas partager un fichier. */
  onShare?: () => void;
  onDismissError: () => void;
  onDownload: () => void;
  onClose: () => void;
  /** Enregistrement dans le compte, quand un compte est connecté. */
  cloudSave?: CloudSave | null;
  /** Place la fusion enregistrée dans l'emplacement A, pour la prochaine fusion. */
  onPromote?: (mergeId: string) => void;
}

export type CloudSave =
  | { state: 'saving' }
  /** `notes` : les emplacements laissés en place (voir `describeKeptSlot`). */
  | { state: 'saved'; notes?: string[]; mergeId?: string }
  | { state: 'error'; error: ErrorView; onRetry: () => void };

/** Où en est l'enregistrement de la fusion dans le compte. */
function CloudSaveLine({ save }: { save: CloudSave }) {
  if (save.state === 'saving') {
    return <p className={s.cloudSave}><Spinner /> Enregistrement dans ton compte…</p>;
  }
  if (save.state === 'saved') {
    return (
      <>
        <p className={`${s.cloudSave} ${s.cloudSaved}`}>✓ Enregistré dans ton compte</p>
        {save.notes?.map((note) => <p key={note} className={s.cloudNote}>{note}</p>)}
      </>
    );
  }
  return (
    <div className={s.cloudSaveError}>
      <ErrorNotice error={save.error} />
      <SecondaryButton label="Réessayer l’enregistrement" onClick={save.onRetry} />
    </div>
  );
}

export function SummaryScreen({
  report, fileName, fileSize, busy, status, error, onDismissError, onDownload, onShare, onClose, cloudSave, onPromote,
}: SummaryScreenProps) {
  // Les trois premières lignes sont celles de la maquette ; les suivantes
  // n'apparaissent que lorsqu'elles ont quelque chose à dire.
  const rows: { label: string; value: string; dim?: boolean }[] = [
    { label: 'Notes', value: fmt.count(report.totals.notes) },
    { label: 'Surlignages', value: fmt.count(report.totals.highlights) },
    { label: 'Favoris', value: fmt.count(report.totals.bookmarks) },
  ];
  if (report.noteConflicts > 0) {
    rows.push({ label: 'Notes réconciliées', value: fmt.count(report.noteConflicts) });
  }
  if (report.bookmarksSkipped > 0) {
    rows.push({ label: 'Favoris sans emplacement', value: fmt.count(report.bookmarksSkipped) });
  }
  rows.push({ label: 'Doublons ignorés', value: fmt.count(report.duplicates), dim: true });

  return (
    <div className={s.screen}>
      <div className={s.scroll}>
        <header className={s.header}>
          <div className={s.headerTop}>
            <span className={s.check} aria-hidden>✓</span>
            <button
              type="button"
              className={s.close}
              aria-label="Fermer le récapitulatif"
              onClick={onClose}
              disabled={busy}
            >
              ✕
            </button>
          </div>
          <h1 className={`${s.title} ${s.summaryTitle}`}>Fusion terminée</h1>
          <p className={s.lead}>Un nouveau fichier a été créé. Vos deux sauvegardes d’origine sont intactes.</p>
        </header>

        <Card className={s.table}>
          {rows.map((row) => (
            <div key={row.label} className={s.row}>
              <span className={s.rowLabel}>{row.label}</span>
              <span className={`${s.rowValue} ${row.dim ? s.rowValueDim : ''}`}>{row.value}</span>
            </div>
          ))}
        </Card>

        <div className={s.output}>
          <Eyebrow>Fichier obtenu</Eyebrow>
          <p className={s.outputName}>{fileName}</p>
          <p className={s.meta}>{fmt.size(fileSize)} · prêt à réimporter dans votre bibliothèque</p>
          {cloudSave && <CloudSaveLine save={cloudSave} />}
        </div>

        {/*
          La restauration remplace intégralement la base locale : l'appareil
          qui ne reçoit pas ce fichier réintroduira son ancien état à sa
          prochaine sauvegarde. Le dire ici évite de perdre la fusion.
        */}
        <p className={s.caution}>
          À restaurer sur les deux appareils. Celui qui garde son ancienne sauvegarde
          la réintroduira lors de sa prochaine sauvegarde.
        </p>
      </div>

      <div className={s.footer}>
        {error && <ErrorNotice error={error} onDismiss={onDismissError} />}
        {status && !error && <p className={s.status} role="status">{status}</p>}
        <PrimaryButton label="Télécharger le fichier" onClick={onDownload} disabled={busy} />
        {onShare && <SecondaryButton label="Partager" onClick={onShare} disabled={busy} />}
        {cloudSave?.state === 'saved' && cloudSave.mergeId && onPromote && (
          <SecondaryButton
            label="Utiliser comme nouveau A"
            onClick={() => onPromote(cloudSave.mergeId!)}
            disabled={busy}
          />
        )}
        {/*
          Télécharger n’est pas obligatoire : la fusion est faite, et quitter
          ce récapitulatif doit se dire autrement qu’avec le seul ✕.
        */}
        <TextButton label={status ? 'Terminer' : 'Terminer sans télécharger'} onClick={onClose} disabled={busy} />
      </div>
    </div>
  );
}
