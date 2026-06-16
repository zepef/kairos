# Kairos — Ontologie de l'agenda vocal intelligent

> Modèle conceptuel de référence. Définit *ce qui existe* (entités), *ce qui peut leur arriver* (statuts/transitions), *comment on en parle* (commandes), et *comment le langage devient action* (le pont). Sert de boussole pour l'implémentation et les évolutions.

---

## 1. Principes fondateurs

1. **Voix d'abord.** L'interaction normale est parlée. L'écran est un retour ponctuel, pas un tableau de bord permanent.
2. **Écran minimal.** Rien ne s'affiche par défaut. Le contenu n'apparaît **que** sur commande système explicite, et peut être masqué. *Moins on envoie à l'écran, mieux c'est.*
3. **On-device & offline.** STT, intelligence (Gemma 4) et données (SQLite) tournent sur l'appareil, sans réseau.
4. **Intelligence remplaçable.** Le LLM ne fait que *traduire le langage en action structurée*. Il n'écrit jamais en base directement. La logique métier est déterministe et testable sans LLM.
5. **Tout est réversible.** Aucune action vocale n'est destructrice sans recours (archiver ≠ supprimer ; un statut se ré-applique).

---

## 2. Entités

### 2.1 Tâche (`task`) — l'unité atomique
La seule chose que l'utilisateur crée. Tout le reste (dossiers, vues) en dérive.

| Attribut | Sens |
|---|---|
| `title` | l'action concrète, nettoyée du préambule (« traduction anglaise », pas « pour le projet X, ajoute… ») |
| `due` | échéance **telle que dite** (« demain 14h », « ce soir ») — fidèle à la voix |
| `due_iso` | la même échéance **résolue** en date absolue (ISO) → permet le filtrage temporel |
| `priority` | 0–3 (optionnel) ; déduite si urgence exprimée → base du filtre **URGENT** |
| `category` | **dossier** (niveau 1) — **QUOI** |
| `subcategory` | **sous-dossier** (niveau 2, optionnel) |
| `person` | **QUI** — personne associée (« avec Paul », « le dentiste ») |
| `place` | **OÙ** — lieu / contexte (« au bureau », « à la maison ») |
| `status` | état dans le cycle de vie (voir §3) — **ÉTAT** |
| `created_at` / `completed_at` | horodatage |

