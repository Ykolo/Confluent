/** Formatage français, écrit à la main pour ne dépendre d'aucun `Intl`. */

/** Espace fine insécable : séparateur de milliers, et avant « % ». */
const THIN = '\u202F';
/** Espace insécable : entre un nombre et son unité. */
const NBSP = '\u00A0';

/** 1043 → « 1 043 ». */
export function count(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** 7340032 → « 7,0 Mo ». En dessous de 1 Mo on descend en Ko, puis en octets. */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}${NBSP}o`;
  const ko = bytes / 1024;
  if (ko < 1024) return `${ko.toFixed(0)}${NBSP}Ko`;
  return `${(ko / 1024).toFixed(1).replace('.', ',')}${NBSP}Mo`;
}

/** 0.42 → « 42 % ». */
export function percent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}${THIN}%`;
}

/**
 * Nom lisible d'un fichier enregistré hors de l'app, pour la confirmation
 * affichée. `segment` est le dernier segment de l'URI écrite (`File.name`),
 * `requested` le nom qu'on avait demandé.
 *
 * Un dossier choisi hors de l'app donne une URI `content://…/document/<id>`,
 * dont le dernier segment est un identifiant de document percent-encodé, et
 * souvent opaque : Google Drive y met `acc%3D1%3Bdoc%3DencodedZ0h4aWd…`, qui
 * s'affichait tel quel. Décoder suffit pour les fournisseurs qui y rangent un
 * chemin (`primary:Download/Fusion_2026-09-18.jwlibrary`) ; pour les autres,
 * le nom demandé est la seule chose lisible à montrer.
 */
export function savedName(segment: string, requested: string): string {
  let name = segment;
  try {
    name = decodeURIComponent(name);
  } catch {
    // Segment non décodable : il reste tel quel, et sera écarté juste après.
  }
  name = name.slice(name.lastIndexOf('/') + 1);
  // Le système peut avoir renommé le fichier pour éviter une collision
  // (« Fusion_2026-09-18 (1).jwlibrary ») : ce nom-là, on le garde.
  return name.endsWith('.jwlibrary') ? name : requested;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Jour et mois : « 05/09 ». */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Date relative telle que l'affiche l'historique : « Aujourd'hui », « Hier »,
 * « 21 juin » dans l'année en cours, « 30 déc. 2025 » au-delà.
 */
export function relativeDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Hier';
  const label = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label} ${d.getFullYear()}`;
}
