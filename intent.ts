import { createTask, logIntent, setStatusByTitle, type TaskStatus } from "./db";

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
export type DispatchResult = {
  ok: boolean;
  tool: string;
  speech: string; // what the TTS says back
  show?: ShowSpec; // system command: display the task list
};

function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().replace(/\s+/g, " ");
  if (!c) return null;
  // Capitalize first letter, preserve the rest (project names keep their casing).
  return c.charAt(0).toUpperCase() + c.slice(1);
}

const STATUS_LABEL: Record<TaskStatus, string> = {
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

export async function dispatch(
  jsonStr: string,
  transcript: string,
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
    return { ok: false, tool: "parse_error", speech: "Je n'ai pas bien compris." };
  }

  let out: DispatchResult;
  switch (obj.tool) {
    case "createTask": {
      if (!obj.title) {
        out = { ok: false, tool: obj.tool, speech: "Quelle tâche dois-je ajouter ?" };
        break;
      }
      const category = normalizeCategory(obj.category);
      const subcategory = normalizeCategory(obj.subcategory);
      await createTask({
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
      };
      break;
    }
    // completeTask kept as a natural alias for setStatus(done).
    case "completeTask":
    case "setStatus": {
      const status =
        obj.tool === "completeTask" ? "done" : toStatus(obj.status) ?? "done";
      const t = await setStatusByTitle(obj.title ?? transcript, status);
      out = t
        ? {
            ok: true,
            tool: "setStatus",
            speech: `${t.title} : ${STATUS_LABEL[status]}.`,
          }
        : { ok: false, tool: "setStatus", speech: "Je n'ai pas trouvé cette tâche." };
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
      };
      break;
    }
    default:
      out = {
        ok: false,
        tool: obj.tool ?? "unknown",
        speech: "Je n'ai pas compris la demande.",
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
