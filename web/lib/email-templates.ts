/**
 * Les e-mails de compte : code de confirmation, code de réinitialisation, et
 * l'avertissement envoyé quand quelqu'un s'inscrit avec une adresse déjà
 * prise.
 *
 * Fonctions pures, sans envoi : `email.ts` les expédie, les tests les lisent.
 * Chaque message a une version HTML et une version texte, que lisent les
 * messageries qui refusent le HTML.
 */
import { color } from '@core/theme';

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** Durée de validité d'un code, en secondes (`expiresIn` du plugin `emailOTP`). */
export const OTP_TTL_SECONDS = 10 * 60;

const minutes = Math.round(OTP_TTL_SECONDS / 60);

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Mise en page commune : une carte sur le fond de l'app, sans image ni lien de suivi. */
function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title></head>
<body style="margin:0;padding:0;background:${color.screen};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${color.ink};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${color.screen};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${color.card};border:1px solid ${color.border};border-radius:18px;padding:32px 28px;">
        <tr><td>
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${color.muted};">Tserohr</p>
          <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;line-height:1.3;">${escape(title)}</h1>
          ${body}
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:${color.faint};">Tserohr · fusion de sauvegardes JW Library</p>
    </td></tr>
  </table>
</body>
</html>`;
}

const paragraph = (s: string) =>
  `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${color.inkSoft};">${s}</p>`;

const codeBlock = (otp: string) =>
  `<p style="margin:8px 0 20px;padding:16px 0;background:${color.sunken};border-radius:14px;text-align:center;font-size:32px;font-weight:600;letter-spacing:.3em;font-family:ui-monospace,Menlo,Consolas,monospace;color:${color.ink};">${escape(otp)}</p>`;

const footnote = (s: string) =>
  `<p style="margin:0;font-size:13px;line-height:1.5;color:${color.muted};">${s}</p>`;

/** Le code à saisir pour confirmer l'adresse d'un nouveau compte. */
export function verificationEmail(otp: string): EmailContent {
  const title = 'Ton code de confirmation';
  return {
    subject: `${otp} est ton code de confirmation Tserohr`,
    html: layout(title, [
      paragraph('Saisis ce code dans Tserohr pour confirmer ton adresse e-mail et activer ton compte :'),
      codeBlock(otp),
      footnote(`Il est valable ${minutes} minutes. Si tu n’as pas créé de compte, ignore simplement ce message.`),
    ].join('\n')),
    text: [
      title,
      '',
      'Saisis ce code dans Tserohr pour confirmer ton adresse e-mail et activer ton compte :',
      '',
      `    ${otp}`,
      '',
      `Il est valable ${minutes} minutes. Si tu n’as pas créé de compte, ignore simplement ce message.`,
    ].join('\n'),
  };
}

/** Le code à saisir avec le nouveau mot de passe. */
export function passwordResetEmail(otp: string): EmailContent {
  const title = 'Réinitialiser ton mot de passe';
  return {
    subject: `${otp} est ton code de réinitialisation Tserohr`,
    html: layout(title, [
      paragraph('Quelqu’un, sans doute toi, a demandé à changer le mot de passe de ton compte Tserohr. Saisis ce code avec ton nouveau mot de passe :'),
      codeBlock(otp),
      footnote(`Il est valable ${minutes} minutes. Si tu n’as rien demandé, ignore ce message : ton mot de passe reste le même.`),
    ].join('\n')),
    text: [
      title,
      '',
      'Quelqu’un, sans doute toi, a demandé à changer le mot de passe de ton compte Tserohr. Saisis ce code avec ton nouveau mot de passe :',
      '',
      `    ${otp}`,
      '',
      `Il est valable ${minutes} minutes. Si tu n’as rien demandé, ignore ce message : ton mot de passe reste le même.`,
    ].join('\n'),
  };
}

/**
 * Envoyé après une réinitialisation réussie : si ce n'était pas la personne,
 * elle l'apprend tout de suite et peut reprendre la main.
 */
export function passwordChangedEmail(): EmailContent {
  const title = 'Ton mot de passe a été modifié';
  const body = 'Le mot de passe de ton compte Tserohr vient d’être changé, et tous tes appareils ont été déconnectés. Si c’est toi, tu n’as rien à faire.';
  const warning = 'Si ce n’est pas toi, choisis tout de suite « Mot de passe oublié ? » dans Tserohr avec cette adresse : tu recevras un code pour en définir un nouveau.';
  return {
    subject: 'Ton mot de passe Tserohr a été modifié',
    html: layout(title, [paragraph(body), footnote(warning)].join('\n')),
    text: [title, '', body, '', warning].join('\n'),
  };
}

/**
 * Envoyé à la place du code quand on s'inscrit avec une adresse déjà prise.
 * Le serveur répond comme pour une inscription réussie, pour ne pas révéler
 * quelles adresses ont un compte : c'est ce message qui prévient la personne.
 */
export function existingAccountEmail(): EmailContent {
  const title = 'Tu as déjà un compte';
  const body = 'Quelqu’un, sans doute toi, a essayé de créer un compte Tserohr avec cette adresse. Elle en a déjà un : connecte-toi plutôt, ou choisis « Mot de passe oublié ? » si tu ne t’en souviens plus.';
  return {
    subject: 'Tu as déjà un compte Tserohr',
    html: layout(title, [
      paragraph(body),
      footnote('Si ce n’était pas toi, ignore ce message : rien n’a changé sur ton compte.'),
    ].join('\n')),
    text: [title, '', body, '', 'Si ce n’était pas toi, ignore ce message : rien n’a changé sur ton compte.'].join('\n'),
  };
}
