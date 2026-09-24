# Confluent — fusion de sauvegardes JW Library

Application Expo qui fusionne deux fichiers `.jwlibrary` en un seul, sans
perte. Trois écrans : choisir les deux fichiers, lire le récapitulatif de la
fusion, retrouver les fusions précédentes.

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
| `src/history.ts` | Historique des fusions, en `AsyncStorage` |
| `src/theme.ts` | Les jetons du canvas de design : couleurs, rayons, fontes |
| `src/ui/` | Les trois écrans et leurs briques |

Le fichier produit sort en `.jwlibrary` : c'est l'extension que JW Library
accepte à la restauration.

## La version web

Un site Next.js dans `web/`, déclaré comme workspace Bun : le `bun install` de
la racine installe l'app et le site. Mêmes trois écrans, et surtout **le même
moteur** : le site importe `src/merge.ts`, `backup-info.ts`, `errors.ts`,
`format.ts`, `progress.ts` et `theme.ts` tels quels, par l'alias `@core/*`.

    cd web
    bun run dev      # http://localhost:3000
    bun run build    # site statique dans web/out/
    bun test         # l'hôte WebAssembly, contre celui de Bun

Tout se passe dans le navigateur. Il n'y a pas de serveur (`output: 'export'`),
les sauvegardes ne sont envoyées nulle part, et `web/out/` se publie sur
n'importe quel hébergement statique. Sur Vercel : dossier racine `web`.

| Fichier | Rôle |
|---|---|
| `web/components/Confluent.tsx` | Le pendant d'`App.tsx` : lecture, fusion, téléchargement, partage |
| `web/components/` | Les trois écrans et leurs briques, en HTML + CSS Modules |
| `web/lib/sqlite-wasm.ts` | `SqliteHost` + SHA-256 pour le navigateur |
| `web/lib/history.ts` | Historique des fusions, en `localStorage` |
| `web/scripts/copy-sqlite.ts` | Pose SQLite WebAssembly dans `public/sqlite/` avant `dev` et `build` |

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
