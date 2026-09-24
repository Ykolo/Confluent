/** Écran 3 — Historique : les fusions déjà faites dans ce navigateur. */
import type { ErrorView } from '@core/errors';
import * as fmt from '@core/format';

import type { HistoryEntry } from '@/lib/history';

import { Card, ErrorNotice } from './kit';
import s from './screens.module.css';

export interface HistoryScreenProps {
  entries: HistoryEntry[];
  /** Identifiants des fusions dont le fichier est encore conservé. */
  stored: Set<string>;
  /** Confirmation de téléchargement. */
  status: string | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onDownload: (entry: HistoryEntry) => void;
}

export function HistoryScreen({ entries, stored, status, error, onDismissError, onDownload }: HistoryScreenProps) {
  return (
    <div className={s.scroll}>
      <header className={s.historyHeader}>
        <h1 className={s.title}>Fusions précédentes</h1>
        <p className={s.lead}>Conservées dans ce navigateur.</p>
      </header>

      {error && <div className={s.historyNotice}><ErrorNotice error={error} onDismiss={onDismissError} /></div>}
      {status && !error && <p className={`${s.status} ${s.historyNotice}`} role="status">{status}</p>}

      {entries.length === 0 ? (
        <p className={s.empty}>Aucune fusion pour l’instant. Les fichiers produits apparaîtront ici.</p>
      ) : (
        <ul className={s.entries}>
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card className={s.entry}>
                <div className={s.entryHead}>
                  <span className={s.entryName}>{entry.name}</span>
                  <span className={s.entryDate}>{fmt.relativeDate(entry.createdAt)}</span>
                </div>
                <p className={s.meta}>{entry.sources}</p>
                <div className={s.entryStats}>
                  <span className={s.entryItems}>{fmt.count(entry.notes)} notes</span>
                  <span className={s.entrySize}>{fmt.size(entry.size)}</span>
                  {stored.has(entry.id) ? (
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
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
