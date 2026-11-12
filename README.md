# Confluent — fusion de sauvegardes JW Library

Application Expo et site web qui fusionnent deux fichiers `.jwlibrary` en un
seul, sans perte. Trois écrans : choisir les deux fichiers, lire le
récapitulatif de la fusion, retrouver les fusions précédentes. Un compte,
facultatif, garde les sauvegardes et les fusions d'un appareil à l'autre (voir
[Compte et synchronisation](#compte-et-synchronisation)).

    bun install
    bun expo start

Le moteur vit dans `src/merge.ts`. C'est un fichier autonome, sans dépendance
à React Native : il ne connaît ni Expo ni Node, seulement `fflate` et le
`SqliteHost` que la plateforme lui passe. Il se teste donc dans un runtime pur.

    bun test

Les tests tournent sur deux fausses sauvegardes, iPad et Android, fabriquées
à la volée par `tests/fixtures/backups.ts` sur le schéma réel : c'est ce que
fait la CI à chaque PR. Pour les rejouer sur de vraies sauvegardes, qui
restent hors du dépôt :

    CONFLUENT_IPAD=iPad.jwlibrary CONFLUENT_ANDROID=Android.jwlibrary bun test

Validé sur de vraies sauvegardes iOS + Android, `schemaVersion` 16.

## Pourquoi ce module existe

JW Library ne sait pas fusionner. La restauration **remplace intégralement** la
base locale, donc restaurer deux sauvegardes l'une après l'autre écrase la
première. Il faut fusionner avant de restaurer.

Corollaire à faire remonter dans l'UI : le fichier fusionné doit être restauré
sur **chacun** des appareils. Celui qui ne l'est pas réintroduira son ancien
état à la prochaine sauvegarde. C'est dit sur l'écran de récapitulatif, sous le
nom du fichier produit.

## L'application

| Fichier | Rôle |
|---|---|
| `App.tsx` | Enchaînement des écrans, choix des fichiers, enregistrement, partage |
| `src/merge.ts` | Le moteur. Ne dépend de rien d'autre que `fflate` |
| `src/zip.ts` | Écriture de l'archive produite, par tranches |
| `src/platform/sqlite-expo.ts` | `SqliteHost` + SHA-256 pour l'app |
| `src/platform/sqlite-bun.ts` | Les mêmes, pour `bun test`. Jamais bundlé |
| `src/backup-info.ts` | Lecture d'une sauvegarde choisie : compteurs des cartes fichier |
| `src/history.ts` | Historique des fusions, en `AsyncStorage` ; fichiers produits dans les documents de l’app |
| `src/theme.ts` | Les jetons du canvas de design : couleurs, rayons, fontes |
| `src/ui/` | Les trois écrans, la connexion, la suppression du compte, et leurs briques |
| `src/cloud/` | Client de l'API de synchronisation, partagé par l'app et le site : types échangés (DTO) et `createCloudClient`, sans dépendance de plateforme |
| `src/auth-client.ts` | Client Better Auth de l'app : session dans le trousseau (`expo-secure-store`), adresse du serveur (`EXPO_PUBLIC_API_URL`) |
| `src/auth-errors.ts` | Erreurs de compte traduites en français, partagées avec le site |
| `src/platform/cloud-expo.ts` | Le client de synchronisation de l'app, sur `expo/fetch` |

Le fichier produit sort en `.jwlibrary` : c'est l'extension que JW Library
accepte à la restauration.

## La version web

Un site Next.js dans `web/`, déclaré comme workspace Bun : le `bun install` de
la racine installe l'app et le site. Mêmes trois écrans, et surtout **le même
moteur** : le site importe `src/merge.ts`, `backup-info.ts`, `errors.ts`,
`format.ts`, `progress.ts` et `theme.ts` tels quels, par l'alias `@core/*`.

Le site est un serveur Next sur Vercel, et non plus un export statique : il
n'y a plus de `web/out/`. Le serveur porte les comptes et la synchronisation
(`app/api/*`) ; la fusion, elle, se fait toujours dans le navigateur, dans un
composant client. `GET /api/health` répond `{"status":"ok"}` tant qu'il
tourne. Sur Vercel : dossier racine `web`, préréglage Next.js, sans dossier de
sortie forcé.

### Lancer le site en local

Les variables d'environnement sont décrites, sans valeur, dans
[`web/.env.example`](web/.env.example) : base Neon, secret Better Auth,
bucket R2 et secret du Cron. Les copier dans `web/.env.local` et les remplir
(branche Neon `dev`), puis, depuis `web/` :

    bunx prisma migrate dev   # met la branche dev au niveau du schéma
    bun run dev               # http://localhost:3000

Les autres commandes :

    bun run build    # build Next dans web/.next/
    bun run start    # sert ce build, http://localhost:3000
    bun test         # hôte WebAssembly, module R2, purge, utilitaires d'API

L'app mobile vise le site de production, ou celui que désigne
`EXPO_PUBLIC_API_URL` dans le `.env` de la racine (voir
[`.env.example`](.env.example)) : l'adresse IP du PC sur le réseau local, avec
le site lancé par `bun run dev -H 0.0.0.0` (l'option va à `next dev`).

| Fichier | Rôle |
|---|---|
| `web/components/Confluent.tsx` | Le pendant d'`App.tsx` : lecture, fusion, téléchargement, partage |
| `web/components/` | Les trois écrans et leurs briques, en HTML + CSS Modules |
| `web/lib/sqlite-wasm.ts` | `SqliteHost` + SHA-256 pour le navigateur |
| `web/lib/history.ts` | Historique des fusions, en `localStorage` ; fichiers produits en IndexedDB |
| `web/scripts/copy-sqlite.ts` | Pose SQLite WebAssembly dans `public/sqlite/` avant `dev` et `build` |
| `web/prisma/schema.prisma` | Comptes (Better Auth), sauvegardes déposées et fusions : métadonnées seulement, les fichiers vivent dans R2 |
| `web/lib/db.ts` | Client Prisma du serveur, sur l'adaptateur Neon (URL poolée) |
| `web/lib/auth.ts` | Comptes (Better Auth) : e-mail et mot de passe, plugin Expo pour l'app, suppression du compte, `requireUser()` pour les routes |
| `web/lib/r2.ts` | Fichiers dans Cloudflare R2 : clés, URL présignées d'envoi et de téléchargement, vérification, copie, suppression |
| `web/lib/api.ts` | Ce que partagent les routes : erreurs, validation des corps (Zod), passage des lignes aux DTO |
| `web/lib/limits.ts` | Quota de 30 fusions par compte, limite de 20 envois par heure |
| `web/lib/cleanup.ts` | Ménage quotidien (Cron Vercel) : envois abandonnés, sauvegardes expirées |
| `web/lib/purge.ts` | Effacement des fichiers R2 d'un compte supprimé |
| `web/app/api/` | Les routes : envois, emplacements, fusions, fichiers, comptes, ménage |
| `web/vercel.json` | Le Cron du ménage, chaque jour à 4 h UTC |

La base est un Postgres Neon : branche `dev` en local, `main` en production.
Le client Prisma est généré au `bun install` (`web/generated/`, non commité).
Pour faire évoluer le schéma, depuis `web/` avec `.env.local` rempli :

    bunx prisma migrate dev --name <changement>   # sur la branche dev

En production, le script `vercel-build` lance `prisma migrate deploy` avant
le build, avec le `DIRECT_URL` de Vercel : la branche `main` suit `master`.
Une migration qui échoue fait échouer le déploiement, et l'ancienne version
reste en ligne. Les Previews ne migrent pas : elles utilisent la branche
`dev`, migrée pendant le développement par `prisma migrate dev`.

Deux particularités de l'hôte navigateur :

- **SQLite n'est pas empaqueté.** Turbopack refuse `@sqlite.org/sqlite-wasm`
  (il y trouve des `new Worker()` aux URL calculées). Le module est donc copié
  tel quel dans `public/sqlite/` et importé hors bundler. La copie est refaite
  à chaque `dev` ou `build`, et reste ainsi alignée sur la version installée.
- **Le WAL passe par `locking_mode=EXCLUSIVE`.** Le VFS en mémoire du module
  n'a pas de mémoire partagée : une base en mode WAL y échoue sur
  `SQLITE_CANTOPEN`, avec ou sans journal à côté. En mode exclusif, SQLite
  tient l'index du WAL dans le tas, et le journal d'une sauvegarde Android est
  bien intégré. Le pragma doit précéder toute lecture.

## Compte et synchronisation

Le compte est **facultatif** : sans lui, l'app et le site fusionnent comme
avant, et rien ne quitte l'appareil. Avec lui, on retrouve sur un appareil ce
qu'on a déposé depuis un autre : la tablette dépose sa sauvegarde en A, le
téléphone la sienne en B, et l'un ou l'autre fusionne.

**Ce qui est envoyé.** Les fichiers `.jwlibrary` que l'on choisit de garder
dans le compte (case « Garder aussi dans le compte »), et les fusions
produites. Ils vont directement de l'appareil à Cloudflare R2, par une URL
signée de 10 minutes : ils ne transitent pas par le serveur. La base Postgres
(Neon) ne garde que des métadonnées : nom du fichier, taille, empreinte
SHA-256, appareil d'envoi, et les compteurs affichés (notes, surlignages,
favoris).

**Ce qui ne l'est jamais.** Le serveur n'ouvre pas les sauvegardes : aucune
lecture, aucune fusion côté serveur. La fusion se fait toujours sur
l'appareil, dans l'app ou dans le navigateur, avec le même moteur
(`src/merge.ts`). Le mot de passe est haché par Better Auth.

**Combien de temps.**

| Quoi | Durée |
|---|---|
| Sauvegarde déposée (emplacements A et B) | 30 jours, puis effacée par la règle de cycle de vie de R2. Elle quitte son emplacement dès qu'une fusion la consomme ou qu'une autre la remplace |
| Fusion enregistrée | Les 30 plus récentes par compte. Au-delà, la plus ancienne part, fichier et ligne |
| Envoi commencé mais jamais confirmé | 1 heure au plus : le ménage quotidien l'efface |

Une sauvegarde déjà présente dans l'emplacement visé (même empreinte) n'est
pas renvoyée. On peut aussi placer une fusion dans l'emplacement A pour
préparer la suivante, sans la retélécharger : elle y est copiée côté R2.

**Supprimer son compte.** « Supprimer le compte », dans la barre du compte,
sur le site et dans l'app, avec le mot de passe pour confirmer. Les fichiers
du compte sont effacés de R2 **avant** le compte : si R2 ne répond pas, le
compte est conservé et la suppression peut être retentée, plutôt que de
laisser des fichiers sans propriétaire. Les fichiers déjà enregistrés sur les
appareils ne sont pas touchés.

**Limites.** 20 envois par heure et par compte, des tentatives de connexion
limitées par Better Auth, des fichiers de 200 Mo au plus.

## API

```ts
import { mergeBackups } from './merge';

const { file, report, fileName } = await mergeBackups(baseBytes, sourceBytes, {
  host,      // SqliteHost — fourni par la plateforme
  sha256,    // (bytes: Uint8Array) => Promise<string>
  conflictStrategy: 'keep-both',   // ou 'newest' — voir plus bas
  onProgress: async (step, done, total) => {
    setProgress(done / total);
    await new Promise((r) => setTimeout(r, 0));
  },
});
```

`base` garde ses identifiants internes ; tout ce qui n'existe que dans `source`
y est ajouté avec de nouveaux IDs. L'opération est symétrique : `merge(A, B)` et
`merge(B, A)` produisent les mêmes totaux par table.

`report` contient le nombre de lignes ajoutées par table (`added`), les lignes
déjà présentes des deux côtés (`duplicates`), les conflits de notes résolus
(`noteConflicts`), les signets écartés faute de slot libre
(`bookmarksSkipped`), et ce que contient le fichier produit (`totals` : notes,
surlignages, signets) — c'est ce que l'écran de récapitulatif affiche.

## Ce que la plateforme doit fournir

Le moteur ne connaît ni Expo ni Node. Il faut lui passer un `SqliteHost` :

```ts
interface SqliteHost {
  open(
    name: string,
    bytes: Uint8Array,
    sidecars?: Record<string, Uint8Array>,
  ): Promise<OpenDatabase>;
}
```

`open` écrit les octets dans un fichier et l'ouvre. Deux bases sont ouvertes en
parallèle, donc `name` doit être unique par appel. `sidecars` est indexé par
suffixe (`-wal`, `-shm`) et chaque entrée doit être écrite sous `name + suffixe`,
à côté de la base — voir les pièges plus bas. `OpenDatabase` expose
`all` / `run` / `exec`, plus `serialize()` qui rend les octets du fichier (WAL
intégré) et `close()`.

`run` doit renvoyer `lastInsertRowId`. Pour `sha256`,
`Crypto.digest(CryptoDigestAlgorithm.SHA256, bytes)` d'`expo-crypto`.

Côté Expo, le répertoire de travail est le **cache de l'app**, et non le
répertoire de bases par défaut d'expo-sqlite. Ce dernier est
`context.filesDir/SQLite` — celui d'Expo Go lui-même — alors que l'API fichiers
d'`expo-file-system` ne donne accès qu'au répertoire cloisonné de l'expérience
en cours : toute écriture y est refusée avec « Missing 'READ' permission » ou
« URI is not absolute ». `openDatabaseAsync(name, options, directory)` accepte
un répertoire, on lui passe donc celui où l'on a le droit d'écrire. Il attend un
chemin nu, quand l'API fichiers manipule des URI `file://` percent-encodées :
la conversion est dans `src/platform/sqlite-expo.ts`.

Côté Bun, pour les tests : `bun:sqlite` (`Database`) et `crypto.subtle`, tous
deux intégrés au runtime. Aucune dépendance à installer, aucun module natif à
compiler.

```ts
import { Database } from 'bun:sqlite';
```

Si tu restes sur Node plutôt que Bun : `node:sqlite` (`DatabaseSync`) fait la
même chose, mais il n'est stable qu'à partir de Node 24 — en dessous il faut le
flag `--experimental-sqlite`, ou `better-sqlite3` en devDependency. Comme cet
adaptateur ne sert qu'aux tests, il ne touche jamais le bundle mobile.

## Format .jwlibrary

Un ZIP contenant `manifest.json`, `userData.db` (SQLite) et des pièces jointes
nommées en UUID (miniatures de playlists). Les sauvegardes Android contiennent
parfois `userData.db-wal` et `-shm`.

`manifest.userDataBackup.hash` est le SHA-256 hexadécimal des octets bruts de
`userData.db`.

## Trois pièges qui coûtent cher

**Ne jamais valider le hash d'un fichier entrant.** Certaines sauvegardes iOS
embarquent un hash tronqué à 62 caractères qui ne correspond pas au SHA-256
réel. Le vérifier ferait rejeter des sauvegardes parfaitement valides. On ne le
recalcule que pour le fichier produit.

**Le WAL doit être reposé à côté de la base, puis intégré.** Une sauvegarde
Android arrive en mode WAL et embarque souvent un `userData.db-wal` (512 Ko sur
les fichiers de test). `readBackup` le rend dans `sidecars` ; l'hôte doit
l'écrire sous `name + '-wal'`, sinon SQLite ne le voit pas et un
`PRAGMA wal_checkpoint(TRUNCATE)` n'a rien à intégrer — les données les plus
récentes restent invisibles. Ne jamais inclure `-wal` / `-shm` dans l'archive de
sortie : après le checkpoint il n'y a plus rien à y mettre.

**Ne pas ouvrir ces bases en mémoire.** `deserializeDatabaseAsync` est tentant —
pas de fichier, pas de permission à demander — mais une base dont l'en-tête
annonce le mode WAL cherche un fichier `-wal` qui n'existe pas en mémoire, et
échoue à la première requête sur `SQLITE_CANTOPEN`. La sauvegarde iOS passe, la
sauvegarde Android non.

**Les index UNIQUE de `Location` n'identifient pas une ligne.** SQLite traite
chaque NULL comme distinct. Sur un cas réel, s'y fier réduisait 1 723 lieux à
913 clés, ce qui fusionnait des lieux différents et déplaçait des signets. La
clé utilisée ici est le tuple de toutes les colonnes sauf `LocationId` et
`Title` (ce dernier n'est qu'un libellé d'affichage, il peut varier d'un
appareil à l'autre pour un même lieu).

## Règles de rapprochement

Tout se fait par clé naturelle, jamais par ID.

| Table | Clé | Traitement |
|---|---|---|
| `Location` | toutes colonnes sauf `LocationId`, `Title` | ajout si absente |
| `UserMark` | `UserMarkGuid` | ajout + `BlockRange` remappés |
| `Note` | `Guid` | conflit : voir ci-dessous |
| `Tag` | `Type` + `Name` | ajout si absent |
| `TagMap` | `TagId` + cible | `Position` renumérotée (`UNIQUE(TagId, Position)`) |
| `Bookmark` | contenu, pas le `Slot` | 10 slots max par publication |
| `InputField` | `LocationId` + `TextTag` | ajout si absent |
| `IndependentMedia` | `FilePath` | ajout + copie de la pièce jointe |

Sur une note divergente, la `LastModified` la plus récente devient le contenu.
`conflictStrategy` décide du sort de l'autre version, et c'est le seul endroit
du moteur qui dépende d'un choix de l'utilisateur :

- `keep-both` (défaut, « Tout garder » à l'écran) ajoute l'ancienne version en
  annexe. Rien de ce qui a été écrit à la main n'est perdu.
- `newest` (« Version récente ») ne garde que la plus récente.

Un `UserMark` sans `BlockRange` est un surlignage invisible : les plages doivent
suivre systématiquement.

## Deux détails de perf et de sûreté

Les IDs sont calculés (`MAX(id) + 1`) au lieu de passer par `lastInsertRowid`,
ce qui permet d'insérer par paquets en `VALUES (..),(..)`. Sur `expo-sqlite`
chaque requête traverse le pont natif : on passe d'environ 44 000 allers-retours
à 150. Sans ça, la fusion gèle l'UI plusieurs dizaines de secondes — compter
~22 000 surlignages par sauvegarde.

Le callback `onProgress` est appelé entre les paquets d'insertion, mais la
fusion tourne sur le thread JS et le bloque. Il peut renvoyer une promesse, et
le moteur l'attend : c'est ce qui permet de rendre la main à la boucle
d'événements (`await new Promise(r => setTimeout(r, 0))`) pour que la barre de
progression se rafraîchisse réellement. Sans ça l'app paraît figée alors
qu'elle travaille. Les étapes signalées sont `lieux`, `surlignages`, `notes`,
`signets`, `vérification` et `archive` ; `src/progress.ts` les recompose en une
seule barre.

L'archive produite est écrite par `src/zip.ts`, et non par `zipSync`. Seuls le
manifeste et la base sont compressés : les pièces jointes sont des médias déjà
compressés (4 % de gain mesuré, pour un tiers du temps d'archivage), elles sont
rangées telles quelles. La base est compressée par tranches, avec `onProgress`
entre chacune : c'était le dernier gros bloc synchrone, près de quatre secondes
d'écran figé sur téléphone. L'enveloppe ZIP est écrite à la main plutôt qu'avec
le `Zip` en flux de fflate, qui termine chaque entrée par un descripteur de
données : `ZipInputStream` de Java refuse une entrée rangée suivie d'un tel
descripteur. Ici les tailles vont dans l'en-tête local, comme avec `zipSync`.

Toute la fusion tient dans une transaction, avec `ROLLBACK` sur erreur, et se
termine par des `foreign_key_check` et `integrity_check` bloquants. Une base à
moitié fusionnée peut être refusée par JW Library, voire la faire planter au
point de devoir la réinstaller. Si une vérification échoue, aucun fichier n'est
produit.

## Tests recommandés

`merge.ts` n'importe rien de React Native : il se teste donc dans un runtime
pur, sans preset RN, sans transformer, sans mock de module natif. `bun test`
suffit — API compatible Jest, rien à configurer.

    bun test

`tests/merge.test.ts` tourne sur les deux sauvegardes du dépôt, sans
simulateur :

- **symétrie** — `merge(A,B)` et `merge(B,A)` donnent les mêmes totaux par
  table. C'est le test qui attrape la majorité des bugs de remappage d'ID.
- **conservation** — les `UserMarkGuid` et les `Guid` de notes en sortie sont
  exactement l'union des deux entrées.
- **idempotence** — `merge(M, M)` n'ajoute rien.
- **intégrité** — aucun surlignage orphelin, `foreign_key_check` et
  `integrity_check` passent, hash du manifeste cohérent, pas de `-wal` dans
  l'archive.

## Limite connue

Les playlists (`PlaylistItem` et ses tables liées) ne sont pas remappées : les
`TagMap` qui les référencent sont ignorées, et seules celles de la base servant
de socle sont conservées. Sur des sauvegardes du même utilisateur elles sont en
général identiques, mais si tu veux les fusionner il faut ajouter le remappage
de `PlaylistItemId` et des `PlaylistItemMarker`.