### 2.2 Dossier (`category`) — niveau 1, émergent
Regroupement **créé à la volée** quand il est mentionné ; jamais affiché s'il est vide. Deux natures :
- **Thématique** : déduit du sens (dentiste/médecin → *Santé* ; achats → *Courses* ; appeler/téléphoner à quelqu'un → *Contact* ; *Travail*, *Rendez-vous*, *Finances*, *Famille*, *Divers*).
- **Projet** : si un projet est nommé (« le projet Mon Assistant Pro »), le dossier **est** le nom du projet.

### 2.3 Sous-dossier (`subcategory`) — niveau 2, optionnel
Subdivision d'un dossier (ex. *Mon Assistant Pro › UI*, *Kairos › Tests*). Hiérarchie : **Dossier › Sous-dossier › Tâche**. Une tâche peut vivre directement dans son dossier (sans sous-dossier).

### 2.4 Portée temporelle (`scope`) — dimension de lecture
Pas une entité stockée, mais une **fenêtre** sur les tâches datées : `all` (tout), `hours` (prochaines heures), `day` (jour), `week` (semaine), `month` (mois), **`overdue`** (en retard, échéance dépassée), **`reminder`** (RAPPEL = à venir sous 24 h **+** en retard).

---

## 3. Cycle de vie d'une tâche (statuts)

```
            ┌──────────── reporter ◄───────────┐
            ▼                                   │
  [todo] ──pending──► [pending] ──reprendre──► [todo] ──faire──► [done]
   à faire            en attente                                accomplie
     │                                                            │
     └────────────────── archiver ──────────────────► [archived] ◄┘
                                                        archivée
   [postponed] (à reporter) ◄── reporter ── (todo|pending)
```

| Statut | Sens | Visible dans les listes « ouvertes » ? |
|---|---|---|
| `todo` | à faire (actif) | oui |
| `pending` | en attente / bloquée | oui (badge) |
| `postponed` | à reporter / repoussée | oui (badge) |
| `done` | accomplie | non |
| `archived` | archivée (rangée, pas supprimée) | non |

Règle : une liste « ouverte » = tout sauf `done` et `archived`.

---

## 4. Familles de commandes (le cœur « vocal intelligent »)

Toute parole tombe dans une **intention** (`tool`). Trois familles :

### 4.1 Commandes de **données** (mutations) — CRUD complet
- **Créer** (`createTask`) → titre + échéance + dossier/sous-dossier + priorité + personne + lieu (déduits).
- **Modifier** (`updateTask`) → change un ou plusieurs attributs d'une tâche existante (`changes` partiels) : replanifier (`due`/`dueISO`), déplacer (`category`), renommer (`title`), réaffecter (`person`/`place`), reprioriser (`priority`).
- **Changer le statut** (`setStatus`) → done / pending / postponed / archived / todo (cas particulier d'Update, verbe distinct).
- **Supprimer** (`deleteTask`) → suppression réelle d'**une** tâche, mais **réversible** via « annule ».
- **Supprimer en groupe** (`deleteTasks`) → supprime **plusieurs** tâches d'un coup : soit une liste de **numéros** affichés (« supprime les 1, 3 et 5 »), soit **toutes les tâches d'une journée** (« efface toutes les tâches de lundi » → `dayISO`). Réversible **en bloc** par un seul « annule ».
- **Annuler** (`undo`, « annule ») → défait la dernière mutation (create/update/status/delete/deleteTasks). Rend tout réversible d'un mot, y compris une suppression de groupe restaurée d'un coup.

**Référence à une tâche & désambiguïsation.** Les commandes ci-dessus visent UNE tâche. Tout ce qui est affiché (mini-agenda d'accueil, liste, candidats) est **numéroté** : la façon la plus sûre de désigner une tâche est son **numéro** (« supprime la 2 », « la 3 est faite », « modifie la 1 »). À défaut, on résout par mots-clés du titre :
- 0 correspondance → l'app le dit ;
- 1 → on agit ;
- plusieurs → on **affiche les candidates numérotées** et on demande « laquelle ? » ; la réponse (numéro, ordinal, mot distinctif, ou « annule ») choisit la cible.

### 4.2 Commandes **système / vue** (n'altèrent rien, pilotent l'écran)
- **Afficher** : `showTasks(...)` → la **seule** façon de mettre des tâches à l'écran. **Masquer** (`✕`) renvoie à l'accueil vide.

  L'écran montre toujours les tâches **groupées par dossier › sous-dossier** (§2.2–2.3) : c'est la structure. Par-dessus, **six dimensions de filtrage entièrement composables** (chacune facultative ; leur intersection définit l'ensemble affiché) :

  | Dimension | Question | Paramètre | Valeurs |
  |---|---|---|---|
  | **QUOI** | quel dossier/projet | `category` | nom de dossier/projet ou `null` |
  | **QUAND** | quelle fenêtre | `scope` | `all`/`hours`/`day`/`week`/`month`/`overdue`/`reminder` |
  | **QUI** | quelle personne | `person` | nom ou `null` |
  | **OÙ** | quel lieu/contexte | `place` | lieu ou `null` |
  | **ÉTAT** | quel statut | `status` | `pending`/`postponed`/`done`/`archived`/`todo` ou `null` |
  | **URGENT** | priorité haute | `urgent` | `true`/`false` (priorité ≥ 2) |

  Exemples composés : « affiche les tâches de la semaine pour Kairos » → `scope:week, category:"Kairos"` · « les tâches urgentes en retard pour Paul » → `scope:overdue, urgent:true, person:"Paul"` · « ce qui est en attente au bureau » → `status:pending, place:"Bureau"`.

  Règles : sans mention temporelle, `scope:all`. Sans filtre `status`, la liste est « ouverte » (exclut `done`/`archived`) ; un `status` explicite peut faire ressortir `done`/`archived`. Les tâches sans date n'apparaissent pas dans les fenêtres temporelles (seulement `all`). `overdue` = échéance < maintenant ; `reminder` = échéance ≤ +24 h (donc à venir + déjà en retard).
- **Calendrier graphique** (`showCalendar`) → ouvre un calendrier plein écran **en paysage** (« à l'italienne ») à une granularité donnée : `day` / `week` / `month` / `year`. Lecture seule ; navigation par tap (drill sur un mois/jour) et par boutons de zoom. Masquer (`✕`) renvoie à l'accueil.
- **Zoomer le calendrier** (`zoomCalendar`) → change la granularité du calendrier **ouvert** d'un cran : `in` = plus de détail (année→mois→semaine→jour), `out` = plus large (jour→semaine→mois→année). Disponible au tactile (boutons ±) **et** à la voix (« zoom avant / arrière »).
- (futur) **COMMENT** (type d'action : appel/email/rdv/achat), **POURQUOI** (objectif), **DURÉE/EFFORT**, **RÉCURRENCE** ; modificateurs **TRI** et **MODE** (liste vs résumé/compte) ; masquer ciblé, rechercher.

### 4.3 **Inconnu**
- `unknown` quand rien ne correspond → l'app le dit, ne devine pas.

---

## 5. Le pont langage → action

```
Voix ──STT(on-device)──► texte
   └─► Gemma 4 (+ date courante) ──► action structurée JSON {tool, params}
        └─► dispatch (déterministe) ──► DB (tâches) ou Vue (affichage)
             └─► confirmation ──TTS──► Voix
```

Gemma est le **traducteur d'ontologie** : il fait correspondre une formulation libre à *(intention, entités, attributs)*. Il résout aussi les **références floues** (« la tâche du dentiste ») et les **dates relatives** (« demain 14h » → date absolue).

---

## 6. Vocabulaire → ontologie (extraits)

| On dit… | Intention | Détail |
|---|---|---|
| « ajoute… », « rappelle-moi de… », « pour le projet X… », « appeler Paul au bureau, urgent » | `createTask` | dossier = thème ou projet ; `person`/`place`/`priority` déduits |
| « appeler / téléphoner à / rappeler X » | `createTask` | `category = "Contact"` (la personne va dans `person`), même si un lieu est dit |
| « marque X en attente » | `setStatus` | pending |
| « X est faite / accomplie » | `setStatus` | done |
| « reporte X / plus tard » | `setStatus` | postponed |
| « archive X » | `setStatus` | archived |
| « affiche les tâches [du jour / de la semaine / prochaines heures / du mois] » | `showTasks` | `scope` |
| « affiche les tâches pour Paul » | `showTasks` | `person` (QUI) |
| « affiche les tâches au bureau » | `showTasks` | `place` (OÙ) |
| « affiche ce qui est en attente / à reporter » | `showTasks` | `status` (ÉTAT) |
| « qu'est-ce qui est en retard ? » | `showTasks` | `scope:overdue` |
| « affiche les tâches urgentes » | `showTasks` | `urgent:true` |
| « rappelle-moi ce qui arrive et ce qui est en retard » | `showTasks` | `scope:reminder` |
| « affiche le calendrier [du jour / hebdomadaire / mensuel / annuel] » | `showCalendar` | `range` = day/week/month/year (paysage) |
| « zoome / zoom avant », « dézoome / zoom arrière » | `zoomCalendar` | `in` (plus de détail) / `out` (plus large) sur le calendrier ouvert |
| « reporte la 2 à mardi 15h », « renomme la 1 en… », « range X dans Santé » | `updateTask` | `changes` partiels ; référence par **numéro** |
| « supprime la 3 », « efface X » | `deleteTask` | UNE tâche ; réversible via « annule » |
| « supprime les tâches 1, 3 et 5 », « efface toutes les tâches de lundi / d'aujourd'hui » | `deleteTasks` | plusieurs (par `numbers`) ou toute une journée (`dayISO`) ; réversible en bloc |
| « annule », « reviens en arrière » | `undo` | défait la dernière mutation |

---

## 7. Invariants

- Une tâche appartient à **exactement un** dossier (et au plus un sous-dossier).
- Un dossier/sous-dossier **n'existe** que s'il contient au moins une tâche ouverte ; il apparaît et disparaît tout seul.
- L'écran ne montre **que** ce qui a été demandé ; l'état par défaut est vide.
- Une référence vocale doit résoudre vers **une** tâche existante, sinon l'app le signale (pas d'action au hasard).
- Tout ce qui est affiché est **numéroté** ; le numéro est la référence canonique pour le CRUD.
- Toute mutation est **réversible** par « annule » (la dernière action est mémorisée).

---

## 8. Extensions futures (cohérentes avec ce modèle)

- **Niveau 3** : sous-sous-dossiers (ex. *Projet › UI › i18n*).
- **Projet** comme entité first-class (description, échéance globale, avancement) au-delà du simple dossier-nom — base de la dimension **POURQUOI**.
- **Dépendances** entre tâches (DAG) → « tâche bloquée tant que… », `whatNext`.
- **Récurrence** (« tous les lundis »).
- **Notifications** push déclenchées par `due_iso` (au-delà du RAPPEL à l'écran).
- **Dimensions de filtrage restantes** : **COMMENT** (type d'action : appel/email/rdv/achat), **DURÉE/EFFORT**.
- **Modificateurs d'affichage** : **TRI** (par échéance/priorité), **MODE** (liste vs résumé/compte : « résume ma semaine », « combien de tâches pour X »).
- **Commandes système avancées** : « range ce dossier », recherche plein-texte.
