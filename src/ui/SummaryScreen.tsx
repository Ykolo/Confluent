/** Écran 2 — Récapitulatif : ce que contient le fichier produit, et quoi en faire. */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ErrorView } from '../errors';
import * as fmt from '../format';
import type { MergeReport } from '../merge';
import { color, font, radius, space } from '../theme';
import { Card, ErrorNotice, Eyebrow, PrimaryButton, SecondaryButton } from './kit';

function Row({ label, value, dim, last }: {
  label: string;
  value: string;
  dim?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, dim && styles.rowValueDim]}>{value}</Text>
    </View>
  );
}

export interface SummaryScreenProps {
  report: MergeReport;
  fileName: string;
  /** Taille de l'archive produite, en octets. */
  fileSize: number;
  busy: boolean;
  /** Confirmation d'enregistrement ou de partage, affichée sous les boutons. */
  status: string | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onSave: () => void;
  onShare: () => void;
  onClose: () => void;
}

export function SummaryScreen({
  report, fileName, fileSize, busy, status, error, onDismissError, onSave, onShare, onClose,
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
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.check}><Text style={styles.checkMark}>✓</Text></View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fermer le récapitulatif"
              onPress={onClose}
              disabled={busy}
              style={({ pressed }) => [styles.close, pressed && styles.closePressed, busy && styles.dim]}
            >
              <Text style={styles.closeMark}>✕</Text>
            </Pressable>
          </View>
          <Text style={styles.title}>Fusion terminée</Text>
          <Text style={styles.lead}>
            Un nouveau fichier a été créé. Vos deux sauvegardes d’origine sont intactes.
          </Text>
        </View>

        <Card style={styles.table}>
          {rows.map((row, i) => (
            <Row key={row.label} {...row} last={i === rows.length - 1} />
          ))}
        </Card>

        <View style={styles.output}>
          <Eyebrow>Fichier obtenu</Eyebrow>
          <Text style={styles.outputName}>{fileName}</Text>
          <Text style={styles.outputMeta}>
            {fmt.size(fileSize)} · prêt à réimporter dans votre bibliothèque
          </Text>
        </View>

        {/*
          La restauration remplace intégralement la base locale : l'appareil
          qui ne reçoit pas ce fichier réintroduira son ancien état à sa
          prochaine sauvegarde. Le dire ici évite de perdre la fusion.
        */}
        <Text style={styles.caution}>
          À restaurer sur les deux appareils. Celui qui garde son ancienne sauvegarde
          la réintroduira lors de sa prochaine sauvegarde.
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        {error && <ErrorNotice error={error} onDismiss={onDismissError} />}
        {status && !error && <Text style={styles.status}>{status}</Text>}
        <PrimaryButton label="Enregistrer le fichier" onPress={onSave} disabled={busy} />
        <SecondaryButton label="Partager" onPress={onShare} disabled={busy} />
        {/*
          Ni enregistrer ni partager n'est obligatoire : la fusion est déjà
          faite et le fichier est déjà écrit. Le ✕ de l'en-tête permettait
          seul de sortir, mais rien n'y disait qu'on en avait le droit — d'où
          cette sortie nommée, à côté des actions qu'elle remplace.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Terminer sans enregistrer le fichier"
          disabled={busy}
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.finish, pressed && styles.finishPressed, busy && styles.dim]}
        >
          <Text style={styles.finishLabel}>Terminer sans enregistrer</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingTop: space.screenTop, paddingHorizontal: space.gutter, paddingBottom: 24 },

  header: { gap: 8 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  check: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: color.accent, alignItems: 'center', justifyContent: 'center',
  },
  checkMark: { fontFamily: font.sansSemi, fontSize: 20, color: color.onAccent },
  close: {
    width: 36, height: 36, borderRadius: 18,
    borderWidth: 1, borderColor: color.outline,
    alignItems: 'center', justifyContent: 'center',
  },
  closePressed: { borderColor: color.faint },
  dim: { opacity: 0.5 },
  closeMark: { fontFamily: font.sansMedium, fontSize: 15, color: color.faint },
  title: { fontFamily: font.serif, fontSize: 32, lineHeight: 37, color: color.ink, marginTop: 10 },
  lead: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.muted },

  table: { marginTop: 26, overflow: 'hidden' },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 16, paddingHorizontal: 18,
    borderBottomWidth: 1, borderBottomColor: color.divider,
  },
  rowLast: { borderBottomWidth: 0 },
  rowLabel: { fontFamily: font.sans, fontSize: 15, color: color.inkSoft },
  rowValue: { fontFamily: font.sansSemi, fontSize: 15, color: color.ink },
  rowValueDim: { color: color.faint },

  output: {
    marginTop: 16,
    backgroundColor: color.sunken,
    borderRadius: radius.card,
    padding: 18,
    gap: 6,
  },
  outputName: { fontFamily: font.sansSemi, fontSize: 16, color: color.ink },
  outputMeta: { fontFamily: font.sans, fontSize: 13, color: color.muted },

  caution: {
    marginTop: 16,
    fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: color.fainter,
  },

  footer: { paddingHorizontal: space.gutter, paddingTop: 12, paddingBottom: 4, gap: 10 },
  finish: { alignItems: 'center', paddingVertical: 6 },
  finishPressed: { opacity: 0.6 },
  finishLabel: {
    fontFamily: font.sansMedium,
    fontSize: 14,
    color: color.muted,
    textDecorationLine: 'underline',
  },
  status: { fontFamily: font.sansMedium, fontSize: 14, lineHeight: 19, color: color.accent },
});
