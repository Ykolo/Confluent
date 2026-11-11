/**
 * Toutes les routes de Better Auth : inscription, connexion, session,
 * déconnexion (`/api/auth/sign-up/email`, `/api/auth/get-session`, …).
 */
import { toNextJsHandler } from 'better-auth/next-js';

import { auth } from '@/lib/auth';

export const { GET, POST } = toNextJsHandler(auth);
