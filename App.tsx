/**
 * Confluent — fusion de deux sauvegardes JW Library.
 *
 * Trois écrans, tels que dessinés dans « Fusion Sauvegardes » : l'accueil où
 * l'on choisit les deux fichiers, le récapitulatif de la fusion, et
 * l'historique des fusions faites sur l'appareil.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Platform, StatusBar, StyleSheet, View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
// Import par graisse : la racine de ces paquets réexporte toutes les variantes,
// ce qui embarquerait 2,5 Mo de fontes dont l'app n'utilise que quatre fichiers.
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_500Medium } from '@expo-google-fonts/instrument-sans/500Medium';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { Newsreader_400Regular } from '@expo-google-fonts/newsreader/400Regular';
import { useFonts } from 'expo-font';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
// `SafeAreaView` de react-native est déprécié et sera retiré ; celui-ci le
// remplace et gère en plus l'encoche en paysage. Il lit les marges dans un
// contexte, d'où le `SafeAreaProvider` posé à la racine, au-dessus.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { inspectBackup, type BackupInfo } from './src/backup-info';
import {
  installGlobalErrorLogging, isCancellation, logError, logInfo, stopwatch, timed,
  type ErrorView,
} from './src/errors';
import * as fmt from './src/format';
import { addToHistory, loadHistory, type HistoryEntry } from './src/history';
import { mergeBackups, type ConflictStrategy, type MergeReport } from './src/merge';
import { expoHost, sha256Expo } from './src/platform/sqlite-expo';
import { overallRatio } from './src/progress';
import { color } from './src/theme';
import { HistoryScreen } from './src/ui/HistoryScreen';
import { HomeScreen } from './src/ui/HomeScreen';
import { Segmented } from './src/ui/kit';
import { SummaryScreen } from './src/ui/SummaryScreen';

type Slot = 'a' | 'b';
type Tab = 'merge' | 'history';

interface MergeResult {
  report: MergeReport;
  fileName: string;
  /** Le fichier produit, déjà écrit dans le cache de l'app. */
  file: File;
  size: number;
}

const TABS = [
  { value: 'merge', label: 'Fusionner' },
  { value: 'history', label: 'Historique' },
] as const;

