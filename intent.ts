import {
  createTask,
  deleteTaskById,
  findCandidates,
  getTaskById,
  logIntent,
  updateTaskById,
  type Revert,
  type Task,
  type TaskStatus,
} from "./db";

// J4: turn Gemma's JSON action into a real DB mutation / view change + a spoken
// confirmation. Two intent families: data (createTask/setStatus) and system
// (showTasks — only these put anything on screen, voice-first by design).
export type Scope =
  | "all"
  | "hours"
  | "day"
  | "week"
  | "month"
  | "overdue" // EN RETARD — échéance dépassée
  | "reminder"; // RAPPEL — à venir bientôt + en retard
// A display request, all dimensions composable (any may be null/false):
//   WHAT (category) × WHEN (scope) × WHO (person) × WHERE (place)
//   × STATE (status) × URGENT (priority high).
export type ShowSpec = {
  scope: Scope;
  category: string | null;
  person: string | null;
  place: string | null;
  status: TaskStatus | null;
  urgent: boolean;
};
// Graphical calendar ranges (landscape views).
export type CalRange = "day" | "week" | "month" | "year";

// A mutation awaiting which task to act on (set when a reference is ambiguous).
export type PendingAction =
  | { kind: "update"; changes: Record<string, unknown> }
  | { kind: "delete" }
  | { kind: "status"; status: TaskStatus };

export type DispatchResult = {
  ok: boolean;
  tool: string;
  speech: string; // what the TTS says back
  show?: ShowSpec; // system command: display the task list
  emoji: string; // symbol of the understood intent, shown in the top panel
  revert?: Revert; // how to undo this mutation ("annule")
  candidates?: Task[]; // ambiguous reference: which task did you mean?
  pending?: PendingAction; // the mutation to run once the candidate is chosen
  calendar?: CalRange; // system command: open a graphical calendar (landscape)
};

function toCalRange(raw: unknown): CalRange {
  const s = String(raw ?? "").toLowerCase();
  if (/(week|hebdo|semaine)/.test(s)) return "week";
  if (/(month|mensuel|mois)/.test(s)) return "month";
  if (/(year|annuel|année|annee|\ban\b)/.test(s)) return "year";
  return "day";
}

const CAL_LABEL: Record<CalRange, string> = {
  day: "quotidien",
  week: "hebdomadaire",
  month: "mensuel",
  year: "annuel",
};

// Pick an emoji that symbolizes the task from its category/title.
export function taskEmoji(category: string | null, title: string): string {
  const hay = `${category ?? ""} ${title ?? ""}`.toLowerCase();
  if (/(santé|sante|médec|medec|dentiste|docteur|pharmac|hôpital|hopital|rdv médical)/.test(hay)) return "🏥";
  if (/(course|achat|acheter|pain|supermarch|magasin|épicerie|epicerie)/.test(hay)) return "🛒";
  if (/(appel|appeler|téléphon|telephon|rappeler)/.test(hay)) return "📞";
  if (/(mail|e-mail|email|courriel|écrire|ecrire|envoyer un message)/.test(hay)) return "✉️";
  if (/(rendez-vous|rdv|réunion|reunion|meeting)/.test(hay)) return "📅";
  if (/(finance|banque|payer|paiement|facture|impôt|impot|virement)/.test(hay)) return "💰";
  if (/(famille|maman|papa|enfant|école|ecole|anniversaire)/.test(hay)) return "👪";
  if (/(voyage|train|avion|billet|vol|hôtel|hotel)/.test(hay)) return "✈️";
  if (/(travail|projet|bureau|client|réunion|dossier)/.test(hay)) return "💼";
  return "📝";
}

export const STATUS_EMOJI: Record<TaskStatus, string> = {
  todo: "↩️",
  pending: "⏳",
  done: "✅",
  postponed: "🔁",
  archived: "🗄️",
};

function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().replace(/\s+/g, " ");
  if (!c) return null;
  // Capitalize first letter, preserve the rest (project names keep their casing).
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "à faire",
  pending: "en attente",
  done: "accomplie",
  postponed: "à reporter",
  archived: "archivée",
};

// Map free-form status (LLM or French words) to a canonical TaskStatus.
function toStatus(raw: unknown): TaskStatus | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase();
  if (/(done|accompli|termin|fait|fini)/.test(s)) return "done";
  if (/(pending|attente|attendre|bloqu)/.test(s)) return "pending";
  if (/(postpon|report|repouss|plus tard|différ|differ)/.test(s)) return "postponed";
  if (/(archiv)/.test(s)) return "archived";
  if (/(todo|à faire|a faire|réactiv|reactiv)/.test(s)) return "todo";
  return null;
}

