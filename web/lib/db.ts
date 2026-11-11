/**
 * Client Prisma du serveur, sur l'adaptateur Neon.
 *
 * Réservé au code serveur de `web/` (routes `app/api/*`, Better Auth). Rien
 * sous `src/` ne doit l'importer : le bundle Expo n'a pas à l'atteindre.
 *
 * L'URL poolée (`DATABASE_URL`, hôte en `-pooler`) supporte les nombreuses
 * connexions courtes des fonctions Vercel. Les migrations passent, elles, par
 * l'URL directe (voir `prisma.config.ts`).
 */
import 'server-only';

import { PrismaNeon } from '@prisma/adapter-neon';

import { PrismaClient } from '@/generated/prisma/client';

function create() {
  // Pas d'erreur ici si `DATABASE_URL` manque : `next build` importe les routes
  // sans les variables d'environnement (en CI notamment). L'adaptateur n'ouvre
  // son pool qu'à la première requête, qui échoue alors clairement.
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL }) });
}

// En développement, chaque rechargement à chaud réévalue ce module : on garde
// le client sur `globalThis` pour ne pas ouvrir un nouveau pool à chaque fois.
const cache = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = cache.prisma ?? create();
if (process.env.NODE_ENV !== 'production') cache.prisma = prisma;
