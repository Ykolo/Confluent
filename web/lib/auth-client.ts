/**
 * Client Better Auth du navigateur. Le site et l'API partagent la même
 * origine : pas d'adresse à configurer, la session tient dans un cookie.
 */
'use client';

import { emailOTPClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  // Codes de confirmation d'adresse et de réinitialisation du mot de passe.
  plugins: [emailOTPClient()],
});

export const { useSession, signIn, signUp, signOut, deleteUser, emailOtp } = authClient;
