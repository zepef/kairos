import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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

  // The launch loader is the native ActivityIndicator: it's animated by the
  // Android system, so it stays smooth even though the JS thread freezes in
  // bursts while llama loads the ~3 GB model file (RN's own Animated would
  // stutter during those freezes).
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

  // The logo doubles as the push-to-talk button once the model is ready: hold
  // to listen. A colored halo appears while listening (green) or speaking (blue).
  const renderTalk = (size: number) => (
    <Pressable
      onPressIn={startListening}
      onPressOut={stopListening}
      hitSlop={12}
      style={({ pressed }) => [styles.talkBtn, pressed && styles.talkPressed]}
    >
      {status !== "idle" && (
        <View
          style={[
            styles.talkRing,
            { width: size + 30, height: size + 30, borderRadius: (size + 30) / 2 },
            status === "listening"
              ? styles.talkRingListening
              : styles.talkRingSpeaking,
          ]}
        />
      )}
      <Image
        source={LOGO}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    </Pressable>
  );

  // Launch screen: nothing but the centered logo with a circular loader around
  // it while Gemma loads (and a tap-to-retry affordance if the load failed).
  if (modelStatus !== "ready") {
    return (
      <View style={styles.screen}>
        <StatusBar style="dark" />
        <View style={styles.splash}>
          <View style={styles.ringWrap}>
            {/* The native spinner draws its arc in the TOP of its own box, so
                centering the view leaves the circle above the logo. Nudge the
                spinner down so the circle's center lands on the logo. */}
            <View style={styles.spinnerWrap}>
              <ActivityIndicator
                size="large"
                color="#2f6fed"
                style={styles.loaderSpin}
              />
            </View>
            <View style={styles.loaderWrap}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            </View>
            {/* Percentage just below the circle. */}
            {modelStatus !== "error" && (
              <View style={styles.pctWrap}>
                <Text style={styles.loadPct}>{loadPct}%</Text>
              </View>
            )}
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

      {/* Minimal top bar: status dot + dev "Tester" chip. */}
      <View style={styles.topBar}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
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
      </View>

      {display === null ? (
        // Home: the logo sits centered and IS the push-to-talk button.
        <View style={styles.homeCenter}>{renderTalk(132)}</View>
      ) : (
        // A system command showed tasks: list them, keep talk available below.
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
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
          </ScrollView>
          <View style={styles.dockTalk}>{renderTalk(54)}</View>
        </>
      )}

      {/* Interaction journal: single non-scrolling line at the bottom (for
          retrieving the last event; kept minimal to not pollute the UI). */}
      <Text style={styles.journalLine} numberOfLines={1}>
        {log[0] ?? ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fbfbfa" },
  splash: { flex: 1, alignItems: "center", justifyContent: "center" },
  // Coordinate frame for the loader; centered on screen. The logo sits at its
  // center, the spinner is nudged down to wrap it, the % sits near the bottom.
  ringWrap: { width: 240, height: 240 },
  loaderWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  // Same as loaderWrap but pushed down ~57dp: the native spinner draws its arc
  // that far above its view center, so this re-centers the circle on the logo.
  spinnerWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 65 }],
  },
  loaderSpin: { transform: [{ scale: 3 }] },
  logo: { width: 96, height: 96 },
  // Centered like the logo, then pushed down to sit just below the circle.
  pctWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 10 }],
  },
  loadPct: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2f6fed",
    fontVariant: ["tabular-nums"],
  },
  topBar: {
    paddingTop: 54,
    paddingHorizontal: 20,
    paddingBottom: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  testChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d7e3ff",
    backgroundColor: "#eef3ff",
  },
  testChipText: { fontSize: 11, color: "#2f6fed", fontWeight: "600" },
  // The logo IS the push-to-talk button; a halo appears while listening/speaking.
  homeCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  talkBtn: { alignItems: "center", justifyContent: "center" },
  talkPressed: { opacity: 0.85 },
  talkRing: { position: "absolute", borderWidth: 4, borderColor: "#e6eeff" },
  talkRingListening: { borderColor: "#2e9e5b" },
  talkRingSpeaking: { borderColor: "#2f6fed" },
  dockTalk: { alignItems: "center", paddingVertical: 6 },
  journalLine: {
    paddingHorizontal: 20,
    paddingVertical: 6,
    fontSize: 11,
    color: "#9aa0a6",
    fontFamily: "monospace",
    backgroundColor: "#f1f3f6",
  },
  errorBanner: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fdecec",
    borderWidth: 1,
    borderColor: "#f5c2c2",
  },
  errorText: { fontSize: 14, color: "#c0392b", fontWeight: "600" },
  scroll: { flex: 1 },
  container: {
    backgroundColor: "#fbfbfa",
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  tasksHeaderRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: "#1a1a1a" },
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
});
