import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
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
import { dispatch, type Scope, type ShowSpec } from "./intent";
import { initDb, listTasks, type Task } from "./db";

// Kairos — STT (FR) + on-device intent parsing with Gemma 4 (E2B) via llama.rn.
// Voice -> STT -> Gemma 4 (JSON action) -> execute on local SQLite -> TTS.
const LANG = "fr-FR";

// Clean Kairos chevron (transparent background) — centered on the launch screen.
const LOGO = require("./assets/android-icon-foreground.png");

type Status = "idle" | "listening" | "speaking";
type ModelStatus = "unloaded" | "loading" | "ready" | "error";

// Dev test phrases (cycled by the "Tester l'intention" button) to drive the
// intent loop without voice.
const TEST_PHRASES = [
  "affiche toutes les tâches pour Mon Assistant Pro",
  "affiche les tâches du dossier Kairos",
  "affiche les tâches du jour",
  "affiche toutes les tâches",
  "affiche les tâches de la semaine pour Kairos",
  "marque réviser le dossier client comme en attente",
  "archive la traduction anglaise",
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

// Level-1 folders -> level-2 subfolders (case-insensitive; first-seen label).
// No category -> "Divers"; "" subcategory = directly in the folder.
type Folder = {
  label: string;
  count: number;
  subs: { label: string; items: Task[] }[];
};
function buildFolders(items: Task[]): Folder[] {
  type Sub = { label: string; items: Task[] };
  const map = new Map<string, { label: string; subs: Map<string, Sub> }>();
  for (const t of items) {
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
  // null = minimal home (nothing on screen); a ShowSpec = task list is displayed
  // (WHAT folder × WHEN temporal scope).
  const [display, setDisplay] = useState<ShowSpec | null>(null);

  // Continuous rotation for the circular loader drawn around the logo on launch.
  // Native-driven + memoized so the animation node is created once and never
  // re-attached on re-render (loadPct updates would otherwise make it stutter).
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spin = useMemo(
    () =>
      spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ["0deg", "360deg"],
      }),
    [spinAnim],
  );
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    if (modelStatus !== "ready") loop.start();
    return () => loop.stop();
  }, [modelStatus, spinAnim]);

  const warmAnnounced = useRef(false);

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
    warmAnnounced.current = false;
    addLog("⏳ chargement Gemma 4 E2B…");
    // Voice cue: the only thing the app says while the model file loads.
    speak("Patienter pendant le chargement du modèle.");
    try {
      const { ms } = await loadModel((p) => {
        // initLlama reports 0..1 or 0..100 depending on platform — normalize.
        const pct = Math.max(0, Math.min(100, Math.round(p <= 1 ? p * 100 : p)));
        console.log(`[KAIROS] load progress ${pct}%`);
        setLoadPct(pct);
        // File done -> warm-up begins; announce it once.
        if (pct >= 100 && !warmAnnounced.current) {
          warmAnnounced.current = true;
          speak("Préchauffage du système.");
        }
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
      if (res.show) setDisplay(res.show); // system command: show the task list
      await refreshTasks();
      addLog(`${res.ok ? "✓" : "✗"} ${res.tool}: ${res.speech}`);
      console.log(`[KAIROS] action ${res.tool} ok=${res.ok} :: ${res.speech}`);
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

  // Temporal window (level 2) for the display command.
  const scopeBounds = (s: Scope): [number, number] => {
    const d = new Date();
    const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (s === "hours") return [d.getTime(), d.getTime() + 6 * 3600 * 1000];
    if (s === "day") {
      const e = new Date(startOfDay);
      e.setDate(e.getDate() + 1);
      return [startOfDay.getTime(), e.getTime()];
    }
    if (s === "week") {
      const mondayOffset = (startOfDay.getDay() + 6) % 7;
      const ws = new Date(startOfDay);
      ws.setDate(ws.getDate() - mondayOffset);
      const we = new Date(ws);
      we.setDate(we.getDate() + 7);
      return [ws.getTime(), we.getTime()];
    }
    return [
      new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
      new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
    ];
  };

  // Level 2 (temporal) filters the task set; level 1 (folders) then structures
  // it. "all" = no temporal filter (every open task); temporal scopes keep only
  // tasks whose resolved date falls in the window.
  const displayedTasks = (() => {
    if (display === null) return [];
    let set = tasks;
    // Level 1 (WHAT): optional folder/category filter.
    if (display.category) {
      const c = display.category.toLowerCase();
      set = set.filter((t) => (t.category || "").toLowerCase() === c);
    }
    // Level 2 (WHEN): optional temporal window.
    if (display.scope !== "all") {
      const [s, e] = scopeBounds(display.scope);
      set = set.filter((t) => {
        const ms = parseIso(t.due_iso);
        return !Number.isNaN(ms) && ms >= s && ms < e;
      });
    }
    return set;
  })();

  const folders = buildFolders(displayedTasks);

  const SCOPE_TITLE: Record<Scope, string> = {
    all: "Toutes les tâches",
    hours: "Prochaines heures",
    day: "Aujourd'hui",
    week: "Cette semaine",
    month: "Ce mois",
  };

  const STATUS_BADGE: Partial<Record<Task["status"], string>> = {
    pending: "en attente",
    postponed: "à reporter",
  };

  const dotColor =
    status === "listening"
      ? "#2e9e5b"
      : status === "speaking"
        ? "#2f6fed"
        : "#9aa0a6";

  // Launch screen: nothing but the centered logo with a circular loader around
  // it while Gemma loads (and a tap-to-retry affordance if the load failed).
  if (modelStatus !== "ready") {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.splash}>
          <View style={styles.ringWrap}>
            <Animated.View
              style={[styles.ring, { transform: [{ rotate: spin }] }]}
            />
            <View style={styles.ringInner}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" />
              {modelStatus !== "error" && (
                <Text style={styles.loadPct}>{loadPct}%</Text>
              )}
            </View>
          </View>
          {modelStatus === "error" && (
            <Pressable onPress={loadGemma} style={styles.errorBanner}>
              <Text style={styles.errorText}>
                Échec du chargement. Toucher pour réessayer.
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

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
          {modelStatus === "ready" && (
            <Pressable
              onPress={() => {
                const phrase = TEST_PHRASES[testIdx % TEST_PHRASES.length];
                setTestIdx((i) => i + 1);
                runIntent(phrase);
              }}
              style={styles.testChip}
              hitSlop={8}
            >
              <Text style={styles.testChipText}>Tester</Text>
            </Pressable>
          )}
        </View>

        {modelStatus === "ready" && (
          <>
        {display === null ? (
          processing ? (
            <Text style={styles.homeHint}>traitement…</Text>
          ) : (
            <Text style={styles.homeHint}>
              Dis « affiche les tâches du jour », « ajoute… », « marque… ».
            </Text>
          )
        ) : (
          <>
            <View style={styles.tasksHeaderRow}>
              <Text style={styles.sectionTitle}>
                {display.category
                  ? display.scope === "all"
                    ? display.category
                    : `${display.category} · ${SCOPE_TITLE[display.scope].toLowerCase()}`
                  : SCOPE_TITLE[display.scope]}
              </Text>
              <Pressable onPress={() => setDisplay(null)} hitSlop={10}>
                <Text style={styles.hideBtn}>✕ Masquer</Text>
              </Pressable>
            </View>

            {displayedTasks.length === 0 ? (
              <View style={styles.tasksBox}>
                <Text style={styles.taskEmpty}>
                  {display.category
                    ? `Aucune tâche pour ${display.category}.`
                    : display.scope === "all"
                      ? "Aucune tâche."
                      : "Rien sur cette période."}
                </Text>
              </View>
            ) : (
              // Level 1 (folders) over the level-2 (temporal) filtered set.
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
                            <Text style={styles.taskDue}>
                              {STATUS_BADGE[t.status]
                                ? STATUS_BADGE[t.status]
                                : t.due_iso
                                  ? fmtWhen(t.due_iso)
                                  : t.due ?? ""}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
          </>
        )}

          </>
        )}
      </ScrollView>
      {/* Interaction journal: single non-scrolling line at the bottom (for
          retrieving the last event; kept minimal to not pollute the UI). */}
      <Text style={styles.journalLine} numberOfLines={1}>
        {log[0] ?? ""}
      </Text>

      {/* Push-to-talk FAB, bottom-right (hold to speak). */}
      {modelStatus === "ready" && (
        <Pressable
          onPressIn={startListening}
          onPressOut={stopListening}
          hitSlop={10}
          style={({ pressed }) => [
            styles.fab,
            status === "listening" && styles.fabActive,
            pressed && styles.fabPressed,
          ]}
        >
          <View style={styles.micBody} />
          <View style={styles.micStem} />
          <View style={styles.micBase} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fbfbfa" },
  splash: { flex: 1, alignItems: "center", justifyContent: "center", gap: 28 },
  ringWrap: {
    width: 176,
    height: 176,
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 5,
    borderColor: "#e6eeff",
    borderTopColor: "#2f6fed",
  },
  ringInner: { alignItems: "center", justifyContent: "center" },
  logo: { width: 88, height: 88 },
  loadPct: {
    marginTop: 2,
    fontSize: 13,
    fontWeight: "700",
    color: "#2f6fed",
    fontVariant: ["tabular-nums"],
  },
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
  testChip: {
    marginLeft: "auto",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d7e3ff",
    backgroundColor: "#eef3ff",
  },
  testChipText: { fontSize: 11, color: "#2f6fed", fontWeight: "600" },
  journalLine: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    fontSize: 11,
    color: "#9aa0a6",
    fontFamily: "monospace",
    backgroundColor: "#f1f3f6",
  },
  fab: {
    position: "absolute",
    right: 22,
    bottom: 48,
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: "#2f6fed",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  fabActive: { backgroundColor: "#2e9e5b" },
  fabPressed: { opacity: 0.9 },
  micBody: { width: 15, height: 23, borderRadius: 7.5, backgroundColor: "#fff" },
  micStem: { width: 2, height: 5, backgroundColor: "#fff", marginTop: 2 },
  micBase: {
    width: 17,
    height: 2,
    borderRadius: 1,
    backgroundColor: "#fff",
    marginTop: 1,
  },
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
  homeHint: {
    marginTop: 28,
    fontSize: 15,
    color: "#9aa0a6",
    fontStyle: "italic",
    textAlign: "center",
  },
  hideBtn: { fontSize: 14, color: "#9aa0a6", fontWeight: "600" },
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
