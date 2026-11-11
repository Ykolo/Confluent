import path from 'node:path';

import type { NextConfig } from 'next';

const config: NextConfig = {
  // Un vrai serveur Next : Better Auth et les routes `app/api/*` en ont besoin.
  // La fusion, elle, reste dans le navigateur (`components/Confluent.tsx` est
  // un composant client) : les sauvegardes ne sont envoyées au serveur que si
  // l'utilisateur choisit de les synchroniser.
  // Le moteur vit hors de `web/`, dans `../src` : Turbopack doit voir tout le dépôt.
  turbopack: { root: path.join(__dirname, '..') },
};

export default config;
