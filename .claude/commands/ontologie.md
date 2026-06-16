---
description: Affiche l'ontologie de Kairos ET en écrit un instantané MD timestampé
allowed-tools: Read(*), Bash(*), Write(*)
---

Affiche l'ontologie de référence de Kairos **et** sauvegarde un instantané daté.

1. Lis `docs/ontologie.md` depuis le répertoire courant (worktree actif sinon racine repo).
2. Construis une présentation lisible reprenant fidèlement les sections clés. **Tous les tableaux** (statuts, dimensions, état du code) doivent être rendus en **caractères d'encadrement box-drawing** (`┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ ─ │`) à l'intérieur d'un **bloc de code** ```` ``` ```` (jamais en tableaux Markdown `| … |`), avec colonnes alignées au caractère près (padding 1 espace de chaque côté ; largeur de colonne = longueur max de la cellule). Pour garantir l'alignement, génère-les via un petit script (ex. Python : largeur = `max(len(cellule))` par colonne) plutôt qu'à la main. Sections clés —
   - Principes fondateurs (voix d'abord, écran minimal, on-device, intelligence remplaçable, réversibilité).
   - Entités (tâche + attributs ; dossier/sous-dossier ; portée temporelle `scope`).
   - Cycle de vie des statuts (todo/pending/postponed/done/archived).
   - Les 3 familles de commandes (données CRUD : createTask/updateTask/setStatus/deleteTask/deleteTasks/undo ; système/vue : showTasks/showCalendar/zoomCalendar ; inconnu).
   - Les 6 dimensions de filtrage composables (QUOI/QUAND/QUI/OÙ/ÉTAT/URGENT).
   - Le pont langage→action (Gemma traducteur, dispatch déterministe).
3. Récap **de l'état réel du code** : liste les `tool` effectivement gérés dans `intent.ts` (cases du switch `dispatch`) et signale tout écart avec la doc (intent documenté mais non implémenté, ou inversement).
4. **Affiche** cette présentation dans le terminal.
5. **Écris-la aussi dans un fichier MD timestampé** :
   - Récupère l'horodatage : `date +%Y%m%d-%H%M%S` (via Bash).
   - Crée le dossier si besoin : `mkdir -p docs/ontologie-snapshots`.
   - Écris le **même contenu** que la présentation (étapes 2-3) dans `docs/ontologie-snapshots/ontologie-<TIMESTAMP>.md`, précédé d'un en-tête `# Ontologie Kairos — instantané <date lisible>` et d'une ligne indiquant la branche git courante (`git branch --show-current`).
6. **Ouvre automatiquement le fichier dans VS Code** (les liens cliquables ne marchent pas dans ce terminal) :
   - Résous le **chemin absolu** : `realpath docs/ontologie-snapshots/ontologie-<TIMESTAMP>.md` (via Bash).
   - Lance `code "<chemin absolu>"` (VS Code est dispo sous WSL ; le `.md` s'ouvre tout seul). Si `code` est introuvable, replier sur `explorer.exe "$(wslpath -w <chemin>)"`.
   - Affiche aussi le chemin absolu **entre backticks** en dernière ligne (pour copie/référence), mais l'ouverture ne dépend pas du clic.

But : donner une vue d'ensemble fidèle ET à jour de ce que l'app comprend réellement, et en garder une trace datée à chaque invocation.

$ARGUMENTS
