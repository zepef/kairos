---
description: Teste automatiquement toute l'ontologie sur le S96 (drive la puce Tester + vérifie logcat)
allowed-tools: Bash(*), Read(*)
---

Lance un test automatique de **toute l'ontologie** de Kairos sur le S96 branché, sans voix (le bouton « Tester » court-circuite le STT en appelant `runIntent(phrase)` sur les phrases de `TEST_PHRASES`).

Variables : `ADB=~/platform-tools/adb.exe`, paquet `com.zepef.kairos`.

## Procédure

1. **Pré-requis** : `"$ADB" devices` doit lister le S96 en `device`. Lis `App.tsx` pour récupérer la liste `TEST_PHRASES` et son nombre N (le test fait N appuis pour couvrir un cycle complet).

2. **Lancer l'app + attendre le modèle** : `"$ADB" shell monkey -p com.zepef.kairos -c android.intent.category.LAUNCHER 1`, puis `"$ADB" logcat -c`, puis boucle `until` (bornée) jusqu'à voir `KAIROS.*model ready` dans `logcat -d`.

3. **Driver** (réutilise cette logique éprouvée) :
   - Repérer un nœud par `content-desc` : `uiautomator dump /sdcard/d.xml` puis parser les `bounds` du nœud dont le `content-desc` CONTIENT la cible (sous-chaîne, pour gérer « ✕ Fermer »), et `input tap` au centre.
   - Avant chaque appui : si un calendrier est ouvert (paysage), fermer via le nœud contenant `Fermer`, puis `sleep 2`.
   - Compter les lignes `[KAIROS] action` ; taper le nœud `Tester` ; attendre (boucle `until` bornée ~30×1s) que le compteur augmente.
   - Faire N appuis pour parcourir tout `TEST_PHRASES`.

4. **Capturer** depuis `logcat -d` toutes les lignes `[KAIROS] input` (la phrase), le JSON d'intent, et `[KAIROS] action <tool> ok=<bool> :: <speech>`.

## Rapport attendu

- **Tableau** : pour chaque phrase → `tool` émis par Gemma → `ok`/`error` → speech.
- **Couverture ontologie** : ensemble des `tool` attendus =
  `createTask, updateTask, setStatus, deleteTask, deleteTasks, undo, showTasks, showCalendar, zoomCalendar` (+ `unknown` pour une phrase hors-ontologie).
  Liste les intents **couverts** vs **non couverts** par le cycle actuel.
- **Échecs** : signale toute action `ok=false`, tout `unknown`/`parse_error` inattendu, et tout `tool` qui ne correspond pas à l'intention évidente de la phrase (juge la cohérence phrase↔tool).
- **Note** : si `TEST_PHRASES` ne couvre pas tous les intents ci-dessus, dis-le explicitement et propose les phrases manquantes à ajouter (createTask « appeler » → Contact, updateTask, setStatus pending/postponed/archived, deleteTasks par numéros, deleteTasks d'une journée, showTasks par personne/lieu/état/urgent/overdue/reminder, zoomCalendar in/out, une phrase `unknown`).

Important : ce test n'exerce pas le micro/STT réel (non injectable), seulement le chemin Gemma→dispatch→action. Rappelle-le dans la conclusion.

$ARGUMENTS
