/**
 * Jetons repris du canvas « Fusion Sauvegardes ».
 *
 * Les valeurs sont recopiées telles quelles depuis la maquette : toute
 * couleur ou tout rayon utilisé dans l'app doit passer par ce fichier, pour
 * qu'un écart avec le design se corrige à un seul endroit.
 */

export const color = {
  /** Fond d'écran de l'app. */
  screen: '#FBF9F5',
  /** Fond du canvas de la maquette, réutilisé pour la barre d'état. */
  canvas: '#EFEBE4',
  /** Cartes. */
  card: '#FFFFFF',
  /** Surfaces creuses : segments, encart « fichier obtenu », barre d'onglets. */
  sunken: '#F1EDE5',

  border: '#E3DDD1',
  /** Séparateur interne d'une carte, plus discret que `border`. */
  divider: '#F0EBE1',
  /** Contour en pointillés / boutons secondaires. */
  outline: '#CFC7B8',

  ink: '#1B1A16',
  inkSoft: '#4C4739',
  muted: '#7C7565',
  faint: '#8A8272',
  fainter: '#9A9382',

  accent: '#2E5A46',
  accentPressed: '#1D3B2E',
  onAccent: '#FBF9F5',

  danger: '#8C3A2B',
  /** Fond et contour de l'encart d'erreur — la maquette n'en montrait pas,
   *  ces deux teintes sont `danger` désaturé sur le fond d'écran. */
  dangerSurface: '#FAF0EC',
  dangerBorder: '#E7CEC6',
} as const;

export const radius = {
  card: 18,
  button: 16,
  segment: 14,
  segmentItem: 11,
  badge: 999,
} as const;

export const space = {
  /** Marge horizontale des écrans (26px dans la maquette). */
  gutter: 26,
  screenTop: 34,
  screenBottom: 34,
} as const;

export const font = {
  sans: 'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  sansSemi: 'InstrumentSans_600SemiBold',
  serif: 'Newsreader_400Regular',
} as const;

/** Styles de texte récurrents de la maquette. */
export const text = {
  /** Sur-titre en capitales espacées. */
  eyebrow: {
    fontFamily: font.sansSemi,
    fontSize: 12,
    letterSpacing: 1.7,
    textTransform: 'uppercase',
  },
  title: { fontFamily: font.serif, fontSize: 32, lineHeight: 37, color: color.ink },
  titleLarge: { fontFamily: font.serif, fontSize: 34, lineHeight: 38, color: color.ink },
  lead: { fontFamily: font.sans, fontSize: 15, lineHeight: 21, color: color.muted },
  body: { fontFamily: font.sans, fontSize: 15, color: color.inkSoft },
  strong: { fontFamily: font.sansSemi, fontSize: 17, color: color.ink },
  meta: { fontFamily: font.sans, fontSize: 13, color: color.muted },
} as const;

export const shadow = {
  /** Ombre légère de la pastille active d'un segment. */
  segmentThumb: {
    shadowColor: '#1B1A16',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
} as const;
