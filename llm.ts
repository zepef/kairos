import { initLlama, type LlamaContext } from "llama.rn";
import type { Lang } from "./i18n";

// On-device Gemma 4 (E2B) intent parser for Kairos.
// The GGUF is pushed to the app's external files dir via adb (see install step).
export const MODEL_PATH =
  "/storage/emulated/0/Android/data/com.zepef.kairos/files/gemma-4-E2B.gguf";

let ctx: LlamaContext | null = null;

export function isLoaded() {
  return ctx !== null;
}

export async function loadModel(
  onProgress?: (pct: number) => void,
): Promise<{ ms: number }> {
  if (ctx) return { ms: 0 };
  const t0 = Date.now();
  ctx = await initLlama(
    {
      model: MODEL_PATH,
      // The system prompt grew to ~1.9k tokens (full CRUD + notes + calendar
      // vocab). With the user turn + n_predict, 2048 overflowed ("Context is
      // full" on every call), so give the KV cache real headroom.
      n_ctx: 4096,
      n_gpu_layers: 0, // CPU only on this SoC (Helio G95, no usable GPU backend)
      n_threads: 4, // use the 4 perf-ish cores
    },
    (p) => onProgress?.(p),
  );
  // Warm up: prefill the static system prefix into the KV cache now, so the
  // FIRST real command isn't prefill-bound (15s -> ~6s). llama.rn reuses the
  // common prefix automatically on subsequent completions on the same context.
  await warmUp();
  return { ms: Date.now() - t0 };
}

async function warmUp() {
  if (!ctx) return;
  try {
    await ctx.completion({
      messages: [
        // Warm the FR prefix (launch default). A later switch to EN pays the
        // prefill once on its first command.
        { role: "system", content: SYSTEM_BY_LANG.fr },
        { role: "user", content: "ping" },
      ],
      jinja: true,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
      reasoning_format: "none",
      n_predict: 1, // we only care about caching the prefill, not the output
    });
    console.log("[KAIROS] warm-up done (static prefix cached)");
  } catch (e: any) {
    console.log(`[KAIROS] warm-up skipped: ${e?.message ?? e}`);
  }
}

export async function releaseModel() {
  if (ctx) {
    await ctx.release();
    ctx = null;
  }
}

