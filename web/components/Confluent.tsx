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
import type { BackupDto, MergeDto, MergeMeta, MergePage } from '@core/cloud/types';
import { isCancellation, logError, logInfo, stopwatch, type ErrorView } from '@core/errors';
import * as fmt from '@core/format';
import { mergeBackups, type Backup, type ConflictStrategy, type MergeReport } from '@core/merge';
import { overallRatio } from '@core/progress';

import { signOut, useSession } from '@/lib/auth-client';
import { describeAuthError } from '@core/auth-errors';
import { cloud } from '@/lib/cloud';
import { addToHistory, loadFile, loadHistory, storedFiles, storeFile, type HistoryEntry } from '@/lib/history';
import { sha256Web, wasmHost } from '@/lib/sqlite-wasm';

import { AccountScreen } from './AccountScreen';
import { HistoryScreen } from './HistoryScreen';
import { HomeScreen, type CloudLine } from './HomeScreen';
import { Segmented } from './kit';
import s from './screens.module.css';
import { SummaryScreen, type CloudSave } from './SummaryScreen';

type Slot = 'a' | 'b';
type Tab = 'merge' | 'history';

const SLOTS = ['a', 'b'] as const;

/** D'où vient la sauvegarde à lire dans un emplacement. */
interface ReadSource {
  name: string;
  /** Pour le journal et l'erreur : « choix du fichier », « récupération depuis le compte ». */
  what: string;
  firstStep: string;
  open: () => Promise<Uint8Array>;
  /** Ce que la carte peut montrer avant même d'avoir les octets. */
  outline?: BackupInfo;
}

const NO_REMOTE: Record<Slot, BackupDto | null> = { a: null, b: null };

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

/**
 * Le compte, en une ligne discrète au-dessus de l'écran : il reste facultatif.
 * Rien ne s'affiche tant que la session n'est pas connue, pour ne pas faire
 * clignoter « Se connecter » chez quelqu'un qui l'est déjà.
 */
