import { completeTaskByTitle, createTask, logIntent } from "./db";

// J4: turn Gemma's JSON action into a real DB mutation + a spoken confirmation.
export type AgendaRange = "day" | "week" | "month";
export type DispatchResult = {
  ok: boolean;
  tool: string;
  speech: string; // what the TTS should say back
  view?: AgendaRange; // system command: switch the displayed calendar view
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
        tool: obj.tool,
        speech: `Tâche ajoutée${where ? ` dans ${where}` : ""} : ${obj.title}${obj.due ? `, ${obj.due}` : ""}.`,
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
    case "showAgenda":
    case "listAgenda": {
      const range: AgendaRange =
        obj.range === "week" || obj.range === "month" ? obj.range : "day";
      const label =
        range === "day" ? "la journée" : range === "week" ? "la semaine" : "le mois";
      out = {
        ok: true,
        tool: "showAgenda",
        speech: `Voici le calendrier de ${label}.`,
        view: range,
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
