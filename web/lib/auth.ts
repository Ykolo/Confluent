/**
 * Comptes Confluent : Better Auth, adossé à Postgres par Prisma.
 *
 * Le site et l'app mobile partagent les mêmes comptes. Le navigateur tient sa
 * session dans un cookie ; l'app, par le plugin `expo()`, la garde dans le
 * trousseau du téléphone et la renvoie en en-tête `Cookie`.
 *
 * Réservé au serveur.
 */
import 'server-only';

import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';

import { prisma } from '@/lib/db';
import { purgeUserFiles } from '@/lib/purge';

/**
 * Adresse publique du site, d'où Better Auth tire l'origine attendue des
 * requêtes et l'URL de ses liens.
 *
 * En production et en local, c'est `BETTER_AUTH_URL`. Une Preview Vercel
 * change d'adresse à chaque branche : on prend alors celle de la branche,
 * celle que l'on ouvre dans le navigateur.
 */
function siteUrl(): string | undefined {
  if (process.env.VERCEL_ENV === 'preview') {
    const host = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
    if (host) return `https://${host}`;
  }
  return process.env.BETTER_AUTH_URL;
}

/** Origines admises en plus de celle du site. */
function trustedOrigins(): string[] {
  const origins = [
    // Le schéma de l'app (`app.json`) : sans lui, la session mobile ne tient pas.
    'confluent://',
  ];
  // Une Preview répond aussi sur l'adresse propre au déploiement.
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL) {
    origins.push(`https://${process.env.VERCEL_URL}`);
  }
  // Expo Go, en développement, parle depuis `exp://`.
  if (process.env.NODE_ENV === 'development') origins.push('exp://', 'exp://**');
  return origins;
}

export const auth = betterAuth({
  baseURL: siteUrl(),
  // `BETTER_AUTH_SECRET` est lu par Better Auth lui-même.
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: { enabled: true },
  plugins: [expo()],
  trustedOrigins: trustedOrigins(),
  rateLimit: {
    enabled: true,
    // En mémoire, le compteur repartirait de zéro à chaque fonction Vercel :
    // il vit donc en base (table `rateLimit`).
    storage: 'database',
  },
  telemetry: { enabled: false },
  user: {
    deleteUser: {
      enabled: true,
      // Les fichiers d'abord : si R2 ne répond pas, le compte reste, et avec
      // lui les lignes qui disent quels fichiers effacer à la prochaine
      // tentative. L'inverse laisserait des notes personnelles sans maître.
      beforeDelete: async (user) => {
        try {
          await purgeUserFiles(user.id);
        } catch {
          // Le détail est déjà journalisé, essai par essai, par la purge.
          throw new APIError('SERVICE_UNAVAILABLE', {
            code: 'STORAGE_PURGE_FAILED',
            message: 'Les fichiers du compte n’ont pas pu être effacés ; le compte est conservé.',
          });
        }
      },
      // Un envoi signé avant la suppression a pu arriver entre-temps : on
      // repasse. Le compte n'existe plus, un échec ne peut que se journaliser.
      afterDelete: async (user) => {
        try {
          await purgeUserFiles(user.id, { attempts: 2 });
        } catch (err) {
          console.error(`[compte] ${user.id} supprimé, fichiers R2 peut-être restants sous backups/ et merges/`, err);
        }
      },
    },
  },
  hooks: {
    // Sans mot de passe, Better Auth se contente d'une session de moins d'un
    // jour : un téléphone déverrouillé suffirait. On exige toujours le mot
    // de passe, qui tient lieu de confirmation explicite.
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/delete-user') return;
      const password = (ctx.body as { password?: unknown } | undefined)?.password;
      if (typeof password !== 'string' || password.length === 0) {
        throw new APIError('BAD_REQUEST', {
          code: 'PASSWORD_REQUIRED',
          message: 'Le mot de passe est requis pour supprimer le compte.',
        });
      }
    }),
  },
});

export type SessionUser = typeof auth.$Infer.Session.user;

/**
 * L'utilisateur connecté, ou une réponse 401 à renvoyer telle quelle :
 *
 *     const user = await requireUser(req);
 *     if (user instanceof Response) return user;
 */
export async function requireUser(req: Request): Promise<SessionUser | Response> {
  const session = await auth.api.getSession({ headers: req.headers });
  return session?.user ?? Response.json({ error: 'unauthorized' }, { status: 401 });
}
