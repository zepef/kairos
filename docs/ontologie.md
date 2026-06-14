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
| `priority` | 0–3 (optionnel) |
| `category` | **dossier** (niveau 1) |
| `subcategory` | **sous-dossier** (niveau 2, optionnel) |
| `status` | état dans le cycle de vie (voir §3) |
| `created_at` / `completed_at` | horodatage |

### 2.2 Dossier (`category`) — niveau 1, émergent
Regroupement **créé à la volée** quand il est mentionné ; jamais affiché s'il est vide. Deux natures :
- **Thématique** : déduit du sens (dentiste/médecin → *Santé* ; achats → *Courses* ; *Travail*, *Appels*, *Rendez-vous*, *Finances*, *Famille*, *Divers*).
- **Projet** : si un projet est nommé (« le projet Mon Assistant Pro »), le dossier **est** le nom du projet.

### 2.3 Sous-dossier (`subcategory`) — niveau 2, optionnel
Subdivision d'un dossier (ex. *Mon Assistant Pro › UI*, *Kairos › Tests*). Hiérarchie : **Dossier › Sous-dossier › Tâche**. Une tâche peut vivre directement dans son dossier (sans sous-dossier).

### 2.4 Portée temporelle (`scope`) — dimension de lecture
Pas une entité stockée, mais une **fenêtre** sur les tâches datées : `hours` (prochaines heures), `day` (jour), `week` (semaine), `month` (mois), `all` (tout, groupé par dossier).

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

### 4.1 Commandes de **données** (mutations)
- **Créer** : `createTask` → titre + échéance + dossier/sous-dossier + priorité (déduits).
- **Changer le statut** : `setStatus` → done / pending / postponed / archived / todo.

### 4.2 Commandes **système / vue** (n'altèrent rien, pilotent l'écran)
- **Afficher** : `showTasks(scope)` → la **seule** façon de mettre des tâches à l'écran.

  L'affichage se lit sur **deux niveaux composables** :
  - **Niveau 1 — structure (dossiers).** L'écran montre toujours les tâches **groupées par dossier › sous-dossier** (cf. §2.2–2.3). C'est la colonne vertébrale spatiale/thématique.
  - **Niveau 2 — fenêtre temporelle.** Un filtre temporel appliqué *par-dessus* la structure :
    - « affiche les tâches » → `all` (aucun filtre — tout l'ouvert)
    - « pour les prochaines heures » → `hours`
    - « du jour » → `day` · « de la semaine » → `week` · « du mois » → `month`

  Donc « affiche les tâches du jour » = *les tâches dont l'échéance tombe aujourd'hui, groupées par dossier*. Le temporel restreint l'ensemble ; les dossiers le structurent. (Les tâches sans date n'apparaissent que dans `all`.)
- (futur niveau 1 alternatif) afficher **un dossier** précis, **un statut** (« ce qui est en attente »), **un projet** — toujours combinables avec le niveau 2 temporel.
- (futur) masquer, naviguer, rechercher, trier.

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
| « ajoute… », « rappelle-moi… », « pour le projet X… » | `createTask` | dossier = thème ou projet |
| « marque X en attente » | `setStatus` | pending |
| « X est faite / accomplie » | `setStatus` | done |
| « reporte X / plus tard » | `setStatus` | postponed |
| « archive X » | `setStatus` | archived |
| « affiche les tâches [du jour / de la semaine / prochaines heures] » | `showTasks` | scope |

---

## 7. Invariants

- Une tâche appartient à **exactement un** dossier (et au plus un sous-dossier).
- Un dossier/sous-dossier **n'existe** que s'il contient au moins une tâche ouverte ; il apparaît et disparaît tout seul.
- L'écran ne montre **que** ce qui a été demandé ; l'état par défaut est vide.
- Une référence vocale doit résoudre vers **une** tâche existante, sinon l'app le signale (pas d'action au hasard).

---

## 8. Extensions futures (cohérentes avec ce modèle)

- **Niveau 3** : sous-sous-dossiers (ex. *Projet › UI › i18n*).
- **Projet** comme entité first-class (description, échéance globale, avancement) au-delà du simple dossier-nom.
- **Dépendances** entre tâches (DAG) → « tâche bloquée tant que… », `whatNext`.
- **Récurrence** (« tous les lundis »).
- **Rappels / notifications** déclenchés par `due_iso`.
- **Contexte** : lieu (« quand je suis au bureau »), personnes.
- **Commandes système avancées** : « range ce dossier », « résume ma semaine », « qu'est-ce qui est en retard ? ».
