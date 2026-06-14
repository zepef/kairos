import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { isLoaded, loadModel, parseIntent } from "./llm";
import { dispatch } from "./intent";
import { initDb, listTasks, type Task } from "./db";

// Kairos — STT (FR) + on-device intent parsing with Gemma 4 (E2B) via llama.rn.
// Voice -> STT -> Gemma 4 (JSON action) -> execute on local SQLite -> TTS.
const LANG = "fr-FR";

type Status = "idle" | "listening" | "speaking";
type ModelStatus = "unloaded" | "loading" | "ready" | "error";

// Dev test phrases (cycled by the "Tester l'intention" button) to drive the
// intent loop without voice.
const TEST_PHRASES = [
  "pour le projet Mon Assistant Pro, pense à ajouter une UI en anglais",
  "ajoute au projet Kairos l'écriture des tests unitaires",
  "appelle le dentiste demain à 14h pour reprendre rendez-vous",
  "rappelle-moi d'acheter du pain et du lait ce soir en rentrant",
  "qu'est-ce que j'ai de prévu cette semaine ?",
];

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [testIdx, setTestIdx] = useState(0);

  const [modelStatus, setModelStatus] = useState<ModelStatus>("unloaded");
  const [intentJson, setIntentJson] = useState("");
  const [intentPerf, setIntentPerf] = useState("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [processing, setProcessing] = useState(false);

  const refreshTasks = async () => setTasks(await listTasks("open"));

  useEffect(() => {
    initDb()
      .then(refreshTasks)
      .catch((e) => addLog(`✗ db init: ${e?.message ?? e}`));
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
    addLog("⏳ chargement Gemma 4 E2B…");
    try {
      const { ms } = await loadModel((p) => setIntentPerf(`chargement ${p}%`));
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

  // Group open tasks into level-1 folders (created on the fly from the LLM's
  // category). Case-insensitive so "Santé"/"santé" merge; first-seen label wins.
  // Tasks with no category fall under "Divers".
  const taskGroups = (() => {
    const map = new Map<string, { label: string; items: Task[] }>();
    for (const t of tasks) {
      const label = t.category || "Divers";
      const key = label.toLowerCase();
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(t);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  })();

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

        <View style={styles.tasksHeaderRow}>
          <Text style={styles.sectionTitle}>Mes tâches ({tasks.length})</Text>
          {processing && <Text style={styles.processing}>traitement…</Text>}
        </View>
        {tasks.length === 0 ? (
          <View style={styles.tasksBox}>
            <Text style={styles.taskEmpty}>Aucune tâche. Dicte une demande.</Text>
          </View>
        ) : (
          // Level-1 folders, created on the fly — only non-empty ones show.
          taskGroups.map((g) => (
            <View key={g.label} style={styles.folder}>
              <Text style={styles.folderTitle}>
                {g.label} ({g.items.length})
              </Text>
              <View style={styles.tasksBox}>
                {g.items.map((t) => (
                  <View key={t.id} style={styles.taskRow}>
                    <Text style={styles.taskTitle}>{t.title}</Text>
                    {t.due ? <Text style={styles.taskDue}>{t.due}</Text> : null}
                  </View>
                ))}
              </View>
            </View>
          ))
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
