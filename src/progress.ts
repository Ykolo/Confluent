/**
 * Avancement global de la fusion.
 *
 * `mergeBackups` signale des étapes successives, chacune avec sa propre
 * progression. Les poids ci-dessous les recomposent en une seule barre qui
 * n'avance jamais à reculons — ils viennent des durées observées sur de
 * vraies sauvegardes, les surlignages dominant largement le reste.
 */
const WEIGHTS: Record<string, number> = {
  // La décompression des deux archives bloque le thread JS plusieurs secondes
  // avant que la moindre ligne soit lue : sans poids ici, la barre resterait
  // plantée à zéro pendant tout ce temps, ce qui se lit comme un blocage.
  lecture: 0.1,
  lieux: 0.05,
  surlignages: 0.4,
  notes: 0.25,
  signets: 0.05,
  'vérification': 0.1,
  /** Recompression du fichier produit, tout aussi bloquante que la lecture. */
  archive: 0.05,
};

const ORDER = Object.keys(WEIGHTS);

/** Fraction du travail total accomplie, entre 0 et 1. */
export function overallRatio(step: string, done: number, total: number): number {
  const index = ORDER.indexOf(step);
  if (index === -1) return 0;
  const before = ORDER.slice(0, index).reduce((sum, s) => sum + WEIGHTS[s], 0);
  const within = total > 0 ? Math.min(1, done / total) : 1;
  return Math.min(1, before + WEIGHTS[step] * within);
}
