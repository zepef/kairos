# Kairos — un assistant de tâches 100 % vocal qui tient sur un téléphone moyen

## 🇫🇷 Version française

### Ce que fait l'application

**Kairos** est un gestionnaire de tâches **piloté à la voix**. On appuie sur le logo central, on parle (« ajoute appeler Paul demain 10 h, c'est urgent »), et l'application **comprend, agit, puis répond à voix haute**. On peut créer, modifier, reporter, terminer, supprimer des tâches, les ranger en dossiers et sous-dossiers, afficher des listes filtrées (par échéance, personne, lieu, urgence, état), ouvrir un **calendrier graphique** en mode paysage (jour / semaine / mois / année) avec zoom et défilement au doigt, attacher une **note dictée** à chaque tâche, supprimer plusieurs tâches d'un coup — le tout **réversible** (« annule »). Au lancement, elle signale même les tâches **en retard**.

La grande particularité : **tout tourne sur l'appareil, hors-ligne**. Aucune donnée ne part dans le cloud. La compréhension du langage est assurée par un **petit modèle de langage embarqué** (Gemma 4 « E2B ») exécuté directement sur le téléphone.

### Comment ça marche

La chaîne est volontairement simple et robuste :

```
Voix → Reconnaissance vocale (STT) → Gemma 4 (→ JSON) → Aiguillage déterministe → SQLite → Synthèse vocale (TTS)
```

Le modèle ne fait **qu'une seule chose** : traduire une phrase en un objet JSON `{outil, paramètres}`. C'est ensuite du **code déterministe** (un simple `switch`) qui exécute l'action sur une base **SQLite** locale et formule la confirmation parlée. Cette séparation est la clé de la fiabilité : le modèle n'écrit jamais dans la base, il ne fait que *proposer une intention*.

### Les astuces pour que ça tienne sur un smartphone moyen

Le téléphone de test (S96, SoC Helio G95) n'a **pas de GPU exploitable** : tout se fait au **CPU**. Faire tourner un LLM dans ces conditions a demandé une série de compromis d'ingénierie :

- **Un modèle minuscule et quantifié.** Gemma 4 « E2B » (variante efficiente) au format GGUF, exécuté **CPU uniquement** (`n_gpu_layers: 0`), sur **4 threads**. C'est ce qui rend l'inférence possible sans accélérateur.
- **On coupe le raisonnement.** Gemma 4 est un modèle « à réflexion » : par défaut, il écrit une longue chaîne de raisonnement (~48 s) avant de répondre. On la **désactive** (`enable_thinking: false`) → on obtient directement le JSON, en quelques secondes.
- **Décodage contraint.** On force la sortie en **JSON valide** (`response_format: json_object`) et on **plafonne la génération** (`n_predict: 120`) : on n'a besoin que d'un petit objet, pas d'un paragraphe.
- **Préchauffage (warm-up).** Au chargement, on **précalcule le prompt système** dans le cache (KV cache). La **première** commande n'est ainsi plus pénalisée par ce calcul (de ~15 s à ~6 s), et les suivantes réutilisent ce préfixe commun.
- **Budget de contexte maîtrisé.** Le prompt système (toute « l'ontologie » des commandes) a grossi ; il a fallu dimensionner la fenêtre (`n_ctx: 4096`) pour couvrir *prompt + phrase + génération*. En dessous, on obtenait « Context is full » sur **toutes** les commandes. Leçon : toujours garder une marge.
- **Du déterministe autour du modèle.** Des expressions régulières ramènent les formulations libres du modèle (et de l'utilisateur) vers des valeurs canoniques (statut, période, niveau de calendrier). Le système tolère ainsi les variations de vocabulaire — **et fonctionne en français comme en anglais**.
- **Tâches numérotées.** Ce qui est à l'écran est numéroté : « supprime la 2 » se résout par le **numéro** (exact, gratuit) avant tout appariement flou par titre. Moins de charge pour le modèle.
- **La dictée court-circuite le LLM.** Quand on dicte le texte d'une **note**, il est stocké tel quel **sans repasser par le modèle** : on évite une inférence et le risque que la note soit prise pour une commande.
- **Le chargement reste fluide.** L'indicateur de chargement est le *spinner natif* d'Android : il est animé par le système, donc il ne saccade pas pendant que le fil JavaScript se fige par à-coups en chargeant le fichier modèle (~3 Go).
- **Build « JS embarqué ».** L'app est compilée en **release** avec le JavaScript intégré : pas besoin d'un serveur de développement sur le téléphone, l'appli est autonome.

### Installation

L'app se distribue en **APK** (hors Play Store) : on télécharge le fichier depuis le lien de partage, puis on autorise **« installer des applications inconnues »** pour son navigateur ou pour Drive au moment de l'installation.
Au **premier lancement**, il faut patienter pendant le chargement du modèle (~3 Go) ; ensuite, tout fonctionne **hors-ligne**, sans compte ni connexion.

### En résumé

Kairos montre qu'on peut offrir une **expérience entièrement vocale, privée et hors-ligne** sur du matériel **moyen de gamme**, à condition de traiter le petit modèle de langage comme un **traducteur d'intentions** — rapide, contraint, préchauffé — et de confier l'exécution à du code déterministe, fiable et réversible.

---

## 🇬🇧 English version

### What the app does

**Kairos** is a **voice-first** task manager. You hold the central logo, speak ("add call Paul tomorrow 10am, it's urgent"), and the app **understands, acts, then answers out loud**. You can create, edit, postpone, complete and delete tasks, file them into folders and sub-folders, show filtered lists (by due date, person, place, urgency, status), open a **graphical landscape calendar** (day / week / month / year) with zoom and finger-swipe paging, attach a **dictated note** to any task, delete several tasks at once — all of it **reversible** ("undo"). At launch it even flags **overdue** tasks.

The defining trait: **everything runs on the device, offline**. No data leaves for the cloud. Language understanding comes from a **small on-device language model** (Gemma 4 "E2B") running directly on the phone.

### How it works

The pipeline is deliberately simple and robust:

```
Voice → Speech-to-text (STT) → Gemma 4 (→ JSON) → Deterministic dispatch → SQLite → Text-to-speech (TTS)
```

The model does **exactly one thing**: turn a sentence into a JSON object `{tool, params}`. From there, **deterministic code** (a plain `switch`) runs the action on a local **SQLite** database and produces the spoken confirmation. That separation is the key to reliability: the model never writes to the database — it only *proposes an intent*.

### The tricks that make it fit a mid-range phone

The test phone (S96, Helio G95 SoC) has **no usable GPU**: everything runs on the **CPU**. Running an LLM under those constraints took a series of engineering trade-offs:

- **A tiny, quantized model.** Gemma 4 "E2B" (the efficient variant) in GGUF format, **CPU-only** (`n_gpu_layers: 0`), on **4 threads**. That's what makes inference possible without an accelerator.
- **Turn reasoning off.** Gemma 4 is a "thinking" model: by default it writes a long reasoning trace (~48 s) before answering. We **disable** it (`enable_thinking: false`) → straight JSON, in a few seconds.
- **Constrained decoding.** We force **valid JSON** output (`response_format: json_object`) and **cap generation** (`n_predict: 120`): we only need a small object, not a paragraph.
- **Warm-up.** On load, we **pre-compute the system prompt** into the KV cache. The **first** command is no longer penalized by that work (from ~15 s down to ~6 s), and later commands reuse the shared prefix.
- **A disciplined context budget.** The system prompt (the whole command "ontology") grew; we had to size the window (`n_ctx: 4096`) to cover *prompt + utterance + generation*. Below that, we hit "Context is full" on **every** command. Lesson: always keep headroom.
- **Determinism around the model.** Regular expressions map the model's (and the user's) free-form wording back to canonical values (status, time span, calendar level). This tolerates vocabulary variation — **and works in English as well as French**.
- **Numbered tasks.** Whatever is on screen is numbered: "delete 2" resolves by **number** (exact, free) before any fuzzy title match. Less load on the model.
- **Dictation bypasses the LLM.** When you dictate a **note**, the text is stored verbatim **without going through the model**: it saves an inference and avoids the note being mistaken for a command.
- **Loading stays smooth.** The loading indicator is Android's *native spinner*: the system animates it, so it never stutters while the JavaScript thread freezes in bursts loading the ~3 GB model file.
- **"JS-embedded" build.** The app is compiled in **release** with JavaScript bundled in: no dev server needed on the phone, the app is self-contained.

### Installation

The app ships as an **APK** (outside the Play Store): download the file from the share link, then allow **"install unknown apps"** for your browser or for Drive when prompted.
On **first launch**, wait while the model (~3 GB) loads; after that, everything works **offline**, with no account and no connection.

### In short

Kairos shows you can deliver a **fully voice-driven, private, offline** experience on **mid-range** hardware — provided you treat the small language model as an **intent translator** (fast, constrained, pre-warmed) and hand execution to deterministic, reliable, reversible code.
