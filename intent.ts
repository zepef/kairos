import {
  createTask,
  deleteTaskById,
  findCandidates,
  getTaskById,
  listTasks,
  logIntent,
  updateTaskById,
  type Revert,
  type Task,
  type TaskStatus,
} from "./db";
import { tr, type Lang } from "./i18n";

// Hermes returns NaN for ISO without seconds — parse from parts (cf. App.tsx).
// Used to resolve a task's due date when clearing a whole day.
function parseIso(iso: unknown): number {
  if (typeof iso !== "string") return NaN;
  const m = iso.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (!m) return NaN;
  return new Date(
    +m[1],
    +m[2] - 1,
    +m[3],
    +(m[4] ?? 0),
    +(m[5] ?? 0),
    +(m[6] ?? 0),
  ).getTime();
}

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
  | { kind: "status"; status: TaskStatus }
  // Attach a note: if `note` is already known (dictated inline) save it; else the
  // app enters note-capture and the next utterance becomes the note verbatim.
  // append=true concatenates to the existing note instead of replacing it.
  | { kind: "note"; note?: string; append?: boolean };

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
  calendarZoom?: "in" | "out"; // relative zoom of the open calendar (in = more
  // detail, year→month→week→day ; out = wider, day→week→month→year)
  noteCapture?: {
    taskId: number;
    title: string;
    prevNote: string | null;
    append: boolean; // true = concat to prevNote, false = replace
  };
  // ask the user to dictate a note for this task (next utterance = the note)
  noteChoice?: { taskId: number; title: string; prevNote: string | null };
  // ambiguous note edit: ask whether to replace / append / erase (next utterance
  // picks the operation, App resolves it)
};

// Pull a dictated note out of the model's object (several possible keys), or ""
// if none was provided in this utterance.
function noteText(obj: any): string {
  for (const k of ["note", "content", "text", "body", "message"]) {
    if (typeof obj?.[k] === "string" && obj[k].trim()) return obj[k].trim();
  }
  return "";
}

function toCalRange(raw: unknown): CalRange {
  const s = String(raw ?? "").toLowerCase();
  if (/(week|hebdo|semaine)/.test(s)) return "week";
  if (/(month|mensuel|mois)/.test(s)) return "month";
  if (/(year|annuel|année|annee|horizon|\ban\b)/.test(s)) return "year";
  return "day";
}

// Relative zoom direction: "in" = zoom in (more detail, toward the day view),
// "out" = zoom out (wider, toward the year view).
function toZoomDir(raw: unknown): "in" | "out" {
  const s = String(raw ?? "").toLowerCase();
  if (/(out|arrière|arriere|dézoom|dezoom|élarg|elarg|recul|large|ensemble|éloign|eloign)/.test(s))
    return "out";
  return "in";
}

// Calendar level labels (quotidien / hebdomadaire / …) now live per-language in
// i18n (tr(lang).calLabel) so the spoken confirmation follows the UI language.

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

// Spoken status labels (à faire / accomplie / …) now live per-language in i18n
// (tr(lang).statusLabel); STATUS_EMOJI above stays here (language-independent).

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

