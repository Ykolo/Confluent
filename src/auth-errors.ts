/**
 * Erreurs de connexion et d'inscription, traduites en `ErrorView` pour
 * s'afficher dans le même encart que les autres erreurs du site.
 *
 * Better Auth renvoie un code stable (`INVALID_EMAIL_OR_PASSWORD`…) et un
 * message en anglais : on traduit le code, et le message part dans le détail
 * technique.
 */
import type { ErrorView } from './errors';

/** Ce que les appels du client Better Auth renvoient dans `error`. */
export interface AuthFailure {
  code?: string;
  message?: string;
  status?: number;
}

/** Longueur minimale d'un mot de passe, celle de Better Auth par défaut. */
export const MIN_PASSWORD = 8;

const VIEWS: Record<string, Omit<ErrorView, 'technical'>> = {
  INVALID_EMAIL_OR_PASSWORD: {
    title: 'Connexion refusée',
    message: 'L’adresse e-mail ou le mot de passe ne correspond pas.',
    hint: 'Vérifie les deux, ou crée un compte si tu n’en as pas encore.',
  },
  USER_ALREADY_EXISTS: {
    title: 'Adresse déjà utilisée',
    message: 'Un compte existe déjà avec cette adresse e-mail.',
    hint: 'Connecte-toi plutôt.',
  },
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: {
    title: 'Adresse déjà utilisée',
    message: 'Un compte existe déjà avec cette adresse e-mail.',
    hint: 'Connecte-toi, ou utilise une autre adresse.',
  },
  INVALID_EMAIL: {
    title: 'Adresse invalide',
    message: 'Cette adresse e-mail n’est pas valide.',
    hint: 'Vérifie qu’elle est bien écrite.',
  },
  PASSWORD_TOO_SHORT: {
    title: 'Mot de passe trop court',
    message: `Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`,
  },
  PASSWORD_TOO_LONG: {
    title: 'Mot de passe trop long',
    message: 'Le mot de passe dépasse la longueur autorisée.',
    hint: 'Choisis-en un plus court.',
  },
};

export function describeAuthError(err: AuthFailure | null | undefined): ErrorView {
  const technical = [err?.status, err?.code, err?.message].filter(Boolean).join(' · ') || 'erreur inconnue';
  const known = err?.code ? VIEWS[err.code] : undefined;
  if (known) return { ...known, technical };
  if (err?.status === 429) {
    return {
      title: 'Trop de tentatives',
      message: 'Trop d’essais en peu de temps.',
      hint: 'Patiente une minute, puis réessaie.',
      technical,
    };
  }
  if (!err?.status) {
    return {
      title: 'Pas de connexion',
      message: 'Le serveur de Confluent n’a pas pu être joint.',
      hint: 'Vérifie ta connexion internet, puis réessaie.',
      technical,
    };
  }
  return {
    title: 'Connexion impossible',
    message: 'Le serveur n’a pas pu traiter la demande.',
    hint: 'Réessaie dans quelques instants.',
    technical,
  };
}
