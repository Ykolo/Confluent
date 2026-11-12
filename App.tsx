/**
 * Confluent — fusion de deux sauvegardes JW Library.
 *
 * Trois écrans, tels que dessinés dans « Fusion Sauvegardes » : l'accueil où
 * l'on choisit les deux fichiers, le récapitulatif de la fusion, et
 * l'historique des fusions faites sur l'appareil.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, AppState, Platform, StatusBar, StyleSheet, Text, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
// Import par graisse : la racine de ces paquets réexporte toutes les variantes,
// ce qui embarquerait 2,5 Mo de fontes dont l'app n'utilise que quatre fichiers.
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { useFonts } from 'expo-font';
import { Directory, File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// `SafeAreaView` de react-native est déprécié et sera retiré ; celui-ci le
// remplace et gère en plus l'encoche en paysage. Il lit les marges dans un
// contexte, d'où le `SafeAreaProvider` posé à la racine, au-dessus.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { inspectBackup, type BackupInfo } from './src/backup-info';
import {
  installGlobalErrorLogging, isCancellation, logError, logInfo, stopwatch, timed, withTimeout,
  type ErrorView,
} from './src/errors';
import * as fmt from './src/format';
import {
  addToHistory, archivedFile, findArchivedFile, fromMergeDto, loadHistory, pruneArchive, remoteCopy,
  type HistoryEntry,
} from './src/history';
import { mergeBackups, type Backup, type ConflictStrategy, type MergeReport } from './src/merge';
import { openInJwLibrary, RESTORE_STEPS } from './src/platform/jw-library';
import { expoHost, sha256Expo } from './src/platform/sqlite-expo';
import { overallRatio } from './src/progress';
import { color, font } from './src/theme';
import { signOut, useSession } from './src/auth-client';
import { describeKeptSlot, type BackupDto, type MergeMeta, type MergePage } from './src/cloud/types';
import { cloud } from './src/platform/cloud-expo';
import { describeAuthError } from './src/auth-errors';
import { AccountScreen } from './src/ui/AccountScreen';
import { DeleteAccountScreen } from './src/ui/DeleteAccountScreen';
import { HistoryScreen } from './src/ui/HistoryScreen';
import { HomeScreen, type CloudLine } from './src/ui/HomeScreen';
import { Segmented, TextLink } from './src/ui/kit';
import { SummaryScreen, type CloudSave } from './src/ui/SummaryScreen';

type Slot = 'a' | 'b';
type Tab = 'merge' | 'history';

const SLOTS = ['a', 'b'] as const;
const NO_REMOTE: Record<Slot, BackupDto | null> = { a: null, b: null };

interface MergeResult {
  report: MergeReport;
  fileName: string;
  /** Le fichier produit, déjà écrit dans les documents de l'app. */
  file: File;
  size: number;
}

const TABS = [
  { value: 'merge', label: 'Fusionner' },
  { value: 'history', label: 'Historique' },
] as const;

/**
 * Rend la main à la boucle d'événements, le temps d'un tour.
 *
 * React ne peint pas sur un simple `await` : il faut lui laisser un vrai tour
 * de boucle. C'est ce qui permet à un traitement long, découpé en tranches, de
 * garder l'écran vivant au lieu de le figer jusqu'à la fin.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Intervalle minimal entre deux respirations.
 *
 * Rendre la main n'est pas gratuit : mesuré sur appareil, 30 respirations ont
 * coûté 438 ms sur 1097 ms de décompression — 40 % du temps passé à attendre
 * le tour de boucle suivant plutôt qu'à travailler. Espacer les respirations
 * d'un dixième de seconde suffit à garder l'écran vivant (dix rafraîchissements
 * par seconde) tout en ramenant ce surcoût à quelques pour cent.
 */
const BREATH_MS = 100;

/**
 * Au-delà de ce délai, le sélecteur natif est considéré comme perdu.
 *
 * Ce n'est pas une limite de patience imposée à l'utilisateur : parcourir un
 * stockage en ligne prend légitimement des dizaines de secondes, d'où un délai
 * large. C'est un filet contre le cas où le retour d'activité Android ne vient
 * jamais — `getDocumentAsync` laisse alors sa promesse en attente pour de bon,
 * le verrou `picking` ne se relève plus, et l'écran de choix devient inerte
 * jusqu'au redémarrage de l'app. Mieux vaut rendre la main avec une erreur qui
 * nomme le blocage.
 */