// Spoken scope labels now live per-language in i18n (tr(lang).scopeLabel).

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
  const m = t.match(/(?:tâche|tache|task|num[ée]ro|number|n°|no|the|la|le|l['’])\s*(\d{1,2})\b/);
  if (m) return +m[1];
  const ord: [string, number][] = [
    ["premi", 1], ["first", 1],
    ["deuxi", 2], ["second", 2],
    ["troisi", 3], ["third", 3],
    ["quatri", 4], ["fourth", 4],
    ["cinqui", 5], ["fifth", 5],
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
  lang: Lang = "fr",
): Promise<DispatchResult> {
  const L = tr(lang);
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
      speech: L.parseError,
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
          speech: L.whichTaskToAdd,
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
        speech: L.taskAdded(where, obj.title, obj.due ?? ""),
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
          speech: L.statusSet(task.title, L.statusLabel[status]),
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
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "setStatus",
          speech: L.severalWhich,
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
          speech: L.whatToModify,
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
          speech: L.updated((changes.title as string) ?? task.title),
          emoji: "✏️",
          revert: { kind: "update", id: task.id, fields: before },
        };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "updateTask",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "updateTask",
          speech: L.severalWhichModify,
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
          speech: L.deletedUndo(task.title),
          emoji: "🗑️",
          revert: { kind: "reinsert", task },
        };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "deleteTask",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "deleteTask",
          speech: L.severalWhichDelete,
          emoji: "🗑️",
          candidates,
          pending: { kind: "delete" },
        };
      }
      break;
    }
    // Delete SEVERAL tasks at once — by displayed numbers ("supprime les 1, 3 et
    // 5") or every open task on a given day ("efface toutes les tâches de lundi"
    // -> dayISO). Reversible as a single "annule" that restores them all.
    case "deleteTasks":
    case "removeTasks":
    case "clearDay": {
      let targets: Task[] = [];
      const nums = Array.isArray(obj.numbers)
        ? obj.numbers
        : Array.isArray(obj.refs)
          ? obj.refs
          : null;
      if (nums && nums.length) {
        const seen = new Set<number>();
        for (const raw of nums) {
          const n = typeof raw === "number" ? raw : parseInt(String(raw), 10);
          if (!Number.isFinite(n) || n < 1 || n > numberedIds.length) continue;
          const id = numberedIds[n - 1];
          if (seen.has(id)) continue;
          seen.add(id);
          const t = await getTaskById(id);
          if (t) targets.push(t);
        }
      } else {
        const ms = parseIso(obj.dayISO ?? obj.day ?? obj.dueISO ?? obj.scope);
        if (!Number.isNaN(ms)) {
          const d = new Date(ms);
          const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
          const end = start + 24 * 3600 * 1000;
          const openTasks = await listTasks("open");
          targets = openTasks.filter((t) => {
            const tms = parseIso(t.due_iso);
            return !Number.isNaN(tms) && tms >= start && tms < end;
          });
        }
      }
      if (targets.length === 0) {
        out = {
          ok: false,
          tool: "deleteTasks",
          speech: L.noTaskToDelete,
          emoji: "❓",
        };
        break;
      }
      for (const t of targets) await deleteTaskById(t.id);
      const n = targets.length;
      out = {
        ok: true,
        tool: "deleteTasks",
        speech: L.manyDeletedUndo(n),
        emoji: "🗑️",
        revert: { kind: "reinsertMany", tasks: targets },
      };
      break;
    }
    // Attach a textual note to a task. The note is dictated: either inline in
    // this same sentence ("note sur la 2 : apporter le dossier") or, if no text
    // is given, the app asks for it and captures the next utterance verbatim
    // (noteCapture) so Gemma doesn't try to parse the note as a command.
    case "addNote":
    case "setNote":
    case "note":
    case "annotate": {
      const note = noteText(obj);
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        if (note) {
          await updateTaskById(task.id, { note });
          out = {
            ok: true,
            tool: "addNote",
            speech: L.noteAdded(task.title),
            emoji: "📝",
            revert: { kind: "update", id: task.id, fields: { note: task.note } },
          };
        } else {
          // No text yet — hand control to App to capture the dictated note.
          out = {
            ok: true,
            tool: "addNote",
            speech: L.whichNote(task.title),
            emoji: "📝",
            noteCapture: {
              taskId: task.id,
              title: task.title,
              prevNote: task.note,
              append: false,
            },
          };
        }
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "addNote",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "addNote",
          speech: L.severalWhichNote,
          emoji: "📝",
          candidates,
          pending: { kind: "note", note: note || undefined, append: false },
        };
      }
      break;
    }
    // Append to a task's existing note instead of replacing it ("complète la
    // note de la 2 : …"). Same two paths as addNote: inline text concatenates
    // now, no text -> capture the next utterance and concat it. Reversible.
    case "appendNote":
    case "addToNote":
    case "completeNote":
    case "complementNote": {
      const note = noteText(obj);
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        if (note) {
          const merged = task.note ? `${task.note} ${note}` : note;
          await updateTaskById(task.id, { note: merged });
          out = {
            ok: true,
            tool: "appendNote",
            speech: L.noteCompleted(task.title),
            emoji: "📝",
            revert: { kind: "update", id: task.id, fields: { note: task.note } },
          };
        } else {
          out = {
            ok: true,
            tool: "appendNote",
            speech: L.whatToAddToNote(task.title),
            emoji: "📝",
            noteCapture: {
              taskId: task.id,
              title: task.title,
              prevNote: task.note,
              append: true,
            },
          };
        }
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "appendNote",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "appendNote",
          speech: L.severalWhichAppend,
          emoji: "📝",
          candidates,
          pending: { kind: "note", note: note || undefined, append: true },
        };
      }
      break;
    }
    // Ambiguous "modify the note": don't guess (replacing/erasing silently lost
    // the note before) — ask whether to edit (replace), append, or erase. App
    // captures the answer (noteChoice) and routes to the right operation.
    case "editNote":
    case "modifyNote":
    case "changeNote":
    case "updateNote": {
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        out = task.note
          ? {
              ok: true,
              tool: "editNote",
              speech: L.editNotePrompt(task.title, task.note),
              emoji: "📝",
              noteChoice: { taskId: task.id, title: task.title, prevNote: task.note },
            }
          : {
              // No note yet: nothing to modify — start a fresh dictation.
              ok: true,
              tool: "editNote",
              speech: L.noNoteAskAdd(task.title),
              emoji: "📝",
              noteCapture: {
                taskId: task.id,
                title: task.title,
                prevNote: null,
                append: false,
              },
            };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "editNote",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: false,
          tool: "editNote",
          speech: L.whichTaskEditNote,
          emoji: "📝",
        };
      }
      break;
    }
    // Read a task's note aloud.
    case "readNote":
    case "showNote":
    case "getNote": {
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        out = task.note
          ? {
              ok: true,
              tool: "readNote",
              speech: L.readNoteSpeech(task.title, task.note),
              emoji: "📖",
            }
          : {
              ok: true,
              tool: "readNote",
              speech: L.noNote(task.title),
              emoji: "📖",
            };
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "readNote",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: false,
          tool: "readNote",
          speech: L.whichTaskReadNote,
          emoji: "📖",
        };
      }
      break;
    }
    // Remove a task's note (reversible via "annule").
    case "clearNote":
    case "removeNote":
    case "deleteNote": {
      const { task, candidates } = await resolveTarget(obj, transcript, numberedIds);
      if (task) {
        if (task.note) {
          await updateTaskById(task.id, { note: null });
          out = {
            ok: true,
            tool: "clearNote",
            speech: L.noteRemoved(task.title),
            emoji: "🗑️",
            revert: { kind: "update", id: task.id, fields: { note: task.note } },
          };
        } else {
          out = {
            ok: true,
            tool: "clearNote",
            speech: L.noNote(task.title),
            emoji: "📝",
          };
        }
      } else if (candidates.length === 0) {
        out = {
          ok: false,
          tool: "clearNote",
          speech: L.taskNotFound,
          emoji: "❓",
        };
      } else {
        out = {
          ok: true,
          tool: "clearNote",
          speech: L.severalWhich,
          emoji: "🗑️",
          candidates,
          pending: { kind: "note", note: "" },
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
      if (status) quals.push(L.statusLabel[status]);
      if (urgent) quals.push(L.spokenUrgent);
      if (category) quals.push(L.spokenFor(category));
      if (person) quals.push(L.spokenWith(person));
      if (place) quals.push(L.spokenAt(place));
      out = {
        ok: true,
        tool: "showTasks",
        speech: L.showTasksSpeech(L.scopeLabel[scope], quals),
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
        speech: L.calendarShown(L.calLabel[cal]),
        emoji: "🗓️",
        calendar: cal,
      };
      break;
    }
    // Relative zoom of the open calendar (App resolves the resulting level from
    // the current one, then speaks it). in = more detail, out = wider.
    case "zoomCalendar":
    case "zoom": {
      const dir = toZoomDir(obj.direction ?? obj.zoom ?? obj.range);
      out = {
        ok: true,
        tool: "zoomCalendar",
        speech: dir === "out" ? L.zoomOut : L.zoomIn,
        emoji: "🔍",
        calendarZoom: dir,
      };
      break;
    }
    default:
      out = {
        ok: false,
        tool: obj.tool ?? "unknown",
        speech: L.notUnderstoodRequest,
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