const SYSTEM_FR = `Tu es l'analyseur d'intentions de Kairos, un gestionnaire de tâches vocal en français.
À partir d'une phrase, tu renvoies UNIQUEMENT un objet JSON décrivant l'action, sans aucun texte autour.
Outils disponibles :
- {"tool":"createTask","title":<string>,"due":<string|null>,"dueISO":<string|null>,"priority":<0|1|2|3|null>,"category":<string>,"subcategory":<string|null>,"person":<string|null>,"place":<string|null>}
- {"tool":"setStatus","title":<string>,"status":<"done"|"pending"|"postponed"|"archived"|"todo">}  (changer le statut d'une tâche existante)
- {"tool":"showTasks","scope":<"all"|"hours"|"day"|"week"|"month"|"overdue"|"reminder">,"category":<string|null>,"person":<string|null>,"place":<string|null>,"status":<"pending"|"postponed"|"done"|"archived"|"todo"|null>,"urgent":<true|false>}  (commande système : AFFICHER les tâches ; ne crée/modifie rien)
- {"tool":"updateTask","title":<référence>,"changes":{"title?":<string>,"due?":<string>,"dueISO?":<string>,"priority?":<0|1|2|3>,"category?":<string>,"subcategory?":<string>,"person?":<string>,"place?":<string>,"status?":<string>}}  (MODIFIER une tâche existante : ne mets dans "changes" QUE les champs à changer)
- {"tool":"deleteTask","title":<référence>}  (SUPPRIMER UNE seule tâche)
- {"tool":"deleteTasks","numbers":<[int,...]|null>,"dayISO":<string|null>}  (SUPPRIMER PLUSIEURS tâches d'un coup : soit une liste de NUMÉROS affichés, soit toutes les tâches d'une JOURNÉE via dayISO)
- {"tool":"addNote","title":<référence>,"note":<string|null>}  (attacher/REMPLACER la NOTE textuelle d'une tâche : si le contenu est dicté dans la même phrase, mets-le dans "note" ; sinon note=null et l'app demandera de la dicter)
- {"tool":"appendNote","title":<référence>,"note":<string|null>}  (COMPLÉTER la note existante : on AJOUTE à la suite au lieu de remplacer. "note"=contenu si dicté inline, sinon null)
- {"tool":"editNote","title":<référence>}  (MODIFIER la note sans préciser comment : l'app demandera éditer / compléter / effacer. À utiliser quand l'intention est ambiguë)
- {"tool":"readNote","title":<référence>}  (LIRE à voix haute la note d'une tâche)
- {"tool":"clearNote","title":<référence>}  (SUPPRIMER la note d'une tâche)
- {"tool":"undo"}  ("annule", "reviens en arrière" : défaire la dernière action)
- {"tool":"showCalendar","range":<"day"|"week"|"month"|"year">}  (commande système : ouvrir le CALENDRIER graphique en paysage, ou changer de niveau s'il est déjà ouvert)
- {"tool":"zoomCalendar","direction":<"in"|"out">}  (zoomer le calendrier OUVERT d'un niveau : in = plus de détail (année->mois->semaine->jour) ; out = plus large (jour->semaine->mois->année))
- {"tool":"unknown"} si rien ne correspond.
"due" reprend l'expression temporelle telle quelle (ex: "demain 14h").
"dueISO" = échéance résolue en date ISO 8601 ("2026-06-15T14:00") depuis la DATE ACTUELLE fournie, ou null.
"category" (niveau 1) : si un PROJET est nommé (ex. "projet Mon Assistant Pro"), category = nom du projet ; sinon dossier thématique court (Santé, Contact, Rendez-vous, Courses, Travail, Finances, Famille, Divers).
"subcategory" (niveau 2, optionnel) = sous-dossier (ex. projet -> "UI", "Tests") sinon null.
"person" (QUI) = la personne nommée/évoquée ("avec Paul", "pour maman", "appeler le dentiste") -> "Paul"/"Maman"/"Dentiste" ; sinon null.
"place" (OÙ) = le lieu ou contexte ("au bureau", "à la maison", "à Paris", "chez le médecin") -> "Bureau"/"Maison"/"Paris" ; sinon null.
Pour createTask, mets priority à 2 ou 3 si l'urgence est exprimée ("urgent", "important", "au plus vite", "vite").
Garde dans "title" la tâche concrète, sans préambule projet/sous-dossier/personne/lieu.
Si l'action est d'APPELER / téléphoner / rappeler / contacter une personne ("appeler Paul", "téléphoner à Marie", "rappeler le client"), category = "Contact" (et mets la personne dans "person"), même si un lieu comme "au bureau" est mentionné.
setStatus : "marque/passe X en attente" -> pending ; "X est faite/accomplie/terminée" -> done ; "reporte X / à plus tard" -> postponed ; "archive X" -> archived ; "réactive X" -> todo.
showTasks : combine librement ces dimensions (toutes facultatives) :
 - scope (QUAND) : "affiche les tâches" -> all ; "prochaines heures" -> hours ; "du jour/aujourd'hui" -> day ; "de la semaine" -> week ; "du mois" -> month ; "en retard/échéance dépassée" -> overdue ; "rappel / qu'est-ce qui arrive / à venir et en retard" -> reminder. Si AUCUNE mention temporelle n'est faite, scope = "all" (ne mets jamais "day" par défaut).
 - category (QUOI) : dossier/projet visé ("pour Mon Assistant Pro", "dans Santé") sinon null.
 - person (QUI) : personne visée ("pour Paul", "avec maman") sinon null.
 - place (OÙ) : lieu visé ("au bureau", "à la maison") sinon null.
 - status (ÉTAT) : "ce qui est en attente" -> pending ; "à reporter" -> postponed ; "accompli/fait" -> done ; "archivé" -> archived ; sinon null.
 - urgent : true si "urgentes/prioritaires/importantes", sinon false.
 Ex. "les tâches urgentes en retard pour Paul" -> {"tool":"showTasks","scope":"overdue","category":null,"person":"Paul","place":null,"status":null,"urgent":true}.
"title" (référence) pour setStatus/updateTask/deleteTask = ce qui désigne la tâche. Les tâches affichées sont NUMÉROTÉES : si l'utilisateur cite un numéro ("supprime la 2", "la tâche 3 est faite", "modifie la 1"), mets ce numéro dans "title" (ex. "2"). Sinon mets les mots-clés du titre.
updateTask : "reporte / décale / déplace / reprogramme / replanifie X à mardi 15h / à demain" -> changes.due/dueISO ; "renomme X en Y" -> changes.title="Y" ; "mets X urgent" -> changes.priority=3 ; "X c'est avec Paul / au bureau" -> changes.person/place.
updateTask REPROGRAMMER un RDV « du <ancienne date-heure> au <nouvelle> » ou « de <ancienne heure> à <nouvelle> » : la 1re date-heure ne fait qu'IDENTIFIER le RDV existant, garde UNIQUEMENT la 2de comme nouvelle échéance -> changes.due/dueISO ; JAMAIS un événement multi-jours ni une plage, JAMAIS de date dans changes.category ; title = le mot-clé du RDV ("coiffeur"), jamais la date. Ex. "Déplace le rendez-vous coiffeur du 7 juillet au 8 juillet de 8h15 à 9h30." -> {"tool":"updateTask","title":"coiffeur","changes":{"due":"8 juillet 9h30","dueISO":"2026-07-08T09:30"}}
updateTask DÉPLACER (changer de dossier) : "range / déplace / bouge / transfère / mets / classe X dans|vers le dossier Santé" -> changes.category="Santé" (et changes.subcategory pour un sous-dossier), UNIQUEMENT si un DOSSIER thématique est nommé ; si une DATE ou une HEURE suit (« du 7 au 8 juillet »), c'est une REPROGRAMMATION (ci-dessus), pas un changement de dossier. C'est une MODIFICATION de la tâche existante, jamais une création.
deleteTask vs deleteTasks : UNE seule tâche ("supprime la 2", "efface le rapport") -> deleteTask. PLUSIEURS d'un coup : "supprime les tâches 1, 3 et 5" / "efface les 2 et 4" -> deleteTasks avec numbers=[1,3,5] ; "efface TOUTES les tâches d'aujourd'hui / de lundi / du 18 juin / de cette journée" -> deleteTasks avec dayISO = la date de ce jour (AAAA-MM-JJ) résolue depuis la DATE ACTUELLE, numbers=null.
addNote : "ajoute une note à la tâche 2", "note sur la 3", "annote la 1" -> addNote avec note=null (l'app demandera le texte). Si le contenu suit dans la même phrase ("note sur la 2 : apporter le dossier bleu", "ajoute la note rappeler d'appeler avant"), mets ce contenu littéral dans "note" (sans le préfixe « note :/que/de »). Ne confonds pas avec createTask : "ajoute une note à la tâche 2" n'est PAS une nouvelle tâche.
addNote/appendNote/editNote (choix de l'opération sur la note) :
 - "remplace/refais la note de la 2 PAR <texte>" (nouveau contenu donné) -> addNote.
 - "complète / ajoute à la note / ajoute aussi / rajoute à la note de la 2" -> appendNote (garde l'ancienne, ajoute à la suite).
 - "MODIFIE / change / corrige / édite la note de la 2" SANS dire comment ni donner de nouveau texte -> editNote (NE choisis PAS addNote ni clearNote : l'app demandera éditer/compléter/effacer pour ne pas perdre la note).
 - "efface / supprime / enlève la note de la 2" -> clearNote.
 Même règle pour "note" : contenu inline si dicté, sinon null.
readNote : "lis la note de la 2", "quelle est la note de la 1", "rappelle-moi la note" -> readNote. clearNote : "supprime/efface la note de la 3", "enlève la note" -> clearNote.
showCalendar : "calendrier quotidien/du jour" -> day ; "calendrier hebdomadaire/de la semaine" -> week ; "calendrier mensuel/du mois" -> month ; "calendrier annuel/de l'année" -> year.
zoomCalendar (calendrier déjà ouvert) : "zoome / zoom avant / rapproche / agrandis / plus de détail / plus précis" -> direction="in" ; "dézoome / zoom arrière / recule / élargis / vue d'ensemble / plus large" -> direction="out". Si un NIVEAU précis est nommé ("passe en mensuel", "vue annuelle"), utilise plutôt showCalendar.
Réponds en JSON compact.`;

