import { completeTaskByTitle, createTask, listTasks, logIntent } from "./db";

// J4: turn Gemma's JSON action into a real DB mutation + a spoken confirmation.
export type DispatchResult = {
  ok: boolean;
  tool: string;
  speech: string; // what the TTS should say back
};

// Normalise the LLM-provided category ("dossier") so grouping stays consistent
// (e.g. "santé" / "Santé " -> "Santé").
function normalizeCategory(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().replace(/\s+/g, " ");
  if (!c) return null;
  // Capitalize the first letter, preserve the rest (so project names like
  // "Mon Assistant Pro" keep their casing). Grouping is case-insensitive in the UI.
  return c.charAt(0).toUpperCase() + c.slice(1);
}

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
      await createTask({
        title: obj.title,
        due: obj.due ?? null,
        priority: typeof obj.priority === "number" ? obj.priority : null,
        category,
      });
      out = {
        ok: true,
        tool: obj.tool,
        speech: `Tâche ajoutée${category ? ` dans ${category}` : ""} : ${obj.title}${obj.due ? `, ${obj.due}` : ""}.`,
      };
      break;
    }
    case "completeTask": {
      const done = await completeTaskByTitle(obj.title ?? transcript);
      out = done
        ? { ok: true, tool: obj.tool, speech: `C'est noté comme terminé : ${done.title}.` }
        : { ok: false, tool: obj.tool, speech: "Je n'ai pas trouvé cette tâche." };
      break;
    }
    case "listAgenda": {
      const tasks = await listTasks("open");
      out = {
        ok: true,
        tool: obj.tool,
        speech:
          tasks.length === 0
            ? "Tu n'as rien de prévu."
            : `Tu as ${tasks.length} tâche${tasks.length > 1 ? "s" : ""} : ${tasks
                .slice(0, 5)
                .map((t) => t.title)
                .join(", ")}.`,
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
