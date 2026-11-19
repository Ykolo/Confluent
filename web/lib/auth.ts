/**
 * Comptes Tserohr : Better Auth, adossé à Postgres par Prisma.
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
import { emailOTP } from 'better-auth/plugins';
import { after } from 'next/server';

import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { existingAccountEmail, OTP_TTL_SECONDS, passwordResetEmail, verificationEmail } from '@/lib/email-templates';
import { purgeUserFiles } from '@/lib/purge';

/**
 * Les e-mails partent après la réponse : une adresse inconnue (aucun envoi)
 * ne répond ainsi pas plus vite qu'une adresse connue, et la personne n'attend
 * pas Resend. Sur Vercel, `after` garde la fonction en vie jusqu'à la fin de
 * l'envoi. Hors d'une requête Next (les tests appellent les routes
 * directement), `after` lève une erreur : la promesse court alors seule.
 */
function inBackground(promise: Promise<unknown>): void {
  try {
    after(promise);
  } catch {
    void promise;
  }
}

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
    'tserohr://',
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
  emailAndPassword: {
    enabled: true,
    // Pas de session tant que l'adresse n'est pas confirmée par le code reçu.
    // Les comptes antérieurs sont marqués vérifiés par la migration
    // `verify_existing_users`.
    requireEmailVerification: true,
    // Un mot de passe réinitialisé déconnecte tous les appareils : si le
    // compte était compromis, l'intrus perd sa session.
    revokeSessionsOnPasswordReset: true,
    // Avec `requireEmailVerification`, une inscription sur une adresse prise
    // répond comme une inscription réussie, pour ne pas révéler quelles
    // adresses ont un compte. C'est ce message qui prévient la personne.
    onExistingUserSignUp: async ({ user }) => {
      await sendEmail({ to: user.email, ...existingAccountEmail() });
    },
  },
  emailVerification: {
    // Une connexion à un compte non confirmé renvoie un code, puis
    // `EMAIL_NOT_VERIFIED` : l'écran passe alors à la saisie du code.
    sendOnSignIn: true,
    // Le code validé ouvre la session, sans repasser par le mot de passe.
    autoSignInAfterVerification: true,
  },
  plugins: [
    expo(),
    // Des codes à 6 chiffres plutôt que des liens, pour la confirmation comme
    // pour la réinitialisation : sur le téléphone, un lien devrait rouvrir
    // l'app depuis la messagerie ; un code se tape (ou se colle) partout.
    emailOTP({
      otpLength: 6,
      expiresIn: OTP_TTL_SECONDS,
      allowedAttempts: 5,
      // En base, seule l'empreinte du code : une fuite de la table ne donne
      // aucun code utilisable.
      storeOTP: 'hashed',
      // L'e-mail de confirmation de Better Auth (un lien) devient un code.
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        const content = type === 'forget-password' ? passwordResetEmail(otp) : verificationEmail(otp);
        await sendEmail({ to: email, ...content });
      },
    }),
  ],
  advanced: {
    backgroundTasks: { handler: inBackground },
  },
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
    before: createAuthMiddleware(async (ctx) => {
      // Le plugin `emailOTP` ouvre aussi une connexion par code seul, qui
      // créerait au passage des comptes sans mot de passe. On ne garde que la
      // confirmation d'adresse et la réinitialisation.
      const type = (ctx.body as { type?: unknown } | undefined)?.type;
      if (ctx.path === '/sign-in/email-otp'
        || ctx.path === '/forget-password/email-otp'
        || ctx.path.startsWith('/email-otp/request-email-change')
        || ctx.path === '/email-otp/change-email'
        || (ctx.path === '/email-otp/send-verification-otp' && type !== 'email-verification')) {
        throw new APIError('NOT_FOUND', { code: 'NOT_SUPPORTED', message: 'Cette opération n’est pas proposée.' });
      }

      // Sans mot de passe, Better Auth se contente d'une session de moins d'un
      // jour : un téléphone déverrouillé suffirait. On exige toujours le mot
      // de passe, qui tient lieu de confirmation explicite.
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