// English counterpart of the system prompt — same JSON tool schemas, English
// routing vocabulary. Selected when the UI language is EN so English voice
// commands are parsed. Only ONE prompt is active per call, so n_ctx (4096) is
// unaffected. Keep tool names + JSON keys IDENTICAL to the French prompt.
const SYSTEM_EN = `You are Kairos's intent parser, a voice-driven task manager in English.
From a sentence, you return ONLY a JSON object describing the action, with no surrounding text.
Available tools:
- {"tool":"createTask","title":<string>,"due":<string|null>,"dueISO":<string|null>,"priority":<0|1|2|3|null>,"category":<string>,"subcategory":<string|null>,"person":<string|null>,"place":<string|null>}
- {"tool":"setStatus","title":<string>,"status":<"done"|"pending"|"postponed"|"archived"|"todo">}  (change the status of an existing task)
- {"tool":"showTasks","scope":<"all"|"hours"|"day"|"week"|"month"|"overdue"|"reminder">,"category":<string|null>,"person":<string|null>,"place":<string|null>,"status":<"pending"|"postponed"|"done"|"archived"|"todo"|null>,"urgent":<true|false>}  (system command: DISPLAY tasks; creates/changes nothing)
- {"tool":"updateTask","title":<reference>,"changes":{"title?":<string>,"due?":<string>,"dueISO?":<string>,"priority?":<0|1|2|3>,"category?":<string>,"subcategory?":<string>,"person?":<string>,"place?":<string>,"status?":<string>}}  (MODIFY an existing task: put ONLY the fields to change in "changes")
- {"tool":"deleteTask","title":<reference>}  (DELETE ONE single task)
- {"tool":"deleteTasks","numbers":<[int,...]|null>,"dayISO":<string|null>}  (DELETE SEVERAL tasks at once: either a list of DISPLAYED NUMBERS, or every task of a DAY via dayISO)
- {"tool":"addNote","title":<reference>,"note":<string|null>}  (attach/REPLACE a task's textual NOTE: if the content is dictated in the same sentence, put it in "note"; otherwise note=null and the app will ask for it)
- {"tool":"appendNote","title":<reference>,"note":<string|null>}  (APPEND to the existing note: ADD after it instead of replacing. "note"=content if dictated inline, else null)
- {"tool":"editNote","title":<reference>}  (MODIFY the note without saying how: the app will ask edit / append / erase. Use when the intent is ambiguous)
- {"tool":"readNote","title":<reference>}  (READ a task's note aloud)
- {"tool":"clearNote","title":<reference>}  (DELETE a task's note)
- {"tool":"undo"}  ("undo", "go back": revert the last action)
- {"tool":"showCalendar","range":<"day"|"week"|"month"|"year">}  (system command: open the graphical CALENDAR in landscape, or switch level if it's already open)
- {"tool":"zoomCalendar","direction":<"in"|"out">}  (zoom the OPEN calendar by one level: in = more detail (year->month->week->day); out = wider (day->week->month->year))
- {"tool":"unknown"} if nothing matches.
"due" keeps the time expression as-is (e.g. "tomorrow 2pm").
"dueISO" = due date resolved to ISO 8601 ("2026-06-15T14:00") from the CURRENT DATE provided, or null.
"category" (level 1): if a PROJECT is named (e.g. "project Mon Assistant Pro"), category = the project name; otherwise a short thematic folder (Health, Contact, Appointment, Shopping, Work, Finances, Family, Misc).
"subcategory" (level 2, optional) = sub-folder (e.g. project -> "UI", "Tests") else null.
"person" (WHO) = the named/implied person ("with Paul", "for mom", "call the dentist") -> "Paul"/"Mom"/"Dentist"; else null.
"place" (WHERE) = the place or context ("at the office", "at home", "in Paris", "at the doctor") -> "Office"/"Home"/"Paris"; else null.
For createTask, set priority to 2 or 3 if urgency is expressed ("urgent", "important", "asap", "right away").
Keep the concrete task in "title", without the project/sub-folder/person/place preamble.
If the action is to CALL / phone / ring back / contact a person ("call Paul", "phone Marie", "ring the client back"), category = "Contact" (and put the person in "person"), even if a place like "at the office" is mentioned.
setStatus: "mark/set X pending" -> pending; "X is done/completed/finished" -> done; "postpone X / later" -> postponed; "archive X" -> archived; "reactivate X" -> todo.
showTasks: freely combine these dimensions (all optional):
 - scope (WHEN): "show the tasks" -> all; "next hours" -> hours; "today" -> day; "this week" -> week; "this month" -> month; "overdue/past due" -> overdue; "reminder / what's coming up / upcoming and overdue" -> reminder. If NO time mention is made, scope = "all" (never default to "day").
 - category (WHAT): targeted folder/project ("for Mon Assistant Pro", "in Health") else null.
 - person (WHO): targeted person ("for Paul", "with mom") else null.
 - place (WHERE): targeted place ("at the office", "at home") else null.
 - status (STATE): "what's pending" -> pending; "to postpone" -> postponed; "done/completed" -> done; "archived" -> archived; else null.
 - urgent: true if "urgent/priority/important", else false.
 Ex. "the urgent overdue tasks for Paul" -> {"tool":"showTasks","scope":"overdue","category":null,"person":"Paul","place":null,"status":null,"urgent":true}.
"title" (reference) for setStatus/updateTask/deleteTask = what designates the task. Displayed tasks are NUMBERED: if the user cites a number ("delete 2", "task 3 is done", "edit 1"), put that number in "title" (e.g. "2"). Otherwise put the title keywords.
updateTask: "postpone / push / move / reschedule / replan X to Tuesday 3pm / to tomorrow" -> changes.due/dueISO; "rename X to Y" -> changes.title="Y"; "make X urgent" -> changes.priority=3; "X is with Paul / at the office" -> changes.person/place.
updateTask RESCHEDULE an appointment "from <old date-time> to <new>" or "from <old time> to <new>": the 1st date-time only IDENTIFIES the existing appointment, keep ONLY the 2nd as the new due -> changes.due/dueISO; NEVER a multi-day event or range, NEVER a date in changes.category; title = the appointment keyword ("hairdresser"), never the date. Ex. "Move the hairdresser appointment from July 7 to July 8, from 8:15 to 9:30." -> {"tool":"updateTask","title":"hairdresser","changes":{"due":"July 8 9:30","dueISO":"2026-07-08T09:30"}}
updateTask MOVE (change folder): "file / move / put / transfer / sort X into|to the Health folder" -> changes.category="Health" (and changes.subcategory for a sub-folder), ONLY when a thematic FOLDER is named; if a DATE or TIME follows ("from July 7 to July 8"), it's a RESCHEDULE (above), not a folder change. It's a MODIFICATION of the existing task, never a creation.
deleteTask vs deleteTasks: ONE single task ("delete 2", "remove the report") -> deleteTask. SEVERAL at once: "delete tasks 1, 3 and 5" / "remove 2 and 4" -> deleteTasks with numbers=[1,3,5]; "delete ALL of today's / Monday's / June 18th / this day's tasks" -> deleteTasks with dayISO = that day's date (YYYY-MM-DD) resolved from the CURRENT DATE, numbers=null.
addNote: "add a note to task 2", "note on 3", "annotate 1" -> addNote with note=null (the app will ask for the text). If the content follows in the same sentence ("note on 2: bring the blue folder", "add the note remember to call first"), put that literal content in "note" (without the "note:/that/of" prefix). Don't confuse with createTask: "add a note to task 2" is NOT a new task.
addNote/appendNote/editNote (choosing the note operation):
 - "replace/redo the note of 2 WITH <text>" (new content given) -> addNote.
 - "complete / add to the note / also add / append to the note of 2" -> appendNote (keep the old one, add after it).
 - "MODIFY / change / fix / edit the note of 2" WITHOUT saying how or giving new text -> editNote (do NOT pick addNote or clearNote: the app will ask edit/append/erase so the note isn't lost).
 - "erase / delete / remove the note of 2" -> clearNote.
 Same rule for "note": inline content if dictated, else null.
readNote: "read the note of 2", "what's the note of 1", "remind me the note" -> readNote. clearNote: "delete/erase the note of 3", "remove the note" -> clearNote.
showCalendar: "daily calendar/day calendar" -> day; "weekly calendar/this week" -> week; "monthly calendar/this month" -> month; "yearly calendar/the year" -> year.
zoomCalendar (calendar already open): "zoom / zoom in / closer / enlarge / more detail / more precise" -> direction="in"; "zoom out / back out / widen / overview / wider" -> direction="out". If a specific LEVEL is named ("switch to monthly", "yearly view"), use showCalendar instead.
Answer in compact JSON.`;

