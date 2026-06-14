import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

// Cadence — J3 walking skeleton: push-to-talk -> STT (FR) -> live transcript -> TTS echo.
// Goal: measure on-device French STT on the target S96 (Android 12 / API 31).
const LANG = "fr-FR";

type Status = "idle" | "listening" | "speaking";

export default function App() {
  const [status, setStatus] = useState<Status>("idle");
  const [partial, setPartial] = useState("");
  const [finalText, setFinalText] = useState("");
  const [preferOffline, setPreferOffline] = useState(true);
  const [log, setLog] = useState<string[]>([]);

  const addLog = (line: string) =>
    setLog((prev) => [line, ...prev].slice(0, 30));

  useSpeechRecognitionEvent("start", () => {
    setStatus("listening");
    addLog("● start");
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript ?? "";
    if (event.isFinal) {
      setFinalText(transcript);
      setPartial("");
      addLog(`✓ final: ${transcript || "(vide)"}`);
      if (transcript) speak(`J'ai entendu : ${transcript}`);
    } else {
      setPartial(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    addLog(`✗ error: ${event.error} — ${event.message}`);
    setStatus("idle");
  });

  useSpeechRecognitionEvent("end", () => {
    addLog("○ end");
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

  const startListening = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      addLog("✗ permission micro refusée");
      return;
    }
    setFinalText("");
    setPartial("");
    addLog(`▶ start (offline préféré: ${preferOffline})`);
    ExpoSpeechRecognitionModule.start({
      lang: LANG,
      interimResults: true,
      continuous: false,
      maxAlternatives: 1,
      // Android 12/API 31: pas de vrai on-device natif → on PRÉFÈRE l'offline,
      // repli en ligne automatique si le pack FR n'est pas installé.
      requiresOnDeviceRecognition: false,
      androidIntentOptions: {
        EXTRA_PREFER_OFFLINE: preferOffline,
      },
    });
  };

  const stopListening = () => ExpoSpeechRecognitionModule.stop();

  const dotColor =
    status === "listening"
      ? "#2e9e5b"
      : status === "speaking"
        ? "#2f6fed"
        : "#9aa0a6";

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Text style={styles.title}>Cadence — test vocal</Text>

      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.statusText}>{status}</Text>
      </View>

      <View style={styles.toggleRow}>
        <Text style={styles.toggleLabel}>Préférer hors-ligne (FR)</Text>
        <Switch value={preferOffline} onValueChange={setPreferOffline} />
      </View>

      <View style={styles.transcriptBox}>
        <Text style={styles.label}>En cours…</Text>
        <Text style={styles.partial}>{partial || "—"}</Text>
        <Text style={styles.label}>Reconnu</Text>
        <Text style={styles.final}>{finalText || "—"}</Text>
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

      <Pressable
        onPress={() => speak("Bonjour, ici Cadence. Le test audio fonctionne.")}
        style={styles.ttsBtn}
      >
        <Text style={styles.ttsBtnText}>Tester la voix (TTS)</Text>
      </Pressable>

      <Text style={styles.label}>Journal</Text>
      <ScrollView style={styles.logBox}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fbfbfa",
    paddingTop: 60,
    paddingHorizontal: 20,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#1a1a1a" },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { fontSize: 16, color: "#444" },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 16,
  },
  toggleLabel: { fontSize: 15, color: "#333" },
  transcriptBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#eee",
  },
  label: {
    marginTop: 10,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#999",
  },
  partial: { fontSize: 16, color: "#888", fontStyle: "italic" },
  final: { fontSize: 20, color: "#111", fontWeight: "600" },
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
  logBox: {
    marginTop: 6,
    flex: 1,
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
