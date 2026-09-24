/**
 * Confluent, version web — le pendant de `App.tsx`.
 *
 * Mêmes trois écrans, même moteur (`src/merge.ts`), même découpage en
 * tranches pour garder l'écran vivant. Ce qui change est ce que le navigateur
 * sait faire : le fichier arrive d'un `<input>` ou d'un glisser-déposer, la
 * base s'ouvre dans SQLite compilé en WebAssembly, et le résultat part en
 * téléchargement. Rien n'est envoyé à un serveur.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { inspectBackup, type BackupInfo } from '@core/backup-info';
import { isCancellation, logError, logInfo, stopwatch, type ErrorView } from '@core/errors';
import * as fmt from '@core/format';
import { mergeBackups, type Backup, type ConflictStrategy, type MergeReport } from '@core/merge';
import { overallRatio } from '@core/progress';

import { addToHistory, loadFile, loadHistory, storedFiles, storeFile, type HistoryEntry } from '@/lib/history';
import { sha256Web, wasmHost } from '@/lib/sqlite-wasm';

import { HistoryScreen } from './HistoryScreen';
import { HomeScreen } from './HomeScreen';
import { Segmented } from './kit';
import s from './screens.module.css';
import { SummaryScreen } from './SummaryScreen';

type Slot = 'a' | 'b';
type Tab = 'merge' | 'history';

interface MergeResult {
  report: MergeReport;
  fileName: string;
  /** Le fichier produit, prêt à télécharger. */
  file: File;
}

const TABS = [
  { value: 'merge', label: 'Fusionner' },
  { value: 'history', label: 'Historique' },
] as const;

/**
 * Rend la main à la boucle d'événements, le temps d'un tour : React peint, la
 * barre avance. Voir `App.tsx` pour le détail.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Intervalle minimal entre deux respirations — le même compromis que sur mobile. */
const BREATH_MS = 100;

/** `Fusion_2026-09-18.jwlibrary` : le navigateur règle lui-même les collisions de nom. */
function outputName(): string {
  return `Fusion_${new Date().toISOString().slice(0, 10)}.jwlibrary`;
}

