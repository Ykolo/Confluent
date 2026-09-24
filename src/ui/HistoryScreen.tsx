/** Écran 3 — Historique : les fusions déjà faites sur cet appareil. */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ErrorView } from '../errors';
import * as fmt from '../format';
import type { HistoryEntry } from '../history';
import { color, font, space } from '../theme';
import { Card, ErrorNotice } from './kit';

function Action({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.actionPressed, disabled && styles.actionDisabled]}
    >
      <Text style={styles.action}>{label}</Text>
    </Pressable>
  );
}

function Entry({ entry, stored, busy, onSave, onShare }: {
  entry: HistoryEntry;
  stored: boolean;
  busy: boolean;
  onSave: () => void;
  onShare: () => void;
}) {
  return (
    <Card style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryName} numberOfLines={2}>{entry.name}</Text>
        <Text style={styles.entryDate}>{fmt.relativeDate(entry.createdAt)}</Text>
      </View>
      <Text style={styles.entrySources}>{entry.sources}</Text>
      <View style={styles.entryStats}>
        <Text style={styles.entryItems}>{fmt.count(entry.notes)} notes</Text>
        <Text style={styles.entrySize}>{fmt.size(entry.size)}</Text>
      </View>
      {stored ? (
        <View style={styles.actions}>
          <Action label="Enregistrer" onPress={onSave} disabled={busy} />
          <Action label="Partager" onPress={onShare} disabled={busy} />
        </View>
      ) : (
        <Text style={styles.gone}>Fichier non conservé</Text>
      )}
    </Card>
  );
}

export interface HistoryScreenProps {
  entries: HistoryEntry[];
  /** Identifiants des fusions dont le fichier est encore conservé. */
  stored: Set<string>;
  busy: boolean;
  /** Confirmation d'enregistrement. */
  status: string | null;
  error: ErrorView | null;
  onDismissError: () => void;
  onSave: (entry: HistoryEntry) => void;
  onShare: (entry: HistoryEntry) => void;
}

export function HistoryScreen({
  entries, stored, busy, status, error, onDismissError, onSave, onShare,
}: HistoryScreenProps) {
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.id}
      renderItem={({ item }) => (
        <Entry
          entry={item}
          stored={stored.has(item.id)}
          busy={busy}
          onSave={() => onSave(item)}
          onShare={() => onShare(item)}
        />
      )}
      extraData={{ stored, busy }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Fusions précédentes</Text>
          <Text style={styles.lead}>Conservées sur cet appareil.</Text>
          {error && (
            <View style={styles.notice}>
              <ErrorNotice error={error} onDismiss={onDismissError} />
            </View>
          )}
          {status && !error && <Text style={[styles.status, styles.notice]}>{status}</Text>}
        </View>
      }
      ListEmptyComponent={
        <Text style={styles.empty}>
          Aucune fusion pour l’instant. Les fichiers produits apparaîtront ici.
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: space.screenTop,
    paddingHorizontal: space.gutter,
    paddingBottom: 24,
  },
  header: { marginBottom: 24 },
  title: { fontFamily: font.serif, fontSize: 32, color: color.ink },
  lead: { marginTop: 8, fontFamily: font.sans, fontSize: 15, color: color.muted },
  notice: { marginTop: 16 },
  status: { fontFamily: font.sansMedium, fontSize: 14, lineHeight: 19, color: color.accent },

  gap: { height: 10 },
  entry: { paddingVertical: 17, paddingHorizontal: 18, gap: 8 },
  entryHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  entryName: { flex: 1, fontFamily: font.sansSemi, fontSize: 16, color: color.ink },
  entryDate: { fontFamily: font.sans, fontSize: 13, color: color.fainter },
  entrySources: { fontFamily: font.sans, fontSize: 13, lineHeight: 19, color: color.muted },
  entryStats: { flexDirection: 'row', gap: 14 },
  entryItems: { fontFamily: font.sans, fontSize: 13, color: color.inkSoft },
  entrySize: { fontFamily: font.sans, fontSize: 13, color: color.fainter },

  actions: { flexDirection: 'row', gap: 18, marginTop: 4 },
  action: {
    fontFamily: font.sansSemi,
    fontSize: 14,
    color: color.accent,
    textDecorationLine: 'underline',
  },
  actionPressed: { opacity: 0.6 },
  actionDisabled: { opacity: 0.5 },
  gone: { marginTop: 4, fontFamily: font.sans, fontSize: 13, color: color.fainter },

  empty: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.fainter },
});
