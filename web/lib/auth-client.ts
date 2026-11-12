/**
 * Client Better Auth du navigateur. Le site et l'API partagent la même
 * origine : pas d'adresse à configurer, la session tient dans un cookie.
 */
'use client';

import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient();

export const { useSession, signIn, signUp, signOut, deleteUser } = authClient;
