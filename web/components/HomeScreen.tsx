/** Écran 1 — Accueil : choisir deux fichiers, régler les doublons, fusionner. */
'use client';

import { useRef, useState, type DragEvent } from 'react';

import type { BackupInfo } from '@core/backup-info';
import type { ErrorView } from '@core/errors';
import * as fmt from '@core/format';
import type { ConflictStrategy } from '@core/merge';

import {
  Card, DashedButton, ErrorNotice, Eyebrow, PlusRule, PrimaryButton, ProgressBar, Segmented, Spinner,
  TextButton,
} from './kit';
import s from './screens.module.css';

type Slot = 'a' | 'b';

const STRATEGIES = [
  { value: 'keep-both', label: 'Tout garder' },
  { value: 'newest', label: 'Version récente' },
] as const satisfies readonly { value: ConflictStrategy; label: string }[];

function FileSlot({ label, info, onFile, disabled, step }: {
  label: string;
  info: BackupInfo | null;
  onFile: (file: File) => void;
  disabled?: boolean;
  /** Phase de lecture en cours, tant que les compteurs manquent. */
  step?: string | null;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Sur ordinateur, on dépose volontiers le fichier plutôt que de le chercher :
  // la carte entière sert de zone de dépôt.
  const drop = {
    onDragOver: (e: DragEvent) => {
      if (disabled) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer.files[0];
      if (file && !disabled) onFile(file);
    },
  };

  const picker = (
    <input
      ref={input}
      type="file"
      accept=".jwlibrary"
      hidden
      onChange={(e) => {
        const file = e.target.files?.[0];
        // Réinitialisé pour qu'un même fichier choisi deux fois déclenche bien.
        e.target.value = '';
        if (file) onFile(file);
      }}
    />
  );

  if (!info) {
    return (
      <>
        {picker}
        <button
          type="button"
          className={`${s.emptySlot} ${over ? s.over : ''}`}
          aria-label={`${label} — choisir un fichier`}
          disabled={disabled}
          onClick={() => input.current?.click()}
          {...drop}
        >
          <Eyebrow tone="faint">{label}</Eyebrow>
          <span className={s.slotName}>Choisir un fichier</span>
          <span className={s.meta}>Une sauvegarde .jwlibrary — ou déposez-la ici</span>
        </button>
      </>
    );
  }

  // La carte paraît dès le manifeste lu : nom, appareil, taille. Les
  // compteurs arrivent ensuite, quand la base a fini d'être décompressée.
  const card = (
    <Card className={`${s.slot} ${over ? s.over : ''}`}>
      <div className={s.slotHead}>
        <Eyebrow tone="accent">{label}</Eyebrow>
        <span className={s.slotSize}>{fmt.size(info.size)}</span>
      </div>
      <span className={s.slotName}>{info.name}</span>
      {info.counts ? (
        <span className={s.slotStats}>
          <span className={s.meta}>{fmt.count(info.counts.notes)} notes</span>
          <span className={s.meta}>{fmt.count(info.counts.highlights)} surlignages</span>
          <span className={s.meta}>{fmt.count(info.counts.bookmarks)} favoris</span>
        </span>
      ) : (
        <span className={s.slotLoading}>
          <Spinner />
          <span className={s.meta}>{step ?? 'lecture'}…</span>
        </span>
      )}
    </Card>
  );

  if (!info.counts) return <div aria-busy>{card}</div>;

  return (
    <>
      {picker}
      <button
        type="button"
        className={s.filledSlot}
        aria-label={`${label} — ${info.name}, cliquer pour remplacer`}
        disabled={disabled}
        onClick={() => input.current?.click()}
        {...drop}
      >
        {card}
      </button>
    </>
  );
}

export interface HomeScreenProps {
  fileA: BackupInfo | null;
  fileB: BackupInfo | null;
  strategy: ConflictStrategy;
  busy: boolean;
  /** Emplacement en cours de lecture, et phase atteinte. */
  reading: { slot: Slot; step: string } | null;
  /** Étape en cours et avancement global, pendant la fusion. */
  progress: { step: string; ratio: number } | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onFile: (slot: Slot, file: File) => void;
  onStrategyChange: (value: ConflictStrategy) => void;
  onMerge: () => void;
}

export function HomeScreen({
  fileA, fileB, strategy, busy, reading, progress, error,
  onDismissError, onFile, onStrategyChange, onMerge,
}: HomeScreenProps) {
  // Une carte qui n'affiche encore que son manifeste n'a pas de base à
  // fusionner : le bouton reste inerte tant que les deux lectures ne sont pas
  // terminées.
  const ready = !!fileA?.counts && !!fileB?.counts;
  // L'app mobile demande « lequel ? » dans une alerte native ; ici, les deux
  // cartes sont déjà cliquables, le bouton ne fait que le rappeler.
  const [replacing, setReplacing] = useState(false);

  return (
    <div className={s.screen}>
      <div className={s.scroll}>
        <header className={s.header}>
          <Eyebrow>Confluent</Eyebrow>
          <h1 className={s.titleLarge}>Fusionner deux sauvegardes</h1>
        </header>

        <div className={s.slots}>
          <FileSlot
            label="Fichier A"
            info={fileA}
            onFile={(file) => { setReplacing(false); onFile('a', file); }}
            disabled={busy}
            step={reading?.slot === 'a' ? reading.step : null}
          />
          <PlusRule />
          <FileSlot
            label="Fichier B"
            info={fileB}
            onFile={(file) => { setReplacing(false); onFile('b', file); }}
            disabled={busy}
            step={reading?.slot === 'b' ? reading.step : null}
          />
          {ready && (replacing ? (
            <div className={s.replaceHint}>
              <p className={s.hint}>Cliquez sur la carte du fichier à remplacer, ou déposez-y le nouveau.</p>
              <TextButton label="Annuler" onClick={() => setReplacing(false)} />
            </div>
          ) : (
            <DashedButton label="Remplacer un fichier" onClick={() => setReplacing(true)} disabled={busy} />
          ))}
        </div>

        <p className={s.privacy}>
          Les sauvegardes sont lues et fusionnées dans ce navigateur : elles ne sont envoyées nulle part.
        </p>
      </div>

      <div className={s.footer}>
        <div className={s.strategy}>
          <Eyebrow>En cas de doublon</Eyebrow>
          <Segmented
            label="En cas de doublon"
            options={STRATEGIES}
            value={strategy}
            onChange={onStrategyChange}
            disabled={busy}
          />
          <p className={s.hint}>
            {strategy === 'keep-both'
              ? 'Une note modifiée des deux côtés garde sa version récente, l’ancienne est ajoutée en annexe.'
              : 'Une note modifiée des deux côtés ne garde que sa version la plus récente.'}
          </p>
        </div>

        {error && <ErrorNotice error={error} onDismiss={onDismissError} />}

        {busy && progress && (
          <div className={s.progress}>
            <ProgressBar ratio={progress.ratio} />
            <p className={s.progressLabel}>{progress.step} · {fmt.percent(progress.ratio)}</p>
          </div>
        )}

        <PrimaryButton
          label={busy && progress ? 'Fusion en cours…' : 'Fusionner'}
          onClick={onMerge}
          disabled={!ready || busy}
        />
      </div>
    </div>
  );
}
