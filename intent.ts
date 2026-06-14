import { createTask, logIntent, setStatusByTitle, type TaskStatus } from "./db";

// J4: turn Gemma's JSON action into a real DB mutation / view change + a spoken
// confirmation. Two intent families: data (createTask/setStatus) and system
// (showTasks — only these put anything on screen, voice-first by design).
export type Scope = "all" | "hours" | "day" | "week" | "month";
export type DispatchResult = {
  ok: boolean;
  tool: string;
  speech: string; // what the TTS says back
  show?: Scope; // system command: display the task list for this scope
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
      out = {
        ok: true,
        tool: "showTasks",
        speech: `Voici ${SCOPE_LABEL[scope]}.`,
        show: scope,
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
