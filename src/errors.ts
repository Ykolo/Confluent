/**
 * Erreurs de l'app : une phrase compréhensible pour l'écran, la trace
 * complète pour la console du poste de développement.
 *
 * Le principe est celui-ci : chaque erreur qui remonte à l'interface passe
 * par `describeError`, qui la traduit en `ErrorView` (un titre, ce qui s'est
 * passé, quoi faire). Le message technique d'origine n'est pas jeté — il est
 * conservé dans la vue et journalisé par `logError`, de sorte que l'écran
 * reste lisible sans que le diagnostic soit perdu.
 *
 * Aucun import React Native ici : `merge.ts` s'appuie dessus et doit rester
 * exécutable en Bun pour les tests.
 */

export interface ErrorView {
  /** Titre court, en gras dans l'encart. */
  title: string;
  /** Ce qui s'est passé, en une phrase, sans jargon. */
  message: string;
  /** Ce que l'utilisateur peut tenter. */
  hint?: string;
  /** Message d'origine, journalisé tel quel et replié sous l'encart. */
  technical: string;
}

/**
 * Erreur déjà rédigée pour l'utilisateur. Toute erreur levée sciemment par
 * l'app en est une : `describeError` la laisse alors passer sans traduction.
 */
export class AppError extends Error {
  readonly title: string;
  readonly hint?: string;
  readonly technical: string;

  constructor(view: Omit<ErrorView, 'technical'> & { technical?: string; cause?: unknown }) {
    super(view.message);
    this.name = 'AppError';
    this.title = view.title;
    this.hint = view.hint;
    this.technical = view.technical ?? describeRaw(view.cause) ?? view.message;
    // `cause` n'est pas dans la cible ES de Hermes : on l'attache à la main
    // pour que `logError` puisse dérouler la chaîne.
    if (view.cause !== undefined) (this as { cause?: unknown }).cause = view.cause;
  }

  get view(): ErrorView {
    return { title: this.title, message: this.message, hint: this.hint, technical: this.technical };
  }
}

