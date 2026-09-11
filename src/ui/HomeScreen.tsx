/** Écran 1 — Accueil : choisir deux fichiers, régler les doublons, fusionner. */
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BackupInfo } from '../backup-info';
import type { ErrorView } from '../errors';
import type { ConflictStrategy } from '../merge';
import * as fmt from '../format';
import { color, font, radius, space } from '../theme';
import {
  Card, DashedButton, ErrorNotice, Eyebrow, PlusRule, PrimaryButton, ProgressBar, Segmented,
} from './kit';

const STRATEGIES = [
  { value: 'keep-both', label: 'Tout garder' },
  { value: 'newest', label: 'Version récente' },
] as const satisfies readonly { value: ConflictStrategy; label: string }[];

function FileSlot({ label, info, onPress, disabled, step }: {
  label: string;
  info: BackupInfo | null;
  onPress: () => void;
  disabled?: boolean;
  /** Phase de lecture en cours, tant que les compteurs manquent. */
  step?: string | null;
}) {
  if (!info) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} — choisir un fichier`}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [styles.emptySlot, pressed && styles.emptySlotPressed, disabled && styles.dim]}
      >
        <Eyebrow tone={color.faint}>{label}</Eyebrow>
        <Text style={styles.emptyTitle}>Choisir un fichier</Text>
        <Text style={styles.meta}>Une sauvegarde .jwlibrary</Text>
      </Pressable>
    );
  }

  // La carte paraît dès le manifeste lu : nom, appareil, taille. Les
  // compteurs arrivent ensuite, quand la base a fini d'être décompressée.
  const card = (
    <Card style={styles.slot}>
      <View style={styles.slotHead}>
        <Eyebrow tone={color.accent}>{label}</Eyebrow>
        <Text style={styles.slotSize}>{fmt.size(info.size)}</Text>
      </View>
      <Text style={styles.slotName} numberOfLines={2}>{info.name}</Text>
      {info.counts ? (
        <View style={styles.slotStats}>
          <Text style={[styles.meta, styles.stat]}>{fmt.count(info.counts.notes)} notes</Text>
          <Text style={[styles.meta, styles.stat]}>{fmt.count(info.counts.highlights)} surlignages</Text>
          <Text style={[styles.meta, styles.stat]}>{fmt.count(info.counts.bookmarks)} favoris</Text>
        </View>
      ) : (
        <View style={styles.slotLoading}>
          <ActivityIndicator size="small" color={color.accent} />
          <Text style={styles.meta}>{step ?? 'lecture'}…</Text>
        </View>
      )}
    </Card>
  );

  if (!info.counts) return <View accessibilityRole="progressbar">{card}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} — ${info.name}, appuyer pour remplacer`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressedCard, disabled && styles.dim]}
    >
      {card}
    </Pressable>
  );
}

export interface HomeScreenProps {
  fileA: BackupInfo | null;
  fileB: BackupInfo | null;
  strategy: ConflictStrategy;
  busy: boolean;
  /** Emplacement en cours de lecture, et phase atteinte. */
  reading: { slot: 'a' | 'b'; step: string } | null;
  /** Étape en cours et avancement global, pendant la fusion. */
  progress: { step: string; ratio: number } | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onPick: (slot: 'a' | 'b') => void;
  onReplace: () => void;
  onStrategyChange: (value: ConflictStrategy) => void;
  onMerge: () => void;
}

export function HomeScreen({
  fileA, fileB, strategy, busy, reading, progress, error,
  onDismissError, onPick, onReplace, onStrategyChange, onMerge,
}: HomeScreenProps) {
  // Une carte qui n'affiche encore que son manifeste n'a pas de base à
  // fusionner : le bouton reste inerte tant que les deux lectures ne sont pas
  // terminées.
  const ready = !!fileA?.counts && !!fileB?.counts;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Eyebrow>Confluent</Eyebrow>
          <Text style={styles.title}>Fusionner deux sauvegardes</Text>
        </View>

        <View style={styles.slots}>
          <FileSlot
            label="Fichier A"
            info={fileA}
            onPress={() => onPick('a')}
            disabled={busy}
            step={reading?.slot === 'a' ? reading.step : null}
          />
          <PlusRule />
          <FileSlot
            label="Fichier B"
            info={fileB}
            onPress={() => onPick('b')}
            disabled={busy}
            step={reading?.slot === 'b' ? reading.step : null}
          />
          {ready && (
            <DashedButton label="Remplacer un fichier" onPress={onReplace} disabled={busy} />
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.strategy}>
          <Eyebrow>En cas de doublon</Eyebrow>
          <Segmented
            options={STRATEGIES}
            value={strategy}
            onChange={onStrategyChange}
            disabled={busy}
          />
          <Text style={styles.hint}>
            {strategy === 'keep-both'
              ? 'Une note modifiée des deux côtés garde sa version récente, l’ancienne est ajoutée en annexe.'
              : 'Une note modifiée des deux côtés ne garde que sa version la plus récente.'}
          </Text>
        </View>

        {error && <ErrorNotice error={error} onDismiss={onDismissError} />}

        {busy && progress && (
          <View style={styles.progress}>
            <ProgressBar ratio={progress.ratio} />
            <Text style={styles.progressLabel}>
              {progress.step} · {fmt.percent(progress.ratio)}
            </Text>
          </View>
        )}

        <PrimaryButton
          label={busy ? 'Fusion en cours…' : 'Fusionner'}
          onPress={onMerge}
          disabled={!ready || busy}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingTop: space.screenTop, paddingHorizontal: space.gutter, paddingBottom: 24 },

  header: { gap: 6 },
  title: { fontFamily: font.serif, fontSize: 34, lineHeight: 38, color: color.ink },

  slots: { marginTop: 28, gap: 12 },

  slot: { padding: 18, gap: 10 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotSize: { fontFamily: font.sans, fontSize: 13, color: color.fainter },
  slotName: { fontFamily: font.sansSemi, fontSize: 17, color: color.ink },
  // L'espacement passe par des marges et non par `gap`. Sur un conteneur en
  // `flexWrap: 'wrap'`, la répartition de `gap` entre les lignes est le point de
  // Yoga soupçonné d'avoir figé le thread JS au moment précis où cette rangée
  // apparaissait. Des marges donnent la même image sans emprunter ce chemin.
  slotStats: { flexDirection: 'row', flexWrap: 'wrap' },
  stat: { marginRight: 18, marginTop: 2 },
  pressedCard: { opacity: 0.7 },
  dim: { opacity: 0.5 },

  emptySlot: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.outline,
    borderRadius: radius.card,
    padding: 18,
    gap: 8,
  },
  emptySlotPressed: { borderColor: color.accent },

  slotLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  emptyTitle: { fontFamily: font.sansSemi, fontSize: 17, color: color.ink },

  meta: { fontFamily: font.sans, fontSize: 13, color: color.muted },

  footer: {
    paddingHorizontal: space.gutter,
    paddingTop: 16,
    paddingBottom: 4,
    gap: 16,
  },
  strategy: { gap: 10 },
  hint: { fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: color.fainter },

  progress: { gap: 8 },
  progressLabel: { fontFamily: font.sansMedium, fontSize: 13, color: color.muted },
});
