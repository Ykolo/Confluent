/**
 * Envoi des e-mails de compte par Resend, depuis le domaine `mail.tserohr.com`.
 *
 * Sans `RESEND_API_KEY` (en local, ou dans les tests qui ne remplacent pas
 * ce module), rien ne part : le message est écrit dans la console, code
 * compris, pour pouvoir s'inscrire sans boîte de réception.
 *
 * Réservé au serveur.
 */
import 'server-only';

import type { EmailContent } from '@/lib/email-templates';

const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Tserohr <no-reply@mail.tserohr.com>';

export interface EmailMessage extends EmailContent {
  to: string;
}

/**
 * Expédie `message`. Lève une erreur si Resend refuse : Better Auth la
 * journalise, et la personne peut demander un nouveau code.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // En production, un oubli de configuration ne doit pas passer inaperçu.
    const log = process.env.VERCEL_ENV === 'production' ? console.error : console.info;
    log(`[e-mail] RESEND_API_KEY absente, non envoyé à ${message.to} : ${message.subject}\n${message.text}`);
    return;
  }

  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || DEFAULT_FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend a refusé l'envoi (${res.status}) : ${detail.slice(0, 300)}`);
  }
}
