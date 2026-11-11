/**
 * Stockage des fichiers dans Cloudflare R2, par son API compatible S3.
 *
 * Les sauvegardes et les fusions ne transitent jamais par le serveur : il
 * signe une URL, le client envoie ou télécharge directement chez R2. Le
 * serveur ne fait que vérifier (`head`) et nettoyer (`remove`, `removePrefix`).
 *
 * Les clés sont toujours construites ici, jamais reçues du client :
 * `backups/{userId}/{id}.jwlibrary` et `merges/{userId}/{id}.jwlibrary`. Le
 * type vient en tête parce qu'une règle de cycle de vie R2 ne prend qu'un
 * préfixe littéral : `backups/` expire au bout de 30 jours, `merges/` non.
 *
 * Réservé au serveur : les clés d'API R2 ne doivent jamais atteindre un bundle.
 */
import 'server-only';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Durée de validité d'une URL d'envoi : de quoi téléverser quelques Mo sur un réseau lent. */
export const PUT_TTL_SECONDS = 10 * 60;
/** Durée de validité d'une URL de téléchargement : elle est suivie aussitôt. */
export const GET_TTL_SECONDS = 5 * 60;

export type ObjectKind = 'backups' | 'merges';

// Un identifiant de la base (uuid) ou de Better Auth : lettres, chiffres, `-`
// et `_`. Rien qui puisse sortir du préfixe (`/`, `..`) ni l'élargir.
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

function segment(name: string, value: string): string {
  if (!SEGMENT.test(value)) throw new Error(`r2 : ${name} invalide pour une clé d'objet`);
  return value;
}

/** Clé d'un fichier : `{kind}/{userId}/{id}.jwlibrary`. */
export function objectKey(kind: ObjectKind, userId: string, id: string): string {
  return `${kind}/${segment('userId', userId)}/${segment('id', id)}.jwlibrary`;
}

export const backupKey = (userId: string, id: string) => objectKey('backups', userId, id);
export const mergeKey = (userId: string, id: string) => objectKey('merges', userId, id);

/** Les préfixes qui contiennent tous les fichiers d'un utilisateur. */
export function userPrefixes(userId: string): string[] {
  const user = segment('userId', userId);
  return [`backups/${user}/`, `merges/${user}/`];
}

/**
 * En-tête `Content-Disposition` d'un téléchargement. `filename` reste en
 * ASCII pour les vieux clients ; `filename*` porte le vrai nom en UTF-8.
 */
export function attachment(fileName: string): string {
  const ascii = fileName.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'confluent.jwlibrary';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

let cached: { client: S3Client; bucket: string } | null = null;

/**
 * Client créé au premier appel, pas à l'import : `next build` charge les
 * modules des routes sans les variables d'environnement.
 */
function r2() {
  if (cached) return cached;
  const { R2_ACCOUNT_ID: account, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET: bucket } =
    process.env;
  if (!account || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('r2 : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY et R2_BUCKET sont requis (voir web/.env.example)');
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // `https://{compte}.r2…/{bucket}/{clé}` plutôt que `{bucket}.{compte}.r2…` :
    // un seul hôte, celui sur lequel le CORS du bucket a été vérifié (YKO-36).
    forcePathStyle: true,
    // Par défaut, le SDK ajoute une somme CRC32 à chaque envoi, et la signe
    // dans les URL présignées : le navigateur, qui ne l'envoie pas, se ferait
    // refuser. On ne la calcule que là où l'API l'exige (DeleteObjects).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  cached = { client, bucket };
  return cached;
}

/**
 * URL d'envoi d'un fichier, valable 10 minutes. La taille annoncée est
 * signée : R2 refuse un corps d'une autre longueur, le client ne peut donc
 * pas envoyer plus que ce que le serveur a accepté.
 */
export async function presignPut(key: string, size: number): Promise<string> {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('r2 : taille invalide');
  const { client, bucket } = r2();
  return getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentLength: size }), {
    expiresIn: PUT_TTL_SECONDS,
  });
}

/** URL de téléchargement, valable 5 minutes, qui enregistre le fichier sous `fileName`. */
export async function presignGet(key: string, fileName: string): Promise<string> {
  const { client, bucket } = r2();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: attachment(fileName) }),
    { expiresIn: GET_TTL_SECONDS },
  );
}

/** Taille de l'objet en octets, ou `null` s'il n'existe pas (envoi jamais fait ou expiré). */
export async function head(key: string): Promise<number | null> {
  const { client, bucket } = r2();
  try {
    const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return res.ContentLength ?? 0;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/** Supprime un objet. Sans effet s'il n'existe pas. */
export async function remove(key: string): Promise<void> {
  const { client, bucket } = r2();
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/**
 * Supprime tout ce qui commence par `prefix`, par lots de 1 000 (la limite de
 * DeleteObjects). Sert à la suppression de compte, avec `userPrefixes()`.
 * Renvoie le nombre d'objets supprimés.
 *
 * Le préfixe doit viser le dossier d'un utilisateur : un préfixe vide ou trop
 * court viderait le bucket entier.
 */
export async function removePrefix(prefix: string): Promise<number> {
  if (!/^(backups|merges)\/[A-Za-z0-9_-]{1,128}\/$/.test(prefix)) {
    throw new Error(`r2 : préfixe refusé (${prefix}) — attendu backups/{userId}/ ou merges/{userId}/`);
  }
  const { client, bucket } = r2();
  let removed = 0;
  // On reliste depuis le début à chaque lot plutôt que de suivre un jeton de
  // continuation : les objets supprimés ne reviennent plus dans la liste.
  for (;;) {
    const list = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
    const keys = (list.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (keys.length === 0) return removed;
    const res = await client.send(
      new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }),
    );
    if (res.Errors?.length) {
      const first = res.Errors[0]!;
      throw new Error(`r2 : ${res.Errors.length} suppression(s) en échec, dont ${first.Key} (${first.Code})`);
    }
    removed += keys.length;
    if (!list.IsTruncated) return removed;
  }
}
