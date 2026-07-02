import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { isLoaded, loadModel, parseIntent } from "./llm";
import * as ScreenOrientation from "expo-screen-orientation";
import CalendarView from "./calendar";
import {
  dispatch,
  taskEmoji,
  STATUS_EMOJI,
  type CalRange,
  type PendingAction,
  type Scope,
  type ShowSpec,
} from "./intent";
import {
  applyRevert,
  deleteTaskById,
  getSetting,
  initDb,
  listTasks,
  setSetting,
  updateTaskById,
  type Revert,
  type Task,
} from "./db";
import { tr, type Lang, STT_LANG, TTS_LANG } from "./i18n";
import { LangToggle } from "./flags";
import { THEMES, DEFAULT_THEME, type Theme, type ThemeName } from "./theme";
import { ThemeContext, isThemeName } from "./ThemeContext";
import { useAppFonts } from "./fonts";
import { Orb, LogoMark, type OrbVState } from "./Orb";
import Picker from "./Picker";
import Settings from "./Settings";

// Kairos — STT (FR/EN) + on-device intent parsing with Gemma 4 (E2B) via
// llama.rn. Voice -> STT -> Gemma 4 (JSON action) -> execute on SQLite -> TTS.
// The active language (state below) drives STT/TTS locale, the Gemma system
// prompt and every on-screen + spoken string (see i18n.ts). The active theme
// (theme.ts / ThemeContext) re-skins the whole UI live.

// Home orb diameter (the push-to-talk zone). Compact orbs (list/calendar) size
// themselves inline.
const ORB_SIZE = 210;

type Status = "idle" | "listening" | "speaking";
type ModelStatus = "unloaded" | "loading" | "ready" | "error";

// Dev test phrases (cycled by the "Tester" button) to drive the intent loop
// without voice — per language, so the chip exercises whichever Gemma prompt is
// active.
const TEST_PHRASES: Record<Lang, string[]> = {
  fr: [
    "ajoute appeler Paul demain 10h au bureau, c'est urgent",
    "ajoute acheter du pain ce soir à la maison",
    "affiche toutes les tâches",
    "marque la 1 comme faite",
    "reporte la 2 à vendredi 9h",
    "renomme la 1 en acheter une baguette",
    "supprime la 1",
    "annule",
    "qu'est-ce qui est en retard",
    "affiche le calendrier hebdomadaire",
    "affiche le calendrier mensuel",
    "affiche le calendrier annuel",
    "affiche le calendrier quotidien",
    "zoom avant",
    "zoom arrière",
    "ajoute une note à la tâche 1 : penser à apporter le dossier bleu",
    "complète la note de la 1 : et prévoir le parking",
    "déplace la 1 dans le dossier Travail",
    "lis la note de la 1",
  ],
  en: [
    "add call Paul tomorrow 10am at the office, it's urgent",
    "add buy bread tonight at home",
    "show all tasks",
    "mark 1 as done",
    "postpone 2 to Friday 9am",
    "rename 1 to buy a baguette",
    "delete 1",
    "undo",
    "what's overdue",
    "show the weekly calendar",
    "show the monthly calendar",
    "show the yearly calendar",
    "show the daily calendar",
    "zoom in",
    "zoom out",
    "add a note to task 1: remember to bring the blue folder",
    "append to the note of 1: and plan for parking",
    "move 1 to the Work folder",
    "read the note of 1",
  ],
};

// Calendar zoom levels, narrowest → widest. "out" widens (day→week→month→year),
// "in" adds detail (year→month→week→day). Shared with the same order in
// calendar.tsx; kept here so voice zoom resolves the next level.
const CAL_LEVELS: CalRange[] = ["day", "week", "month", "year"];
const widerLevel = (r: CalRange): CalRange =>
  CAL_LEVELS[Math.min(CAL_LEVELS.length - 1, CAL_LEVELS.indexOf(r) + 1)];
