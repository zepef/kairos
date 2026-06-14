# Cadence — Document de fondations

> Gestionnaire de planning intelligent, **100 % vocal**, sous **Android**.
> To-do intelligente (tâches + projets), **React Native / Expo**, vocal **on-device**, intelligence via **OpenRouter**, données **local-first + sync**.

Statut : greenfield. Ce document fige le périmètre, l'architecture et les jalons **avant** d'écrire du code.

---

## 1. Vision & principes

Cadence est un assistant de **gestion de tâches et de projets** que l'on pilote **à la voix**, en mains libres. On parle, l'app comprend l'intention, agit sur le planning, et confirme oralement. L'écran est un **filet de sécurité** (consulter, corriger), pas le mode principal.

**Principes directeurs**
1. **Voix d'abord, écran en secours.** Toute action courante doit être faisable sans toucher l'écran.
2. **Local-first.** Voix et données fonctionnent hors-ligne. Le réseau n'est jamais bloquant.
3. **Intelligence remplaçable.** Le LLM est *stateless* : il transforme « langage → action structurée ». On peut changer de modèle (OpenRouter) sans toucher au reste.
4. **Logique métier testable sans LLM.** Priorisation, replanification, dépendances = code déterministe, couvert par des tests unitaires.
5. **Vie privée.** STT/TTS on-device ; seul le texte d'intention sort (cachable, dégradable, désactivable).

