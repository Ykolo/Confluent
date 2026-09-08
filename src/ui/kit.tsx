/**
 * Briques d'interface reprises du canvas « Fusion Sauvegardes ». Les états
 * `hover` de la maquette deviennent des états pressés.
 */
import { useState, type ReactNode } from 'react';
import {
  Pressable, StyleSheet, Text, View,
  type StyleProp, type TextStyle, type ViewStyle,
} from 'react-native';

import type { ErrorView } from '../errors';
import { color, font, radius, shadow, text } from '../theme';

export function Eyebrow({ children, tone = color.fainter, style }: {
  children: ReactNode;
  tone?: string;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.eyebrow, { color: tone }, style]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Button({ label, onPress, disabled, base, pressed, labelStyle }: {
  label: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  base: StyleProp<ViewStyle>;
  pressed: StyleProp<ViewStyle>;
  labelStyle: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed: isDown }) => [base, isDown && pressed, disabled && styles.disabled]}
    >
      {typeof label === 'string' ? <Text style={labelStyle}>{label}</Text> : label}
    </Pressable>
  );
}

export function PrimaryButton(props: { label: ReactNode; onPress?: () => void; disabled?: boolean }) {
  return (
    <Button
      {...props}
      base={styles.primary}
      pressed={styles.primaryPressed}
      labelStyle={styles.primaryLabel}
    />
  );
}

export function SecondaryButton(props: { label: ReactNode; onPress?: () => void; disabled?: boolean }) {
  return (
    <Button
      {...props}
      base={styles.secondary}
      pressed={styles.secondaryPressed}
      labelStyle={styles.secondaryLabel}
    />
  );
}

export function DashedButton(props: { label: ReactNode; onPress?: () => void; disabled?: boolean }) {
  return (
    <Button
      {...props}
      base={styles.dashed}
      pressed={styles.dashedPressed}
      labelStyle={styles.dashedLabel}
    />
  );
}

/** Séparateur « — + — » entre les deux fichiers. */
export function PlusRule() {
  return (
    <View style={styles.plusRule}>
      <View style={styles.rule} />
      <Text style={styles.plus}>+</Text>
      <View style={styles.rule} />
    </View>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Segment à pastille glissante : choix du traitement des doublons, onglets. */
export function Segmented<T extends string>({ options, value, onChange, variant = 'compact', disabled }: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'compact' | 'tabs';
  disabled?: boolean;
}) {
  const tabs = variant === 'tabs';
  return (
    <View style={tabs ? styles.tabTrack : styles.segmentTrack}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: !!disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={[
              tabs ? styles.tabItem : styles.segmentItem,
              active && (tabs ? styles.tabItemActive : styles.segmentItemActive),
            ]}
          >
            <Text
              style={[
                tabs ? styles.tabLabel : styles.segmentLabel,
                active && (tabs ? styles.tabLabelActive : styles.segmentLabelActive),
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Barre d'avancement de la fusion. */
export function ProgressBar({ ratio }: { ratio: number }) {
  const width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` as const;
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width }]} />
    </View>
  );
}

/**
 * Encart d'erreur : ce qui s'est passé, puis quoi faire. Le message technique
 * n'est pas affiché d'emblée — il est là pour le rapport de bug, replié
 * derrière « Détail technique », et déjà écrit en entier dans la console du
 * poste de développement.
 */
export function ErrorNotice({ error, onDismiss }: {
  error: ErrorView;
  onDismiss?: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.notice} accessibilityRole="alert">
      <View style={styles.noticeHead}>
        <Text style={[styles.noticeTitle, styles.noticeTitleFlex]}>{error.title}</Text>
        {onDismiss && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fermer le message d’erreur"
            hitSlop={10}
            onPress={onDismiss}
            style={({ pressed }) => [styles.noticeClose, pressed && styles.noticeClosePressed]}
          >
            <Text style={styles.noticeCloseMark}>✕</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.noticeMessage}>{error.message}</Text>
      {error.hint && <Text style={styles.noticeHint}>{error.hint}</Text>}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={open ? 'Masquer le détail technique' : 'Afficher le détail technique'}
        hitSlop={8}
        onPress={() => setOpen((v) => !v)}
      >
        <Text style={styles.noticeToggle}>
          {open ? 'Masquer le détail' : 'Détail technique'}
        </Text>
      </Pressable>
      {open && <Text style={styles.noticeTechnical} selectable>{error.technical}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: font.sansSemi,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
  },

  disabled: { opacity: 0.5 },

  primary: {
    backgroundColor: color.accent,
    borderRadius: radius.button,
    paddingVertical: 19,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: { backgroundColor: color.accentPressed },
  primaryLabel: { fontFamily: font.sansSemi, fontSize: 17, color: color.onAccent },

  secondary: {
    borderWidth: 1,
    borderColor: color.outline,
    borderRadius: radius.button,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryPressed: { borderColor: color.faint },
  secondaryLabel: { fontFamily: font.sansMedium, fontSize: 16, color: color.inkSoft },

  dashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.outline,
    borderRadius: radius.card,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashedPressed: { borderColor: color.accent },
  dashedLabel: { fontFamily: font.sansMedium, fontSize: 15, color: color.muted },

  notice: {
    backgroundColor: color.dangerSurface,
    borderWidth: 1,
    borderColor: color.dangerBorder,
    borderRadius: radius.card,
    padding: 14,
    gap: 6,
  },
  noticeHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  noticeTitle: { fontFamily: font.sansSemi, fontSize: 15, color: color.danger },
  noticeTitleFlex: { flex: 1 },
  noticeClose: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -2,
  },
  noticeClosePressed: { backgroundColor: color.dangerBorder },
  noticeCloseMark: { fontFamily: font.sansMedium, fontSize: 13, color: color.danger },
  noticeMessage: { fontFamily: font.sans, fontSize: 14, lineHeight: 19, color: color.inkSoft },
  noticeHint: { fontFamily: font.sans, fontSize: 13, lineHeight: 18, color: color.muted },
  noticeToggle: {
    fontFamily: font.sansMedium,
    fontSize: 12,
    letterSpacing: 0.3,
    color: color.faint,
    textDecorationLine: 'underline',
    paddingTop: 2,
  },
  noticeTechnical: { fontFamily: font.sans, fontSize: 12, lineHeight: 17, color: color.fainter },

  plusRule: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6 },
  rule: { height: 1, flex: 1, backgroundColor: color.border },
  plus: { fontFamily: font.serif, fontSize: 20, color: color.fainter },

  segmentTrack: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: color.sunken,
    borderRadius: radius.segment,
    padding: 4,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 8,
    borderRadius: radius.segmentItem,
  },
  segmentItemActive: { backgroundColor: color.card, ...shadow.segmentThumb },
  segmentLabel: { fontFamily: font.sansMedium, fontSize: 14, color: color.faint },
  segmentLabelActive: { fontFamily: font.sansSemi, color: color.ink },

  tabTrack: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: color.sunken,
    borderRadius: radius.button,
    padding: 5,
  },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  tabItemActive: { backgroundColor: color.card, ...shadow.segmentThumb },
  tabLabel: { fontFamily: font.sansMedium, fontSize: 15, color: color.faint },
  tabLabelActive: { fontFamily: font.sansSemi, color: color.ink },

  progressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: color.sunken,
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 999, backgroundColor: color.accent },
});

export { text };
