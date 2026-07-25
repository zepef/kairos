# Anti-sèche

Fiches préparées à l'avance, soufflées point par point dans une oreillette
pendant un rendez-vous. Fonction discrète : masquée dans les Réglages jusqu'à 7
appuis sur le libellé de version, désactivée par défaut.

## Ce que ça fait

1. **Avant** le rendez-vous : on attache une liste ordonnée de points à une tâche
   existante de Kairos (idéalement un RDV avec `due_iso`). Les points se saisissent
   à la main ou s'importent depuis la note dictée de la tâche.
2. **Pendant** : un appui lit le point suivant. Le point est **toujours affiché**
   à l'écran, et **prononcé uniquement si la sortie audio est privée**.

Aucun enregistrement, aucun appel réseau, Gemma n'intervient pas.

## Ce qui a été explicitement écarté (ne pas re-proposer)

La demande initiale était : tapotement → enregistrement de l'interlocuteur →
analyse par le LLM embarqué → réponse soufflée **à l'insu** de l'interlocuteur.
Écarté pour quatre raisons cumulatives, chacune suffisante :

- **Juridique.** Art. 226-1 du code pénal : capter ou enregistrer sans le
  consentement de leur auteur des paroles prononcées à titre privé = 1 an
  d'emprisonnement et 45 000 € d'amende, **y compris pour un participant à la
  conversation**. Art. 226-2 pour la conservation et l'usage. Kairos étant
  distribué à des tiers, le risque n'est pas seulement personnel.
- **Le « caché » est impossible.** Depuis Android 12 l'OS allume un indicateur
  micro que **aucune application ne peut supprimer**. Depuis Android 9 le micro
  est interdit en arrière-plan sans *foreground service* + notification
  persistante non balayable. `targetSdk 36` durcit encore.
- **Latence rédhibitoire.** Gemma 4 E2B tourne en CPU pur (`n_gpu_layers: 0`) sur
  Helio G95. Le warm-up fait passer une simple **classification** JSON de 15 s à
  ~6 s avec préfixe déjà en cache. Une vraie réponse en prose (transcript non
  caché en prefill + ~100 tokens de décodage) se compte en dizaines de secondes :
  la conversation est passée à autre chose.
- **E2B n'est pas un modèle de connaissance.** Chez nous c'est un routeur
  d'intentions (prompt système de ~1,9k tokens de schémas d'outils,
  `response_format: json_object`). Il ne produit pas d'argumentaire métier.

Une fiche préparée résout le besoin réel — « ne pas être à court de réponses » —
avec une latence **nulle**, hors ligne, et sans capter personne.

## Le garde-fou de sortie audio

C'est la pièce critique. Sans elle, le mode d'échec n'est pas « ça ne marche
pas » mais « l'anti-sèche s'annonce au haut-parleur devant la personne à qui on
la cache ».

**Ni `expo-speech` ni `expo-audio` n'exposent la route audio sur Android en SDK
56** (`shouldRouteThroughEarpiece` est iOS-only ; aucune énumération de
périphériques). D'où le module natif local `modules/kairos-audio-route`, ~50
lignes de Kotlin sur `AudioManager.getDevices(GET_DEVICES_OUTPUTS)`, qui renvoie
`"bluetooth" | "wired" | "speaker"`.

Règles :

- La route est **relue au moment exact de parler**, pas seulement sondée toutes
  les 2 s pour le badge : une oreillette débranchée entre deux sondages est
  précisément le cas à ne pas rater.
- `"unknown"` (module natif absent, c.-à-d. bundle JS plus récent que l'APK
  installé) n'est **pas** considéré comme privé : l'utilisateur doit confirmer
  explicitement une fois par séance.
- Un écouteur filaire compte comme privé au même titre que le Bluetooth.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/AntiSeche.tsx` | Écran : liste des fiches, éditeur, séance |
| `src/db.ts` | Table `cue` (+ index), CRUD, réordonnancement, purge des orphelins |
| `modules/kairos-audio-route/` | Module natif : route audio courante |
| `src/Settings.tsx` | Section masquée + révélation par 7 appuis |

La suppression d'une tâche **ne cascade pas** sur ses points : « annule »
restaurerait sinon un rendez-vous à fiche vide. Les orphelins sont invisibles
(toute lecture joint sur `task`) et balayés au démarrage suivant.

## Rebuild requis

Le module natif impose `expo prebuild` + `assembleRelease` — un simple
rechargement JS ne suffit pas. Sur un APK antérieur, l'écran fonctionne mais la
route reste `"unknown"` et exige la confirmation manuelle.

## Suites possibles

- **Déclencheur bouton d'oreillette** (MediaSession + `KEYCODE_MEDIA_*`) plutôt
  qu'un appui à l'écran : plus fiable qu'une détection de tapotement à
  l'accéléromètre (bruitée à travers un tissu, et le comportement des capteurs en
  arrière-plan n'est pas documenté en v56), et porter la main à son oreillette
  est un geste naturel.
- **`expo-keep-awake`** pour empêcher l'écran de s'éteindre en séance. Déjà
  présent en dépendance transitive d'`expo` mais non hoisté : demande une entrée
  dans `package.json` + `npm install`.
