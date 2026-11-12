/**
 * Client de l'API de synchronisation, partagé par l'app et le site.
 *
 * Même principe que `SqliteHost` : aucune dépendance de plateforme. Chaque
 * plateforme passe son `fetch`, et l'app y ajoute son cookie de session (le
 * plugin Expo de Better Auth le garde dans le trousseau) par `headers`.
 *
 * Deux sortes de requêtes partent d'ici, traitées différemment :
 * - vers l'API (`baseUrl`) : avec la session ;
 * - vers R2 (les URL présignées) : **sans** cookie ni identifiants. La
 *   signature de l'URL suffit, et le CORS du bucket refuserait une requête
 *   qui en porte.
 *
 * Toute erreur remonte en `CloudError`, déjà rédigée pour l'écran.
 */
import type { BackupInfo } from '../backup-info';
import { AppError } from '../errors';
import type {
  ApiError,
  BackupDto,
  DownloadLink,
  ExistingUpload,
  MergeMeta,
  MergePage,
  SavedMerge,
  Slot,
  Slots,
  UploadKind,
  UploadTicket,
  UploadedBackup,
} from './types';

/** Ce que le client retient d'une sauvegarde lue (`inspectBackup`) pour la déposer. */
export type BackupMeta = Pick<BackupInfo, 'name' | 'deviceName' | 'createdAt' | 'counts'>;

/** Un fichier à envoyer : `Blob` dans le navigateur, octets ailleurs. */
export type FileBody = Blob | Uint8Array;

export interface CloudClient {
  /** Les deux emplacements de l'utilisateur. */
  slots(): Promise<Slots>;
  /**
   * Dépose une sauvegarde dans un emplacement : ticket, envoi vers R2,
   * confirmation. Si l'emplacement contient déjà ce fichier, rien n'est
   * envoyé (`alreadyThere`).
   */
  uploadBackup(slot: Slot, info: BackupMeta, body: FileBody, sha256: string): Promise<UploadedBackup>;
  /** Récupère le contenu d'une sauvegarde déposée. */
  downloadBackup(backup: BackupDto): Promise<Uint8Array>;
  /**
   * Enregistre une fusion dans l'historique et libère les emplacements
   * consommés, sauf ceux où une autre sauvegarde a été déposée entre-temps.
   */
  saveMerge(file: FileBody, meta: MergeMeta, sha256: string): Promise<SavedMerge>;
  /** Une page de l'historique ; `next` se repasse tel quel pour la suivante. */
  merges(cursor?: string): Promise<MergePage>;
  /** Lien de téléchargement de 5 minutes, sous le nom du fichier. */
  downloadUrl(kind: UploadKind, id: string): Promise<string>;
  /** Vide un emplacement. */
  clearSlot(slot: Slot): Promise<void>;
  /** Retire une fusion de l'historique, fichier compris. */
  deleteMerge(id: string): Promise<void>;
}

export interface CloudClientOptions {
  /** Adresse du serveur, sans `/` final : `https://confluent-web.vercel.app`. */
  baseUrl: string;
  /** Le `fetch` de la plateforme ; seule cette forme d'appel est utilisée. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * En-têtes ajoutés aux appels de l'API, relus à chaque requête : l'app y
   * met `Cookie`, que la session peut avoir renouvelé entre deux appels.
   */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** L'appareil d'où partent les dépôts, montré dans les emplacements (« iPhone »). */
  uploadedFrom?: string;
  /**
   * `include` (défaut) : le navigateur joint son cookie de session. L'app
   * passe `omit` et fournit le cookie par `headers` : la pile réseau native
   * garde ses propres cookies, qui viendraient sinon s'y mêler.
   */
  credentials?: RequestCredentials;
}

/** Erreur d'un appel à l'API ou à R2, rédigée pour l'écran. */
export class CloudError extends AppError {
  /** Statut HTTP ; `0` quand le serveur n'a pas pu être joint. */
  readonly status: number;
  /** Code stable de l'API (`not_found`, `upload_missing`…), ou `network`. */
  readonly code: string;

  constructor(status: number, code: string, view: { title: string; message: string; hint?: string; technical: string; cause?: unknown }) {
    super(view);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
  }

  /** La session a expiré ou n'existe pas : il faut se reconnecter. */
  get unauthorized(): boolean {
    return this.status === 401;
  }
}

/** Ce qu'on montre pour chaque statut, quand le serveur n'a rien rédigé de mieux. */
function viewFor(status: number): { title: string; message: string; hint?: string } {
  if (status === 401) {
    return { title: 'Connexion requise', message: 'Ta session a expiré.', hint: 'Reconnecte-toi, puis réessaie.' };
  }
  if (status === 404) {
    return { title: 'Introuvable', message: 'Ce fichier n’existe plus sur ton compte.', hint: 'Actualise la liste.' };
  }
  if (status === 409) return { title: 'Conflit', message: 'L’opération entre en conflit avec une autre.', hint: 'Réessaie.' };
  if (status === 422) return { title: 'Envoi incomplet', message: 'Le fichier n’est pas arrivé en entier.', hint: 'Recommence l’envoi.' };
  if (status === 429) {
    return { title: 'Trop de tentatives', message: 'Le serveur demande de patienter un peu.', hint: 'Patiente, puis réessaie.' };
  }
  if (status >= 500) {
    return { title: 'Serveur indisponible', message: 'Le serveur de Confluent n’a pas pu répondre.', hint: 'Réessaie dans quelques instants.' };
  }
  return { title: 'Requête refusée', message: 'Le serveur a refusé la demande.', hint: 'Mets l’app à jour si le problème persiste.' };
}

