import { initLlama, type LlamaContext } from "llama.rn";

// On-device Gemma 4 (E2B) intent parser for Cadence.
// The GGUF is pushed to the app's external files dir via adb (see install step).
export const MODEL_PATH =
  "/storage/emulated/0/Android/data/com.zepef.cadence/files/gemma-4-E2B.gguf";

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
  return { ms: Date.now() - t0 };
}

export async function releaseModel() {
  if (ctx) {
    await ctx.release();
    ctx = null;
  }
}

const SYSTEM = `Tu es l'analyseur d'intentions de Cadence, un gestionnaire de tâches vocal en français.
À partir d'une phrase, tu renvoies UNIQUEMENT un objet JSON décrivant l'action, sans aucun texte autour.
Outils disponibles :
- {"tool":"createTask","title":<string>,"due":<string|null>,"priority":<0|1|2|3|null>}
- {"tool":"listAgenda","range":<"today"|"week">}
- {"tool":"completeTask","title":<string>}
- {"tool":"unknown"} si rien ne correspond.
"due" reprend l'expression temporelle telle quelle (ex: "demain 14h"). Réponds en JSON compact.`;

export type IntentResult = {
  json: string;
  ms: number;
  tokensPredicted?: number;
  tokensPerSec?: number;
};

export async function parseIntent(text: string): Promise<IntentResult> {
  if (!ctx) throw new Error("model not loaded");
  const t0 = Date.now();
  const res = await ctx.completion({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: text },
    ],
    jinja: true, // use Gemma 4's embedded chat template
    response_format: { type: "json_object" }, // constrain to valid JSON
    n_predict: 200,
    temperature: 0.1,
    top_p: 0.9,
  });
  const ms = Date.now() - t0;
  const predicted = (res as any).timings?.predicted_n as number | undefined;
  const predMs = (res as any).timings?.predicted_ms as number | undefined;
  return {
    json: (res.text ?? "").trim(),
    ms,
    tokensPredicted: predicted,
    tokensPerSec:
      predicted && predMs ? +(predicted / (predMs / 1000)).toFixed(1) : undefined,
  };
}
