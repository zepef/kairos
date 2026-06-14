# Cadence — Journal de session du 2026-06-14

> Sauvegarde de la conversation : cadrage du projet, validation voix on-device, et preuve de concept **Gemma 4 on-device** avec investigation des performances.

---

## 1. Cadrage du projet

Nouvelle application : **gestionnaire de planning intelligent, 100 % vocal, sous Android**.

Décisions actées (via questions/réponses) :

| Sujet | Choix |
|---|---|
| Domaine | **Tâches + projets** (to-do intelligente : priorisation, deadlines, dépendances) |
| Stack | **React Native / Expo** + TypeScript (Android cible) |
| Voix | **On-device max** — STT `expo-speech-recognition`, TTS `expo-speech` |
| Données | **Local-first + sync** — SQLite on-device, sync Supabase optionnelle |
| Cerveau IA | **OpenRouter** au départ (flexibilité), puis pivot vers **LLM local Gemma** |
| Démarrage | **Plan détaillé d'abord** |
| Nom | **Cadence** |

**Architecture cible** : 3 couches — App (Expo) / Données (SQLite local-first) / Intent (LLM en tool-calling).
Boucle vocale : `push-to-talk → STT local → texte → LLM (action JSON) → exécution DB → TTS`.

Plan de fondations détaillé écrit dans [`docs/fondations.md`](./fondations.md) (jalons J0→J7, schéma de données, registre d'outils, risques).

---

## 2. Mise en place ADB + qualification du device

- Débogage USB activé côté téléphone.
- `adb` absent du système → téléchargement des **platform-tools Windows** ; écriture sur `/mnt/c` interdite (sandbox) → binaire gardé dans `~/platform-tools/`, exécuté via l'interop WSL (`adb.exe`).
- **Device cible qualifié : S96GT / S96 Pro (ZN129T_EEA)**
  - Android **12 (API 31)**, locale **fr-FR**
  - **MediaTek Helio G95 (MT6785)**, arm64-v8a, **8 cœurs** (2× A76 + 6× A55)
  - **~8 Go RAM**, 168 Go libres
  - GMS complets : Google app (STT) + Google TTS présents

**Contrainte découverte** : l'API STT on-device native (`createOnDeviceSpeechRecognizer`) n'existe qu'à partir d'**Android 13 / API 33** → indisponible sur ce S96.
**Décision** : STT hybride pragmatique (`EXTRA_PREFER_OFFLINE` + pack FR, repli en ligne).

---

## 3. Toolchain Android (userspace, sans sudo)

- **JDK 17 Temurin** → `~/jdk17`
- **Android SDK** (cmdline-tools, platform-tools, platform-34, build-tools-34) → `~/Android/Sdk`
  - Gradle auto-installe le reste (NDK 27.1, platform/build-tools 36) car licences acceptées.
- Env réutilisable : `source ~/cadence-android-env.sh`
- Build : `expo prebuild --platform android` puis `cd android && ./gradlew assembleRelease --no-daemon`

**Leçon clé** : le build **debug** exige Metro, et le pont `adb reverse` ne relaie pas jusqu'à Metro dans WSL → écran rouge « Unable to load script ».
➡️ **Solution = `assembleRelease`** (JS embarqué, signé avec la clé debug par défaut du template Expo → installable direct, tourne sans câble/Metro). APK : `android/app/build/outputs/apk/release/app-release.apk`.

---

## 4. Walking-skeleton vocal — VALIDÉ

App de test : push-to-talk → STT FR → transcript live → écho TTS (+ interrupteur « préférer hors-ligne »).

**Résultat (test réel utilisateur) :**
- ✅ **STT FR fonctionnel** sur le S96
- ✅ **TTS fonctionnel**
- ✅ **Fonctionne aussi HORS-LIGNE** (wifi coupé)

➡️ **Risque n°1 (voix on-device) levé ; stratégie 100 % on-device confirmée.**

---

## 5. Pivot : LLM local Gemma 4 on-device

Demande utilisateur : faire tourner un **LLM local sur le téléphone** pour la couche d'intention.

- Correction de cap : **Gemma 4 existe** (sorti après la date de connaissance de l'assistant, vérifié par recherche web). Gamme : E2B / E4B (edge/on-device), 12B, 31B, 26B-A4B (MoE).
- Cible S96 → **Gemma 4 E2B** (2,3B effectifs / 5,1B total) en **UD-Q4_K_XL** (~3,18 Go), depuis `unsloth/gemma-4-E2B-it-GGUF`.
- Lib : **`llama.rn` 0.12.4** (supporte `LLM_ARCH_GEMMA4`, + `messages`/`jinja`/`response_format`/`enable_thinking`).
- GGUF poussé au runtime dans le dossier privé de l'app :
  `/storage/emulated/0/Android/data/com.zepef.cadence/files/gemma-4-E2B.gguf`
- Code : `llm.ts` (load + `parseIntent`) + panneau de test dans `App.tsx`.

### Pièges résolus

1. **Gemma 4 est un modèle à RAISONNEMENT** (thinking ON par défaut) → dump un long « Thinking Process » (~48 s) et se fait couper avant le JSON.
   ➡️ Fix : `enable_thinking: false` + `reasoning_format: "none"`.
2. **Sortie enveloppée dans un fence ```json** (le `response_format json_object` n'est pas strictement appliqué avec jinja).
   ➡️ Fix : extraction du JSON pur côté JS (`extractJson`).
3. **Bug UI** : page non scrollable (seul le Journal scrollait) → toute la page rendue scrollable.

### Premier résultat correct

Entrée : *« ajoute appeler le dentiste demain à 14h »*
Sortie on-device :
```json
{"tool":"createTask","title":"appeler le dentiste","due":"demain 14h","priority":2}
```
✅ Tool correct, titre extrait, échéance et priorité. **Gemma 4 E2B tourne réellement sur le S96.**

---

## 6. Investigation des performances

Latence initiale ~15 s/commande. Sur conseil (ne pas dégainer Q3 avant de décomposer) : **mesurer le prefill (TTFT) vs le décodage** via les `timings` de llama.cpp.

### Breakdown — 5 phrases différentes, après 1 chargement

| # | Énoncé | Prefill | Décodage | Total |
|---|--------|---------|----------|-------|
| 1 (à froid) | dentiste demain 14h | **8782 ms / 192 tok** | 5860 ms / 32 tok | **14,8 s** |
| 2 | acheter du pain ce soir | 963 ms / 16 tok | 5227 ms / 26 tok | 6,6 s |
| 3 | qu'ai-je prévu demain ? | 1063 ms / 18 tok | 2810 ms / 15 tok | **3,9 s** |
| 4 | marquer réunion terminée | 821 ms / 11 tok | 3121 ms / 17 tok | 4,0 s |
| 5 | tâche urgente rapport | 1056 ms / 15 tok | 4955 ms / 27 tok | 6,2 s |

### Conclusions

- **Run 1 à froid** : prefill de 192 tokens = le préfixe statique complet (system prompt + défs d'outils) → 8,8 s.
- **Runs 2-5 (énoncés différents)** : prefill de **11-18 tokens seulement** = juste l'énoncé. Les ~176 tokens de préfixe statique sont **réutilisés gratuitement par le KV cache — automatiquement dans llama.rn, sans code.**
- **À froid = prefill-bound** (coût unique). **En régime courant = decode-bound** (~5,4 tok/s, latence ∝ longueur de sortie).
- Prefill à froid 21,9 tok/s = 4× le décodage → kernels matmul OK (cohérent avec dotprod actif). n_threads = 4.

### Leviers d'optimisation restants (dans l'ordre)

1. **Warm-up au chargement** (complétion bidon au load) → éliminer le 15 s du tout premier appel. Quasi gratuit.
2. **Décodage** (le plancher désormais) : sorties JSON plus courtes ; tuning threads (A76, éviter les A55) ; vérifier les kernels dotprod ; et surtout **sortir le décodage du chemin critique** (note brute affichée immédiatement, version structurée en tâche de fond) + **fast-path déterministe** pour les captures canoniques (attaque la médiane, pas que le pire cas).
3. Quant plus légère (Q3/IQ3) seulement si nécessaire après les leviers ci-dessus.

---

## 7. État du code

- Branche de travail mergée dans `main`.
- Commits clés : squelette vocal → ajout llama.rn → Gemma 4 (thinking off, strip fence, UI scrollable) → instrumentation timings → phrases de test variées.
- Helper `llm.ts` (`loadModel`, `parseIntent`, `extractJson`, timings prefill/decode).
- `App.tsx` : panneau de test Gemma (charger, tester l'intention, breakdown perf).

## 8. Prochaines étapes

- Implémenter le **warm-up** au chargement.
- Décider : on-device optimisé (choisi) vs hybride OpenRouter+repli local.
- Reprendre les jalons fondations : **J2** (schéma SQLite local) / **J4** (couche intent → exécution DB).