/** Répertoire de travail : les fichiers produits y attendent d'être enregistrés. */
function workDirectory(): Directory {
  const dir = new Directory(Paths.cache, 'fusions');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/**
 * Nom libre dans le répertoire de travail, en suffixant si besoin :
 * `Fusion_2026-09-05_2.jwlibrary`.
 */
function freeName(dir: Directory, base: string, extension: string): string {
  for (let i = 1; i < 100; i++) {
    const name = i === 1 ? `${base}${extension}` : `${base}_${i}${extension}`;
    if (!new File(dir, name).exists) return name;
  }
  return `${base}_${Date.now()}${extension}`;
}

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
        hint: 'Termine-la, ou ferme complètement l’app et rouvre-la si l’écran de choix ne revient pas.',
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
      const picked = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        // Sur Android, la copie en cache atterrit dans le cache d'Expo Go, hors
        // du répertoire auquel il donne accès : `File.bytes()` la refuse avec
        // « Missing 'READ' permission ». L'URI content:// d'origine, elle, est
        // lisible sans condition. Sur iOS la copie tombe dans le cache de
        // l'app et se lit bien, alors que l'URL d'origine est à accès
        // restreint et ne survit pas au sélecteur.
        copyToCacheDirectory: Platform.OS === 'ios',
        multiple: false,
      });
      lap(picked.canceled ? 'sélecteur fermé sans choix' : 'sélecteur refermé');
      if (picked.canceled) return;
      const asset = picked.assets[0];

      setBusy(true);
      setReading({ slot, step: 'ouverture du fichier' });
      logInfo('choix', `fichier ${slot.toUpperCase()} : ${asset.name} (${asset.uri})`);
      const bytes = await timed('choix', `archive lue (${asset.name})`,
        () => new File(asset.uri).bytes());
      lap(`archive de ${bytes.byteLength} octets en mémoire`);

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
      const info = await inspectBackup(asset.name, bytes, expoHost, {
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
      show(info);
      lap(`fichier ${slot.toUpperCase()} prêt : ${info.counts?.notes} notes, `
        + `${info.counts?.highlights} surlignages, ${info.counts?.bookmarks} favoris`);
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

  const replace = useCallback(() => {
    Alert.alert('Remplacer un fichier', 'Quel fichier voulez-vous remplacer ?', [
      { text: 'Fichier A', onPress: () => void pick('a') },
      { text: 'Fichier B', onPress: () => void pick('b') },
      { text: 'Annuler', style: 'cancel' },
    ]);
  }, [pick]);

  const merge = useCallback(async () => {
    // Les deux sauvegardes doivent être entièrement lues : tant qu'une carte
    // n'affiche que son manifeste, il n'y a pas de base à fusionner.
    const baseBackup = fileA?.backup;
    const sourceBackup = fileB?.backup;
    if (!fileA || !fileB || !baseBackup || !sourceBackup) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    setProgress({ step: 'préparation', ratio: 0 });
    let lastTick = Date.now();

    try {
      const dir = workDirectory();
      const fileName = freeName(dir, `Fusion_${new Date().toISOString().slice(0, 10)}`, '.jwlibrary');

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

      const file = new File(dir, fileName);
      file.create({ overwrite: true });
      file.write(merged.file);

      setResult({
        report: merged.report,
        fileName: merged.fileName,
        file,
        size: merged.file.byteLength,
      });

      const entry: HistoryEntry = {
        id: `${Date.now()}`,
        name: merged.fileName,
        createdAt: new Date().toISOString(),
        sources: `${fileA.deviceName} ${fmt.dayMonth(fileA.createdAt)}`
          + ` + ${fileB.deviceName} ${fmt.dayMonth(fileB.createdAt)}`,
        notes: merged.report.totals.notes,
        size: merged.file.byteLength,
      };
      setHistory(await addToHistory(entry));
      logInfo('fusion', `${merged.fileName} — ${merged.report.totals.notes} notes, `
        + `${merged.file.byteLength} octets`);
    } catch (err) {
      setError(surface('fusion', err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [fileA, fileB, strategy]);

  const save = useCallback(async () => {
    if (!result) return;
    setError(null);
    try {
      const target = await Directory.pickDirectoryAsync();
      setBusy(true);
      // Le dossier choisi peut être un emplacement SAF sur Android : c'est
      // `createFile` qui règle les collisions de nom, pas nous.
      const destination = target.createFile(result.fileName, 'application/octet-stream');
      destination.write(await result.file.bytes());
      setStatus(`Enregistré : ${destination.name}`);
    } catch (err) {
      // Un choix de dossier annulé rejette aussi : rien à signaler dans ce cas.
      if (!isCancellation(err)) setError(surface('enregistrement', err));
    } finally {
      setBusy(false);
    }
  }, [result]);

  const share = useCallback(async () => {
    if (!result) return;
    setError(null);
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
      await Sharing.shareAsync(result.file.uri, {
        mimeType: 'application/octet-stream',
        UTI: 'public.data',
        dialogTitle: result.fileName,
      });
    } catch (err) {
      if (!isCancellation(err)) setError(surface('partage', err));
    }
  }, [result]);

  const closeSummary = useCallback(() => {
    setResult(null);
    setStatus(null);
    setError(null);
  }, []);

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
          onSave={() => void save()}
          onShare={() => void share()}
          onClose={closeSummary}
        />
      ) : (
        <>
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
              />
            ) : (
              <HistoryScreen entries={history} />
            )}
          </View>
          <View style={styles.tabs}>
            <Segmented options={TABS} value={tab} onChange={setTab} variant="tabs" disabled={busy} />
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
  tabs: { paddingHorizontal: 26, paddingTop: 10, paddingBottom: 8 },
});
