<!-- Langue : [English](README.md) · **Français** -->

# Kairos

**Un gestionnaire de tâches vocal, 100 % sur l'appareil. L'IA ne quitte jamais votre téléphone.**

Maintenez l'orbe, parlez naturellement : Kairos vous comprend, classe la tâche et vous répond à voix haute — le tout en local, **sans rien envoyer dans le cloud**. Le modèle de langage (Gemma 4 · E2B, ~3 Go) tourne directement sur l'appareil via `llama.rn`.

> L'écran est un filet de sécurité — l'**orbe vocale est le produit**.
> Boucle centrale : **maintenir → parler → compris → répondu à voix haute**.

---

## En bref

- 🎙️ **Voice-first** — une orbe « maintenir pour parler » ; des commandes en langage naturel.
- 📴 **100 % hors-ligne & privé** — LLM embarqué + SQLite local. **0 donnée envoyée par l'app.** Le modèle (~3 Go) se télécharge une seule fois, puis tout fonctionne hors-ligne.
- 🧠 **IA embarquée** — Gemma 4 E2B via `llama.rn` (CPU uniquement, `n_ctx` 4096). Le modèle ne fait que *proposer* une intention ; du code déterministe l'*exécute*.
- 🗣️ **Gestion de tâches en langage naturel** — créer, replanifier, renommer, reprioriser, accomplir, reporter, supprimer — à la voix.
- 🗂️ **Classement automatique** — les tâches sont rangées en dossiers (catégories) et sous-dossiers, avec la personne, le lieu, la date et l'urgence déduits automatiquement.
- 📝 **Notes dictées** — attacher / compléter / lire à voix haute / effacer une note libre sur n'importe quelle tâche.
- 📅 **Calendrier graphique** (paysage) — jour / semaine / mois / année, balayage pour paginer, ± pour zoomer, tap pour zoomer dans le détail — pilotable à la voix aussi.
- 🔁 **Tout est réversible** — dites **« annule »** / **“undo”** pour défaire la dernière action.
- 🌍 **Bilingue FR / EN** — un seul bouton bascule l'interface, la voix (STT + TTS) **et** le prompt du modèle.
- 🎨 **Trois thèmes commutables à chaud** — Signal (lumineux), Local (chaleureux/analogique), On-Device (technique/sombre).
- 🔗 **Synchronisation Google Agenda optionnelle** — pousse vos tâches datées vers l'agenda Google de votre choix, sans que l'app ne fasse le moindre appel réseau (voir plus bas).

---

## Comment ça marche

```
Voix ──▶ STT embarqué ──▶ Gemma 4 E2B ──▶ dispatch déterministe ──▶ SQLite
  (expo-speech-recognition)  (intention JSON)   (simple switch, sans LLM)   (tâches)
                                                        │
                                                        └──▶ confirmation vocale (TTS)
```

- **Gemma est un traducteur d'ontologie** : il fait correspondre une phrase libre à *(intention, entités, attributs)* sous forme d'un objet JSON compact, résout les **références floues** (« la tâche du dentiste ») et les **dates relatives** (« demain 14h » → date absolue).
- **Exécution déterministe** : un simple `switch` transforme ce JSON en une vraie mutation de base de données ou un changement de vue. Le LLM ne touche jamais vos données directement — une incompréhension ne peut donc rien corrompre, et chaque action est réversible.
- **Ontologie ré-ancrée** : la date/heure courante et la liste numérotée des tâches à l'écran sont injectées à **chaque** commande. Cela compense l'absence de raisonnement d'un petit modèle — il n'a jamais à « se souvenir », il a toujours un contexte frais.

---

## Utiliser Kairos

**Accueil** — maintenez l'**orbe** centrale, dites une commande, relâchez. Kairos affiche ce qu'il a compris et confirme à voix haute.
**En-tête** — ☰ liste · ▦ calendrier · ⚙ réglages · 🇫🇷/🇺🇸 bascule de langue.

### Exemples de commandes vocales

**Créer & organiser**
- *« ajoute appeler Paul demain 10h au bureau, c'est urgent »*
- *« ajoute acheter du pain ce soir à la maison »*
- *« ajoute un rendez-vous dentiste vendredi 14h »*

**Afficher / filtrer** (combinez les 6 dimensions)
- *« affiche toutes les tâches »* · *« qu'est-ce qui est en retard »* · *« affiche les tâches de la semaine »*
- *« affiche les tâches urgentes en retard pour Paul »*

**Modifier**
- *« reporte la 2 à vendredi 9h »* · *« déplace le rendez-vous coiffeur du 7 juillet au 8 juillet »*
- *« renomme la 1 en acheter une baguette »* · *« mets la 1 urgente »* · *« déplace la 1 dans le dossier Travail »*
- *« marque la 1 comme faite »* · *« supprime la 2 »* · *« efface toutes les tâches de lundi »* · *« annule »*

