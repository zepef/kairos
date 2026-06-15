import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { isLoaded, loadModel, parseIntent } from "./llm";
import {
  dispatch,
  taskEmoji,
  STATUS_EMOJI,
  STATUS_LABEL,
  type PendingAction,
  type Scope,
  type ShowSpec,
} from "./intent";
import {
  applyRevert,
  deleteTaskById,
  initDb,
  listTasks,
  updateTaskById,
  type Revert,
  type Task,
} from "./db";

// Kairos — STT (FR) + on-device intent parsing with Gemma 4 (E2B) via llama.rn.
// Voice -> STT -> Gemma 4 (JSON action) -> execute on local SQLite -> TTS.
const LANG = "fr-FR";

// Kairos logo — centered on the launch screen and used as the PTT button.
const LOGO = require("./assets/kairos-logo.png");
// Shared sizing so the logo + circle are identical on the launch screen and the
// push-to-talk button (PTT sizing validated as "perfect": 132 logo, +30 ring).
const LOGO_SIZE = 132;

type Status = "idle" | "listening" | "speaking";
type ModelStatus = "unloaded" | "loading" | "ready" | "error";

// Dev test phrases (cycled by the "Tester l'intention" button) to drive the
// intent loop without voice.
const TEST_PHRASES = [
  "ajoute appeler Paul demain 10h au bureau, c'est urgent",
  "ajoute acheter du pain ce soir à la maison",
  "affiche toutes les tâches",
  "marque la 1 comme faite",
  "reporte la 2 à vendredi 9h",
  "renomme la 1 en acheter une baguette",
  "supprime la 1",
  "annule",
  "qu'est-ce qui est en retard",
  "rappelle-moi ce qui arrive et ce qui est en retard",
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
  const [ttsOn, setTtsOn] = useState(true);
  // Top summary panel: what we heard + the understood intent (visual echo of
  // the TTS confirmation, so the user sees we got their intent right).
  const [heard, setHeard] = useState("");
  const [summary, setSummary] = useState("");
  const [summaryEmoji, setSummaryEmoji] = useState("");
  // CRUD plumbing: last undoable mutation, and a pending disambiguation.
  const [lastRevert, setLastRevert] = useState<Revert | null>(null);
  const [candidates, setCandidates] = useState<Task[] | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  // Folder labels currently collapsed in the task list (accordion).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleFolder = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  // The launch loader is the native ActivityIndicator: it's animated by the
  // Android system, so it stays smooth even though the JS thread freezes in
  // bursts while llama loads the ~3 GB model file (RN's own Animated would
  // stutter during those freezes).
  const warmAnnounced = useRef(false);

  // Load every row; displayedTasks decides open-vs-status per the display spec
  // (so an explicit ÉTAT filter like "accomplies" can surface done/archived).
  const refreshTasks = async () => setTasks(await listTasks("all"));

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
    // A new utterance begins: clear the previous summary right away so the top
    // panel is replaced by the new intent (shows "À l'écoute…" meanwhile).
    setHeard("");
    setSummary("");
    setSummaryEmoji("");
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
    if (!ttsOn) return; // voice output disabled via the TTS toggle
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
    addLog("⏳ chargement…");
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
          speak("Initialisation du système.");
        }
      });
      setLoadPct(100);
      setModelStatus("ready");
      setIntentPerf(`chargé en ${(ms / 1000).toFixed(1)}s`);
      addLog(`✓ prêt (${(ms / 1000).toFixed(1)}s)`);
      console.log(`[KAIROS] model ready in ${ms}ms`);
      // PTT now visible: tell the user how to use it (once — loadGemma runs once).
      speak(
        "Maintenez le bouton central appuyé pour enregistrer votre commande.",
      );
    } catch (e: any) {
      setModelStatus("error");
      addLog(`✗ load model: ${e?.message ?? e}`);
      console.log(`[KAIROS] load error: ${e?.message ?? e}`);
    }
  };

  const runIntent = async (text: string) => {
    // Disambiguation follow-up: a mutation is waiting for which task.
    if (pending && candidates) {
      const sel = pickCandidate(text, candidates);
      if (sel === "cancel") {
        setPending(null);
        setCandidates(null);
        setHeard(text);
        setSummary("Annulé.");
        setSummaryEmoji("✖️");
        speak("Annulé.");
        return;
      }
      if (sel) {
        setProcessing(true);
        setHeard(text);
        setSummary("");
        setSummaryEmoji("");
        try {
          const r = await applyPending(pending, sel);
          setPending(null);
          setCandidates(null);
          await refreshTasks();
          setSummary(r.speech);
          setSummaryEmoji(r.emoji);
          speak(r.speech);
        } finally {
          setProcessing(false);
        }
        return;
      }
      // Not a selection -> treat as a brand-new command.
      setPending(null);
      setCandidates(null);
    }

    setIntentJson("…");
    setIntentPerf("inférence…");
    setProcessing(true);
    setHeard(text); // echo what was heard in the top panel
    setSummary("");
    setSummaryEmoji("");
    console.log(`[KAIROS] input :: ${text}`);
    // Bridge the wait (on-device inference takes a few seconds) until we can
    // confirm what was understood.
    speak("ok");
    try {
      const r = await parseIntent(text);
      setIntentJson(r.json);
      setIntentPerf(
        `total ${r.ms}ms · prefill ${r.prefillMs ?? "?"}ms/${r.prefillTokens ?? "?"}tok · ` +
          `decode ${r.decodeMs ?? "?"}ms${r.tokensPerSec ? ` @${r.tokensPerSec}tok/s` : ""}`,
      );
      console.log(`[KAIROS] intent ${r.ms}ms ${r.tokensPerSec}tok/s :: ${r.json}`);
      // Numbers shown on screen are how the user references a task.
      const ids = numberedList.map((t) => t.id);
      const res = await dispatch(r.json, text, ids);

      if (res.tool === "undo") {
        let sp = "Rien à annuler.";
        if (lastRevert) {
          await applyRevert(lastRevert);
          setLastRevert(null);
          await refreshTasks();
          sp = "C'est annulé.";
        }
        setSummary(sp);
        setSummaryEmoji("↩️");
        speak(sp);
      } else if (res.candidates && res.pending) {
        // Ambiguous reference: show the numbered candidates and ask which.
        setDisplay(null);
        setCandidates(res.candidates);
        setPending(res.pending);
        setSummary(res.speech);
        setSummaryEmoji(res.emoji);
        speak(res.speech);
      } else {
        if (res.show) {
          setDisplay(res.show); // system command: show the task list
          setCandidates(null);
          setPending(null);
        }
        if (res.revert) setLastRevert(res.revert);
        await refreshTasks();
        setSummary(res.speech);
        setSummaryEmoji(res.emoji);
        speak(res.speech);
      }
      addLog(`${res.ok ? "✓" : "✗"} ${res.tool}: ${res.speech}`);
      console.log(`[KAIROS] action ${res.tool} ok=${res.ok} :: ${res.speech}`);
    } catch (e: any) {
      setIntentJson("");
      setSummary("Je n'ai pas compris.");
      setSummaryEmoji("❓");
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

  // Apply every composable display dimension (each optional):
  // ÉTAT (status) × QUOI (category) × QUI (person) × OÙ (place) × URGENT
  // × QUAND (scope, incl. overdue / reminder). The folders view then structures
  // whatever survives.
  const displayedTasks = (() => {
    if (display === null) return [];
    let set = tasks;
    // ÉTAT: explicit status filter, else default to the open list.
    if (display.status) {
      set = set.filter((t) => t.status === display.status);
    } else {
      set = set.filter((t) => t.status !== "done" && t.status !== "archived");
    }
    // QUOI (folder/project)
    if (display.category) {
      const c = display.category.toLowerCase();
      set = set.filter((t) => (t.category || "").toLowerCase() === c);
    }
    // QUI (person) — fuzzy contains
    if (display.person) {
      const p = display.person.toLowerCase();
      set = set.filter((t) => (t.person || "").toLowerCase().includes(p));
    }
    // OÙ (place) — fuzzy contains
    if (display.place) {
      const pl = display.place.toLowerCase();
      set = set.filter((t) => (t.place || "").toLowerCase().includes(pl));
    }
    // URGENT — priority high (2–3)
    if (display.urgent) {
      set = set.filter((t) => (t.priority ?? 0) >= 2);
    }
    // QUAND (temporal)
    const now = Date.now();
    if (display.scope === "overdue") {
      set = set.filter((t) => {
        const ms = parseIso(t.due_iso);
        return !Number.isNaN(ms) && ms < now;
      });
    } else if (display.scope === "reminder") {
      // à venir bientôt (≤ 24 h) OU en retard
      const soon = now + 24 * 3600 * 1000;
      set = set.filter((t) => {
        const ms = parseIso(t.due_iso);
        return !Number.isNaN(ms) && ms < soon;
      });
    } else if (display.scope !== "all") {
      const [s, e] = scopeBounds(display.scope);
      set = set.filter((t) => {
        const ms = parseIso(t.due_iso);
        return !Number.isNaN(ms) && ms >= s && ms < e;
      });
    }
    return set;
  })();

  const folders = buildFolders(displayedTasks);

  // Mini agenda peek shown under the PTT button: the few soonest open tasks
  // (tasks is already sorted by due date). Grows as the user adds/updates tasks.
  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.status !== "archived")
    .slice(0, 4);

  // What's currently on screen, in order, is what gets numbered — and a number
  // is how the user CRUDs on a task ("supprime la 2"). Disambiguation
  // candidates > displayed list > home mini-agenda.
  const flatDisplayed = folders.flatMap((f) => f.subs.flatMap((s) => s.items));
  const numberedList: Task[] =
    candidates ?? (display ? flatDisplayed : upcoming);
  const numberOf = new Map(numberedList.map((t, i) => [t.id, i + 1]));

  // Resolve a disambiguation reply to one candidate (number, ordinal, keyword)
  // or "cancel".
  const pickCandidate = (
    text: string,
    cands: Task[],
  ): Task | "cancel" | null => {
    const s = text.toLowerCase().trim();
    if (/(annul|laisse|aucun|rien|tant pis|non merci)/.test(s)) return "cancel";
    const num = s.match(/\b(\d{1,2})\b/);
    if (num) {
      const i = +num[1] - 1;
      if (i >= 0 && i < cands.length) return cands[i];
    }
    const ord: [RegExp, number][] = [
      [/premi/, 0],
      [/deuxi|second/, 1],
      [/troisi/, 2],
      [/quatri/, 3],
      [/cinqui/, 4],
    ];
    for (const [re, i] of ord) if (re.test(s) && i < cands.length) return cands[i];
    if (/derni/.test(s)) return cands[cands.length - 1];
    const hits = cands.filter((c) => {
      const hay = `${c.title} ${c.person ?? ""} ${c.category ?? ""} ${c.place ?? ""}`.toLowerCase();
      return s.split(/\s+/).some((w) => w.length > 3 && hay.includes(w));
    });
    return hits.length === 1 ? hits[0] : null;
  };

  // Run a pending mutation once its target task is chosen; record the undo.
  const applyPending = async (
    p: PendingAction,
    t: Task,
  ): Promise<{ speech: string; emoji: string }> => {
    if (p.kind === "delete") {
      await deleteTaskById(t.id);
      setLastRevert({ kind: "reinsert", task: t });
      return {
        speech: `Supprimé : ${t.title}. Dites « annule » pour récupérer.`,
        emoji: "🗑️",
      };
    }
    if (p.kind === "status") {
      const completedAt = p.status === "done" ? Date.now() : null;
      await updateTaskById(t.id, { status: p.status, completed_at: completedAt });
      setLastRevert({
        kind: "update",
        id: t.id,
        fields: { status: t.status, completed_at: t.completed_at },
      });
      return {
        speech: `${t.title} : ${STATUS_LABEL[p.status]}.`,
        emoji: STATUS_EMOJI[p.status],
      };
    }
    const t0 = t as any;
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(p.changes)) before[k] = t0[k] ?? null;
    await updateTaskById(t.id, p.changes);
    setLastRevert({ kind: "update", id: t.id, fields: before });
    return {
      speech: `${(p.changes as any).title ?? t.title} : mis à jour.`,
      emoji: "✏️",
    };
  };

  const SCOPE_TITLE: Record<Scope, string> = {
    all: "Toutes les tâches",
    hours: "Prochaines heures",
    day: "Aujourd'hui",
    week: "Cette semaine",
    month: "Ce mois",
    overdue: "En retard",
    reminder: "Rappel",
  };

  const STATUS_TITLE: Partial<Record<Task["status"], string>> = {
    todo: "à faire",
    pending: "en attente",
    postponed: "à reporter",
    done: "accomplies",
    archived: "archivées",
  };

  // Header reflecting every active display dimension, e.g.
  // "En retard · urgent · avec Paul".
  const displayTitle = (() => {
    if (display === null) return "";
    const bits: string[] = [SCOPE_TITLE[display.scope]];
    if (display.status) bits.push(STATUS_TITLE[display.status] ?? "");
    if (display.urgent) bits.push("urgent");
    if (display.category) bits.push(`pour ${display.category}`);
    if (display.person) bits.push(`avec ${display.person}`);
    if (display.place) bits.push(`à ${display.place}`);
    return bits.filter(Boolean).join(" · ");
  })();

  const STATUS_BADGE: Partial<Record<Task["status"], string>> = {
    pending: "en attente",
    postponed: "à reporter",
  };

  // The logo doubles as the push-to-talk button once the model is ready: hold
  // to listen. A colored halo appears while listening (green) or speaking (blue).
  const renderTalk = (size: number) => {
    const ring = size + 30;
    return (
      <Pressable
        onPressIn={startListening}
        onPressOut={stopListening}
        hitSlop={12}
        style={({ pressed }) => [styles.talkBtn, pressed && styles.talkPressed]}
      >
        {/* Circle around the logo: blue by default, green while listening. */}
        <View
          style={[
            styles.talkRing,
            { width: ring, height: ring, borderRadius: ring / 2 },
            status === "listening" && styles.talkRingListening,
          ]}
        />
        <Image
          source={LOGO}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      </Pressable>
    );
  };

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
            {/* Below the circle: percentage, replaced by a wait message at 100%
                (the model is then warming up). */}
            {modelStatus !== "error" && (
              <View style={styles.pctWrap}>
                <Text style={styles.loadPct}>
                  {loadPct >= 100 ? "Un instant SVP" : `${loadPct}%`}
                </Text>
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

      {/* Top summary panel: visual echo of the current intent (replaced on each
          new utterance — listening → understanding → result). */}
      {(status === "listening" || processing || summary) && (
        <View style={styles.topNote}>
          {heard ? (
            <Text style={styles.topNoteHeard} numberOfLines={1}>
              « {heard} »
            </Text>
          ) : null}
          <View style={styles.topNoteRow}>
            {!processing && status !== "listening" && summaryEmoji ? (
              <Text style={styles.topNoteEmoji}>{summaryEmoji}</Text>
            ) : null}
            <Text style={styles.topNoteSummary} numberOfLines={2}>
              {status === "listening" && !processing
                ? "À l'écoute…"
                : processing
                  ? "Compréhension en cours…"
                  : summary}
            </Text>
          </View>
        </View>
      )}

      {candidates ? (
        // Ambiguous reference: numbered candidates, pick one by number/voice.
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.tasksHeaderRow}>
              <Text style={styles.sectionTitle}>Laquelle ?</Text>
              <Pressable
                onPress={() => {
                  setCandidates(null);
                  setPending(null);
                }}
                hitSlop={10}
              >
                <Text style={styles.hideBtn}>✕ Annuler</Text>
              </Pressable>
            </View>
            <View style={styles.tasksBox}>
              {candidates.map((t) => (
                <View key={t.id} style={styles.taskRow}>
                  <Text style={styles.taskNum}>{numberOf.get(t.id)}</Text>
                  <Text style={styles.taskTitle}>{t.title}</Text>
                  <Text style={styles.taskDue}>
                    {t.due_iso ? fmtWhen(t.due_iso) : (t.due ?? "")}
                  </Text>
                </View>
              ))}
            </View>
          </ScrollView>
          <View style={styles.dockTalk}>{renderTalk(54)}</View>
        </>
      ) : display === null ? (
        // Home: the logo is the push-to-talk button, with a live mini agenda
        // of upcoming tasks below it (fed as the user issues commands).
        <View style={styles.homeCenter}>
          {renderTalk(LOGO_SIZE)}
          {upcoming.length > 0 && (
            <View style={styles.miniPlan}>
              <Text style={styles.miniHeader}>À venir</Text>
              {upcoming.map((t) => (
                <View key={t.id} style={styles.miniRow}>
                  <Text style={styles.miniNum}>{numberOf.get(t.id)}</Text>
                  <Text style={styles.miniEmoji}>
                    {taskEmoji(t.category, t.title)}
                  </Text>
                  <Text style={styles.miniTitle} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <Text style={styles.miniDue}>
                    {t.due_iso ? fmtWhen(t.due_iso) : (t.due ?? "")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : (
        // A system command showed tasks: list them, keep talk available below.
        <>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.tasksHeaderRow}>
              <Text style={styles.sectionTitle}>{displayTitle}</Text>
              <Pressable onPress={() => setDisplay(null)} hitSlop={10}>
                <Text style={styles.hideBtn}>✕ Masquer</Text>
              </Pressable>
            </View>

            {displayedTasks.length === 0 ? (
              <View style={styles.tasksBox}>
                <Text style={styles.taskEmpty}>
                  {display.scope === "overdue"
                    ? "Rien en retard."
                    : "Aucune tâche pour ces critères."}
                </Text>
              </View>
            ) : (
              // Level 1 (folders) over the level-2 (temporal) filtered set —
              // each folder is a collapsible accordion section.
              folders.map((f) => (
                <View key={f.label} style={styles.folder}>
                  <Pressable
                    style={styles.folderHeader}
                    onPress={() => toggleFolder(f.label)}
                    hitSlop={6}
                  >
                    <Text style={styles.folderTitle}>
                      {f.label} ({f.count})
                    </Text>
                    <Text style={styles.folderChevron}>
                      {collapsed.has(f.label) ? "▸" : "▾"}
                    </Text>
                  </Pressable>
                  {!collapsed.has(f.label) &&
                    f.subs.map((s) => (
                    <View key={s.label || "_"}>
                      {s.label ? (
                        <Text style={styles.subfolderTitle}>{s.label}</Text>
                      ) : null}
                      <View style={styles.tasksBox}>
                        {s.items.map((t) => (
                          <View key={t.id} style={styles.taskRow}>
                            <Text style={styles.taskNum}>
                              {numberOf.get(t.id)}
                            </Text>
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

      {/* Bottom bar: version (left) + TTS toggle + dev "Tester" chip (right). */}
      <View style={styles.bottomBar}>
        <Text style={styles.versionLabel}>Kairos version 0.3</Text>
        <View style={styles.bottomRight}>
          <View style={styles.ttsToggle}>
            <Text style={styles.ttsLabel}>TTS</Text>
            <Switch
              value={ttsOn}
              onValueChange={setTtsOn}
              trackColor={{ true: "#2f6fed", false: "#cfd4da" }}
              thumbColor="#ffffff"
              style={styles.ttsSwitch}
            />
          </View>
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
      </View>
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
    transform: [{ translateY: 88 }],
  },
  loaderSpin: { transform: [{ scale: 5.2 }] },
  logo: { width: LOGO_SIZE, height: LOGO_SIZE },
  // Centered like the logo, then pushed down to sit just below the circle.
  pctWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 26 }],
  },
  loadPct: {
    fontSize: 14,
    fontWeight: "700",
    color: "#2f6fed",
    fontVariant: ["tabular-nums"],
  },
  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 8,
    // Clear the Android navigation bar (48dp inset on this device) since Expo
    // SDK 56 draws edge-to-edge by default.
    paddingBottom: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  versionLabel: { fontSize: 13, fontWeight: "600", color: "#9aa0a6" },
  bottomRight: { flexDirection: "row", alignItems: "center", gap: 14 },
  ttsToggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  ttsLabel: { fontSize: 12, fontWeight: "600", color: "#9aa0a6" },
  ttsSwitch: { transform: [{ scale: 0.8 }] },
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
  topNote: {
    marginTop: 50,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#eef3ff",
    borderWidth: 1,
    borderColor: "#cfe0ff",
  },
  topNoteHeard: {
    fontSize: 12,
    color: "#7a869a",
    fontStyle: "italic",
    marginBottom: 3,
  },
  topNoteRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  topNoteEmoji: { fontSize: 22 },
  topNoteSummary: { flex: 1, fontSize: 14, fontWeight: "600", color: "#1a1a1a" },
  homeCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
  miniPlan: { width: "88%", marginTop: 28 },
  miniHeader: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9aa0a6",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  miniRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e8e8e8",
  },
  miniNum: {
    fontSize: 12,
    fontWeight: "700",
    color: "#9aa0a6",
    minWidth: 16,
    fontVariant: ["tabular-nums"],
  },
  miniEmoji: { fontSize: 18 },
  miniTitle: { flex: 1, fontSize: 14, color: "#1a1a1a" },
  miniDue: { fontSize: 12, color: "#2f6fed" },
  talkBtn: { alignItems: "center", justifyContent: "center" },
  talkPressed: { opacity: 0.85 },
  talkRing: { position: "absolute", borderWidth: 6, borderColor: "#2f6fed" },
  talkRingListening: { borderColor: "#2e9e5b" },
  dockTalk: { alignItems: "center", paddingVertical: 6 },
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
  folderHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  folderChevron: { fontSize: 13, color: "#2f6fed", marginBottom: 6 },
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
    gap: 10,
  },
  taskNum: {
    fontSize: 13,
    fontWeight: "700",
    color: "#9aa0a6",
    minWidth: 18,
    fontVariant: ["tabular-nums"],
  },
  taskTitle: { flex: 1, fontSize: 16, color: "#1a1a1a" },
  taskDue: { fontSize: 13, color: "#2f6fed" },
});
