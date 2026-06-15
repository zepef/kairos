import { initLlama, type LlamaContext } from "llama.rn";

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
      n_ctx: 2048,
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
        { role: "system", content: SYSTEM },
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

const SYSTEM = `Tu es l'analyseur d'intentions de Kairos, un gestionnaire de tâches vocal en français.
À partir d'une phrase, tu renvoies UNIQUEMENT un objet JSON décrivant l'action, sans aucun texte autour.
Outils disponibles :
- {"tool":"createTask","title":<string>,"due":<string|null>,"dueISO":<string|null>,"priority":<0|1|2|3|null>,"category":<string>,"subcategory":<string|null>,"person":<string|null>,"place":<string|null>}
- {"tool":"setStatus","title":<string>,"status":<"done"|"pending"|"postponed"|"archived"|"todo">}  (changer le statut d'une tâche existante)
- {"tool":"showTasks","scope":<"all"|"hours"|"day"|"week"|"month"|"overdue"|"reminder">,"category":<string|null>,"person":<string|null>,"place":<string|null>,"status":<"pending"|"postponed"|"done"|"archived"|"todo"|null>,"urgent":<true|false>}  (commande système : AFFICHER les tâches ; ne crée/modifie rien)
- {"tool":"unknown"} si rien ne correspond.
"due" reprend l'expression temporelle telle quelle (ex: "demain 14h").
"dueISO" = échéance résolue en date ISO 8601 ("2026-06-15T14:00") depuis la DATE ACTUELLE fournie, ou null.
"category" (niveau 1) : si un PROJET est nommé (ex. "projet Mon Assistant Pro"), category = nom du projet ; sinon dossier thématique court (Santé, Appels, Rendez-vous, Courses, Travail, Finances, Famille, Divers).
"subcategory" (niveau 2, optionnel) = sous-dossier (ex. projet -> "UI", "Tests") sinon null.
"person" (QUI) = la personne nommée/évoquée ("avec Paul", "pour maman", "appeler le dentiste") -> "Paul"/"Maman"/"Dentiste" ; sinon null.
"place" (OÙ) = le lieu ou contexte ("au bureau", "à la maison", "à Paris", "chez le médecin") -> "Bureau"/"Maison"/"Paris" ; sinon null.
Pour createTask, mets priority à 2 ou 3 si l'urgence est exprimée ("urgent", "important", "au plus vite", "vite").
Garde dans "title" la tâche concrète, sans préambule projet/sous-dossier/personne/lieu.
setStatus : "marque/passe X en attente" -> pending ; "X est faite/accomplie/terminée" -> done ; "reporte X / à plus tard" -> postponed ; "archive X" -> archived ; "réactive X" -> todo.
showTasks : combine librement ces dimensions (toutes facultatives) :
 - scope (QUAND) : "affiche les tâches" -> all ; "prochaines heures" -> hours ; "du jour/aujourd'hui" -> day ; "de la semaine" -> week ; "du mois" -> month ; "en retard/échéance dépassée" -> overdue ; "rappel / qu'est-ce qui arrive / à venir et en retard" -> reminder. Si AUCUNE mention temporelle n'est faite, scope = "all" (ne mets jamais "day" par défaut).
 - category (QUOI) : dossier/projet visé ("pour Mon Assistant Pro", "dans Santé") sinon null.
 - person (QUI) : personne visée ("pour Paul", "avec maman") sinon null.
 - place (OÙ) : lieu visé ("au bureau", "à la maison") sinon null.
 - status (ÉTAT) : "ce qui est en attente" -> pending ; "à reporter" -> postponed ; "accompli/fait" -> done ; "archivé" -> archived ; sinon null.
 - urgent : true si "urgentes/prioritaires/importantes", sinon false.
 Ex. "les tâches urgentes en retard pour Paul" -> {"tool":"showTasks","scope":"overdue","category":null,"person":"Paul","place":null,"status":null,"urgent":true}.
Réponds en JSON compact.`;

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

function nowContext(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const local = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  const jours = [
    "dimanche",
    "lundi",
    "mardi",
    "mercredi",
    "jeudi",
    "vendredi",
    "samedi",
  ];
  return `${jours[d.getDay()]} ${local}`;
}

export async function parseIntent(text: string): Promise<IntentResult> {
  if (!ctx) throw new Error("model not loaded");
  const t0 = Date.now();
  const res = await ctx.completion({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `Date actuelle: ${nowContext()}.\n${text}` },
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