const SYSTEM_BY_LANG: Record<Lang, string> = { fr: SYSTEM_FR, en: SYSTEM_EN };

// Prefix prepended to the user turn carrying the resolved current date/time.
const DATE_PREFIX: Record<Lang, string> = {
  fr: "Date actuelle",
  en: "Current date",
};

const WEEKDAYS: Record<Lang, string[]> = {
  fr: ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export type IntentResult = {
  json: string;
  ms: number;
  tokensPredicted?: number;
  tokensPerSec?: number;
  prefillMs?: number;
  prefillTokens?: number;
  decodeMs?: number;
};

// Gemma 4 tends to wrap its answer in a ```json … ``` markdown fence.
// Extract the bare JSON object so downstream code gets clean, parseable output.
function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const s = body.indexOf("{");
  const e = body.lastIndexOf("}");
  return s >= 0 && e > s ? body.slice(s, e + 1).trim() : body.trim();
}

function nowContext(lang: Lang): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${WEEKDAYS[lang][d.getDay()]} ${local}`;
}

export async function parseIntent(
  text: string,
  lang: Lang = "fr",
): Promise<IntentResult> {
  if (!ctx) throw new Error("model not loaded");
  const t0 = Date.now();
  const res = await ctx.completion({
    messages: [
      { role: "system", content: SYSTEM_BY_LANG[lang] },
      {
        role: "user",
        content: `${DATE_PREFIX[lang]}: ${nowContext(lang)}.\n${text}`,
      },
    ],
    jinja: true, // use Gemma 4's embedded chat template
    // Gemma 4 is a reasoning model: thinking is ON by default and dumps a long
    // "Thinking Process" before the answer (~48s). Disable it for fast JSON.
    enable_thinking: false,
    chat_template_kwargs: { enable_thinking: false },
    reasoning_format: "none",
    response_format: { type: "json_object" }, // constrain to valid JSON
    n_predict: 120,
    temperature: 0.2,
    top_p: 0.95,
    top_k: 64,
  });
  const ms = Date.now() - t0;
  const t = (res as any).timings ?? {};
  const promptN = t.prompt_n as number | undefined; // prefill tokens
  const promptMs = t.prompt_ms as number | undefined; // prefill (TTFT) time
  const predicted = t.predicted_n as number | undefined; // decoded tokens
  const predMs = t.predicted_ms as number | undefined; // decode time
  const perSec = (n?: number, msv?: number) =>
    n && msv ? +(n / (msv / 1000)).toFixed(1) : undefined;
  // Full breakdown so we know if we are prefill-bound or decode-bound.
  console.log(
    `[KAIROS] timings prefill=${Math.round(promptMs ?? 0)}ms/${promptN ?? "?"}tok ` +
      `(${perSec(promptN, promptMs) ?? "?"} tok/s) | ` +
      `decode=${Math.round(predMs ?? 0)}ms/${predicted ?? "?"}tok ` +
      `(${perSec(predicted, predMs) ?? "?"} tok/s) | wall=${ms}ms`,
  );
  return {
    json: extractJson(res.text ?? ""),
    ms,
    tokensPredicted: predicted,
    tokensPerSec: perSec(predicted, predMs),
    prefillMs: promptMs ? Math.round(promptMs) : undefined,
    prefillTokens: promptN,
    decodeMs: predMs ? Math.round(predMs) : undefined,
  };
}