function describeRaw(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Déroule `cause` pour obtenir le texte complet, y compris les erreurs natives. */
function fullText(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 8; depth++) {
    parts.push(describeRaw(current) ?? '');
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join('\n');
}

/**
 * Traductions, de la plus spécifique à la plus générale : la première qui
 * reconnaît le texte de l'erreur gagne.
 */
const RULES: { match: RegExp; view: Omit<ErrorView, 'technical'> }[] = [
  {
    // Le sélecteur natif ne garde qu'une sélection en cours, et ne la libère
    // qu'au retour de l'activité Android. Si ce retour n'arrive jamais, seul
    // un redémarrage de l'app débloque le module — d'où le conseil.
    match: /document picking in progress|PickingInProgress/i,
    view: {
      title: 'Sélecteur déjà ouvert',
      message: 'Le système considère qu’une sélection de fichier est encore en cours.',
      hint: 'Ferme complètement l’app puis rouvre-la : le sélecteur reste bloqué tant qu’elle tourne.',
    },
  },
  {
    match: /Failed to read the selected document|FailedToReadDocument/i,
    view: {
      title: 'Fichier illisible',
      message: 'Le système n’a pas rendu de fichier exploitable pour cette sélection.',
      hint: 'Choisis la sauvegarde depuis « Fichiers » ou « Téléchargements » plutôt que depuis une app de stockage en ligne.',
    },
  },
  {
    // Le cas typique : la base ouverte n'est pas celle qu'on a écrite, ou son
    // schéma n'est pas celui attendu.
    match: /no such table|no such column|has no column/i,
    view: {
      title: 'Sauvegarde illisible',
      message: 'La base de données de cette sauvegarde est vide ou ne contient pas les tables attendues.',
      hint: 'Réexporte la sauvegarde depuis JW Library, puis relance l’app.',
    },
  },
  {
    match: /malformed|not a database|file is encrypted|integrity_check|corrompue/i,
    view: {
      title: 'Sauvegarde abîmée',
      message: 'Le fichier est bien une sauvegarde, mais son contenu est endommagé.',
      hint: 'Réexporte-la depuis JW Library : un transfert interrompu suffit à l’abîmer.',
    },
  },
  {
    match: /disk (is )?full|SQLITE_FULL|ENOSPC|no space left|not enough space/i,
    view: {
      title: 'Stockage plein',
      message: 'Il n’y a plus assez de place sur l’appareil pour préparer la fusion.',
      hint: 'Libère quelques centaines de mégaoctets, puis réessaie.',
    },
  },
  {
    match: /SQLITE_CANTOPEN|unable to open database|cannot open|ensureDatabasePathExists/i,
    view: {
      title: 'Espace de travail inaccessible',
      message: 'L’app n’a pas pu créer les fichiers temporaires dont elle a besoin.',
      hint: 'Ferme puis rouvre l’app ; si cela persiste, vérifie l’espace de stockage disponible.',
    },
  },
  {
    match: /permission|EACCES|EPERM|not permitted/i,
    view: {
      title: 'Accès au fichier refusé',
      message: 'Le système n’autorise pas l’app à lire le fichier choisi.',
      hint: 'Choisis-le depuis « Fichiers » ou « Téléchargements » plutôt que depuis une autre app.',
    },
  },
  {
    match: /ENOENT|no such file|does not exist|introuvable/i,
    view: {
      title: 'Fichier introuvable',
      message: 'Le fichier a été déplacé ou supprimé depuis que tu l’as choisi.',
      hint: 'Sélectionne-le à nouveau.',
    },
  },
  {
    match: /zip|central directory|unexpected EOF|invalid (data|header)|crc|inflate/i,
    view: {
      title: 'Fichier non reconnu',
      message: 'Ce fichier n’est pas une archive .jwlibrary exploitable.',
      hint: 'Vérifie que tu as bien choisi une sauvegarde exportée par JW Library.',
    },
  },
  {
    match: /out of memory|OutOfMemory|allocation failed|maximum call stack/i,
    view: {
      title: 'Mémoire insuffisante',
      message: 'La fusion demande plus de mémoire que l’appareil n’en a de libre.',
      hint: 'Ferme les autres applications, puis réessaie.',
    },
  },
];

/** Vrai si l'erreur n'est qu'une annulation de l'utilisateur : rien à afficher. */
export function isCancellation(err: unknown): boolean {
  return /cancel|abort|dismiss/i.test(fullText(err));
}

/** Traduit n'importe quelle erreur en un encart affichable. */
export function describeError(err: unknown): ErrorView {
  if (err instanceof AppError) return err.view;

  const text = fullText(err);
  const technical = describeRaw(err) ?? 'Erreur inconnue';
  const rule = RULES.find((r) => r.match.test(text));
  if (rule) return { ...rule.view, technical };

  return {
    title: 'Quelque chose s’est mal passé',
    message: 'L’opération n’a pas pu être menée à son terme.',
    hint: 'Réessaie ; le détail technique ci-dessous aide à comprendre pourquoi.',
    technical,
  };
}

/**
 * Garde-temps sur un appel natif.
 *
 * Un module natif qui ne rend jamais la main laisse l'app figée sans rien
 * afficher : les boutons restent désactivés, aucune erreur ne remonte, et le
 * terminal se tait. Plutôt que ce silence, on rejette au bout de `ms` avec le
 * nom de l'étape en cause. La minuterie est fiable ici parce que les appels
 * SQLite d'Expo s'exécutent hors du thread JS : la boucle d'événements reste
 * libre de la déclencher.
 *
 * Attention : cela n'interrompt pas le travail natif, cela cesse seulement de
 * l'attendre.
 *
 * `view` rédige l'erreur autrement quand l'appel surveillé n'est pas une
 * requête SQLite — le sélecteur de documents, par exemple, se bloque pour de
 * tout autres raisons et demande un autre conseil.
 */
export function withTimeout<T>(
  label: string,
  ms: number,
  run: () => Promise<T>,
  view: Omit<ErrorView, 'technical'> = {
    title: 'Opération bloquée',
    message: 'L’app a cessé de répondre pendant l’accès à la base de données.',
    hint: 'Ferme puis rouvre l’app et réessaie ; le détail ci-dessous indique l’étape en cause.',
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AppError({
        ...view,
        technical: `${label} : aucune réponse après ${Math.round(ms / 1000)} s`,
      }));
    }, ms);

    run().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ---------------------------------------------------------------------------
// Journal — visible dans le terminal Expo, sur le poste de développement
// ---------------------------------------------------------------------------

const TAG = 'Confluent';

/**
 * Heure locale, au format `HH:MM:SS.mmm`.
 *
 * Le terminal Expo n'horodate pas `console.log` : deux lignes séparées par
 * trente secondes de silence s'y lisent comme deux lignes consécutives. C'est
 * ce qui rend un journal inexploitable quand l'app paraît figée — on ne voit ni
 * où le silence commence, ni combien de temps il a duré, et les durées mesurées
 * par `timed` ne disent rien du temps passé *entre* les étapes.
 *
 * Le format est celui d'`adb logcat` à dessein : quand le diagnostic doit
 * descendre jusqu'au natif, les deux journaux s'alignent ligne à ligne au lieu
 * de devoir être recoupés à la main.
 */
