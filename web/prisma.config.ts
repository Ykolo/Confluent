/**
 * Configuration de la CLI Prisma (generate, migrate).
 *
 * Prisma 7 ne lit plus les fichiers `.env` : on charge celui de Next quand il
 * existe, c'est-à-dire en local. Sur Vercel, les variables sont déjà dans
 * l'environnement.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig } from 'prisma/config';

const local = path.join(__dirname, '.env.local');
if (existsSync(local)) process.loadEnvFile(local);

// URL directe (hôte sans `-pooler`) : une migration a besoin d'une vraie
// session Postgres, que le pooler de Neon ne garantit pas. L'app, elle, passe
// par l'URL poolée (`DATABASE_URL`, voir `lib/db.ts`).
const url = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Absente en CI : seul `prisma generate` y tourne, et il ne se connecte pas.
  ...(url ? { datasource: { url } } : {}),
});