function toScope(raw: unknown): Scope {
  if (typeof raw !== "string") return "all";
  const s = raw.toLowerCase();
  if (/(reminder|rappel|à venir|a venir|arrive)/.test(s)) return "reminder";
  if (/(overdue|retard|dépass|depass|échu|echu)/.test(s)) return "overdue";
  if (/(hour|heure)/.test(s)) return "hours";
  if (/(today|jour|day|aujourd)/.test(s)) return "day";
  if (/(week|semaine)/.test(s)) return "week";
  if (/(month|mois)/.test(s)) return "month";
  return "all";
}

const SCOPE_LABEL: Record<Scope, string> = {
  all: "toutes les tâches",
  hours: "les tâches des prochaines heures",
  day: "les tâches du jour",
  week: "les tâches de la semaine",
  month: "les tâches du mois",
  overdue: "les tâches en retard",
  reminder: "le rappel des tâches à venir et en retard",
};

// Build the set of column changes for updateTask from the model's "changes".
function buildChanges(obj: any): Record<string, unknown> {
  const c = obj?.changes && typeof obj.changes === "object" ? obj.changes : {};
  const out: Record<string, unknown> = {};
  if (typeof c.title === "string" && c.title.trim()) out.title = c.title.trim();
  if (typeof c.due === "string") out.due = c.due;
  if (typeof c.dueISO === "string") out.due_iso = c.dueISO;
  else if (typeof c.due_iso === "string") out.due_iso = c.due_iso;
  if (typeof c.priority === "number") out.priority = c.priority;
  if ("category" in c) out.category = normalizeCategory(c.category);
  if ("subcategory" in c) out.subcategory = normalizeCategory(c.subcategory);
  if ("person" in c) out.person = normalizeCategory(c.person);
  if ("place" in c) out.place = normalizeCategory(c.place);
  const st = toStatus(c.status);
  if (st) out.status = st;
  return out;
}