function networkError(what: string, cause: unknown): CloudError {
  return new CloudError(0, 'network', {
    title: 'Pas de connexion',
    message: 'Le serveur de Confluent n’a pas pu être joint.',
    hint: 'Vérifie ta connexion internet, puis réessaie.',
    technical: `${what} : ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });
}

/** Erreur à partir d'une réponse non 2xx : le message du serveur, s'il en a donné un. */
async function httpError(what: string, res: Response): Promise<CloudError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await res.json()) as Partial<ApiError>;
  } catch {
    // Pas de JSON (R2 répond en XML, un proxy en HTML) : la vue par défaut suffit.
  }
  const base = viewFor(res.status);
  return new CloudError(res.status, body.error ?? `http_${res.status}`, {
    ...base,
    // Le message de l'API est déjà en français et plus précis, sauf pour 401
    // et 5xx où la vue générique dit mieux quoi faire.
    message: body.message && res.status !== 401 && res.status < 500 ? body.message : base.message,
    technical: `${what} → ${res.status}${body.error ? ` ${body.error}` : ''}`,
  });
}

const sizeOf = (body: FileBody) => (body instanceof Uint8Array ? body.byteLength : body.size);

export function createCloudClient(opts: CloudClientOptions): CloudClient {
  const base = opts.baseUrl.replace(/\/+$/, '');

  /** Appel de l'API, avec la session. Renvoie le JSON, ou `undefined` sur un 204. */
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const what = `${method} ${path}`;
    const headers: Record<string, string> = { ...(await opts.headers?.()) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await opts.fetch(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: opts.credentials ?? 'include',
      });
    } catch (err) {
      throw networkError(what, err);
    }
    if (!res.ok) throw await httpError(what, res);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** Appel direct à R2 sur une URL présignée : sans session. */
  async function storage(method: 'PUT' | 'GET', url: string, body?: FileBody): Promise<Response> {
    const what = `${method} stockage`;
    let res: Response;
    try {
      res = await opts.fetch(url, { method, body: body as BodyInit | undefined, credentials: 'omit' });
    } catch (err) {
      throw networkError(what, err);
    }
    if (!res.ok) throw await httpError(what, res);
    return res;
  }

  async function upload(kind: UploadKind, body: FileBody, sha256: string): Promise<string> {
    const ticket = await call<UploadTicket>('POST', '/api/uploads', { kind, size: sizeOf(body), sha256 });
    await storage('PUT', ticket.putUrl, body);
    return ticket.id;
  }

  const client: CloudClient = {
    slots: () => call<Slots>('GET', '/api/slots'),

    async uploadBackup(slot, info, body, sha256) {
      const answer = await call<UploadTicket | ExistingUpload>('POST', '/api/uploads', {
        kind: 'backup', size: sizeOf(body), sha256, slot,
      });
      if ('existing' in answer) return { backup: answer.existing, alreadyThere: true };
      await storage('PUT', answer.putUrl, body);
      const backup = await call<BackupDto>('POST', `/api/backups/${encodeURIComponent(answer.id)}/confirm`, {
        slot,
        name: info.name,
        deviceName: info.deviceName,
        backupCreatedAt: info.createdAt,
        counts: info.counts,
        uploadedFrom: opts.uploadedFrom ?? null,
      });
      return { backup, alreadyThere: false };
    },

    async downloadBackup(backup) {
      const url = await client.downloadUrl('backup', backup.id);
      const bytes = new Uint8Array(await (await storage('GET', url)).arrayBuffer());
      if (bytes.byteLength !== backup.size) {
        throw new CloudError(422, 'size_mismatch', {
          title: 'Téléchargement incomplet',
          message: 'La sauvegarde reçue n’a pas la taille attendue.',
          hint: 'Réessaie ; si cela persiste, dépose-la à nouveau.',
          technical: `${backup.id} : ${bytes.byteLength} octets reçus, ${backup.size} attendus`,
        });
      }
      return bytes;
    },

    async saveMerge(file, meta, sha256) {
      const id = await upload('merge', file, sha256);
      return call<SavedMerge>('POST', `/api/merges/${encodeURIComponent(id)}/confirm`, meta);
    },

    merges: (cursor) =>
      call<MergePage>('GET', `/api/merges${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),

    async downloadUrl(kind, id) {
      const link = await call<DownloadLink>('GET', `/api/files/${kind}/${encodeURIComponent(id)}`);
      return link.url;
    },

    clearSlot: (slot) => call<void>('DELETE', `/api/slots/${slot}`),

    deleteMerge: (id) => call<void>('DELETE', `/api/merges/${encodeURIComponent(id)}`),
  };
  return client;
}