function clock(): string {
  const now = new Date();
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    + `.${pad(now.getMilliseconds(), 3)}`;
}

/**
 * Chronomètre une étape et la journalise avec sa durée.
 *
 * Un journal qui dit seulement « fait » ne distingue pas une étape rapide
 * d'une étape qui a duré une minute. Quand l'app paraît figée, c'est
 * exactement ce qu'il faut savoir : laquelle a pris le temps.
 */
export async function timed<T>(scope: string, label: string, run: () => Promise<T> | T): Promise<T> {
  const started = Date.now();
  try {
    return await run();
  } finally {
    logInfo(scope, `${label} — ${Date.now() - started} ms`);
  }
}

/**
 * Chronomètre à tours, pour découper une suite d'appels natifs synchrones.
 *
 * `timed` entoure une opération ; celui-ci mesure chaque maillon d'une chaîne
 * sans avoir à l'éclater en fonctions. Chaque `lap()` journalise le temps
 * écoulé depuis le tour précédent.
 */
export function stopwatch(scope: string, subject: string): (what: string) => void {
  let mark = Date.now();
  return (what: string) => {
    const elapsed = Date.now() - mark;
    mark = Date.now();
    logInfo(scope, `${subject} · ${what} — ${elapsed} ms`);
  };
}

/** Étape franchie : une ligne dans le terminal, rien à l'écran. */
export function logInfo(scope: string, message: string, data?: unknown): void {
  if (data === undefined) console.log(`${clock()} [${TAG}] ${scope} — ${message}`);
  else console.log(`${clock()} [${TAG}] ${scope} — ${message}`, data);
}

/**
 * Erreur complète dans le terminal : le titre affiché à l'utilisateur, le
 * message technique, puis la pile et toute la chaîne de causes. C'est ce
 * bloc, et non l'écran du téléphone, qui sert au diagnostic.
 */
export function logError(scope: string, err: unknown, view = describeError(err)): ErrorView {
  const lines = [
    // Seule la première ligne est horodatée : les suivantes appartiennent au
    // même bloc, et les préfixer noierait la pile sous des heures identiques.
    `${clock()} [${TAG}] ✖ ${scope}`,
    `  affiché : ${view.title} — ${view.message}`,
    `  cause   : ${view.technical}`,
  ];

  let current: unknown = err;
  for (let depth = 0; current && depth < 8; depth++) {
    if (current instanceof Error && current.stack) {
      lines.push(...current.stack.split('\n').map((l) => `  ${depth > 0 ? '↳ ' : ''}${l.trim()}`));
    } else if (depth > 0) {
      lines.push(`  ↳ ${describeRaw(current)}`);
    }
    current = (current as { cause?: unknown }).cause;
  }

  console.error(lines.join('\n'));
  return view;
}

/**
 * Filet de sécurité : une erreur qui échappe à un `try` (rejet de promesse non
 * traité, exception hors rendu) part quand même dans le terminal au lieu de
 * disparaître. À appeler une fois au démarrage.
 */
export function installGlobalErrorLogging(): void {
  const utils = (globalThis as { ErrorUtils?: {
    getGlobalHandler(): (err: unknown, fatal?: boolean) => void;
    setGlobalHandler(handler: (err: unknown, fatal?: boolean) => void): void;
  } }).ErrorUtils;

  if (utils && !(utils as { __confluent?: boolean }).__confluent) {
    const previous = utils.getGlobalHandler();
    utils.setGlobalHandler((err, fatal) => {
      logError(fatal ? 'erreur fatale' : 'erreur non rattrapée', err);
      previous(err, fatal);
    });
    (utils as { __confluent?: boolean }).__confluent = true;
  }

  const hermes = globalThis as { HermesInternal?: { hasPromise?: unknown } };
  if (hermes.HermesInternal) {
    // Hermes signale les rejets non traités par cet événement ; il n'existe
    // pas partout, d'où le garde.
    const add = (globalThis as { addEventListener?: (t: string, l: (e: unknown) => void) => void })
      .addEventListener;
    add?.call(globalThis, 'unhandledrejection', (event: unknown) => {
      logError('promesse rejetée sans traitement', (event as { reason?: unknown })?.reason ?? event);
    });
  }
}