const PICKER_TIMEOUT = 120_000;

/**
 * Tout ce qui remonte à l'écran passe par ici : la trace complète part dans la
 * console du poste de développement, l'utilisateur ne voit que la version
 * rédigée. Le `scope` est le nom de l'action en cours — il préfixe la ligne du
 * terminal et rend le journal lisible sans le lire dans l'ordre.
 */
function surface(scope: string, err: unknown): ErrorView {
  return logError(scope, err);
}

// Le filet de sécurité est posé au chargement du module, avant même le premier
// rendu : une erreur au démarrage part alors elle aussi dans le terminal.
installGlobalErrorLogging();

function Confluent() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    Newsreader_400Regular,
  });

  const [tab, setTab] = useState<Tab>('merge');
  const [fileA, setFileA] = useState<BackupInfo | null>(null);
  const [fileB, setFileB] = useState<BackupInfo | null>(null);
  const [strategy, setStrategy] = useState<ConflictStrategy>('keep-both');

  const [busy, setBusy] = useState(false);
  /** Emplacement en cours de lecture, et phase atteinte, pour l'afficher. */
  const [reading, setReading] = useState<{ slot: Slot; step: string } | null>(null);
  /**
   * Un sélecteur de documents est ouvert. C'est une référence et non un état :
   * le verrou doit être posé dans l'instant, avant même le rendu suivant, sinon
   * deux appuis rapprochés atteignent tous les deux le module natif.
   */
  const picking = useRef(false);
  const [progress, setProgress] = useState<{ step: string; ratio: number } | null>(null);
  const [error, setError] = useState<ErrorView | null>(null);

  /**
   * Les sauvegardes décompressées, tenues hors de l'état React.
   *
   * Un `Backup` porte plusieurs mégaoctets de tableaux typés : la base, et
   * l'archive brute conservée pour les pièces jointes que la fusion réclamera.
   * Rien de tout cela ne s'affiche — l'écran ne montre qu'un nom, une taille et
   * trois compteurs. Les ranger dans l'état obligerait React à les faire
   * traverser l'arbre des vues à chaque rendu ; une référence les garde à
   * disposition de la fusion sans jamais les mettre sur ce chemin.
   */
  const backups = useRef<Record<Slot, Backup | null>>({ a: null, b: null });

  const [result, setResult] = useState<MergeResult | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => { void loadHistory().then(setHistory); }, []);

  const pick = useCallback(async (slot: Slot) => {
    // Le module natif ne retient qu'une sélection à la fois : un second appel
    // est rejeté, et le rejet laisse sa promesse en attente jusqu'au
    // redémarrage de l'app. Un appui de trop ne doit donc jamais l'atteindre.
    if (picking.current) {
      // Silence interdit : si le retour d'activité Android s'est perdu, ce
      // verrou ne se relèvera jamais et l'appui resterait sans effet ni
      // explication. On dit alors ce qui bloque et comment en sortir.
      logInfo('choix', 'sélecteur déjà ouvert — appui ignoré');
      setError({
        title: 'Sélecteur déjà ouvert',
        message: 'Une sélection de fichier est encore en cours.',
        hint: `Termine-la. Si le sélecteur ne s’affiche pas, l’écran se débloquera de lui-même au bout de `
          + `${Math.round(PICKER_TIMEOUT / 1000)} s — inutile d’appuyer plusieurs fois.`,
        technical: 'getDocumentAsync est encore en attente d’un retour du système',
      });
      return;
    }
    picking.current = true;
    setError(null);
    const lap = stopwatch('choix', `fichier ${slot.toUpperCase()}`);
    const started = Date.now();
    try {
      logInfo('choix', `→ ouverture du sélecteur pour le fichier ${slot.toUpperCase()}`);
      // Le garde-temps ne peut pas annuler l'activité Android, seulement cesser
      // de l'attendre. Si elle revient plus tard, sa réponse est perdue — c'est
      // le prix à payer pour que l'écran redevienne utilisable.
      const picked = await withTimeout(
        `sélecteur du fichier ${slot.toUpperCase()}`, PICKER_TIMEOUT,
        () => DocumentPicker.getDocumentAsync({
          type: '*/*',
          // Sur Android, la copie en cache atterrit dans le cache d'Expo Go,
          // hors du répertoire auquel il donne accès : `File.bytes()` la refuse
          // avec « Missing 'READ' permission ». L'URI content:// d'origine, elle,
          // est lisible sans condition. Sur iOS la copie tombe dans le cache de
          // l'app et se lit bien, alors que l'URL d'origine est à accès
          // restreint et ne survit pas au sélecteur.
          copyToCacheDirectory: Platform.OS === 'ios',
          multiple: false,
        }),
        {
          title: 'Sélecteur sans réponse',
          message: 'Le sélecteur de fichiers ne s’est pas ouvert, ou n’a jamais rendu de réponse.',
          hint: 'Copie tes sauvegardes dans « Téléchargements » sur le téléphone et choisis-les de là : '
            + 'un stockage en ligne comme Google Drive passe par le réseau et peut ne jamais répondre.',
        },
      );
      lap(picked.canceled ? 'sélecteur fermé sans choix' : 'sélecteur refermé');
      if (picked.canceled) return;
      const asset = picked.assets[0];

      setBusy(true);
      setReading({ slot, step: 'ouverture du fichier' });
      logInfo('choix', `fichier ${slot.toUpperCase()} : ${asset.name} (${asset.uri})`);
      const bytes = await timed('choix', `archive lue (${asset.name})`,
        () => new File(asset.uri).bytes());
      lap(`archive de ${bytes.byteLength} octets en mémoire`);

      const pickNo = ++picks.current[slot];
      setRemote((r) => ({ ...r, [slot]: null }));
      setUploading((u) => ({ ...u, [slot]: false }));
      const info = await inspectInto(slot, asset.name, bytes, lap);

      // Connecté, et « garder dans le compte » coché : dépôt en tâche de fond.
      // L'écran est déjà rendu à l'utilisateur, la fusion n'attend pas l'envoi.
      if (sync.current.userId && sync.current.keep) void keepRemotely(slot, bytes, info, pickNo);
    } catch (err) {
      setError(surface(`choix du fichier ${slot.toUpperCase()}`, err));
    } finally {
      // Cette ligne est la preuve que l'écran est rendu à l'utilisateur : si
      // elle manque au journal alors que la décompression est passée, c'est
      // qu'une étape n'a jamais rendu la main, et le chronomètre de l'étape
      // précédente dit laquelle.
      picking.current = false;
      setReading(null);
      setBusy(false);
      logInfo('choix', `← écran déverrouillé (fichier ${slot.toUpperCase()}) — `
        + `${Date.now() - started} ms depuis l’appui`);
    }
  }, []);

  /**
   * Décompresse une sauvegarde dans un emplacement, qu'elle vienne du
   * sélecteur ou du compte. La sauvegarde part dans `backups`, la fiche
   * affichable dans l'état.
   */
  const inspectInto = useCallback(async (
    slot: Slot, name: string, bytes: Uint8Array, lap: (what: string) => void,
  ): Promise<BackupInfo> => {
    // Deux compteurs distincts : le travail réellement fait dans les
    // tranches, et le temps passé à attendre le tour de boucle suivant. Si
    // le second domine, la lenteur ne vient pas de la décompression mais du
    // rythme auquel React Native rend la main — et le remède n'est pas le
    // même.
    let slices = 0;
    let breaths = 0;
    let waiting = 0;
    let slowest = 0;
    let mark = Date.now();
    let lastBreath = Date.now();

    const show = slot === 'a' ? setFileA : setFileB;
    const info = await inspectBackup(name, bytes, expoHost, {
      // Le manifeste est lu en quelques millisecondes : la carte s'affiche
      // aussitôt, appareil et taille compris, et les compteurs la
      // complètent quand la base a fini d'être décompressée.
      onOutline: (outline) => {
        show(outline);
        lap('manifeste lu, carte affichée');
        mark = Date.now();
      },
      onStep: async (step) => {
        setReading({ slot, step });
        logInfo('choix', `→ ${step}`);
        await breathe();
        mark = Date.now();
      },
      // Sans ce retour à la boucle d'événements entre deux tranches, la
      // décompression retiendrait le thread JS plusieurs secondes d'affilée
      // et l'app paraîtrait plantée. Le pourcentage qui monte est la preuve
      // la plus directe, pour qui regarde l'écran, qu'elle travaille.
      onSlice: async (done, total) => {
        const spent = Date.now() - mark;
        if (spent > slowest) slowest = spent;
        slices++;
        if (Date.now() - lastBreath < BREATH_MS) return;

        breaths++;
        setReading({ slot, step: `décompression ${fmt.percent(done / total)}` });
        const pause = Date.now();
        await breathe();
        waiting += Date.now() - pause;
        lastBreath = Date.now();
        mark = Date.now();
      },
    });

    logInfo('choix', `décompression : ${slices} tranches, ${breaths} respirations — `
      + `${waiting} ms d’attente de la boucle, plus longue pause d’affilée ${slowest} ms`);
    // La sauvegarde décompressée part dans la référence, la fiche affichable
    // dans l'état — celle-ci ne garde donc que du texte et des nombres.
    backups.current[slot] = info.backup;
    const shown = { ...info, backup: null };
    show(shown);
    lap(`fichier ${slot.toUpperCase()} prêt : ${info.counts?.notes} notes, `
      + `${info.counts?.highlights} surlignages, ${info.counts?.bookmarks} favoris`);
    return shown;
  }, []);

  // --- Synchronisation des emplacements, quand un compte est connecté ---

  const session = useSession();
  const userId = session.data?.user.id ?? null;
  /** La sauvegarde du compte qui correspond au fichier affiché dans chaque emplacement. */
  const [remote, setRemote] = useState<Record<Slot, BackupDto | null>>(NO_REMOTE);
  const [uploading, setUploading] = useState<Record<Slot, boolean>>({ a: false, b: false });
  const [keepInAccount, setKeepInAccount] = useState(true);
  /** Numéro du dernier choix par emplacement : un envoi tardif ne rattache pas un fichier remplacé. */
  const picks = useRef<Record<Slot, number>>({ a: 0, b: 0 });
  /**
   * Compte et case à cocher, lus par `pick` sans en dépendre : `pick` reste
   * stable, et le verrou du sélecteur avec lui.
   */
  const sync = useRef({ userId, keep: keepInAccount });
  sync.current = { userId, keep: keepInAccount };

  /** Sauvegardes qu'un dépôt a trouvées déjà dans le compte, pour le dire sous la carte. */
  const alreadyThere = useRef(new Set<string>());

  /** Dépose en tâche de fond la sauvegarde qu'on vient de lire. */
  const keepRemotely = useCallback(async (slot: Slot, bytes: Uint8Array, info: BackupInfo, pickNo: number) => {
    setUploading((u) => ({ ...u, [slot]: true }));
    try {
      const sha256 = await sha256Expo(bytes);
      const { backup: dto, alreadyThere: known } = await timed('synchronisation', `dépôt de ${info.name} en ${slot.toUpperCase()}`,
        () => cloud.uploadBackup(slot, info, bytes, sha256));
      if (known) alreadyThere.current.add(dto.id);
      if (picks.current[slot] === pickNo) setRemote((r) => ({ ...r, [slot]: dto }));
    } catch (err) {
      setError(surface(`dépôt dans le compte, emplacement ${slot.toUpperCase()}`, err));
    } finally {
      if (picks.current[slot] === pickNo) setUploading((u) => ({ ...u, [slot]: false }));
    }
  }, []);

  /**
   * Reprend les emplacements du compte : au lancement, à la connexion, et au
   * retour au premier plan (un autre appareil a pu déposer entre-temps). Un
   * emplacement déjà rempli sur le téléphone est laissé tel quel.
   */
  const syncing = useRef(false);
  const pullSlots = useCallback(async () => {
    if (!sync.current.userId || syncing.current || picking.current) return;
    syncing.current = true;
    try {
      const slots = await cloud.slots();
      for (const slot of SLOTS) {
        const dto = slots[slot];
        // L'emplacement du compte a changé ailleurs : la ligne ne correspond plus.
        setRemote((r) => (r[slot] && r[slot]!.id !== dto?.id ? { ...r, [slot]: null } : r));
        if (!dto || backups.current[slot]) continue;

        const pickNo = ++picks.current[slot];
        const lap = stopwatch('synchronisation', `emplacement ${slot.toUpperCase()}`);
        setRemote((r) => ({ ...r, [slot]: dto }));
        setBusy(true);
        setReading({ slot, step: 'téléchargement depuis le compte' });
        (slot === 'a' ? setFileA : setFileB)({
          name: dto.name, size: dto.size, deviceName: dto.deviceName,
          createdAt: dto.backupCreatedAt, counts: null, backup: null,
        });
        try {
          const bytes = await cloud.downloadBackup(dto);
          lap(`téléchargé : ${bytes.byteLength} octets`);
          await inspectInto(slot, dto.name, bytes, lap);
        } catch (err) {
          (slot === 'a' ? setFileA : setFileB)(null);
          if (picks.current[slot] === pickNo) setRemote((r) => ({ ...r, [slot]: null }));
          setError(surface(`récupération depuis le compte, emplacement ${slot.toUpperCase()}`, err));
        } finally {
          setReading(null);
          setBusy(false);
        }
      }
    } catch (err) {
      setError(surface('synchronisation des emplacements', err));
    } finally {
      syncing.current = false;
    }
  }, [inspectInto]);

  useEffect(() => {
    setRemote(NO_REMOTE);
    if (!userId) return;
    void pullSlots();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pullSlots();
    });
    return () => sub.remove();
  }, [userId, pullSlots]);

  const removeRemote = useCallback(async (slot: Slot) => {
    setError(null);
    try {
      await cloud.clearSlot(slot);
      setRemote((r) => ({ ...r, [slot]: null }));
    } catch (err) {
      setError(surface(`retrait du compte, emplacement ${slot.toUpperCase()}`, err));
    }
  }, []);

  const cloudLine = (slot: Slot): CloudLine | null => {
    if (uploading[slot]) return { text: 'Envoi vers le compte…' };
    const dto = remote[slot];
    if (!dto) return null;
    const from = dto.uploadedFrom ? `Déposé depuis ${dto.uploadedFrom}` : 'Dans le compte';
    const text = `${from} · ${fmt.timeAgo(dto.createdAt)}`;
    // Le fichier choisi était déjà là : rien n'a été renvoyé (YKO-51).
    const known = alreadyThere.current.has(dto.id) ? `Déjà dans ton compte · ${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
    return { text: known, onRemove: () => void removeRemote(slot) };
  };

  const replace = useCallback(() => {
    Alert.alert('Remplacer un fichier', 'Quel fichier voulez-vous remplacer ?', [
      { text: 'Fichier A', onPress: () => void pick('a') },
      { text: 'Fichier B', onPress: () => void pick('b') },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [pick]);

  // --- Enregistrement de la fusion dans le compte ---

  const [cloudSave, setCloudSave] = useState<CloudSave | null>(null);
  const [remoteHistory, setRemoteHistory] = useState<MergePage | null>(null);
  const [historyMore, setHistoryMore] = useState(false);
  /** La dernière fusion à enregistrer, gardée pour « Réessayer ». Le fichier est déjà sur le disque. */
  const pendingSave = useRef<{ file: File; meta: MergeMeta; sha256: string } | null>(null);

  const saveToAccount = useCallback(async () => {
    const job = pendingSave.current;
    if (!job) return;
    setCloudSave({ state: 'saving' });
    try {
      const saved = await timed('synchronisation', `enregistrement de ${job.meta.fileName}`,
        async () => cloud.saveMerge(await job.file.bytes(), job.meta, job.sha256));
      if (pendingSave.current !== job) return;
      setCloudSave({ state: 'saved', notes: saved.slotsKept.map(describeKeptSlot) });
      // Le serveur a libéré les emplacements consommés : l'écran suit. Un
      // emplacement redéposé entre-temps ne correspond plus au fichier affiché.
      setRemote((r) => ({
        a: r.a && job.meta.backups.a === r.a.id ? null : r.a,
        b: r.b && job.meta.backups.b === r.b.id ? null : r.b,
      }));
      const { slotsKept: _kept, ...dto } = saved;
      setRemoteHistory((h) => (h ? { ...h, items: [dto, ...h.items] } : h));
    } catch (err) {
      if (pendingSave.current !== job) return;
      setCloudSave({
        state: 'error',
        error: surface('enregistrement de la fusion dans le compte', err),
        onRetry: () => void saveToAccount(),
      });
    }
  }, []);

  const merge = useCallback(async () => {
    // Les deux sauvegardes doivent être entièrement lues : tant qu'une carte
    // n'affiche que son manifeste, il n'y a pas de base à fusionner.
    const baseBackup = backups.current.a;
    const sourceBackup = backups.current.b;
    if (!fileA || !fileB || !baseBackup || !sourceBackup) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    setProgress({ step: 'préparation', ratio: 0 });
    let lastTick = Date.now();

    try {
      const id = `${Date.now()}`;
      const fileName = `Fusion_${new Date().toISOString().slice(0, 10)}.jwlibrary`;

      const merged = await mergeBackups(baseBackup, sourceBackup, {
        host: expoHost,
        sha256: sha256Expo,
        outputName: fileName,
        conflictStrategy: strategy,
        onProgress: async (step, done, total) => {
          // La fusion tourne sur le thread JS et le bloque : sans retour à la
          // boucle d'événements, la barre resterait figée jusqu'à la fin. Mais
          // la fusion signale son avancement bien plus souvent qu'un écran ne
          // se rafraîchit — respirer à chaque signal reviendrait à passer le
          // plus clair du temps à attendre. Voir `BREATH_MS`.
          if (Date.now() - lastTick < BREATH_MS) return;
          lastTick = Date.now();
          setProgress({ step, ratio: overallRatio(step, done, total) });
          await breathe();
        },
      });

      // Écrit directement à sa place dans l'historique : c'est ce même fichier
      // que le récapitulatif, puis l'historique, enregistrent ou partagent.
      const file = archivedFile({ id, name: merged.fileName });
      file.create({ overwrite: true });
      file.write(merged.file);

      setResult({
        report: merged.report,
        fileName: merged.fileName,
        file,
        size: merged.file.byteLength,
      });

      const sources = `${fileA.deviceName} ${fmt.dayMonth(fileA.createdAt)}`
        + ` + ${fileB.deviceName} ${fmt.dayMonth(fileB.createdAt)}`;

      // Connecté : enregistrement dans le compte en tâche de fond. Le partage
      // et l'enregistrement local, eux, sont possibles tout de suite.
      if (sync.current.userId) {
        pendingSave.current = {
          file,
          sha256: await sha256Expo(merged.file),
          meta: {
            fileName: merged.fileName,
            report: merged.report,
            sources,
            strategy,
            // Les sauvegardes du compte qui ont servi : leurs emplacements
            // seront libérés, s'ils les contiennent encore.
            backups: { a: remote.a?.id, b: remote.b?.id },
          },
        };
        void saveToAccount();
      } else {
        pendingSave.current = null;
        setCloudSave(null);
      }

      const entry: HistoryEntry = {
        id,
        name: merged.fileName,
        createdAt: new Date().toISOString(),
        sources,
        notes: merged.report.totals.notes,
        size: merged.file.byteLength,
      };
      const next = await addToHistory(entry);
      pruneArchive(next);
      setHistory(next);
      logInfo('fusion', `${merged.fileName} — ${merged.report.totals.notes} notes, `
        + `${merged.file.byteLength} octets`);
    } catch (err) {
      setError(surface('fusion', err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [fileA, fileB, strategy, remote, saveToAccount]);


  /** Fusions dont le fichier est encore conservé, donc réenregistrable. */
  const stored = useMemo(
    () => new Set(history.filter((entry) => findArchivedFile(entry)).map((entry) => entry.id)),
    [history],
  );

  // Enregistrer et partager servent au récapitulatif comme à l'historique :
  // ils prennent le fichier en argument plutôt que de lire `result`.
  const save = useCallback(async (file: File, fileName: string) => {
    setError(null);
    setStatus(null);
    try {
      const target = await Directory.pickDirectoryAsync();
      setBusy(true);
      // Le dossier choisi peut être un emplacement SAF sur Android : c'est
      // `createFile` qui règle les collisions de nom, pas nous.
      const destination = target.createFile(fileName, 'application/octet-stream');
      destination.write(await file.bytes());
      setStatus(`Enregistré : ${fmt.savedName(destination.name, fileName)}`);
    } catch (err) {
      // Un choix de dossier annulé rejette aussi : rien à signaler dans ce cas.
      if (!isCancellation(err)) setError(surface('enregistrement', err));
    } finally {
      setBusy(false);
    }
  }, []);

  const openInJw = useCallback(async () => {
    if (!result) return;
    setError(null);
    try {
      await openInJwLibrary(result.file);
      // On ne sait pas ce que l'app choisie a fait du fichier — l'intention
      // ne rend rien. La suite se passe dans JW Library, autant la dire.
      setStatus(RESTORE_STEPS);
    } catch (err) {
      if (!isCancellation(err)) setError(surface('ouverture dans JW Library', err));
    }
  }, [result]);

  const share = useCallback(async (file: File, fileName: string) => {
    setError(null);
    setStatus(null);
    try {
      if (!await Sharing.isAvailableAsync()) {
        setError({
          title: 'Partage indisponible',
          message: 'Cet appareil n’offre pas de menu de partage.',
          hint: 'Utilise « Enregistrer le fichier » pour le ranger dans un dossier.',
          technical: 'Sharing.isAvailableAsync() a répondu false',
        });
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/octet-stream',
        UTI: 'public.data',
        dialogTitle: fileName,
      });
    } catch (err) {
      if (!isCancellation(err)) setError(surface('partage', err));
    }
  }, []);

  // --- Historique du compte ---


  const loadRemoteHistory = useCallback(async (cursor?: string) => {
    if (cursor) setHistoryMore(true);
    try {
      const page = await cloud.merges(cursor);
      setRemoteHistory((h) => (cursor && h ? { items: [...h.items, ...page.items], next: page.next } : page));
    } catch (err) {
      setError(surface('historique du compte', err));
      if (!cursor) setRemoteHistory({ items: [] });
    } finally {
      setHistoryMore(false);
    }
  }, []);

  // Rechargé à chaque ouverture de l'onglet : une fusion a pu être faite
  // ailleurs. Oublié à la déconnexion.
  useEffect(() => {
    if (!userId) { setRemoteHistory(null); return; }
    if (tab === 'history') {
      setRemoteHistory(null);
      void loadRemoteHistory();
    }
  }, [userId, tab, loadRemoteHistory]);

  /**
   * Télécharge le fichier d'une fusion du compte dans le cache, puis ouvre le
   * menu de partage : c'est par là qu'il rejoint JW Library pour la
   * restauration.
   */
  const downloadAndShare = useCallback(async (entry: HistoryEntry) => {
    if (!entry.remoteId) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    let file: File;
    try {
      const url = await cloud.downloadUrl('merge', entry.remoteId);
      const target = remoteCopy(entry);
      if (target.exists) target.delete();
      file = await timed('historique', `téléchargement de ${entry.name}`,
        () => File.downloadFileAsync(url, target));
    } catch (err) {
      setError(surface('téléchargement depuis le compte', err));
      return;
    } finally {
      setBusy(false);
    }
    await share(file, entry.name);
  }, [share]);

  const deleteRemote = useCallback((entry: HistoryEntry) => {
    if (!entry.remoteId) return;
    Alert.alert(
      'Supprimer cette fusion ?',
      `${entry.name} sera retirée de ton compte, sur tous tes appareils.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => void (async () => {
            setError(null);
            setStatus(null);
            try {
              await cloud.deleteMerge(entry.remoteId!);
              setRemoteHistory((h) => (h ? { ...h, items: h.items.filter((m) => m.id !== entry.remoteId) } : h));
              setStatus(`Supprimée : ${entry.name}`);
            } catch (err) {
              setError(surface('suppression d’une fusion', err));
            }
          })(),
        },
      ],
    );
  }, []);

  /** Le fichier d'une fusion passée, ou une erreur qui dit qu'il n'est plus là. */
  const pastFile = useCallback((entry: HistoryEntry): File | null => {
    const file = findArchivedFile(entry);
    if (!file) {
      setStatus(null);
      setError({
        title: 'Fichier introuvable',
        message: 'Le fichier de cette fusion n’est plus conservé sur l’appareil.',
        hint: 'Relancer la fusion à partir des deux sauvegardes d’origine.',
        technical: `aucun fichier pour l’entrée ${entry.id} (${entry.name})`,
      });
    }
    return file;
  }, []);

  const switchTab = useCallback((next: Tab) => {
    setTab(next);
    setStatus(null);
    setError(null);
  }, []);

  const closeSummary = useCallback(() => {
    setResult(null);
    setStatus(null);
    setError(null);
  }, []);

  // Le compte, facultatif : une ligne discrète au-dessus de l'écran.
  const [accountScreen, setAccountScreen] = useState<'sign-in' | 'delete' | null>(null);
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
  const email = session.data?.user.email ?? null;

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[styles.root, styles.centered]}>
        <ActivityIndicator color={color.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={color.screen} />
      {result ? (
        <SummaryScreen
          report={result.report}
          fileName={result.fileName}
          fileSize={result.size}
          busy={busy}
          status={status}
          error={error}
          onDismissError={() => setError(null)}
          onSave={() => void save(result.file, result.fileName)}
          onOpenInJwLibrary={() => void openInJw()}
          onShare={() => void share(result.file, result.fileName)}
          onClose={closeSummary}
          cloudSave={userId ? cloudSave : null}
        />
      ) : accountScreen === 'sign-in' ? (
        <AccountScreen onDone={() => setAccountScreen(null)} />
      ) : accountScreen === 'delete' && email ? (
        <DeleteAccountScreen
          email={email}
          onCancel={() => setAccountScreen(null)}
          onDeleted={() => setAccountScreen(null)}
        />
      ) : (
        <>
          {/* Rien tant que la session n'est pas connue : pas de clignotement. */}
          <View style={styles.account}>
            {!session.isPending && (email ? (
              <>
                <Text style={styles.accountEmail} numberOfLines={1}>{email}</Text>
                <TextLink small label="Se déconnecter" onPress={() => void logout()} disabled={busy} />
                <TextLink
                  small
                  quiet
                  label="Supprimer le compte"
                  onPress={() => { setError(null); setAccountScreen('delete'); }}
                  disabled={busy}
                />
              </>
            ) : (
              <TextLink
                small
                label="Se connecter pour synchroniser"
                onPress={() => { setError(null); setAccountScreen('sign-in'); }}
                disabled={busy}
              />
            ))}
          </View>
          <View style={styles.content}>
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
                onPick={(slot) => void pick(slot)}
                onReplace={replace}
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
                entries={userId ? (remoteHistory?.items ?? []).map(fromMergeDto) : history}
                stored={stored}
                busy={busy}
                status={status}
                error={error}
                onDismissError={() => setError(null)}
                onSave={(entry) => {
                  const file = pastFile(entry);
                  if (file) void save(file, entry.name);
                }}
                onShare={(entry) => {
                  const file = pastFile(entry);
                  if (file) void share(file, entry.name);
                }}
                remote={userId ? {
                  loading: remoteHistory === null,
                  hasMore: !!remoteHistory?.next,
                  loadingMore: historyMore,
                  onMore: () => void loadRemoteHistory(remoteHistory?.next),
                  onDownload: (entry) => void downloadAndShare(entry),
                  onDelete: deleteRemote,
                } : undefined}
              />
            )}
          </View>
          <View style={styles.tabs}>
            <Segmented options={TABS} value={tab} onChange={switchTab} variant="tabs" disabled={busy} />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Confluent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.screen },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1 },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    minHeight: 30,
    paddingHorizontal: 26,
    paddingTop: 10,
  },
  accountEmail: { flexShrink: 1, fontFamily: font.sans, fontSize: 13, color: color.muted },
  tabs: { paddingHorizontal: 26, paddingTop: 10, paddingBottom: 8 },
});