const narrowerLevel = (r: CalRange): CalRange =>
  CAL_LEVELS[Math.max(0, CAL_LEVELS.indexOf(r) - 1)];

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
function buildFolders(items: Task[], miscLabel: string): Folder[] {
  type Sub = { label: string; items: Task[] };
  const map = new Map<string, { label: string; subs: Map<string, Sub> }>();
  for (const t of items) {
    const cat = t.category || miscLabel;
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
  // Active UI/voice language (FR launch default), toggled by the flags. Drives
  // STT/TTS locale, the Gemma prompt and every string via L = tr(lang).
  const [lang, setLang] = useState<Lang>("fr");
  // Active theme (design-system, theme.ts). Persisted in SQLite; provided to the
  // whole tree via ThemeContext. Signal is the launch default.
  const [themeName, setThemeName] = useState<ThemeName>(DEFAULT_THEME);
  // The bundled themed fonts must be ready before we paint text.
  const fontsLoaded = useAppFonts();
  // The picker (theme choice during model load) stays up until "Commencer".
  const [started, setStarted] = useState(false);
  // Settings overlay (reached from the home ⚙ button).
  const [settingsOpen, setSettingsOpen] = useState(false);

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
  // Note-capture mode: when set, the NEXT utterance is stored verbatim as this
  // task's note (it bypasses Gemma so the dictated note isn't parsed as a
  // command). prevNote is kept so "annule" can restore the previous note.
  const [noteCapture, setNoteCapture] = useState<{
    taskId: number;
    title: string;
    prevNote: string | null;
    append: boolean; // true = concat to prevNote, false = replace
  } | null>(null);
  // "modifie la note" is ambiguous: hold the task while we ask the user whether
  // to edit (replace) / append / erase; the next utterance picks the operation.
  const [noteChoice, setNoteChoice] = useState<{
    taskId: number;
    title: string;
    prevNote: string | null;
  } | null>(null);
  // Graphical calendar overlay (landscape); null = not shown. The zoom level
  // (range) and the date it's anchored on are the single source of truth, so
  // zoom behaves identically from touch and from voice.
  const [calendar, setCalendar] = useState<{
    range: CalRange;
    anchor: Date;
  } | null>(null);
  // Folder labels currently collapsed in the task list (accordion).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleFolder = (label: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      return next;
    });

  // The translated strings for the active language. Used everywhere below
  // (callbacks + render) for both on-screen text and TTS feedback.
  const L = tr(lang);

  // The active theme + its context value. setTheme persists the choice.
  const theme = THEMES[themeName];
  const setTheme = (n: ThemeName) => {
    setThemeName(n);
    setSetting("theme", n).catch(() => {});
  };
  const themeCtx = useMemo(
    () => ({ theme, name: themeName, setTheme }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeName],
  );
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Language change that also persists the choice.
  const changeLang = (l: Lang) => {
    setLang(l);
    setSetting("lang", l).catch(() => {});
  };

  // Launch overdue check fires once, after the user taps "Commencer" (so the
  // alert doesn't talk over the loading announcements).
  const warmAnnounced = useRef(false);
  const launchAlerted = useRef(false);

  // Load every row; displayedTasks decides open-vs-status per the display spec
  // (so an explicit ÉTAT filter like "accomplies" can surface done/archived).
  const refreshTasks = async () => setTasks(await listTasks("all"));

  // On launch: open the DB, restore saved theme/language, then auto-load Gemma 4
  // (with progress) so the model is ready without any manual step.
  useEffect(() => {
    (async () => {
      try {
        await initDb();
        const savedTheme = await getSetting("theme");
        if (isThemeName(savedTheme)) setThemeName(savedTheme);
        const savedLang = await getSetting("lang");
        if (savedLang === "fr" || savedLang === "en") setLang(savedLang);
        await refreshTasks();
      } catch (e: any) {
        addLog(`✗ db init: ${e?.message ?? e}`);
      }
      loadGemma();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Calendars are landscape; everything else is portrait. We lock to a FIXED
  // landscape orientation (LEFT) rather than the sensor-based LANDSCAPE so the
  // calendar reads the natural way the phone is held — i.e. rotated 180° from
  // LANDSCAPE_RIGHT (swap back to LANDSCAPE_RIGHT to flip the other way).
  useEffect(() => {
    ScreenOrientation.lockAsync(
      calendar
        ? ScreenOrientation.OrientationLock.LANDSCAPE_LEFT
        : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => {});
  }, [calendar]);

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
      language: TTS_LANG[lang],
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
    speak(L.loadingModel);
    try {
      const { ms } = await loadModel((p) => {
        // initLlama reports 0..1 or 0..100 depending on platform — normalize.
        const pct = Math.max(0, Math.min(100, Math.round(p <= 1 ? p * 100 : p)));
        console.log(`[KAIROS] load progress ${pct}%`);
        setLoadPct(pct);
        // File done -> warm-up begins; announce it once.
        if (pct >= 100 && !warmAnnounced.current) {
          warmAnnounced.current = true;
          speak(L.initSystem);
        }
      });
      setLoadPct(100);
      setModelStatus("ready");
      setIntentPerf(`chargé en ${(ms / 1000).toFixed(1)}s`);
      addLog(`✓ prêt (${(ms / 1000).toFixed(1)}s)`);
      console.log(`[KAIROS] model ready in ${ms}ms`);
      // The "hold to speak" cue is spoken when the user taps "Commencer" and the
      // orb actually appears (handleStart) — not here, where the Picker is still
      // on screen.
    } catch (e: any) {
      setModelStatus("error");
      addLog(`✗ load model: ${e?.message ?? e}`);
      console.log(`[KAIROS] load error: ${e?.message ?? e}`);
    }
  };

  const runIntent = async (text: string) => {
    // Note-operation follow-up: we asked "edit / append / erase?" so THIS
    // utterance picks the operation (never sent to Gemma). edit/append then open
    // dictation; erase clears now; anything else cancels.
    if (noteChoice) {
      const ch = noteChoice;
      setNoteChoice(null);
      setHeard(text);
      const s = text.toLowerCase().trim();
      if (/(édit|edit|modif|remplac|replace|rewrite|overwrite|écras|ecras|refai|nouvelle|new)/.test(s)) {
        setNoteCapture({
          taskId: ch.taskId,
          title: ch.title,
          prevNote: ch.prevNote,
          append: false,
        });
        const sp = L.whichNote(ch.title);
        setSummary(sp);
        setSummaryEmoji("📝");
        speak(sp);
        return;
      }
      if (/(ajout|complèt|complet|complete|append|rajout|suite|aussi|also|more)/.test(s)) {
        setNoteCapture({
          taskId: ch.taskId,
          title: ch.title,
          prevNote: ch.prevNote,
          append: true,
        });
        const sp = L.whatToAddToNote(ch.title);
        setSummary(sp);
        setSummaryEmoji("📝");
        speak(sp);
        return;
      }
      if (/(efface|supprim|enlèv|enlev|retir|vide|détru|detru|erase|delete|remove|clear|wipe)/.test(s)) {
        setProcessing(true);
        try {
          await updateTaskById(ch.taskId, { note: null });
          setLastRevert({
            kind: "update",
            id: ch.taskId,
            fields: { note: ch.prevNote },
          });
          await refreshTasks();
          const sp = L.noteRemovedUndo(ch.title);
          setSummary(sp);
          setSummaryEmoji("🗑️");
          speak(sp);
        } finally {
          setProcessing(false);
        }
        return;
      }
      // Not a recognized choice -> abandon the edit, keep the note intact.
      const sp = L.noteUntouched;
      setSummary(sp);
      setSummaryEmoji("✖️");
      speak(sp);
      return;
    }

    // Note-capture follow-up: we asked for a note, so THIS utterance is the note
    // itself (stored verbatim, never sent to Gemma) — unless it's a cancel word.
    if (noteCapture) {
      const nc = noteCapture;
      setNoteCapture(null);
      setHeard(text);
      if (/^(annul|laisse|aucun|rien|tant pis|non merci|stop|cancel|never mind|nothing|forget|skip|none)/i.test(text.trim())) {
        setSummary(L.noteCancelled);
        setSummaryEmoji("✖️");
        speak(L.noteCancelled);
        return;
      }
      setProcessing(true);
      try {
        const noteVal = text.trim();
        // append mode concatenates to the previous note; otherwise it replaces.
        const finalNote =
          nc.append && nc.prevNote ? `${nc.prevNote} ${noteVal}` : noteVal;
        await updateTaskById(nc.taskId, { note: finalNote });
        setLastRevert({
          kind: "update",
          id: nc.taskId,
          fields: { note: nc.prevNote },
        });
        await refreshTasks();
        const sp = nc.append ? L.noteCompleted(nc.title) : L.noteSaved(nc.title);
        setSummary(sp);
        setSummaryEmoji("📝");
        speak(sp);
      } finally {
        setProcessing(false);
      }
      return;
    }

    // Disambiguation follow-up: a mutation is waiting for which task.
    if (pending && candidates) {
      const sel = pickCandidate(text, candidates);
      if (sel === "cancel") {
        setPending(null);
        setCandidates(null);
        setHeard(text);
        setSummary(L.cancelled);
        setSummaryEmoji("✖️");
        speak(L.cancelled);
        return;
      }
      // A note pending resolves specially: undefined note -> enter capture mode
      // for the chosen task; "" -> clear its note; non-empty -> save it.
      if (sel && pending.kind === "note") {
        const append = pending.append ?? false;
        setPending(null);
        setCandidates(null);
        setHeard(text);
        if (pending.note === undefined) {
          setNoteCapture({
            taskId: sel.id,
            title: sel.title,
            prevNote: sel.note,
            append,
          });
          const sp = append
            ? L.whatToAddToNote(sel.title)
            : L.whichNote(sel.title);
          setSummary(sp);
          setSummaryEmoji("📝");
          speak(sp);
          return;
        }
        setProcessing(true);
        try {
          const clearing = pending.note === "";
          const finalNote = clearing
            ? null
            : append && sel.note
              ? `${sel.note} ${pending.note}`
              : pending.note;
          await updateTaskById(sel.id, { note: finalNote });
          setLastRevert({
            kind: "update",
            id: sel.id,
            fields: { note: sel.note },
          });
          await refreshTasks();
          const sp = clearing
            ? L.noteRemoved(sel.title)
            : append
              ? L.noteCompleted(sel.title)
              : L.noteAdded(sel.title);
          setSummary(sp);
          setSummaryEmoji(clearing ? "🗑️" : "📝");
          speak(sp);
        } finally {
          setProcessing(false);
        }
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
    // confirm what was understood — but pause 2s first so the "ok" doesn't jump
    // in on top of the user. Cancelled in `finally` if inference finishes sooner.
    const okTimer = setTimeout(() => speak("ok"), 2000);
    try {
      const r = await parseIntent(text, lang);
      setIntentJson(r.json);
      setIntentPerf(
        `total ${r.ms}ms · prefill ${r.prefillMs ?? "?"}ms/${r.prefillTokens ?? "?"}tok · ` +
          `decode ${r.decodeMs ?? "?"}ms${r.tokensPerSec ? ` @${r.tokensPerSec}tok/s` : ""}`,
      );
      console.log(`[KAIROS] intent ${r.ms}ms ${r.tokensPerSec}tok/s :: ${r.json}`);
      // Numbers shown on screen are how the user references a task.
      const ids = numberedList.map((t) => t.id);
      const res = await dispatch(r.json, text, ids, lang);

      if (res.tool === "undo") {
        let sp = L.nothingToUndo;
        if (lastRevert) {
          await applyRevert(lastRevert);
          setLastRevert(null);
          await refreshTasks();
          sp = L.undone;
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
      } else if (res.calendar) {
        // System command: open the graphical (landscape) calendar — or, if it's
        // already open, switch to the named level while keeping the same anchor.
        setCalendar((c) => ({ range: res.calendar!, anchor: c?.anchor ?? new Date() }));
        setDisplay(null);
        setCandidates(null);
        setPending(null);
        setSummary(res.speech);
        setSummaryEmoji(res.emoji);
        speak(res.speech);
      } else if (res.calendarZoom) {
        // Relative zoom of the open calendar (voice). Resolve the resulting
        // level from the current one, keep the anchor, and speak that level.
        if (calendar) {
          const next =
            res.calendarZoom === "out"
              ? widerLevel(calendar.range)
              : narrowerLevel(calendar.range);
          setCalendar({ range: next, anchor: calendar.anchor });
          const sp = L.calendarLevel(L.calLabel[next]);
          setSummary(sp);
          setSummaryEmoji("🔍");
          speak(sp);
        } else {
          const sp = L.calendarNotOpen;
          setSummary(sp);
          setSummaryEmoji("🗓️");
          speak(sp);
        }
      } else if (res.noteCapture) {
        // The app now waits for the dictated note: the next utterance is stored
        // verbatim as this task's note (handled at the top of runIntent).
        setNoteCapture(res.noteCapture);
        setNoteChoice(null);
        setCandidates(null);
        setPending(null);
        setSummary(res.speech);
        setSummaryEmoji(res.emoji);
        speak(res.speech);
      } else if (res.noteChoice) {
        // Ambiguous "modify the note": wait for the user to pick edit/append/erase
        // (resolved at the top of runIntent).
        setNoteChoice(res.noteChoice);
        setNoteCapture(null);
        setCandidates(null);
        setPending(null);
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
      setSummary(L.notUnderstood);
      setSummaryEmoji("❓");
      addLog(`✗ intent: ${e?.message ?? e}`);
      console.log(`[KAIROS] intent error: ${e?.message ?? e}`);
    } finally {
      clearTimeout(okTimer);
      setProcessing(false);
    }
  };

  const startListening = async () => {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      addLog(`✗ ${L.micDenied}`);
      return;
    }
    ExpoSpeechRecognitionModule.start({
      lang: STT_LANG[lang],
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

  const folders = buildFolders(displayedTasks, L.miscFolder);

  // Mini agenda peek shown under the PTT button: the few soonest open tasks
  // (tasks is already sorted by due date). Grows as the user adds/updates tasks.
  const upcoming = tasks
    .filter((t) => t.status !== "done" && t.status !== "archived")
    .slice(0, 4);

  // Open tasks whose due date has already passed — surfaced at launch.
  const overdue = tasks.filter((t) => {
    if (t.status === "done" || t.status === "archived") return false;
    const ms = parseIso(t.due_iso);
    return !Number.isNaN(ms) && ms < Date.now();
  });

  // On launch (once the user taps "Commencer"), proactively flag overdue tasks:
  // speak a concise alert and open the "en retard" list so they're immediately
  // actionable. Runs once per launch; silent when nothing is overdue.
  useEffect(() => {
    if (!started || launchAlerted.current) return;
    launchAlerted.current = true;
    if (overdue.length === 0) return;
    const n = overdue.length;
    const msg = n === 1 ? L.overdueOne(overdue[0].title) : L.overdueMany(n);
    setDisplay({
      scope: "overdue",
      category: null,
      person: null,
      place: null,
      status: null,
      urgent: false,
    });
    setSummary(msg);
    setSummaryEmoji("⏰");
    speak(msg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, overdue]);

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
        speech: L.deletedUndo(t.title),
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
        speech: L.statusSet(t.title, L.statusLabel[p.status]),
        emoji: STATUS_EMOJI[p.status],
      };
    }
    // "note" pendings are resolved inline in runIntent (capture / save / clear),
    // never here — guard so TS narrows p to the "update" variant below.
    if (p.kind !== "update") return { speech: "", emoji: "📝" };
    const t0 = t as any;
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(p.changes)) before[k] = t0[k] ?? null;
    await updateTaskById(t.id, p.changes);
    setLastRevert({ kind: "update", id: t.id, fields: before });
    return {
      speech: L.updated((p.changes as any).title ?? t.title),
      emoji: "✏️",
    };
  };

  // Header reflecting every active display dimension, e.g.
  // "Overdue · urgent · with Paul". Titles/labels come from the active language.
  const displayTitle = (() => {
    if (display === null) return "";
    const bits: string[] = [L.scopeTitle[display.scope]];
    if (display.status) bits.push(L.statusTitle[display.status] ?? "");
    if (display.urgent) bits.push(L.qualUrgent);
    if (display.category) bits.push(L.qualFor(display.category));
    if (display.person) bits.push(L.qualWith(display.person));
    if (display.place) bits.push(L.qualAt(display.place));
    return bits.filter(Boolean).join(" · ");
  })();

  // Presentational due colour bucket (README dueKind): overdue → danger,
  // due within 24 h → soon (accent2), otherwise → accent.
  const dueColor = (t: Task): string => {
    const ms = parseIso(t.due_iso);
    if (Number.isNaN(ms)) return theme.muted;
    const now = Date.now();
    if (ms < now) return theme.danger;
    if (ms < now + 24 * 3600 * 1000) return theme.accent2;
    return theme.accent;
  };
  // What the due column shows: a status badge (pending/postponed) else the time.
  const dueText = (t: Task): string =>
    L.statusBadge[t.status]
      ? (L.statusBadge[t.status] as string)
      : t.due_iso
        ? fmtWhen(t.due_iso)
        : (t.due ?? "");
  const dueTextColor = (t: Task): string =>
    L.statusBadge[t.status] ? theme.accent2 : dueColor(t);

  // The orb's visual voice state, derived from the pipeline status.
  const orbVState: OrbVState =
    status === "listening" ? "listening" : processing ? "understanding" : "idle";
  const orbLabel =
    status === "listening"
      ? L.orbHoldListening
      : processing
        ? L.orbUnderstanding
        : L.orbHoldIdle;
  const orbSub = status === "listening" ? L.orbSubListening : L.orbSub;

  // The orb doubles as the push-to-talk button once ready: hold to listen. It is
  // disabled while an utterance is still being understood/displayed (processing)
  // so a new command can't start before the current one is fully resolved.
  const renderTalk = (size: number) => (
    <Pressable
      onPressIn={startListening}
      onPressOut={stopListening}
      disabled={processing}
      hitSlop={12}
      style={({ pressed }) => ({
        opacity: processing ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      <Orb theme={theme} vState={orbVState} size={size} />
    </Pressable>
  );

  // Nav from the home header.
  const openList = () =>
    setDisplay({
      scope: "all",
      category: null,
      person: null,
      place: null,
      status: null,
      urgent: false,
    });
  const openCalendar = () =>
    setCalendar({ range: "week", anchor: new Date() });

  // "Commencer" leaves the picker for the home orb; announce the push-to-talk
  // cue now that the orb is actually on screen.
  const handleStart = () => {
    setStarted(true);
    speak(L.holdButton);
  };

  const runTest = () => {
    const phrases = TEST_PHRASES[lang];
    const phrase = phrases[testIdx % phrases.length];
    setTestIdx((i) => i + 1);
    runIntent(phrase);
  };

  // Top summary panel: visual echo of the current intent (listening →
  // understanding → result). Shown whenever the voice loop is active.
  const panelActive = status === "listening" || processing || !!summary;
  const voicePanel = panelActive ? (
    <View style={styles.panel}>
      {heard ? (
        <Text style={styles.panelHeard} numberOfLines={1}>
          « {heard} »
        </Text>
      ) : null}
      <View style={styles.panelRow}>
        {!processing && status !== "listening" && summaryEmoji ? (
          <Text style={styles.panelEmoji}>{summaryEmoji}</Text>
        ) : null}
        <Text style={styles.panelText} numberOfLines={2}>
          {status === "listening" && !processing
            ? L.listeningShort
            : processing
              ? L.understanding
              : summary}
        </Text>
      </View>
      {!processing && status !== "listening" && summary && lastRevert ? (
        <Text style={styles.panelHint}>{L.undoHint}</Text>
      ) : null}
    </View>
  ) : null;

  // A single task row (list + candidates).
  const taskRow = (t: Task) => (
    <View key={t.id} style={styles.taskRow}>
      <Text style={styles.taskNum}>{numberOf.get(t.id)}</Text>
      <Text style={styles.taskEmoji}>{taskEmoji(t.category, t.title)}</Text>
      <View style={styles.taskMain}>
        <View style={styles.taskTitleRow}>
          <Text style={styles.taskTitle} numberOfLines={1}>
            {t.title}
          </Text>
          {(t.priority ?? 0) >= 2 ? <View style={styles.urgentDot} /> : null}
        </View>
        {t.note ? (
          <Text style={styles.taskNote} numberOfLines={3}>
            📝 {t.note}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.taskDue, { color: dueTextColor(t) }]}>{dueText(t)}</Text>
    </View>
  );

  // ── Screen content (wrapped once in the theme provider below) ──
  let content: ReactNode;
  if (!fontsLoaded) {
    // Brief blank (themed) frame while the bundled fonts load.
    content = <View style={{ flex: 1, backgroundColor: theme.bg }} />;
  } else if (!started) {
    // Theme picker + model loading (design 5.1).
    content = (
      <Picker
        lang={lang}
        setLang={changeLang}
        L={L}
        loadPct={loadPct}
        ready={modelStatus === "ready"}
        error={modelStatus === "error"}
        onStart={handleStart}
        onRetry={loadGemma}
      />
    );
  } else if (settingsOpen) {
    content = (
      <Settings
        lang={lang}
        setLang={changeLang}
        ttsOn={ttsOn}
        setTtsOn={setTtsOn}
        onClose={() => setSettingsOpen(false)}
        L={L}
      />
    );
  } else if (calendar) {
    // Graphical calendar overlay (landscape) — focused full-screen view.
    content = (
      <CalendarView
        range={calendar.range}
        anchor={calendar.anchor}
        tasks={tasks}
        lang={lang}
        theme={theme}
        onNavigate={(range, anchor) => setCalendar({ range, anchor })}
        renderTalk={renderTalk}
        onClose={() => setCalendar(null)}
      />
    );
  } else if (candidates) {
    // Ambiguous reference: numbered candidates, pick one by number/voice.
    content = (
      <View style={styles.screen}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>{L.whichOne}</Text>
          <Pressable
            onPress={() => {
              setCandidates(null);
              setPending(null);
            }}
            hitSlop={10}
          >
            <Text style={styles.closeBtn}>{L.cancelBtn}</Text>
          </Pressable>
        </View>
        {voicePanel}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.taskCard}>{candidates.map(taskRow)}</View>
        </ScrollView>
        <View style={styles.dockTalk}>{renderTalk(56)}</View>
      </View>
    );
  } else if (display === null) {
    // Home: header + voice orb + upcoming agenda.
    content = (
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <LogoMark theme={theme} size={26} />
            <Text style={styles.brandName}>Kairos</Text>
          </View>
          <View style={styles.headerCluster}>
            <LangToggle lang={lang} onChange={changeLang} />
            <Pressable style={styles.navBtn} onPress={openList} hitSlop={6}>
              <Text style={styles.navIcon}>☰</Text>
            </Pressable>
            <Pressable style={styles.navBtn} onPress={openCalendar} hitSlop={6}>
              <Text style={styles.navIcon}>▦</Text>
            </Pressable>
            <Pressable
              style={styles.navBtn}
              onPress={() => setSettingsOpen(true)}
              hitSlop={6}
            >
              <Text style={styles.navIcon}>⚙</Text>
            </Pressable>
          </View>
        </View>

        {voicePanel}

        <View style={styles.homeCenter}>
          {renderTalk(ORB_SIZE)}
          <Text style={styles.orbLabel}>{orbLabel}</Text>
          <Text style={styles.orbSub}>{orbSub}</Text>
        </View>

        {upcoming.length > 0 && (
          <View style={styles.upcomingWrap}>
            <Text style={styles.upcomingHeader}>{L.upcoming}</Text>
            {upcoming.map((t) => (
              <View key={t.id} style={styles.miniRow}>
                <Text style={styles.miniNum}>{numberOf.get(t.id)}</Text>
                <Text style={styles.miniEmoji}>
                  {taskEmoji(t.category, t.title)}
                </Text>
                <Text style={styles.miniTitle} numberOfLines={1}>
                  {t.title}
                </Text>
                {t.note ? <Text style={styles.miniNoteMark}>📝</Text> : null}
                <Text style={[styles.miniDue, { color: dueTextColor(t) }]}>
                  {dueText(t)}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable style={styles.testChip} onPress={runTest} hitSlop={8}>
          <Text style={styles.testChipText}>{L.testChip}</Text>
        </Pressable>
      </View>
    );
  } else {
    // A system command showed tasks: grouped folders, talk available below.
    content = (
      <View style={styles.screen}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {displayTitle}
          </Text>
          <Pressable onPress={() => setDisplay(null)} hitSlop={10}>
            <Text style={styles.closeBtn}>{L.closeBtn}</Text>
          </Pressable>
        </View>
        {voicePanel}
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {displayedTasks.length === 0 ? (
            <View style={styles.taskCard}>
              <Text style={styles.taskEmpty}>
                {display.scope === "overdue"
                  ? L.nothingOverdue
                  : L.noTasksCriteria}
              </Text>
            </View>
          ) : (
            folders.map((f) => (
              <View key={f.label} style={styles.folder}>
                <Pressable
                  style={styles.folderHeader}
                  onPress={() => toggleFolder(f.label)}
                  hitSlop={6}
                >
                  <Text style={styles.folderLabel}>{f.label}</Text>
                  <View style={styles.folderRule} />
                  <Text style={styles.folderCount}>{f.count}</Text>
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
                      <View style={styles.taskCard}>{s.items.map(taskRow)}</View>
                    </View>
                  ))}
              </View>
            ))
          )}
        </ScrollView>
        <View style={styles.dockTalk}>{renderTalk(56)}</View>
      </View>
    );
  }

  return (
    <ThemeContext.Provider value={themeCtx}>
      <StatusBar style={theme.dark ? "light" : "dark"} />
      {content}
    </ThemeContext.Provider>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },

    // ── Home header ──
    header: {
      paddingTop: 50,
      paddingHorizontal: 16,
      paddingBottom: 4,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 9 },
    brandName: { fontFamily: t.display.semibold, fontSize: 17, color: t.ink },
    headerCluster: { flexDirection: "row", alignItems: "center", gap: 9 },
    navBtn: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      alignItems: "center",
      justifyContent: "center",
    },
    navIcon: { fontSize: 14, color: t.muted },

    // ── List / candidates header ──
    pageHeader: {
      paddingTop: 50,
      paddingHorizontal: 20,
      paddingBottom: 4,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pageTitle: { flex: 1, fontFamily: t.display.semibold, fontSize: 20, color: t.ink },
    closeBtn: { fontFamily: t.body.semibold, fontSize: 13, color: t.muted, marginLeft: 12 },

    // ── Voice panel ──
    panel: {
      marginTop: 13,
      marginHorizontal: 16,
      paddingVertical: 13,
      paddingHorizontal: 14,
      borderRadius: 16,
      backgroundColor: t.panelBg,
      borderWidth: 1,
      borderColor: t.panelBorder,
    },
    panelHeard: {
      fontFamily: t.body.regular,
      fontSize: 12,
      color: t.muted,
      fontStyle: "italic",
      marginBottom: 4,
    },
    panelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    panelEmoji: { fontSize: 19 },
    panelText: { flex: 1, fontFamily: t.body.semibold, fontSize: 14, color: t.ink },
    panelHint: { fontFamily: t.body.regular, fontSize: 11, color: t.muted, marginTop: 6 },

    // ── Home center (orb) ──
    homeCenter: { flex: 1, alignItems: "center", justifyContent: "center" },
    orbLabel: { fontFamily: t.display.semibold, fontSize: 17, color: t.ink, marginTop: 18 },
    orbSub: { fontFamily: t.body.regular, fontSize: 12.5, color: t.muted, marginTop: 4 },

    // ── Upcoming agenda ──
    upcomingWrap: { paddingHorizontal: 22, paddingBottom: 40 },
    upcomingHeader: {
      fontFamily: t.body.bold,
      fontSize: 11,
      letterSpacing: 1.3,
      textTransform: "uppercase",
      color: t.muted,
      marginBottom: 4,
    },
    miniRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 9,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    miniNum: {
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.muted,
      minWidth: 14,
      fontVariant: ["tabular-nums"],
    },
    miniEmoji: { fontSize: 16 },
    miniTitle: { flex: 1, fontFamily: t.body.regular, fontSize: 14.5, color: t.ink },
    miniNoteMark: { fontSize: 11, marginRight: 2 },
    miniDue: { fontFamily: t.body.semibold, fontSize: 12.5 },

    // ── Test chip (dev) ──
    testChip: {
      position: "absolute",
      left: 16,
      bottom: 0, // tout en bas: peut passer sous la bande système du S96; reste accessible même si peu visible
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surface,
    },
    testChipText: { fontFamily: t.body.semibold, fontSize: 11, color: t.muted },

    // ── Task list ──
    scroll: { flex: 1 },
    container: { paddingTop: 6, paddingHorizontal: 20, paddingBottom: 20 },
    folder: { marginTop: 16 },
    folderHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    folderLabel: {
      fontFamily: t.display.semibold,
      fontSize: 11,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: t.accent,
    },
    folderRule: { flex: 1, height: 1, backgroundColor: t.line },
    folderCount: { fontFamily: t.body.regular, fontSize: 11, color: t.muted },
    folderChevron: { fontSize: 12, color: t.muted },
    subfolderTitle: {
      fontFamily: t.body.semibold,
      fontSize: 12,
      color: t.muted,
      marginLeft: 4,
      marginTop: 8,
      marginBottom: 2,
    },
    taskCard: {
      marginTop: 8,
      backgroundColor: t.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.line,
      overflow: "hidden",
    },
    taskEmpty: { padding: 16, fontFamily: t.body.regular, color: t.muted, fontStyle: "italic" },
    taskRow: {
      paddingVertical: 11,
      paddingHorizontal: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 9,
    },
    taskNum: {
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.muted,
      minWidth: 14,
      fontVariant: ["tabular-nums"],
      marginTop: 2,
    },
    taskEmoji: { fontSize: 15, marginTop: 1 },
    taskMain: { flex: 1 },
    taskTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    taskTitle: { flexShrink: 1, fontFamily: t.body.medium, fontSize: 14.5, color: t.ink },
    urgentDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: t.danger },
    taskNote: {
      fontFamily: t.body.regular,
      fontSize: 12,
      color: t.muted,
      fontStyle: "italic",
      marginTop: 3,
      lineHeight: 17,
    },
    taskDue: { fontFamily: t.body.semibold, fontSize: 12.5, marginTop: 1 },

    dockTalk: { alignItems: "center", paddingVertical: 8, paddingBottom: 47 },
  });
}
