/**
 * Connexion et inscription, par e-mail et mot de passe.
 *
 * Le compte reste facultatif : la fusion marche sans. Il sert à retrouver ses
 * sauvegardes et ses fusions d'un appareil à l'autre. La session est gardée
 * dans le trousseau du téléphone et survit au redémarrage de l'app.
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { signIn, signUp } from '../auth-client';
import { describeAuthError, MIN_PASSWORD } from '../auth-errors';
import { logError, type ErrorView } from '../errors';
import { space, text } from '../theme';
import { ErrorNotice, Eyebrow, PrimaryButton, Segmented, TextField, TextLink } from './kit';

type Mode = 'sign-in' | 'sign-up';

const MODES = [
  { value: 'sign-in', label: 'Se connecter' },
  { value: 'sign-up', label: 'Créer un compte' },
] as const;

export function AccountScreen({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorView | null>(null);

  const signingUp = mode === 'sign-up';
  const ready = !!email.trim() && password.length > 0 && (!signingUp || password.length >= MIN_PASSWORD);

  const submit = async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    const address = email.trim();
    try {
      const { error: failure } = signingUp
        ? await signUp.email({
          email: address,
          password,
          // Better Auth exige un nom ; la partie locale de l'adresse en tient lieu.
          name: address.split('@')[0] || address,
        })
        : await signIn.email({ email: address, password });
      if (failure) {
        const view = describeAuthError(failure);
        setError(logError(signingUp ? 'inscription' : 'connexion', new Error(view.technical), view));
        return;
      }
      onDone();
    } catch (err) {
      const view = describeAuthError({ message: err instanceof Error ? err.message : String(err) });
      setError(logError('compte', err, view));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Eyebrow>Compte Confluent</Eyebrow>
          <Text style={text.title}>{signingUp ? 'Créer un compte' : 'Se connecter'}</Text>
          <Text style={text.lead}>
            Pour retrouver tes sauvegardes et tes fusions sur tous tes appareils. La fusion, elle, marche sans compte.
          </Text>
        </View>

        <View style={styles.form}>
          <Segmented
            options={MODES}
            value={mode}
            onChange={(next) => { setMode(next); setError(null); }}
            disabled={busy}
          />
          <TextField
            label="Adresse e-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            editable={!busy}
          />
          <TextField
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            textContentType={signingUp ? 'newPassword' : 'password'}
            hint={signingUp ? `${MIN_PASSWORD} caractères au moins.` : undefined}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />

          {error && <ErrorNotice error={error} onDismiss={() => setError(null)} />}

          <PrimaryButton
            label={busy ? 'Un instant…' : signingUp ? 'Créer mon compte' : 'Se connecter'}
            onPress={() => void submit()}
            disabled={!ready || busy}
          />
          <TextLink label="Continuer sans compte" onPress={onDone} disabled={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingTop: space.screenTop, paddingHorizontal: space.gutter, paddingBottom: 24 },
  header: { gap: 6 },
  form: { gap: 16, marginTop: 26 },
});
