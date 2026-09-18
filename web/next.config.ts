import path from 'node:path';

import type { NextConfig } from 'next';

const config: NextConfig = {
  // Aucun serveur : la fusion se fait entièrement dans le navigateur, et les
  // sauvegardes ne quittent jamais la machine. Le site se réduit donc à des
  // fichiers statiques, publiables n'importe où.
  output: 'export',
  // Le moteur vit hors de `web/`, dans `../src` : Turbopack doit voir tout le dépôt.
  turbopack: { root: path.join(__dirname, '..') },
};

export default config;