/** Vrai si le navigateur sait partager un fichier (menu de partage du téléphone). */
/** Fait télécharger un fichier par le navigateur. */
function triggerDownload(file: Blob, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Le téléchargement a déjà pris sa copie : libérer l'URL tout de suite
  // l'interromprait sur certains navigateurs, d'où le délai.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function canShareFiles(file: File): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function Confluent() {
  const [tab, setTab] = useState<Tab>('merge');
  const [fileA, setFileA] = useState<BackupInfo | null>(null);
  const [fileB, setFileB] = useState<BackupInfo | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both');

  const [busy, setBusy] = useState(false);
  /** Emplacement en cours de lecture, et phase atteinte, pour l'afficher. */
  const [reading, setReading] = useState<{ slot: Slot; step: string } | null>(null);
  const [progress, setProgress] = useState<{ step: string; ratio: number } | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);

  /**
   * Les sauvegardes décompressées, tenues hors de l'état React : plusieurs
   * mégaoctets de tableaux typés que l'écran n'affiche pas.
   */
  const backups = useRef<Record<Slot, Backup | null>>({ a: null, b: null });

  const [result, setResult] = useState<MergeResult | null>(null);
  const [shareable, setShareable] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  /** Fusions dont le fichier est encore conservé, donc retéléchargeable. */
  const [stored, setStored] = useState<Set<string>>(new Set());

  useEffect(() => {
    setHistory(loadHistory());
    void storedFiles().then(setStored);
    // Le module SQLite pèse près d'un mégaoctet : autant qu'il arrive pendant
    // que l'utilisateur cherche ses fichiers.
    wasmHost.preload();
  }, []);

  const read = useCallback(async (slot: Slot, picked: File) => {
    setError(null);
    setBusy(true);
    setReading({ slot, step: 'ouverture du fichier' });
    const show = slot === 'a' ? setFileA : setFileB;
    const lap = stopwatch('choix', `fichier ${slot.toUpperCase()}`);
    // L'ancienne sauvegarde ne doit pas survivre à un remplacement raté : la
    // carte montrerait l'une, la fusion prendrait l'autre.
    backups.current[slot] = null;
    show(null);

    try {
      const bytes = new Uint8Array(await picked.arrayBuffer());
      lap(`archive de ${bytes.byteLength} octets en mémoire`);

      let lastBreath = Date.now();
      const info = await inspectBackup(picked.name, bytes, wasmHost, {
        onOutline: (outline) => {
          show(outline);
          lap('manifeste lu, carte affichée');
        },
        onStep: async (step) => {
          setReading({ slot, step });
          await breathe();
        },
        onSlice: async (done, total) => {
          if (Date.now() - lastBreath < BREATH_MS) return;
          setReading({ slot, step: `décompression ${fmt.percent(done / total)}` });
          await breathe();
          lastBreath = Date.now();
        },
      });

      backups.current[slot] = info.backup;
      show({ ...info, backup: null });
      lap(`prêt : ${info.counts?.notes} notes, ${info.counts?.highlights} surlignages, `
        + `${info.counts?.bookmarks} favoris`);
    } catch (err) {
      show(null);
      setError(logError(`choix du fichier ${slot.toUpperCase()}`, err));
    } finally {
      setReading(null);
      setBusy(false);
    }
  }, []);

  const merge = useCallback(async () => {
    const baseBackup = backups.current.a;
    const sourceBackup = backups.current.b;
    if (!fileA || !fileB || !baseBackup || !sourceBackup) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    setProgress({ step: 'préparation', ratio: 0 });
    let lastTick = Date.now();

    try {
      const merged = await mergeBackups(baseBackup, sourceBackup, {
        host: wasmHost,
        sha256: sha256Web,
        outputName: outputName(),
        conflictStrategy: strategy,
        onProgress: async (step, done, total) => {
          if (Date.now() - lastTick < BREATH_MS) return;
          lastTick = Date.now();
          setProgress({ step, ratio: overallRatio(step, done, total) });
          await breathe();
        },
      });

      const file = new File([merged.file as BlobPart], merged.fileName, { type: 'application/octet-stream' });
      setResult({ report: merged.report, fileName: merged.fileName, file });
      setShareable(canShareFiles(file));

      const id = `${Date.now()}`;
      setHistory(addToHistory({
        id,
        name: merged.fileName,
        createdAt: new Date().toISOString(),
        sources: `${fileA.deviceName} ${fmt.dayMonth(fileA.createdAt)}`
          + ` + ${fileB.deviceName} ${fmt.dayMonth(fileB.createdAt)}`,
        notes: merged.report.totals.notes,
        size: file.size,
      }));
      logInfo('fusion', `${merged.fileName} — ${merged.report.totals.notes} notes, ${file.size} octets`);
      // Le fichier est déjà prêt à télécharger : sa copie pour l'historique se
      // fait à côté, et son échec (quota, navigation privée) ne coûte que le
      // retéléchargement.
      void storeFile(id, file).then(setStored, (err) => logError('historique', err));
    } catch (err) {
      setError(logError('fusion', err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [fileA, fileB, strategy]);

  const download = useCallback(() => {
    if (!result) return;
    triggerDownload(result.file, result.fileName);
    setStatus(`Téléchargé : ${result.fileName}`);
  }, [result]);

  const downloadPast = useCallback(async (entry: HistoryEntry) => {
    setError(null);
    setStatus(null);
    try {
      const file = await loadFile(entry.id);
      if (!file) {
        setStored(await storedFiles());
        setError({
          title: 'Fichier introuvable',
          message: 'Le fichier de cette fusion n’est plus conservé dans ce navigateur.',
          hint: 'Relancer la fusion à partir des deux sauvegardes d’origine.',
          technical: `aucun fichier pour l’entrée ${entry.id} dans IndexedDB`,
        });
        return;
      }
      triggerDownload(file, entry.name);
      setStatus(`Téléchargé : ${entry.name}`);
    } catch (err) {
      setError(logError('téléchargement', err));
    }
  }, []);

  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setStatus(null);
    setError(null);
  }, []);

  const share = useCallback(async () => {
    if (!result) return;
    setError(null);
    try {
      await navigator.share({ files: [result.file], title: result.fileName });
    } catch (err) {
      // Fermer le menu de partage rejette aussi : rien à signaler dans ce cas.
      if (!isCancellation(err) && (err as Error)?.name !== 'AbortError') {
        setError(logError('partage', err));
      }
    }
  }, [result]);

  const closeSummary = useCallback(() => {
    setResult(null);
    setStatus(null);
    setError(null);
  }, []);

  return (
    <main className={s.app}>
      {result ? (
        <SummaryScreen
          report={result.report}
          fileName={result.fileName}
          fileSize={result.file.size}
          busy={busy}
          status={status}
          error={error}
          onDismissError={() => setError(null)}
          onDownload={download}
          onShare={shareable ? () => void share() : undefined}
          onClose={closeSummary}
        />
      ) : (
        <>
          <div className={s.content}>
            {tab === 'merge' ? (
              <HomeScreen
                fileA={fileA}
                fileB={fileB}
                strategy={strategy}
                busy={busy}
                reading={reading}
                progress={progress}
                error={error}
                onDismissError={() => setError(null)}
                onFile={(slot, file) => void read(slot, file)}
                onStrategyChange={setStrategy}
                onMerge={() => void merge()}
              />
            ) : (
              <HistoryScreen
                entries={history}
                stored={stored}
                status={status}
                error={error}
                onDismissError={() => setError(null)}
                onDownload={(entry) => void downloadPast(entry)}
              />
            )}
          </div>
          <nav className={s.tabs}>
            <Segmented label="Sections" options={TABS} value={tab} onChange={switchTab} variant="tabs" disabled={busy} />
          </nav>
        </>
      )}
    </main>
  );
}