function AccountBar({ email, pending, disabled, onSignIn, onSignOut }: {
  email: string | null;
  pending: boolean;
  disabled: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (pending) return <div className={s.account} />;
  return (
    <div className={s.account}>
      {email ? (
        <>
          <span className={s.accountEmail} title={email}>{email}</span>
          <span aria-hidden>·</span>
          <button type="button" className={s.accountLink} onClick={onSignOut} disabled={disabled}>Se déconnecter</button>
        </>
      ) : (
        <button type="button" className={s.accountLink} onClick={onSignIn} disabled={disabled}>
          Se connecter pour synchroniser
        </button>
      )}
    </div>
  );
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

  const session = useSession();
  const [accountOpen, setAccountOpen] = useState(false);

  const logout = useCallback(async () => {
    setError(null);
    try {
      const { error: failure } = await signOut();
      if (failure) {
        const view = describeAuthError(failure);
        setError(logError('déconnexion', new Error(view.technical), view));
      }
    } catch (err) {
      setError(logError('déconnexion', err, describeAuthError({ message: String(err) })));
    }
  }, []);

  useEffect(() => {
    setHistory(loadHistory());
    void storedFiles().then(setStored);
    // Le module SQLite pèse près d'un mégaoctet : autant qu'il arrive pendant
    // que l'utilisateur cherche ses fichiers.
    wasmHost.preload();
  }, []);

  /**
   * Lit une sauvegarde dans un emplacement, qu'elle vienne d'un fichier local
   * ou du compte. Renvoie ce que montre la carte, ou `null` si la lecture a
   * échoué (l'erreur est déjà affichée).
   */
  const read = useCallback(async (slot: Slot, source: ReadSource): Promise<BackupInfo | null> => {
    setError(null);
    setBusy(true);
    setReading({ slot, step: source.firstStep });
    const show = slot === 'a' ? setFileA : setFileB;
    const lap = stopwatch('choix', `fichier ${slot.toUpperCase()}`);
    // L'ancienne sauvegarde ne doit pas survivre à un remplacement raté : la
    // carte montrerait l'une, la fusion prendrait l'autre.
    backups.current[slot] = null;
    show(source.outline ?? null);

    try {
      // Les octets bruts ne vivent que le temps de cette fonction : une fois
      // la sauvegarde décompressée, garder aussi l'archive doublerait le pic
      // de mémoire, surtout après un téléchargement.
      const bytes = await source.open();
      lap(`archive de ${bytes.byteLength} octets en mémoire`);

      let lastBreath = Date.now();
      const info = await inspectBackup(source.name, bytes, wasmHost, {
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
      const shown = { ...info, backup: null };
      show(shown);
      lap(`prêt : ${info.counts?.notes} notes, ${info.counts?.highlights} surlignages, `
        + `${info.counts?.bookmarks} favoris`);
      return shown;
    } catch (err) {
      show(null);
      setError(logError(`${source.what} ${slot.toUpperCase()}`, err));
      return null;
    } finally {
      setReading(null);
      setBusy(false);
    }
  }, []);

  // --- Synchronisation des emplacements, quand un compte est connecté ---

  const userId = session.data?.user.id ?? null;
  /** La sauvegarde du compte qui correspond au fichier affiché dans chaque emplacement. */
  const [remote, setRemote] = useState<Record<Slot, BackupDto | null>>(NO_REMOTE);
  const [uploading, setUploading] = useState<Record<Slot, boolean>>({ a: false, b: false });
  const [keepInAccount, setKeepInAccount] = useState(true);
  /**
   * Numéro du dernier choix par emplacement : un envoi qui se termine après un
   * nouveau choix ne doit pas rattacher l'ancien fichier à la carte.
   */
  const picks = useRef<Record<Slot, number>>({ a: 0, b: 0 });

  // À la connexion : reprendre les emplacements du compte. Un emplacement déjà
  // rempli localement est laissé tel quel, c'est le choix de l'utilisateur.
  useEffect(() => {
    setRemote(NO_REMOTE);
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const slots = await cloud.slots();
        for (const slot of SLOTS) {
          const dto = slots[slot];
          if (cancelled || !dto || backups.current[slot]) continue;
          const pick = ++picks.current[slot];
          setRemote((r) => ({ ...r, [slot]: dto }));
          const info = await read(slot, {
            name: dto.name,
            what: 'récupération depuis le compte, emplacement',
            firstStep: 'téléchargement depuis le compte',
            open: () => cloud.downloadBackup(dto),
            outline: {
              name: dto.name, size: dto.size, deviceName: dto.deviceName,
              createdAt: dto.backupCreatedAt, counts: null, backup: null,
            },
          });
          if (!info && picks.current[slot] === pick) setRemote((r) => ({ ...r, [slot]: null }));
        }
      } catch (err) {
        if (!cancelled) setError(logError('synchronisation des emplacements', err));
      }
    })();
    return () => { cancelled = true; };
  }, [userId, read]);

  /** Dépose en tâche de fond le fichier qu'on vient de lire. */
  const keepRemotely = useCallback(async (slot: Slot, picked: File, info: BackupInfo, pick: number) => {
    setUploading((u) => ({ ...u, [slot]: true }));
    try {
      const sha256 = await sha256Web(new Uint8Array(await picked.arrayBuffer()));
      const dto = await cloud.uploadBackup(slot, info, picked, sha256);
      if (picks.current[slot] === pick) setRemote((r) => ({ ...r, [slot]: dto }));
      logInfo('synchronisation', `${info.name} déposé en ${slot.toUpperCase()}`);
    } catch (err) {
      setError(logError(`dépôt dans le compte, emplacement ${slot.toUpperCase()}`, err));
    } finally {
      if (picks.current[slot] === pick) setUploading((u) => ({ ...u, [slot]: false }));
    }
  }, []);

  /** Choix d'un fichier local : lecture, puis dépôt dans le compte si demandé. */
  const pickLocal = useCallback(async (slot: Slot, picked: File) => {
    const pick = ++picks.current[slot];
    setRemote((r) => ({ ...r, [slot]: null }));
    setUploading((u) => ({ ...u, [slot]: false }));
    const info = await read(slot, {
      name: picked.name,
      what: 'choix du fichier',
      firstStep: 'ouverture du fichier',
      open: async () => new Uint8Array(await picked.arrayBuffer()),
    });
    if (info && userId && keepInAccount && picks.current[slot] === pick) {
      void keepRemotely(slot, picked, info, pick);
    }
  }, [read, userId, keepInAccount, keepRemotely]);

  const removeRemote = useCallback(async (slot: Slot) => {
    setError(null);
    try {
      await cloud.clearSlot(slot);
      setRemote((r) => ({ ...r, [slot]: null }));
    } catch (err) {
      setError(logError(`retrait du compte, emplacement ${slot.toUpperCase()}`, err));
    }
  }, []);

  const cloudLine = (slot: Slot): CloudLine | null => {
    if (uploading[slot]) return { text: 'Envoi vers le compte…' };
    const dto = remote[slot];
    if (!dto) return null;
    const from = dto.uploadedFrom ? `Déposé depuis ${dto.uploadedFrom}` : 'Dans le compte';
    return { text: `${from} · ${fmt.timeAgo(dto.createdAt)}`, onRemove: () => void removeRemote(slot) };
  };

  // --- Enregistrement des fusions et historique du compte ---

  const [cloudSave, setCloudSave] = useState<CloudSave | null>(null);
  /** La dernière fusion à enregistrer, gardée pour « Réessayer ». */
  const pendingSave = useRef<{ file: File; meta: MergeMeta; sha256: string } | null>(null);
  /** Historique du compte : `null` tant qu'il n'est pas chargé. */
  const [remoteHistory, setRemoteHistory] = useState<MergePage | null>(null);
  const [historyMore, setHistoryMore] = useState(false);

  const saveToAccount = useCallback(async () => {
    const job = pendingSave.current;
    if (!job) return;
    setCloudSave({ state: 'saving' });
    try {
      const saved = await cloud.saveMerge(job.file, job.meta, job.sha256);
      if (pendingSave.current !== job) return;
      setCloudSave({ state: 'saved' });
      // Le serveur a libéré les emplacements consommés : la page suit.
      setRemote((r) => ({
        a: r.a && job.meta.backupIds.includes(r.a.id) ? null : r.a,
        b: r.b && job.meta.backupIds.includes(r.b.id) ? null : r.b,
      }));
      setRemoteHistory((h) => (h ? { ...h, items: [saved, ...h.items] } : h));
      logInfo('synchronisation', `${saved.fileName} enregistrée dans le compte`);
    } catch (err) {
      if (pendingSave.current !== job) return;
      setCloudSave({
        state: 'error',
        error: logError('enregistrement de la fusion', err),
        onRetry: () => void saveToAccount(),
      });
    }
  }, []);

  const loadRemoteHistory = useCallback(async (cursor?: string) => {
    if (cursor) setHistoryMore(true);
    try {
      const page = await cloud.merges(cursor);
      setRemoteHistory((h) => (cursor && h ? { items: [...h.items, ...page.items], next: page.next } : page));
    } catch (err) {
      setError(logError('historique du compte', err));
      if (!cursor) setRemoteHistory({ items: [] });
    } finally {
      setHistoryMore(false);
    }
  }, []);

  // L'historique du compte suit l'utilisateur : rechargé à l'ouverture de
  // l'onglet (une fusion a pu être faite ailleurs), oublié à la déconnexion.
  useEffect(() => {
    if (!userId) { setRemoteHistory(null); return; }
    if (tab === 'history') {
      setRemoteHistory(null);
      void loadRemoteHistory();
    }
  }, [userId, tab, loadRemoteHistory]);

  const downloadRemote = useCallback(async (merge: MergeDto) => {
    setError(null);
    setStatus(null);
    try {
      const url = await cloud.downloadUrl('merge', merge.id);
      // L'URL présignée porte `Content-Disposition: attachment` : le
      // navigateur télécharge sans quitter la page.
      const link = document.createElement('a');
      link.href = url;
      link.click();
      setStatus(`Téléchargé : ${merge.fileName}`);
    } catch (err) {
      setError(logError('téléchargement depuis le compte', err));
    }
  }, []);

  const deleteRemote = useCallback(async (merge: MergeDto) => {
    setError(null);
    setStatus(null);
    try {
      await cloud.deleteMerge(merge.id);
      setRemoteHistory((h) => (h ? { ...h, items: h.items.filter((m) => m.id !== merge.id) } : h));
      setStatus(`Supprimée : ${merge.fileName}`);
    } catch (err) {
      setError(logError('suppression d’une fusion', err));
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

      const sources = `${fileA.deviceName} ${fmt.dayMonth(fileA.createdAt)}`
        + ` + ${fileB.deviceName} ${fmt.dayMonth(fileB.createdAt)}`;

      // Connecté : enregistrement dans le compte en tâche de fond. Le
      // téléchargement, lui, est déjà possible.
      if (userId) {
        pendingSave.current = {
          file,
          sha256: await sha256Web(merged.file),
          meta: {
            fileName: merged.fileName,
            report: merged.report,
            sources,
            strategy,
            // Les sauvegardes du compte qui ont servi : leurs emplacements
            // seront libérés, s'ils les contiennent encore.
            backupIds: SLOTS.flatMap((slot) => (remote[slot] ? [remote[slot]!.id] : [])),
          },
        };
        void saveToAccount();
      } else {
        pendingSave.current = null;
        setCloudSave(null);
      }

      const id = `${Date.now()}`;
      setHistory(addToHistory({
        id,
        name: merged.fileName,
        createdAt: new Date().toISOString(),
        sources,
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
  }, [fileA, fileB, strategy, userId, remote, saveToAccount]);

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
          cloudSave={userId ? cloudSave : null}
        />
      ) : accountOpen ? (
        <AccountScreen onDone={() => setAccountOpen(false)} />
      ) : (
        <>
          <AccountBar
            email={session.data?.user.email ?? null}
            pending={session.isPending}
            disabled={busy}
            onSignIn={() => { setError(null); setAccountOpen(true); }}
            onSignOut={() => void logout()}
          />
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
                onFile={(slot, file) => void pickLocal(slot, file)}
                onStrategyChange={setStrategy}
                onMerge={() => void merge()}
                sync={userId ? {
                  lines: { a: cloudLine('a'), b: cloudLine('b') },
                  keepInAccount,
                  onKeepChange: setKeepInAccount,
                } : undefined}
              />
            ) : (
              <HistoryScreen
                entries={history}
                stored={stored}
                status={status}
                error={error}
                onDismissError={() => setError(null)}
                onDownload={(entry) => void downloadPast(entry)}
                remote={userId ? {
                  items: remoteHistory?.items ?? null,
                  hasMore: !!remoteHistory?.next,
                  loadingMore: historyMore,
                  onMore: () => void loadRemoteHistory(remoteHistory?.next),
                  onDownload: (m) => void downloadRemote(m),
                  onDelete: (m) => void deleteRemote(m),
                } : undefined}
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
