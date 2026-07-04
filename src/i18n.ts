import type { CalRange, Scope } from "./intent";
import type { TaskStatus } from "./db";
import type { ThemeName } from "./theme";

// Kairos is bilingual FR/EN. Every user-facing string — on-screen chrome AND the
// spoken (TTS) feedback — lives here so a single language switch retranslates the
// whole app. `tr(lang)` returns one flat object used by App, calendar and intent.
// The Gemma SYSTEM prompt + STT/TTS locales live in llm.ts / are wired in App.

export type Lang = "fr" | "en";

// STT recognizer + TTS voice locale per language.
export const STT_LANG: Record<Lang, string> = { fr: "fr-FR", en: "en-US" };
export const TTS_LANG: Record<Lang, string> = { fr: "fr-FR", en: "en-US" };
// Locale for Date.toLocaleTimeString (calendar chips).
export const DATE_LOCALE: Record<Lang, string> = { fr: "fr-FR", en: "en-US" };
// The "other" language — used by the flag toggle.
export const OTHER_LANG: Record<Lang, Lang> = { fr: "en", en: "fr" };

const CAP = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const FR = {
  // ── Calendar names ────────────────────────────────────────────────
  days: ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"],
  months: [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ],
  monthsShort: [
    "Janv", "Févr", "Mars", "Avr", "Mai", "Juin",
    "Juil", "Août", "Sept", "Oct", "Nov", "Déc",
  ],
  levelLabel: { day: "Jour", week: "Semaine", month: "Mois", year: "Année" } as Record<CalRange, string>,

  // ── Label maps (spoken + displayed) ───────────────────────────────
  calLabel: { day: "quotidien", week: "hebdomadaire", month: "mensuel", year: "annuel" } as Record<CalRange, string>,
  statusLabel: { todo: "à faire", pending: "en attente", done: "accomplie", postponed: "à reporter", archived: "archivée" } as Record<TaskStatus, string>,
  scopeLabel: {
    all: "toutes les tâches",
    hours: "les tâches des prochaines heures",
    day: "les tâches du jour",
    week: "les tâches de la semaine",
    month: "les tâches du mois",
    overdue: "les tâches en retard",
    reminder: "le rappel des tâches à venir et en retard",
  } as Record<Scope, string>,
  scopeTitle: {
    all: "Toutes les tâches",
    hours: "Prochaines heures",
    day: "Aujourd'hui",
    week: "Cette semaine",
    month: "Ce mois",
    overdue: "En retard",
    reminder: "Rappel",
  } as Record<Scope, string>,
  statusTitle: {
    todo: "à faire", pending: "en attente", postponed: "à reporter", done: "accomplies", archived: "archivées",
  } as Partial<Record<TaskStatus, string>>,
  statusBadge: { pending: "en attente", postponed: "à reporter" } as Partial<Record<TaskStatus, string>>,

  // ── App UI chrome ─────────────────────────────────────────────────
  justAMoment: "Un instant SVP",
  loadFailed: "Échec du chargement. Toucher pour réessayer.",
  listeningShort: "À l'écoute…",
  understanding: "Compréhension en cours…",
  upcoming: "À venir",
  whichOne: "Laquelle ?",
  cancelBtn: "✕ Annuler",
  hideBtn: "✕ Masquer",
  nothingOverdue: "Rien en retard.",
  noTasksCriteria: "Aucune tâche pour ces critères.",
  miscFolder: "Divers",
  testChip: "Tester",
  versionLabel: "Kairos version 0.8",
  // display title qualifiers
  qualUrgent: "urgent",
  qualFor: (c: string) => `pour ${c}`,
  qualWith: (p: string) => `avec ${p}`,
  qualAt: (pl: string) => `à ${pl}`,

  // ── Redesign v0.8: theme picker · orb · nav · settings ────────────
  themeName: { signal: "Signal", local: "Local", onDevice: "On-Device" } as Record<ThemeName, string>,
  themeTag: {
    signal: "Lumineux · évolue la marque",
    local: "Chaleureux · vos données chez vous",
    onDevice: "Technique · pour les initiés",
  } as Record<ThemeName, string>,
  pickerTitle: "Choisissez votre style",
  pickerSubtitle: "Modifiable à tout moment dans les Réglages.",
  pickerLoading: "Chargement du modèle",
  pickerWarmup: "Préchauffage du modèle…",
  pickerOnceOffline: "Une seule fois. Ensuite, 100 % hors-ligne.",
  pickerStart: "Commencer",
  orbHoldIdle: "Maintenez pour parler",
  orbHoldListening: "Relâchez pour envoyer",
  orbUnderstanding: "Compréhension…",
  orbSub: "Compris et répondu sur votre téléphone",
  orbSubListening: "Rien ne quitte l'appareil",
  navList: "Liste",
  navCalendar: "Calendrier",
  navSettings: "Réglages",
  closeBtn: "✕ Fermer",
  undoHint: "Dites « annule » pour revenir en arrière",
  settingsTitle: "Réglages",
  settingsAppearance: "Apparence",
  settingsLanguage: "Langue",
  settingsInterfaceVoice: "Interface et voix",
  settingsVoice: "Voix",
  settingsSpokenReplies: "Réponses vocales",
  settingsSpokenRepliesSub: "Kairos répond à voix haute",
  settingsModelPrivacy: "Modèle et confidentialité",
  settingsModelName: "Gemma 4 · E2B",
  settingsModelMeta: "3 Go · sur l'appareil",
  settingsReady: "Prêt",
  settingsPrivacyLine: "✈ 100 % hors-ligne · 0 donnée envoyée",
  // ── Synchronisation Google Agenda ──
  settingsSync: "Synchronisation",
  settingsSyncGoogle: "Google Agenda",
  settingsSyncSub: "Alimente l'agenda choisi avec vos tâches datées",
  settingsSyncNoCalendar:
    "Aucun agenda Google inscriptible. Ajoutez un compte Google (Réglages Android) avec la synchro Agenda activée.",
  settingsSyncNow: "Synchroniser maintenant",
  settingsPrivacyLineSync:
    "🔄 Synchro via votre compte Google — c'est l'appareil, pas l'app, qui envoie",
  gcalSynced: (created: number, updated: number, deleted: number) =>
    `Agenda synchronisé : ${created} ajoutée${created > 1 ? "s" : ""}, ${updated} mise${updated > 1 ? "s" : ""} à jour, ${deleted} retirée${deleted > 1 ? "s" : ""}.`,
  gcalNothing: "Agenda déjà à jour.",
  gcalNoCalendar: "Aucun agenda configuré. Choisissez-en un dans les Réglages.",
  gcalNoPermission: "Accès à l'agenda refusé.",
  gcalCalendarMissing:
    "L'agenda choisi est introuvable. Reconfigurez-le dans les Réglages.",
  gcalError: "La synchronisation a rencontré une erreur.",

  // ── Sécurité : verrouillage + chiffrement ─────────────────────────
  settingsLock: "Verrouillage",
  settingsLockSub: "Exiger la biométrie ou un code à l'ouverture",
  settingsEncryption: "Chiffrement",
  settingsEncryptionSub: "Chiffrer la base de données sur l'appareil",
  lockBiometricAvailable: "Biométrie disponible sur cet appareil",
  lockBiometricUnavailable: "Pas de biométrie — seul le code sera demandé",
  lockSetPasscode: "Définir un code",
  lockChangePasscode: "Changer le code",
  lockPasscodePlaceholder: "Code (4 caractères min.)",
  lockPasscodeConfirmPlaceholder: "Confirmer le code",
  lockSave: "Enregistrer",
  lockCancel: "Annuler",
  lockPasscodeMismatch: "Les deux codes ne correspondent pas.",
  lockPasscodeTooShort: "Le code doit faire au moins 4 caractères.",
  lockPasscodeSaved: "Code enregistré.",
  lockNeedsPasscodeFirst: "Définissez d'abord un code pour activer le verrouillage.",
  encMode: "Mode de clé",
  encModeRecoverable: "Récupérable · protégé par l'appareil",
  encModeZk: "Zéro-connaissance · dérivé de votre code",
  encEnableZk: "Activer le mode zéro-connaissance",
  encDisableZk: "Revenir au mode récupérable",
  encZkNeedsLock: "Activez d'abord le verrouillage et définissez un code.",
  encZkWarnTitle: "Mode zéro-connaissance",
  encZkWarnBody:
    "La clé de chiffrement sera dérivée de votre code. Si vous l'oubliez, vos données seront DÉFINITIVEMENT perdues — aucune récupération n'est possible. Préférez une phrase longue à un code court.",
  encZkConfirm: "J'ai compris, activer",
  encZkEnterPasscode: "Entrez votre code pour dériver la clé",
  encZkBiometric: "Déverrouillage biométrique",
  encZkBiometricSub: "Pratique, mais la clé est mise en cache sur l'appareil",
  encMigrating: "Chiffrement en cours… ne fermez pas l'application.",
  encDecrypting: "Déchiffrement en cours… ne fermez pas l'application.",
  encRekeying: "Changement de clé… ne fermez pas l'application.",
  encEnabledMsg: "Chiffrement activé.",
  encDisabledMsg: "Chiffrement désactivé.",
  encError: "Échec de l'opération. Vos données sont intactes.",
  settingsPrivacyLineEncrypted: "🔒 Chiffré sur l'appareil · 0 donnée envoyée",

  // ── Écran de déverrouillage ───────────────────────────────────────
  unlockTitle: "Kairos est verrouillé",
  unlockSubtitle: "Déverrouillez pour accéder à vos tâches",
  unlockUseBiometric: "Utiliser la biométrie",
  unlockEnterCode: "Entrez votre code",
  unlockCodePlaceholder: "Code",
  unlockSubmit: "Déverrouiller",
  unlockWrong: "Code incorrect.",
  unlockBiometricPrompt: "Déverrouiller Kairos",
  unlockLockedOut: (sec: number) =>
    `Trop d'essais. Réessayez dans ${sec} s.`,

  // ── Écran de récupération (état incohérent) ───────────────────────
  recoverTitle: "Données inaccessibles",
  recoverKeyMissingBody:
    "La clé de chiffrement est introuvable sur cet appareil (réinstallation ou restauration). Les données chiffrées ne peuvent pas être ouvertes.",
  recoverTryPasscode: "Entrer mon code (mode zéro-connaissance)",
  recoverResetBtn: "Effacer et repartir à zéro",
  recoverResetTitle: "Tout effacer ?",
  recoverResetBody:
    "Cela supprime définitivement les données chiffrées et réinitialise Kairos.",
  recoverResetConfirm: "Effacer",
  recoverCancel: "Annuler",

  // ── Calendar chrome ───────────────────────────────────────────────
  calClose: "✕ Fermer",
  calUpcoming: "À venir",
  calNothingHorizon: "Rien de daté à l'horizon.",

  // ── Spoken feedback shared by App + intent ────────────────────────
  loadingModel: "Patienter pendant le chargement du modèle.",
  initSystem: "Initialisation du système.",
  holdButton: "Maintenez le bouton central appuyé pour enregistrer votre commande.",
  micDenied: "permission micro refusée",
  notUnderstood: "Je n'ai pas compris.",
  notUnderstoodRequest: "Je n'ai pas compris la demande.",
  parseError: "Je n'ai pas bien compris.",
  taskNotFound: "Je n'ai pas trouvé cette tâche.",
  cancelled: "Annulé.",
  nothingToUndo: "Rien à annuler.",
  undone: "C'est annulé.",
  calendarNotOpen: "Le calendrier n'est pas ouvert.",
  whichTaskToAdd: "Quelle tâche dois-je ajouter ?",
  whatToModify: "Que dois-je modifier ?",
  severalWhich: "Plusieurs tâches correspondent. Laquelle ?",
  severalWhichModify: "Plusieurs tâches correspondent. Laquelle modifier ?",
  severalWhichDelete: "Plusieurs tâches correspondent. Laquelle supprimer ?",
  severalWhichNote: "Plusieurs tâches correspondent. À laquelle ajouter une note ?",
  severalWhichAppend: "Plusieurs tâches correspondent. À laquelle ajouter ?",
  noTaskToDelete: "Je n'ai trouvé aucune tâche à supprimer.",
  noteUntouched: "D'accord, je ne touche pas à la note.",
  noteCancelled: "Note annulée.",
  whichTaskEditNote: "De quelle tâche dois-je modifier la note ? Précisez le numéro.",
  whichTaskReadNote: "De quelle tâche dois-je lire la note ? Précisez le numéro.",
  zoomIn: "Je zoome.",
  zoomOut: "Je dézoome.",
  // qualifiers spoken by intent.showTasks
  spokenUrgent: "urgentes",
  spokenFor: (c: string) => `pour ${c}`,
  spokenWith: (p: string) => `avec ${p}`,
  spokenAt: (pl: string) => `à ${pl}`,

  // parameterized spoken builders
  whichNote: (title: string) => `Quelle note pour ${title} ?`,
  whatToAddToNote: (title: string) => `Que dois-je ajouter à la note de ${title} ?`,
  noteRemovedUndo: (title: string) => `Note supprimée de ${title}. Dites « annule » pour récupérer.`,
  noteRemoved: (title: string) => `Note supprimée de ${title}.`,
  noteCompleted: (title: string) => `Note complétée pour ${title}.`,
  noteSaved: (title: string) => `Note enregistrée pour ${title}.`,
  noteAdded: (title: string) => `Note ajoutée à ${title}.`,
  noNote: (title: string) => `${title} n'a pas de note.`,
  noNoteAskAdd: (title: string) => `${title} n'a pas de note. Quelle note veux-tu ajouter ?`,
  editNotePrompt: (title: string, note: string) =>
    `Note de ${title} : « ${note} ». Veux-tu l'éditer, la compléter ou l'effacer ?`,
  readNoteSpeech: (title: string, note: string) => `Note de ${title} : ${note}`,
  overdueOne: (title: string) => `Attention, une tâche est en retard : ${title}.`,
  overdueMany: (n: number) => `Attention, vous avez ${n} tâches en retard.`,
  deletedUndo: (title: string) => `Supprimé : ${title}. Dites « annule » pour récupérer.`,
  manyDeletedUndo: (n: number) =>
    `${n} tâche${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}. Dites « annule » pour tout récupérer.`,
  statusSet: (title: string, statusWord: string) => `${title} : ${statusWord}.`,
  updated: (title: string) => `${title} : mis à jour.`,
  taskAdded: (where: string, title: string, due: string) =>
    `Tâche ajoutée${where ? ` dans ${where}` : ""} : ${title}${due ? `, ${due}` : ""}.`,
  showTasksSpeech: (scopeWord: string, quals: string[]) =>
    `Voici ${scopeWord}${quals.length ? " " + quals.join(", ") : ""}.`,
  calendarShown: (label: string) => `Voici le calendrier ${label}.`,
  calendarLevel: (label: string) => `Calendrier ${label}.`,

  // ── Calendar title builders (need the localized name arrays) ──────
  dayTitle: (dayName: string, date: number, monthName: string) =>
    `${dayName.toLowerCase()} ${date} ${monthName.toLowerCase()}`,
  weekTitle: (date: number, monthShort: string) => `Semaine du ${date} ${monthShort.toLowerCase()}`,
  monthTitle: (monthName: string, year: number) => `${monthName} ${year}`,
  railDate: (date: number, monthShort: string) => `${date} ${monthShort.toLowerCase()}`,
  hourLabel: (h: number) => `${String(h).padStart(2, "0")}h`,
};

