import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { isLoaded, loadModel, parseIntent } from "./llm";
import { dispatch, type AgendaRange } from "./intent";
import { initDb, listTasks, type Task } from "./db";

// Kairos — STT (FR) + on-device intent parsing with Gemma 4 (E2B) via llama.rn.
// Voice -> STT -> Gemma 4 (JSON action) -> execute on local SQLite -> TTS.
const LANG = "fr-FR";

type Status = "idle" | "listening" | "speaking";
type ModelStatus = "unloaded" | "loading" | "ready" | "error";

// Dev test phrases (cycled by the "Tester l'intention" button) to drive the
// intent loop without voice.
const TEST_PHRASES = [
  "pour le projet Mon Assistant Pro, dans l'UI, ajoute la traduction anglaise",
  "ajoute au projet Kairos, partie Tests, écrire les tests unitaires",
  "appelle le dentiste demain à 14h",
  "montre-moi le calendrier de la semaine",
  "montre-moi le calendrier de la journée",
];

// Robust ISO parsing: Hermes (RN engine) returns NaN for "2026-06-15T14:00"
// (no seconds), so build the Date from parts manually. Returns local-time ms.
function parseIso(iso: string | null): number {
  if (!iso) return NaN;
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

function fmtWhen(iso: string): string {
  const ms = parseIso(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [testIdx, setTestIdx] = useState(0);

  const [modelStatus, setModelStatus] = useState<ModelStatus>("unloaded");
  const [loadPct, setLoadPct] = useState(0);
  const [intentJson, setIntentJson] = useState("");
  const [intentPerf, setIntentPerf] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [processing, setProcessing] = useState(false);
  const [view, setView] = useState<"folders" | AgendaRange>("folders");

  const refreshTasks = async () => setTasks(await listTasks("open"));

  // On launch: open the DB, then auto-load Gemma 4 (with progress) so the model
  // is ready without any manual step — relaunching the app re-loads it.
  useEffect(() => {
    (async () => {
      try {
        await initDb();
        await refreshTasks();
      } catch (e: any) {
        addLog(`✗ db init: ${e?.message ?? e}`);
      }
      loadGemma();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLog = (line: string) =>
    setLog((prev) => [line, ...prev].slice(0, 30));

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
    addLog("● start");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      addLog(`✓ final: ${transcript || "(vide)"}`);
      if (transcript && isLoaded()) runIntent(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    addLog(`✗ error: ${event.error} — ${event.message}`);
    setStatus("idle");
  });

  useSpeechRecognitionEvent("end", () => {
    setStatus((s) => (s === "speaking" ? s : "idle"));
  });

  const speak = (text: string) => {
    setStatus("speaking");
    Speech.speak(text, {
      language: LANG,
      onDone: () => setStatus("idle"),
      onStopped: () => setStatus("idle"),
      onError: () => setStatus("idle"),
    });
  };

  const loadGemma = async () => {
    if (modelStatus === "loading" || modelStatus === "ready") return;
    setModelStatus("loading");
    setLoadPct(0);
    addLog("⏳ chargement Gemma 4 E2B…");
    try {
      const { ms } = await loadModel((p) => {
        // initLlama reports 0..1 or 0..100 depending on platform — normalize.
        const pct = Math.max(0, Math.min(100, Math.round(p <= 1 ? p * 100 : p)));
        console.log(`[KAIROS] load progress ${pct}%`);
        setLoadPct(pct);
      });
      setLoadPct(100);
      setModelStatus("ready");
      setIntentPerf(`chargé en ${(ms / 1000).toFixed(1)}s`);
      addLog(`✓ Gemma 4 prêt (${(ms / 1000).toFixed(1)}s)`);
      console.log(`[KAIROS] model ready in ${ms}ms`);
    } catch (e: any) {
      setModelStatus("error");
      addLog(`✗ load model: ${e?.message ?? e}`);
      console.log(`[KAIROS] load error: ${e?.message ?? e}`);
    }
  };

  const runIntent = async (text: string) => {
    setIntentJson("…");
    setIntentPerf("inférence…");
    setProcessing(true);
    console.log(`[KAIROS] input :: ${text}`);
    try {
      const r = await parseIntent(text);
      setIntentJson(r.json);
      setIntentPerf(
        `total ${r.ms}ms · prefill ${r.prefillMs ?? "?"}ms/${r.prefillTokens ?? "?"}tok · ` +
          `decode ${r.decodeMs ?? "?"}ms${r.tokensPerSec ? ` @${r.tokensPerSec}tok/s` : ""}`,
      );
      console.log(`[KAIROS] intent ${r.ms}ms ${r.tokensPerSec}tok/s :: ${r.json}`);
      // J4: execute the action on the local DB, then confirm out loud.
      const res = await dispatch(r.json, text);
      if (res.view) setView(res.view); // system command: switch calendar view
      await refreshTasks();
      addLog(`${res.ok ? "✓" : "✗"} ${res.tool}: ${res.speech}`);
      speak(res.speech);
    } catch (e: any) {
      setIntentJson("");
      addLog(`✗ intent: ${e?.message ?? e}`);
      console.log(`[KAIROS] intent error: ${e?.message ?? e}`);
    } finally {
      setProcessing(false);
    }
  };

  const startListening = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      addLog("✗ permission micro refusée");
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: LANG,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      requiresOnDeviceRecognition: false,
      androidIntentOptions: {
        EXTRA_PREFER_OFFLINE: true, // Kairos is offline-first
      },
    });
  };

  const stopListening = () => ExpoSpeechRecognitionModule.stop();

  // Level-1 folders -> level-2 subfolders (case-insensitive; first-seen label).
  // Tasks with no category fall under "Divers"; "" subcategory = directly in the
  // folder. Only non-empty folders/subfolders are produced.
  const folders = (() => {
    type Sub = { label: string; items: Task[] };
    const map = new Map<string, { label: string; subs: Map<string, Sub> }>();
    for (const t of tasks) {
      const cat = t.category || "Divers";
      const ck = cat.toLowerCase();
      if (!map.has(ck)) map.set(ck, { label: cat, subs: new Map() });
      const folder = map.get(ck)!;
      const sub = t.subcategory || "";
      const sk = sub.toLowerCase();
      if (!folder.subs.has(sk)) folder.subs.set(sk, { label: sub, items: [] });
      folder.subs.get(sk)!.items.push(t);
    }
    return [...map.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((f) => ({
        label: f.label,
        count: [...f.subs.values()].reduce((n, s) => n + s.items.length, 0),
        // subfolders first (named), then the folder's own loose tasks ("")
        subs: [...f.subs.values()].sort((a, b) =>
          a.label && b.label ? a.label.localeCompare(b.label) : a.label ? -1 : 1,
        ),
      }));
  })();

  // Calendar views: filter tasks by resolved due_iso into day/week/month.
  const rangeBounds = (r: AgendaRange): [number, number] => {
    const d = new Date();
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (r === "day") {
      const end = new Date(startOfDay);
      end.setDate(end.getDate() + 1);
      return [startOfDay.getTime(), end.getTime()];
    }
    if (r === "week") {
      const mondayOffset = (startOfDay.getDay() + 6) % 7;
      const s = new Date(startOfDay);
      s.setDate(s.getDate() - mondayOffset);
      const e = new Date(s);
      e.setDate(e.getDate() + 7);
      return [s.getTime(), e.getTime()];
    }
    return [
      new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    ];
  };

  const agendaTasks =
    view === "folders"
      ? []
      : tasks
          .map((t) => ({ t, ms: parseIso(t.due_iso) }))
          .filter(({ ms }) => !Number.isNaN(ms))
          .filter(({ ms }) => {
            const [s, e] = rangeBounds(view);
            return ms >= s && ms < e;
          })
          .sort((a, b) => a.ms - b.ms)
          .map(({ t }) => t);

  const VIEWS: { key: "folders" | AgendaRange; label: string }[] = [
    { key: "folders", label: "Dossiers" },
    { key: "day", label: "Jour" },
    { key: "week", label: "Semaine" },
    { key: "month", label: "Mois" },
  ];

  const dotColor =
    status === "listening"
      ? "#2e9e5b"
      : status === "speaking"
        ? "#2f6fed"
        : "#9aa0a6";

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <Text style={styles.title}>Kairos</Text>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>

        {modelStatus === "loading" && (
          <View style={styles.loadingBanner}>
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#2f6fed" />
              <Text style={styles.loadingText}>
                {loadPct >= 100
                  ? "Préchauffage du modèle…"
                  : loadPct > 0
                    ? `Chargement de Gemma 4… ${loadPct}%`
                    : "Chargement du modèle (≈3 Go)…"}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  // Show a partial bar during the indeterminate file-load phase
                  // (initLlama doesn't always report granular progress here).
                  { width: `${loadPct > 0 ? loadPct : 15}%` },
                  loadPct === 0 && styles.progressIndeterminate,
                ]}
              />
            </View>
          </View>
        )}
        {modelStatus === "error" && (
          <Pressable onPress={loadGemma} style={styles.errorBanner}>
            <Text style={styles.errorText}>
              Échec du chargement de Gemma 4. Toucher pour réessayer.
            </Text>
          </Pressable>
        )}

        <Pressable
          onPressIn={startListening}
          onPressOut={stopListening}
          style={({ pressed }) => [
            styles.talkBtn,
            status === "listening" && styles.talkBtnActive,
            pressed && styles.talkBtnPressed,
          ]}
        >
          <Text style={styles.talkBtnText}>
            {status === "listening" ? "J'écoute…" : "Maintenir pour parler"}
          </Text>
        </Pressable>

        <View style={styles.viewBar}>
          {VIEWS.map((v) => (
            <Pressable
              key={v.key}
              onPress={() => setView(v.key)}
              style={[styles.viewBtn, view === v.key && styles.viewBtnActive]}
            >
              <Text
                style={[
                  styles.viewBtnText,
                  view === v.key && styles.viewBtnTextActive,
                ]}
              >
                {v.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tasksHeaderRow}>
          <Text style={styles.sectionTitle}>
            {view === "folders" ? `Mes tâches (${tasks.length})` : "Calendrier"}
          </Text>
          {processing && <Text style={styles.processing}>traitement…</Text>}
        </View>

        {view === "folders" ? (
          tasks.length === 0 ? (
            <View style={styles.tasksBox}>
              <Text style={styles.taskEmpty}>Aucune tâche. Dicte une demande.</Text>
            </View>
          ) : (
            // Level-1 folders -> level-2 subfolders, created on the fly.
            folders.map((f) => (
              <View key={f.label} style={styles.folder}>
                <Text style={styles.folderTitle}>
                  {f.label} ({f.count})
                </Text>
                {f.subs.map((s) => (
                  <View key={s.label || "_"}>
                    {s.label ? (
                      <Text style={styles.subfolderTitle}>{s.label}</Text>
                    ) : null}
                    <View style={styles.tasksBox}>
                      {s.items.map((t) => (
                        <View key={t.id} style={styles.taskRow}>
                          <Text style={styles.taskTitle}>{t.title}</Text>
                          {t.due ? (
                            <Text style={styles.taskDue}>{t.due}</Text>
                          ) : null}
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ))
          )
        ) : agendaTasks.length === 0 ? (
          <View style={styles.tasksBox}>
            <Text style={styles.taskEmpty}>Rien de daté sur cette période.</Text>
          </View>
        ) : (
          <View style={styles.tasksBox}>
            {agendaTasks.map((t) => (
              <View key={t.id} style={styles.taskRow}>
                <Text style={styles.taskTitle}>{t.title}</Text>
                <Text style={styles.taskDue}>
                  {t.due_iso ? fmtWhen(t.due_iso) : t.due}
                </Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.gemmaBox}>
          <View style={styles.gemmaHeaderRow}>
            <Text style={styles.toggleLabel}>Gemma 4 (on-device)</Text>
            <Text style={styles.gemmaStatus}>{modelStatus}</Text>
          </View>
          <Pressable
            onPress={loadGemma}
            disabled={modelStatus === "loading" || modelStatus === "ready"}
            style={[
              styles.ttsBtn,
              (modelStatus === "loading" || modelStatus === "ready") &&
                styles.btnDisabled,
            ]}
          >
            <Text style={styles.ttsBtnText}>
              {modelStatus === "ready"
                ? "Modèle chargé ✓"
                : modelStatus === "loading"
                  ? "Chargement…"
                  : "Charger Gemma 4"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              const phrase = TEST_PHRASES[testIdx % TEST_PHRASES.length];
              setTestIdx((i) => i + 1);
              runIntent(phrase);
            }}
            disabled={modelStatus !== "ready"}
            style={[styles.ttsBtn, modelStatus !== "ready" && styles.btnDisabled]}
          >
            <Text style={styles.ttsBtnText}>Tester l'intention</Text>
          </Pressable>
          <Text style={styles.label}>Action (JSON)</Text>
          <Text style={styles.intentJson}>{intentJson || "—"}</Text>
          <Text style={styles.gemmaPerf}>{intentPerf}</Text>
        </View>

        <Text style={styles.label}>Journal</Text>
        <View style={styles.logBox}>
          {log.map((line, i) => (
            <Text key={i} style={styles.logLine}>
              {line}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fbfbfa" },
  scroll: { flex: 1 },
  container: {
    backgroundColor: "#fbfbfa",
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "800", color: "#1a1a1a" },
  dot: { width: 12, height: 12, borderRadius: 6 },
  loadingBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#eef3ff",
    borderWidth: 1,
    borderColor: "#cfe0ff",
    gap: 10,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  loadingText: { fontSize: 15, color: "#2f6fed", fontWeight: "600" },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "#d7e3ff",
    overflow: "hidden",
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: "#2f6fed" },
  progressIndeterminate: { backgroundColor: "#9bbcff" },
  errorBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    borderWidth: 1,
    borderColor: "#f5c2c2",
  },
  errorText: { fontSize: 14, color: "#c0392b", fontWeight: "600" },
  toggleLabel: { fontSize: 15, color: "#333" },
  label: {
    marginTop: 10,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#999",
  },
  talkBtn: {
    marginTop: 24,
    backgroundColor: "#2f6fed",
    paddingVertical: 22,
    borderRadius: 16,
    alignItems: "center",
  },
  talkBtnActive: { backgroundColor: "#2e9e5b" },
  talkBtnPressed: { opacity: 0.85 },
  talkBtnText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  ttsBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2f6fed",
  },
  ttsBtnText: { color: "#2f6fed", fontSize: 15, fontWeight: "600" },
  btnDisabled: { opacity: 0.4 },
  tasksHeaderRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
  processing: { fontSize: 13, color: "#b8860b", fontWeight: "600" },
  folder: { marginTop: 14 },
  folderTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#2f6fed",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  subfolderTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#7a869a",
    marginLeft: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  viewBar: {
    flexDirection: "row",
    marginTop: 18,
    backgroundColor: "#eef1f6",
    borderRadius: 10,
    padding: 3,
  },
  viewBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  viewBtnActive: { backgroundColor: "#fff" },
  viewBtnText: { fontSize: 13, color: "#7a869a", fontWeight: "600" },
  viewBtnTextActive: { color: "#2f6fed" },
  tasksBox: {
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
    overflow: "hidden",
  },
  taskEmpty: { padding: 16, color: "#999", fontStyle: "italic" },
  taskRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#eee",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  taskTitle: { fontSize: 16, color: "#1a1a1a", flexShrink: 1 },
  taskDue: { fontSize: 13, color: "#2f6fed", marginLeft: 10 },
  gemmaBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e3e8f0",
    gap: 8,
  },
  gemmaHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  gemmaStatus: { fontSize: 14, color: "#2f6fed", fontWeight: "600" },
  intentJson: {
    fontFamily: "monospace",
    fontSize: 13,
    color: "#0d1117",
    backgroundColor: "#f3f5f9",
    borderRadius: 8,
    padding: 8,
  },
  gemmaPerf: { fontSize: 12, color: "#2e9e5b", fontWeight: "600" },
  logBox: {
    marginTop: 6,
    backgroundColor: "#0d1117",
    borderRadius: 10,
    padding: 10,
  },
  logLine: {
    color: "#9ece6a",
    fontFamily: "monospace",
    fontSize: 12,
    marginBottom: 2,
  },
});
