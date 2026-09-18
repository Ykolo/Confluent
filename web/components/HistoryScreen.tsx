/** Écran 3 — Historique : les fusions déjà faites dans ce navigateur. */
import * as fmt from '@core/format';

import type { HistoryEntry } from '@/lib/history';

import { Card } from './kit';
import s from './screens.module.css';

export function HistoryScreen({ entries }: { entries: HistoryEntry[] }) {
  return (
    <div className={s.scroll}>
      <header className={s.historyHeader}>
        <h1 className={s.title}>Fusions précédentes</h1>
        <p className={s.lead}>Conservées dans ce navigateur.</p>
      </header>

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
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
