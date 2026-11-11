/**
 * Écran 3 — Historique.
 *
 * Déconnecté : les fusions faites dans ce navigateur (`localStorage`).
 * Connecté : celles enregistrées dans le compte, depuis n'importe quel
 * appareil, page par page, avec téléchargement et suppression.
 */
'use client';

import { useState, type ReactNode } from 'react';

import type { MergeDto } from '@core/cloud/types';
import type { ErrorView } from '@core/errors';
import * as fmt from '@core/format';

import type { HistoryEntry } from '@/lib/history';

import { Card, ErrorNotice, SecondaryButton, Spinner } from './kit';
import s from './screens.module.css';

/** L'historique du compte, quand un compte est connecté. */
export interface RemoteHistory {
  /** `null` pendant le premier chargement. */
  items: MergeDto[] | null;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onDownload: (merge: MergeDto) => void;
  onDelete: (merge: MergeDto) => void;
}

export interface HistoryScreenProps {
  entries: HistoryEntry[];
  /** Identifiants des fusions dont le fichier est encore conservé. */
  stored: Set<string>;
  /** Confirmation de téléchargement. */
  status: string | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onDownload: (entry: HistoryEntry) => void;
  remote?: RemoteHistory;
}

function Entry({ name, date, sources, notes, size, action }: {
  name: string;
  date: string;
  sources: string;
  notes: number;
  size: number;
  action: ReactNode;
}) {
  return (
    <Card className={s.entry}>
      <div className={s.entryHead}>
        <span className={s.entryName}>{name}</span>
        <span className={s.entryDate}>{fmt.relativeDate(date)}</span>
      </div>
      {sources && <p className={s.meta}>{sources}</p>}
      <div className={s.entryStats}>
        <span className={s.entryItems}>{fmt.count(notes)} {notes > 1 ? 'notes' : 'note'}</span>
        <span className={s.entrySize}>{fmt.size(size)}</span>
        {action}
      </div>
    </Card>
  );
}

/** Une fusion du compte : télécharger, ou supprimer après confirmation sur place. */
function RemoteEntry({ merge, onDownload, onDelete }: {
  merge: MergeDto;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const action = confirming ? (
    <span className={s.entryActions}>
      <button type="button" className={`${s.entryAction} ${s.entryDanger}`} onClick={onDelete}>
        Confirmer la suppression
      </button>
      <button type="button" className={s.entryAction} onClick={() => setConfirming(false)}>Annuler</button>
    </span>
  ) : (
    <span className={s.entryActions}>
      <button
        type="button"
        className={s.entryAction}
        aria-label={`Télécharger ${merge.fileName}`}
        onClick={onDownload}
      >
        Télécharger
      </button>
      <button
        type="button"
        className={`${s.entryAction} ${s.entryQuiet}`}
        aria-label={`Supprimer ${merge.fileName}`}
        onClick={() => setConfirming(true)}
      >
        Supprimer
      </button>
    </span>
  );
  return (
    <Entry
      name={merge.fileName}
      date={merge.createdAt}
      sources={merge.sources}
      notes={merge.report.totals.notes}
      size={merge.size}
      action={action}
    />
  );
}

export function HistoryScreen({ entries, stored, status, error, onDismissError, onDownload, remote }: HistoryScreenProps) {
  return (
    <div className={s.scroll}>
      <header className={s.historyHeader}>
        <h1 className={s.title}>Fusions précédentes</h1>
        <p className={s.lead}>{remote ? 'Enregistrées dans ton compte.' : 'Conservées dans ce navigateur.'}</p>
      </header>

      {error && <div className={s.historyNotice}><ErrorNotice error={error} onDismiss={onDismissError} /></div>}
      {status && !error && <p className={`${s.status} ${s.historyNotice}`} role="status">{status}</p>}

      {remote ? (
        remote.items === null ? (
          <p className={s.historyLoading}><Spinner /> Chargement de l’historique…</p>
        ) : remote.items.length === 0 ? (
          <p className={s.empty}>Aucune fusion dans ton compte pour l’instant. Les prochaines y seront enregistrées.</p>
        ) : (
          <>
            <ul className={s.entries}>
              {remote.items.map((merge) => (
                <li key={merge.id}>
                  <RemoteEntry
                    merge={merge}
                    onDownload={() => remote.onDownload(merge)}
                    onDelete={() => remote.onDelete(merge)}
                  />
                </li>
              ))}
            </ul>
            {remote.hasMore && (
              <div className={s.historyMore}>
                <SecondaryButton
                  label={remote.loadingMore ? 'Chargement…' : 'Afficher les plus anciennes'}
                  onClick={remote.onMore}
                  disabled={remote.loadingMore}
                />
              </div>
            )}
          </>
        )
      ) : entries.length === 0 ? (
        <p className={s.empty}>Aucune fusion pour l’instant. Les fichiers produits apparaîtront ici.</p>
      ) : (
        <ul className={s.entries}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Entry
                name={entry.name}
                date={entry.createdAt}
                sources={entry.sources}
                notes={entry.notes}
                size={entry.size}
                action={stored.has(entry.id) ? (
                  <button
                    type="button"
                    className={s.entryAction}
                    aria-label={`Télécharger ${entry.name}`}
                    onClick={() => onDownload(entry)}
                  >
                    Télécharger
                  </button>
                ) : (
                  <span className={s.entryGone}>Fichier non conservé</span>
                )}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