// A spoken reference may be a NUMBER pointing at a displayed task ("supprime la
// 2", "la tâche 3", "deuxième"). Returns the 1-based number or null.
function refNumber(ref: unknown, transcript: string): number | null {
  if (typeof ref === "string") {
    const direct = ref.match(/^\s*(?:n°|no|numéro|numero|tâche|tache)?\s*(\d{1,2})\s*$/);
    if (direct) return +direct[1];
  }
  const t = (transcript || "").toLowerCase();
  const m = t.match(/(?:tâche|tache|num[ée]ro|n°|no|la|le|l['’])\s*(\d{1,2})\b/);
  if (m) return +m[1];
  const ord: [string, number][] = [
    ["premi", 1],
    ["deuxi", 2],
    ["second", 2],
    ["troisi", 3],
    ["quatri", 4],
    ["cinqui", 5],
  ];
  for (const [w, n] of ord) if (t.includes(w)) return n;
  return null;
}

// Resolve which task a CRUD command targets: a visible number first (exact),
// then a fuzzy title match (1 = act, 0/>1 = let the caller disambiguate).
async function resolveTarget(
  obj: any,
  transcript: string,
  numberedIds: number[],
): Promise<{ task?: Task; candidates: Task[] }> {
  const n = refNumber(obj.title, transcript);
  if (n && n >= 1 && n <= numberedIds.length) {
    const t = await getTaskById(numberedIds[n - 1]);
    if (t) return { task: t, candidates: [t] };
  }
  const cands = await findCandidates(obj.title ?? transcript);
  return { task: cands.length === 1 ? cands[0] : undefined, candidates: cands };
}

export async function dispatch(
  jsonStr: string,
  transcript: string,
  numberedIds: number[] = [],
): Promise<DispatchResult> {
  let obj: any;
  try {
    obj = JSON.parse(jsonStr);
  } catch {
    await logIntent({
      transcript,
      tool: "parse_error",
      paramsJson: jsonStr,
      result: "error",
    });
    return {
      ok: false,
      tool: "parse_error",
      speech: "Je n'ai pas bien compris.",
      emoji: "❓",
    };
  }

  let out: DispatchResult;
  switch (obj.tool) {
    case "createTask": {
      if (!obj.title) {
        out = {
          ok: false,
          tool: obj.tool,
          speech: "Quelle tâche dois-je ajouter ?",
          emoji: "❓",
        };
        break;
      }
      const category = normalizeCategory(obj.category);
      const subcategory = normalizeCategory(obj.subcategory);
      const created = await createTask({
        title: obj.title,
        due: obj.due ?? null,
        dueIso: typeof obj.dueISO === "string" ? obj.dueISO : null,
        priority: typeof obj.priority === "number" ? obj.priority : null,
        category,
        subcategory,
        person: normalizeCategory(obj.person),
        place: normalizeCategory(obj.place),
      });
      const where = [category, subcategory].filter(Boolean).join(" › ");
      out = {
        ok: true,
        tool: "createTask",
        speech: `Tâche ajoutée${where ? ` dans ${where}` : ""} : ${obj.title}${obj.due ? `, ${obj.due}` : ""}.`,
        emoji: taskEmoji(category, obj.title),
        revert: { kind: "delete", id: created.id },
      };
      break;
    }
    // completeTask kept as a natural alias for setStatus(done).
    case "completeTask":
    case "setStatus": {
      const status =
        obj.tool === "completeTask" ? "done" : toStatus(obj.status) ?? "done";
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        const completedAt = status === "done" ? Date.now() : null;
        await updateTaskById(task.id, { status, completed_at: completedAt });
        out = {
          ok: true,
          tool: "setStatus",
          speech: `${task.title} : ${STATUS_LABEL[status]}.`,
          emoji: STATUS_EMOJI[status],
          revert: {
            kind: "update",
            id: task.id,
            fields: { status: task.status, completed_at: task.completed_at },
          },
        };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "setStatus",
          speech: "Je n'ai pas trouvé cette tâche.",
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "setStatus",
          speech: "Plusieurs tâches correspondent. Laquelle ?",
          emoji: STATUS_EMOJI[status],
          candidates,
          pending: { kind: "status", status },
        };
      }
      break;
    }
    // Update any attribute (reschedule / move / rename / reassign / reprioritize).
    case "updateTask":
    case "editTask": {
      const changes = buildChanges(obj);
      if (Object.keys(changes).length === 0) {
        out = {
          ok: false,
          tool: "updateTask",
          speech: "Que dois-je modifier ?",
          emoji: "❓",
        };
        break;
      }
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        const t0 = task as any;
        const before: Record<string, unknown> = {};
        for (const k of Object.keys(changes)) before[k] = t0[k] ?? null;
        await updateTaskById(task.id, changes);
        out = {
          ok: true,
          tool: "updateTask",
          speech: `${(changes.title as string) ?? task.title} : mis à jour.`,
          emoji: "✏️",
          revert: { kind: "update", id: task.id, fields: before },
        };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "updateTask",
          speech: "Je n'ai pas trouvé cette tâche.",
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "updateTask",
          speech: "Plusieurs tâches correspondent. Laquelle modifier ?",
          emoji: "✏️",
          candidates,
          pending: { kind: "update", changes },
        };
      }
      break;
    }
    // Delete a task (reversible via "annule").
    case "deleteTask":
    case "removeTask": {
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        await deleteTaskById(task.id);
        out = {
          ok: true,
          tool: "deleteTask",
          speech: `Supprimé : ${task.title}. Dites « annule » pour récupérer.`,
          emoji: "🗑️",
          revert: { kind: "reinsert", task },
        };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "deleteTask",
          speech: "Je n'ai pas trouvé cette tâche.",
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "deleteTask",
          speech: "Plusieurs tâches correspondent. Laquelle supprimer ?",
          emoji: "🗑️",
          candidates,
          pending: { kind: "delete" },
        };
      }
      break;
    }
    // Undo the last mutation — App holds the revert and performs it.
    case "undo":
    case "annuler": {
      out = { ok: true, tool: "undo", speech: "", emoji: "↩️" };
      break;
    }
    // System / view commands: the only way to put the task list on screen.
    case "showTasks":
    case "showAgenda":
    case "listAgenda": {
      const scope = toScope(obj.scope ?? obj.range);
      const category = normalizeCategory(obj.category);
      const person = normalizeCategory(obj.person);
      const place = normalizeCategory(obj.place);
      const status = toStatus(obj.status);
      const urgent = obj.urgent === true;
      // Spoken confirmation built from the active dimensions.
      const quals: string[] = [];
      if (status) quals.push(STATUS_LABEL[status]);
      if (urgent) quals.push("urgentes");
      if (category) quals.push(`pour ${category}`);
      if (person) quals.push(`avec ${person}`);
      if (place) quals.push(`à ${place}`);
      out = {
        ok: true,
        tool: "showTasks",
        speech: `Voici ${SCOPE_LABEL[scope]}${quals.length ? " " + quals.join(", ") : ""}.`,
        show: { scope, category, person, place, status, urgent },
        emoji: scope === "overdue" ? "⏰" : scope === "reminder" ? "🔔" : "📋",
      };
      break;
    }
    // Graphical calendar (landscape): day / week / month / year.
    case "showCalendar":
    case "calendar": {
      const cal = toCalRange(obj.range ?? obj.scope);
      out = {
        ok: true,
        tool: "showCalendar",
        speech: `Voici le calendrier ${CAL_LABEL[cal]}.`,
        emoji: "🗓️",
        calendar: cal,
      };
      break;
    }
    default:
      out = {
        ok: false,
        tool: obj.tool ?? "unknown",
        speech: "Je n'ai pas compris la demande.",
        emoji: "❓",
      };
  }

  await logIntent({
    transcript,
    tool: out.tool,
    paramsJson: jsonStr,
    result: out.ok ? "ok" : "error",
  });
  return out;
}
