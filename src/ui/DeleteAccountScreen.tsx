/**
 * Suppression du compte : le compte, ses sauvegardes et ses fusions partent
 * du serveur. Le mot de passe sert de confirmation explicite ; le serveur
 * l'exige aussi, et n'efface le compte qu'une fois les fichiers effacés.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteUser } from '../auth-client';
import { describeAuthError } from '../auth-errors';
import { logError, type ErrorView } from '../errors';
import { color, font, space, text } from '../theme';
import { DangerButton, ErrorNotice, Eyebrow, TextField, TextLink } from './kit';

export function DeleteAccountScreen({ email, onCancel, onDeleted }: {
  email: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const submit = async () => {
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      const { error: failure } = await deleteUser({ password });
      if (failure) {
        const view = describeAuthError(failure);
        setError(logError('suppression du compte', new Error(view.technical), view));
        return;
      }
      onDeleted();
    } catch (err) {
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError('suppression du compte', err, view));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Eyebrow>Compte Confluent</Eyebrow>
          <Text style={text.title}>Supprimer mon compte</Text>
          <Text style={text.lead}>
            Le compte <Text style={styles.email}>{email}</Text> sera supprimé, avec tout ce qu’il garde sur le serveur :
          </Text>
        </View>

        <View style={styles.list}>
          <Text style={styles.item}>•  les sauvegardes déposées dans les emplacements A et B ;</Text>
          <Text style={styles.item}>•  toutes les fusions enregistrées dans l’historique du compte.</Text>
        </View>
        <Text style={styles.note}>
          Les fichiers déjà enregistrés sur ton téléphone ne sont pas touchés. La suppression est définitive.
        </Text>

        <View style={styles.form}>
          <TextField
            label="Mot de passe, pour confirmer"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="done"
            editable={!busy}
          />

          {error && <ErrorNotice error={error} onDismiss={() => setError(null)} />}

          <DangerButton
            label={busy ? 'Suppression…' : 'Supprimer définitivement'}
            onPress={() => void submit()}
            disabled={busy || !password}
          />
          <TextLink label="Annuler" onPress={onCancel} disabled={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: space.screenTop, paddingHorizontal: space.gutter, paddingBottom: 24 },
  header: { gap: 6 },
  email: { fontFamily: font.sansSemi, color: color.inkSoft },
  list: { gap: 4, marginTop: 14 },
  item: { fontFamily: font.sans, fontSize: 15, lineHeight: 22, color: color.inkSoft },
  note: { fontFamily: font.sans, fontSize: 14, lineHeight: 20, color: color.muted, marginTop: 12 },
  form: { gap: 16, marginTop: 26 },
});
