-- La validation de l'adresse par code devient obligatoire à la connexion
-- (`requireEmailVerification`). Les comptes créés avant n'ont jamais reçu de
-- code : on les tient pour vérifiés, plutôt que de leur en demander un à la
-- prochaine connexion. La migration tourne au build de production, juste
-- avant que le nouveau code ne serve.
UPDATE "user" SET "emailVerified" = true WHERE "emailVerified" = false;