**Non-objectifs (v1)**
- Pas de collaboration multi-utilisateurs / partage de planning.
- Pas d'iOS au départ (Android only ; Expo garde la porte ouverte).
- Pas de wake-word « always-on » en v1 (push-to-talk d'abord ; wake-word = exploration ultérieure).

---

## 2. Architecture

### 2.1 Boucle vocale (cœur)
```
[push-to-talk / bouton] 
   → STT on-device (Android SpeechRecognizer via expo-speech-recognition)
   → texte brut
   → Couche Intent : texte + contexte planning → OpenRouter (tool-calling) → action(s) structurée(s)
   → Exécution déterministe sur la base locale (SQLite)
   → Réponse : TTS (expo-speech) + mise à jour UI
```

### 2.2 Les trois couches

**A. App (Expo / React Native / TypeScript)**
- Expo SDK récent, TypeScript strict.
- Navigation minimale : écran « Conversation » (principal) + écran « Agenda/Tâches » (consultation/correction) + écran « Réglages ».
- Secrets (clé OpenRouter) via `expo-secure-store`. Jamais en clair dans le repo.

**B. Données — local-first**
- Moteur : **SQLite on-device**. Choix d'ORM à trancher en jalon 0 : `op-sqlite + Drizzle` (léger, typé, requêtes SQL) vs `WatermelonDB` (sync intégrée, réactif).
- Recommandation de départ : **op-sqlite + Drizzle** (schéma typé, migrations claires, contrôle total ; sync écrite à la main plus tard).
- Sync **optionnelle** vers **Supabase** (jalon tardif) : multi-appareils, jamais requis pour utiliser l'app.

**C. Cerveau — couche Intent (OpenRouter)**
- Un **registre d'outils** (function-calling) décrit les actions possibles. Le LLM ne fait *que* choisir l'outil + remplir les paramètres ; il n'écrit jamais en base directement.
- Provider : **OpenRouter** (flexibilité modèle). Modèle de départ conseillé pour le parsing : un modèle rapide et bon en tool-calling (ex. Claude Haiku ou équivalent via OpenRouter), configurable.
- Le contexte envoyé = texte utilisateur + **snapshot compact** du planning pertinent (tâches du jour, projets actifs, date/heure). Pas tout l'historique : un résumé borné.
- Réponses **cachables** et **dégradables** : si OpenRouter est indisponible, repli sur un parseur de commandes simples (grammaire locale) pour les intentions basiques.

### 2.3 Schéma de données (v1, à affiner en jalon 0)

```
project
  id, name, color, status (active|archived), created_at, updated_at

task
  id, project_id (nullable), title, notes,
  status (todo|doing|done|cancelled),
  priority (0..3 ou score calculé),
  due_at (nullable), scheduled_at (nullable), estimated_minutes (nullable),
  created_at, updated_at, completed_at

task_dependency
  id, task_id, depends_on_task_id        -- DAG ; task_id bloquée tant que depends_on non "done"

time_slot                                 -- créneaux planifiés (optionnel v1)
  id, task_id, start_at, end_at

intent_log                                -- traçabilité vocale
  id, transcript, tool_called, params_json, result (ok|error), created_at
```

`intent_log` sert au debug et à l'amélioration du prompt (quelles phrases ont échoué).

### 2.4 Registre d'outils Intent (v1)

Outils minimaux que le LLM peut appeler :

| Outil | Paramètres | Effet |
|---|---|---|
| `createTask` | title, project?, due?, estimate?, priority? | crée une tâche |
| `listAgenda` | range (today/week), project? | lit les tâches/créneaux |
| `completeTask` | task_ref (titre/relatif) | passe une tâche à done |
| `reprioritize` | task_ref, priority | change la priorité |
| `rescheduleTask` | task_ref, when | change due/scheduled |
| `splitTask` | task_ref, subtasks[] | éclate en sous-tâches |
| `addDependency` | task_ref, depends_on_ref | lie deux tâches |
| `createProject` | name, color? | crée un projet |
| `whatNext` | (contexte) | suggère la prochaine tâche (appelle le moteur de planning) |

`task_ref` = résolution floue (« la tâche dont je parlais », « le rapport client ») → couche de résolution locale (match titre + récence + contexte).

### 2.5 Moteur de planning (déterministe, sans LLM)
- **Priorisation** : score à partir de (échéance, priorité déclarée, durée estimée, dépendances débloquées).
- **`whatNext`** : renvoie la meilleure tâche actionnable maintenant (dépendances satisfaites, créneau libre).
- **Replanification** : décale les tâches en retard, respecte le DAG.
- Tout ça = fonctions pures, **testées unitairement**, indépendantes de la voix et du LLM.

---

## 3. Stack technique (proposition)

| Domaine | Choix | Note |
|---|---|---|
| Framework | Expo (RN) + TypeScript strict | Android cible, iOS possible plus tard |
| STT | `expo-speech-recognition` (Android SpeechRecognizer) | on-device, à valider tôt |
| TTS | `expo-speech` | on-device |
| DB locale | op-sqlite + Drizzle ORM | à confirmer en jalon 0 |
| LLM | OpenRouter (tool-calling), modèle configurable | clé en secure-store |
| Sync (tardif) | Supabase | optionnelle, non bloquante |
| Tests | Vitest/Jest pour le moteur de planning | logique métier d'abord |
| Secrets | expo-secure-store + .env (gitignored) | jamais de clé commitée |

---

## 4. Jalons (« fondations d'abord »)

**J0 — Cadrage technique** *(décisions, peu de code)*
- Trancher op-sqlite+Drizzle vs WatermelonDB.
- Valider que `expo-speech-recognition` couvre le STT on-device Android visé (langue FR, hors-ligne ?).
- Figer le schéma de données et le registre d'outils.
- Livrable : ce doc mis à jour + ADRs courts.

**J1 — Scaffold**
- Projet Expo + TS strict, lint/format, structure de dossiers, gestion secrets.
- App qui démarre sur Android, écrans vides câblés.

**J2 — Données locales**
- Schéma SQLite + migrations + seed.
- Accès typé (repositories) + tests.

**J3 — Walking skeleton vocal**
- Push-to-talk → STT → echo texte à l'écran → TTS.
- **Objectif : valider la voix on-device AVANT toute IA.**

**J4 — Couche Intent (MVP)**
- Registre d'outils + appel OpenRouter en tool-calling.
- Brancher `createTask` et `listAgenda` de bout en bout (voix → DB → TTS).
- `intent_log` actif.

**J5 — Moteur de planning**
- Priorisation, `whatNext`, replanification, dépendances. Tests unitaires.
- Brancher `whatNext`, `reprioritize`, `rescheduleTask`.

**J6 — Robustesse & repli**
- Cache d'intentions, parseur de commandes simples en repli hors-ligne.
- Résolution floue des `task_ref`.

**J7 — Sync Supabase (optionnel)**
- Push/pull local↔cloud, résolution de conflits simple (last-write-wins borné).

---

## 5. Risques & points à valider tôt
1. **STT on-device FR fiable ?** — Android SpeechRecognizer dépend du moteur Google ; le mode hors-ligne FR n'est pas garanti sur tous les appareils. **À tester en J0/J3 sur le device cible.**
2. **Latence boucle vocale** — STT local + aller-retour OpenRouter + TTS doit rester < ~2 s perçu. Cache + modèle rapide.
3. **Résolution des références floues** (« cette tâche ») — sous-estimée ; prévoir une vraie couche de résolution.
4. **Coût/quota OpenRouter** — borner le contexte envoyé, cacher, dégrader.
5. **Push-to-talk vs wake-word** — wake-word always-on = batterie + permissions micro ; hors v1.

---

## 6. Prochaine action
Démarrer **J0** : trancher l'ORM local et **valider le STT on-device FR sur ton device Android cible** (c'est le risque n°1). Tout le reste en dépend.