export type Strings = typeof FR;

const EN: Strings = {
  days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  months: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  monthsShort: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ],
  levelLabel: { day: "Day", week: "Week", month: "Month", year: "Year" },

  calLabel: { day: "daily", week: "weekly", month: "monthly", year: "yearly" },
  statusLabel: { todo: "to do", pending: "pending", done: "done", postponed: "postponed", archived: "archived" },
  scopeLabel: {
    all: "all tasks",
    hours: "the tasks for the next few hours",
    day: "today's tasks",
    week: "this week's tasks",
    month: "this month's tasks",
    overdue: "the overdue tasks",
    reminder: "the reminder of upcoming and overdue tasks",
  },
  scopeTitle: {
    all: "All tasks",
    hours: "Next hours",
    day: "Today",
    week: "This week",
    month: "This month",
    overdue: "Overdue",
    reminder: "Reminder",
  },
  statusTitle: { todo: "to do", pending: "pending", postponed: "to postpone", done: "completed", archived: "archived" },
  statusBadge: { pending: "pending", postponed: "to postpone" },

  justAMoment: "Just a moment",
  loadFailed: "Loading failed. Tap to retry.",
  listeningShort: "Listening…",
  understanding: "Understanding…",
  upcoming: "Upcoming",
  whichOne: "Which one?",
  cancelBtn: "✕ Cancel",
  hideBtn: "✕ Hide",
  nothingOverdue: "Nothing overdue.",
  noTasksCriteria: "No tasks for these filters.",
  miscFolder: "Misc",
  testChip: "Test",
  versionLabel: "Kairos version 0.8",
  qualUrgent: "urgent",
  qualFor: (c: string) => `for ${c}`,
  qualWith: (p: string) => `with ${p}`,
  qualAt: (pl: string) => `at ${pl}`,

  // ── Redesign v0.8 ─────────────────────────────────────────────────
  themeName: { signal: "Signal", local: "Local", onDevice: "On-Device" },
  themeTag: {
    signal: "Bright · evolves the brand",
    local: "Warm · your data stays with you",
    onDevice: "Technical · for insiders",
  },
  pickerTitle: "Choose your style",
  pickerSubtitle: "Changeable anytime in Settings.",
  pickerLoading: "Loading the model",
  pickerWarmup: "Warming up the model…",
  pickerOnceOffline: "Just once. Then 100% offline.",
  pickerStart: "Get started",
  orbHoldIdle: "Hold to speak",
  orbHoldListening: "Release to send",
  orbUnderstanding: "Understanding…",
  orbSub: "Understood & answered on your phone",
  orbSubListening: "Nothing leaves the device",
  navList: "List",
  navCalendar: "Calendar",
  navSettings: "Settings",
  closeBtn: "✕ Close",
  undoHint: `Say "undo" to reverse`,
  settingsTitle: "Settings",
  settingsAppearance: "Appearance",
  settingsLanguage: "Language",
  settingsInterfaceVoice: "Interface and voice",
  settingsVoice: "Voice",
  settingsSpokenReplies: "Spoken replies",
  settingsSpokenRepliesSub: "Kairos answers out loud",
  settingsModelPrivacy: "Model and privacy",
  settingsModelName: "Gemma 4 · E2B",
  settingsModelMeta: "3 GB · on device",
  settingsReady: "Ready",
  settingsPrivacyLine: "✈ 100% offline · 0 data sent",
  // ── Google Calendar sync ──
  settingsSync: "Sync",
  settingsSyncGoogle: "Google Calendar",
  settingsSyncSub: "Feed the chosen calendar with your dated tasks",
  settingsSyncNoCalendar:
    "No writable Google calendar. Add a Google account (Android settings) with Calendar sync on.",
  settingsSyncNow: "Sync now",
  settingsPrivacyLineSync:
    "🔄 Synced via your Google account — the device, not the app, sends it",
  gcalSynced: (created: number, updated: number, deleted: number) =>
    `Calendar synced: ${created} added, ${updated} updated, ${deleted} removed.`,
  gcalNothing: "Calendar already up to date.",
  gcalNoCalendar: "No calendar configured. Choose one in Settings.",
  gcalNoPermission: "Calendar access denied.",
  gcalCalendarMissing:
    "The chosen calendar is missing. Reconfigure it in Settings.",
  gcalError: "Sync ran into an error.",

  // ── Security: app lock + encryption ───────────────────────────────
  settingsLock: "App lock",
  settingsLockSub: "Require biometrics or a code at launch",
  settingsEncryption: "Encryption",
  settingsEncryptionSub: "Encrypt the database on the device",
  lockBiometricAvailable: "Biometrics available on this device",
  lockBiometricUnavailable: "No biometrics — only the code will be asked",
  lockSetPasscode: "Set a code",
  lockChangePasscode: "Change the code",
  lockPasscodePlaceholder: "Code (4+ characters)",
  lockPasscodeConfirmPlaceholder: "Confirm the code",
  lockSave: "Save",
  lockCancel: "Cancel",
  lockPasscodeMismatch: "The two codes don't match.",
  lockPasscodeTooShort: "The code must be at least 4 characters.",
  lockPasscodeSaved: "Code saved.",
  lockNeedsPasscodeFirst: "Set a code first to enable the lock.",
  encMode: "Key mode",
  encModeRecoverable: "Recoverable · device-protected",
  encModeZk: "Zero-knowledge · derived from your code",
  encEnableZk: "Enable zero-knowledge mode",
  encDisableZk: "Back to recoverable mode",
  encZkNeedsLock: "Enable the lock and set a code first.",
  encZkWarnTitle: "Zero-knowledge mode",
  encZkWarnBody:
    "The encryption key will be derived from your code. If you forget it, your data is PERMANENTLY lost — no recovery is possible. Prefer a long passphrase over a short code.",
  encZkConfirm: "I understand, enable",
  encZkEnterPasscode: "Enter your code to derive the key",
  encZkBiometric: "Biometric unlock",
  encZkBiometricSub: "Convenient, but the key is cached on the device",
  encMigrating: "Encrypting… don't close the app.",
  encDecrypting: "Decrypting… don't close the app.",
  encRekeying: "Re-keying… don't close the app.",
  encEnabledMsg: "Encryption enabled.",
  encDisabledMsg: "Encryption disabled.",
  encError: "Operation failed. Your data is intact.",
  settingsPrivacyLineEncrypted: "🔒 Encrypted on device · 0 data sent",

  // ── Unlock screen ─────────────────────────────────────────────────
  unlockTitle: "Kairos is locked",
  unlockSubtitle: "Unlock to access your tasks",
  unlockUseBiometric: "Use biometrics",
  unlockEnterCode: "Enter your code",
  unlockCodePlaceholder: "Code",
  unlockSubmit: "Unlock",
  unlockWrong: "Wrong code.",
  unlockBiometricPrompt: "Unlock Kairos",
  unlockLockedOut: (sec: number) => `Too many attempts. Try again in ${sec}s.`,

  // ── Recovery screen (inconsistent state) ──────────────────────────
  recoverTitle: "Data unavailable",
  recoverKeyMissingBody:
    "The encryption key can't be found on this device (reinstall or restore). The encrypted data can't be opened.",
  recoverTryPasscode: "Enter my code (zero-knowledge mode)",
  recoverResetBtn: "Erase and start fresh",
  recoverResetTitle: "Erase everything?",
  recoverResetBody:
    "This permanently deletes the encrypted data and resets Kairos.",
  recoverResetConfirm: "Erase",
  recoverCancel: "Cancel",

  calClose: "✕ Close",
  calUpcoming: "Upcoming",
  calNothingHorizon: "Nothing dated on the horizon.",

  loadingModel: "Please wait while the model loads.",
  initSystem: "Initializing the system.",
  holdButton: "Hold the center button to record your command.",
  micDenied: "microphone permission denied",
  notUnderstood: "I didn't understand.",
  notUnderstoodRequest: "I didn't understand the request.",
  parseError: "I didn't quite understand.",
  taskNotFound: "I couldn't find that task.",
  cancelled: "Cancelled.",
  nothingToUndo: "Nothing to undo.",
  undone: "Undone.",
  calendarNotOpen: "The calendar isn't open.",
  whichTaskToAdd: "What task should I add?",
  whatToModify: "What should I change?",
  severalWhich: "Several tasks match. Which one?",
  severalWhichModify: "Several tasks match. Which one to modify?",
  severalWhichDelete: "Several tasks match. Which one to delete?",
  severalWhichNote: "Several tasks match. Which one to add a note to?",
  severalWhichAppend: "Several tasks match. Which one to append to?",
  noTaskToDelete: "I found no task to delete.",
  noteUntouched: "All right, I'll leave the note as is.",
  noteCancelled: "Note cancelled.",
  whichTaskEditNote: "Which task's note should I change? Please say the number.",
  whichTaskReadNote: "Which task's note should I read? Please say the number.",
  zoomIn: "Zooming in.",
  zoomOut: "Zooming out.",
  spokenUrgent: "urgent",
  spokenFor: (c: string) => `for ${c}`,
  spokenWith: (p: string) => `with ${p}`,
  spokenAt: (pl: string) => `at ${pl}`,

  whichNote: (title: string) => `What note for ${title}?`,
  whatToAddToNote: (title: string) => `What should I add to ${title}'s note?`,
  noteRemovedUndo: (title: string) => `Note removed from ${title}. Say "undo" to restore it.`,
  noteRemoved: (title: string) => `Note removed from ${title}.`,
  noteCompleted: (title: string) => `Note updated for ${title}.`,
  noteSaved: (title: string) => `Note saved for ${title}.`,
  noteAdded: (title: string) => `Note added to ${title}.`,
  noNote: (title: string) => `${title} has no note.`,
  noNoteAskAdd: (title: string) => `${title} has no note. What note would you like to add?`,
  editNotePrompt: (title: string, note: string) =>
    `${title}'s note: "${note}". Do you want to edit, append to, or erase it?`,
  readNoteSpeech: (title: string, note: string) => `${title}'s note: ${note}`,
  overdueOne: (title: string) => `Heads up, one task is overdue: ${title}.`,
  overdueMany: (n: number) => `Heads up, you have ${n} overdue tasks.`,
  deletedUndo: (title: string) => `Deleted: ${title}. Say "undo" to restore it.`,
  manyDeletedUndo: (n: number) =>
    `${n} task${n > 1 ? "s" : ""} deleted. Say "undo" to restore them all.`,
  statusSet: (title: string, statusWord: string) => `${title}: ${statusWord}.`,
  updated: (title: string) => `${title}: updated.`,
  taskAdded: (where: string, title: string, due: string) =>
    `Task added${where ? ` in ${where}` : ""}: ${title}${due ? `, ${due}` : ""}.`,
  showTasksSpeech: (scopeWord: string, quals: string[]) =>
    `Here are ${scopeWord}${quals.length ? " " + quals.join(", ") : ""}.`,
  calendarShown: (label: string) => `Here's the ${label} calendar.`,
  calendarLevel: (label: string) => `${CAP(label)} calendar.`,

  dayTitle: (dayName: string, date: number, monthName: string) =>
    `${dayName} ${monthName} ${date}`,
  weekTitle: (date: number, monthShort: string) => `Week of ${monthShort} ${date}`,
  monthTitle: (monthName: string, year: number) => `${monthName} ${year}`,
  railDate: (date: number, monthShort: string) => `${monthShort} ${date}`,
  hourLabel: (h: number) => `${String(h).padStart(2, "0")}:00`,
};

const TABLE: Record<Lang, Strings> = { fr: FR, en: EN };

export function tr(lang: Lang): Strings {
  return TABLE[lang];
}
