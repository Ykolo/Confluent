/**
 * Écran 3 — Historique.
 *
 * Déconnecté : les fusions faites sur cet appareil. Connecté : celles du
 * compte, depuis n'importe quel appareil, à télécharger puis partager (vers
 * JW Library, pour restaurer) ou à supprimer.
 */
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ErrorView } from '../errors';
import * as fmt from '../format';
import type { HistoryEntry } from '../history';
import { color, font, space } from '../theme';
import { Card, ErrorNotice, SecondaryButton } from './kit';

function Action({ label, onPress, disabled, quiet }: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  quiet?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.actionPressed, disabled && styles.actionDisabled]}
    >
      <Text style={[styles.action, quiet && styles.actionQuiet]}>{label}</Text>
    </Pressable>
  );
}

function Entry({ entry, stored, busy, onSave, onShare, remote }: {
  entry: HistoryEntry;
  stored: boolean;
  busy: boolean;
  onSave: () => void;
  onShare: () => void;
  remote?: RemoteHistory;
}) {
  return (
    <Card style={styles.entry}>
      <View style={styles.entryHead}>
        <Text style={styles.entryName} numberOfLines={2}>{entry.name}</Text>
        <Text style={styles.entryDate}>{fmt.relativeDate(entry.createdAt)}</Text>
      </View>
      <Text style={styles.entrySources}>{entry.sources}</Text>
      <View style={styles.entryStats}>
        <Text style={styles.entryItems}>{fmt.count(entry.notes)} {entry.notes > 1 ? 'notes' : 'note'}</Text>
        <Text style={styles.entrySize}>{fmt.size(entry.size)}</Text>
      </View>
      {remote && entry.remoteId ? (
        <View style={styles.actions}>
          <Action label="Télécharger et partager" onPress={() => remote.onDownload(entry)} disabled={busy} />
          <Action label="Supprimer" onPress={() => remote.onDelete(entry)} disabled={busy} quiet />
        </View>
      ) : stored ? (
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

/** L'historique du compte, quand un compte est connecté : `entries` vient alors du serveur. */
export interface RemoteHistory {
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onDownload: (entry: HistoryEntry) => void;
  onDelete: (entry: HistoryEntry) => void;
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
  remote?: RemoteHistory;
}

export function HistoryScreen({
  entries, stored, busy, status, error, onDismissError, onSave, onShare, remote,
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
          remote={remote}
        />
      )}
      extraData={{ stored, busy, remote }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Fusions précédentes</Text>
          <Text style={styles.lead}>{remote ? 'Enregistrées dans ton compte.' : 'Conservées sur cet appareil.'}</Text>
          {error && (
            <View style={styles.notice}>
              <ErrorNotice error={error} onDismiss={onDismissError} />
            </View>
          )}
          {status && !error && <Text style={[styles.status, styles.notice]}>{status}</Text>}
        </View>
      }
      ListEmptyComponent={remote?.loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={color.accent} />
          <Text style={styles.empty}>Chargement de l’historique…</Text>
        </View>
      ) : (
        <Text style={styles.empty}>
          {remote
            ? 'Aucune fusion dans ton compte pour l’instant. Les prochaines y seront enregistrées.'
            : 'Aucune fusion pour l’instant. Les fichiers produits apparaîtront ici.'}
        </Text>
      )}
      ListFooterComponent={remote?.hasMore ? (
        <View style={styles.more}>
          <SecondaryButton
            label={remote.loadingMore ? 'Chargement…' : 'Afficher les plus anciennes'}
            onPress={remote.onMore}
            disabled={remote.loadingMore || busy}
          />
        </View>
      ) : null}
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
  actionQuiet: { fontFamily: font.sansMedium, color: color.faint },
  actionPressed: { opacity: 0.6 },
  actionDisabled: { opacity: 0.5 },
  gone: { marginTop: 4, fontFamily: font.sans, fontSize: 13, color: color.fainter },

  empty: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.fainter },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  more: { marginTop: 16 },
});
