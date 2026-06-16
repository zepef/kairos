---
description: Build the Kairos release APK from the current dir and install it on the S96
allowed-tools: Bash(*), Read(*)
---

Construis l'APK release de Kairos depuis le **répertoire de travail courant** (le worktree actif s'il y en a un, sinon la racine du repo) puis installe-le sur le S96. Marche à suivre :

1. **Dossier de build** = `$(pwd)` (le répertoire courant de la session). Toutes les commandes Gradle/adb visent ce dossier.

2. **Toolchain** : `source ~/kairos-android-env.sh` (exporte JAVA_HOME, ANDROID_HOME, PATH).

3. **node_modules** : s'il est absent du dossier courant (worktree), crée un lien : `ln -s /home/zepef/projects/kairos/node_modules ./node_modules`.

4. **prebuild** (seulement si `android/` n'existe pas encore) : `npx expo prebuild --platform android --no-install`.

5. **Build en arrière-plan** (run_in_background), en logguant dans `$CLAUDE_JOB_DIR/tmp/` :
   `source ~/kairos-android-env.sh && cd android && ./gradlew assembleRelease --no-daemon`
   APK attendu : `android/app/build/outputs/apk/release/app-release.apk`.

6. **À la fin du build** (exit 0) : installe via l'adb interop WSL —
   `~/platform-tools/adb.exe install -r "$(pwd)/android/app/build/outputs/apk/release/app-release.apk"`.
   (Vérifie d'abord `~/platform-tools/adb.exe devices` ; l'adb Linux du SDK ne voit pas l'USB sous WSL.)

7. **Confirme** : taille/horodatage de l'APK, résultat de l'install (`Success`), et `lastUpdateTime` du paquet `com.zepef.kairos`.

Rappels :
- Ne lance ce build que parce que l'utilisateur l'a explicitement demandé (cf. mémoire « build sur demande »).
- Le build debug ne marche pas sous WSL (Metro) → toujours `assembleRelease` (JS embarqué).
- Si aucun appareil n'est détecté, construis quand même l'APK et signale qu'il reste à brancher le S96 pour l'installer.

$ARGUMENTS
