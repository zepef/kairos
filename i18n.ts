import type { CalRange, Scope } from "./intent";
import type { TaskStatus } from "./db";

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
  versionLabel: "Kairos version 0.5",
  // display title qualifiers
  qualUrgent: "urgent",
  qualFor: (c: string) => `pour ${c}`,
  qualWith: (p: string) => `avec ${p}`,
  qualAt: (pl: string) => `à ${pl}`,

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
  versionLabel: "Kairos version 0.5",
  qualUrgent: "urgent",
  qualFor: (c: string) => `for ${c}`,
  qualWith: (p: string) => `with ${p}`,
  qualAt: (pl: string) => `at ${pl}`,

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
