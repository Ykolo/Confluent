import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Newsreader } from 'next/font/google';
import type { CSSProperties, ReactNode } from 'react';

import { color, radius } from '@core/theme';

import './globals.css';

const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
});

const serif = Newsreader({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-serif',
});

export const metadata: Metadata = {
  title: 'Confluent',
  description: 'Fusionner deux sauvegardes JW Library, sans rien perdre. Tout se passe dans votre navigateur.',
};

export const viewport: Viewport = {
  themeColor: color.screen,
};

/**
 * Les jetons de `src/theme.ts`, exposés en variables CSS : l'app mobile et le
 * site lisent les mêmes valeurs, un écart avec le design se corrige toujours
 * à un seul endroit.
 */
const tokens = {
  ...Object.fromEntries(Object.entries(color).map(([k, v]) => [`--${k}`, v])),
  ...Object.fromEntries(Object.entries(radius).map(([k, v]) => [`--radius-${k}`, `${v}px`])),
} as CSSProperties;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${sans.variable} ${serif.variable}`} style={tokens}>
      <body>{children}</body>
    </html>
  );
}
