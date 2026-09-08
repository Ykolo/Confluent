/** Écran 3 — Historique : les fusions déjà faites sur cet appareil. */
import { FlatList, StyleSheet, Text, View } from 'react-native';

import * as fmt from '../format';
import type { HistoryEntry } from '../history';
import { color, font, space } from '../theme';
import { Card } from './kit';

function Entry({ entry }: { entry: HistoryEntry }) {
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
    </Card>
  );
}

export function HistoryScreen({ entries }: { entries: HistoryEntry[] }) {
  return (
    <FlatList
      data={entries}
      keyExtractor={(entry) => entry.id}
      renderItem={({ item }) => <Entry entry={item} />}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Fusions précédentes</Text>
          <Text style={styles.lead}>Conservées sur cet appareil.</Text>
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

  gap: { height: 10 },
  entry: { paddingVertical: 17, paddingHorizontal: 18, gap: 8 },
  entryHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  entryName: { flex: 1, fontFamily: font.sansSemi, fontSize: 16, color: color.ink },
  entryDate: { fontFamily: font.sans, fontSize: 13, color: color.fainter },
  entrySources: { fontFamily: font.sans, fontSize: 13, lineHeight: 19, color: color.muted },
  entryStats: { flexDirection: 'row', gap: 14 },
  entryItems: { fontFamily: font.sans, fontSize: 13, color: color.inkSoft },
  entrySize: { fontFamily: font.sans, fontSize: 13, color: color.fainter },

  empty: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.fainter },
});