**Notes**
- *« ajoute une note à la tâche 1 : apporter le dossier bleu »* · *« complète la note de la 1 : et prévoir le parking »*
- *« lis la note de la 1 »* · *« efface la note de la 1 »*

**Calendrier**
- *« affiche le calendrier hebdomadaire »* · *« affiche le calendrier mensuel / annuel / quotidien »*
- *« zoom avant »* · *« zoom arrière »*

**Synchronisation**
- *« synchronise »* — pousse les tâches datées vers votre agenda Google (à activer d'abord, voir plus bas).

> Toutes ces commandes fonctionnent aussi en anglais — basculez le drapeau et parlez.

### Les 6 dimensions de l'ontologie

Chaque commande peut les combiner librement — pour créer **et** pour filtrer :

| Dimension | Question | Champ | Exemple |
|---|---|---|---|
| **QUOI** | quel dossier/projet | `category` | « dans Santé », « pour le projet X » |
| **QUAND** | quelle fenêtre / échéance | `scope` / `due` | « aujourd'hui », « en retard », « vendredi 14h » |
| **QUI** | quelle personne | `person` | « avec Paul », « pour maman » |
| **OÙ** | quel lieu | `place` | « au bureau », « à la maison » |
| **ÉTAT** | quel statut | `status` | à faire · en attente · accomplie · à reporter · archivée |
| **URGENT** | priorité haute | `priority` | « urgent », « important » |

---

## Thèmes

Choisissez un style pendant le téléchargement unique du modèle, ou changez-en à tout moment dans les **Réglages** — l'app se re-skinne instantanément :

- **Signal** — lumineux, confiant, une orbe vocale bleu→teal vivante.
- **Local** — chaleureux, analogique, tons papier, un serif humaniste, une « pierre d'appui » en argile.
- **On-Device** — sombre, orienté ingénierie, accents menthe, `gemma-4-e2b` sur l'orbe.

---

## Synchronisation Google Agenda (opt-in)

Kairos peut **alimenter un agenda Google** avec vos tâches datées, tout en restant fidèle à sa promesse hors-ligne.

- **Paramétrage (non vocal) :** Réglages → **Synchronisation** → activez → accordez la permission Agenda → choisissez un de vos agendas Google inscriptibles.
- **Déclencher :** dites **« synchronise »** ou touchez **Synchroniser**.
- **Comportement :** unidirectionnel (Kairos → Google), idempotent. Les tâches datées ouvertes deviennent des événements ; les tâches accomplies/supprimées retirent les leurs. Pas de doublon.
- **Confidentialité :** Kairos écrit l'événement dans l'agenda de **l'appareil** ; c'est **l'adaptateur de synchronisation du compte Google d'Android** qui l'envoie. L'app ne fait **aucun OAuth ni appel réseau** — l'invariant « l'app n'envoie rien » tient. Nécessite un compte Google ajouté sur l'appareil, avec la synchro Agenda activée.

---

## Pile technique

| Domaine | Choix |
|---|---|
| Framework | Expo SDK 56 · React Native 0.85 · TypeScript · Hermes |
| LLM embarqué | **Gemma 4 E2B** (GGUF) via `llama.rn` — CPU, `n_ctx` 4096 |
| Voix | `expo-speech-recognition` (STT) · `expo-speech` (TTS) |
| Stockage | `expo-sqlite` |
| Interface | `react-native-svg` (orbe animée), `expo-linear-gradient`, polices Google embarquées via `expo-font` |
| Synchro agenda | `expo-calendar` (écrit dans l'agenda de l'appareil) |

---

## Compiler & lancer (Android)

Un vrai appareil est requis — le modèle de ~3 Go exclut Expo Go, et le build release embarque le bundle JS (pas de Metro).

1. Installez les dépendances : `npm install`.
2. Fournissez le modèle : placez le GGUF Gemma sur l'appareil à
   `/storage/emulated/0/Android/data/com.zepef.kairos/files/gemma-4-E2B.gguf`
   (voir `MODEL_PATH` dans `llm.ts`).
3. Générez le projet natif et compilez :
   ```bash
   npx expo prebuild -p android
   cd android && ./gradlew assembleRelease
   ```
4. Installez l'APK : `adb install -r android/app/build/outputs/apk/release/app-release.apk`.

Au premier lancement, le modèle se charge (une fois), puis Kairos fonctionne entièrement hors-ligne.

---

## Confidentialité

- **L'app n'envoie rien.** Reconnaissance vocale, compréhension, stockage et synthèse vocale se font sur l'appareil.
- Les tâches vivent dans une base **SQLite locale** sur votre téléphone.
- Le **seul** flux sortant optionnel est la synchro Google Agenda — et même là, l'app ne fait qu'écrire dans l'agenda local de l'appareil ; c'est votre **OS** (pas Kairos) qui l'envoie vers votre compte Google.

---

*Kairos — parlez à votre liste de tâches. Elle écoute sur votre téléphone, et nulle part ailleurs.*
