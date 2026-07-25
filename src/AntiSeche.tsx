// AntiSeche.tsx — the crib-sheet feature, reached from the (hidden) Réglages
// entry. Two halves:
//
//   • PREPARATION — before a meeting you attach an ordered list of talking points
//     ("points") to an appointment that already lives in Kairos.
//   • SESSION — during the meeting, one tap reads the next point into your ear.
//
// It never records anything and never touches the network: the content is what
// YOU wrote beforehand, and Gemma is not involved. That is deliberate. Capturing
// the other party's words without their consent is an offence under art. 226-1 of
// the French code pénal, and an on-device answer would arrive tens of seconds late
// anyway — long after the moment has passed. A prepared sheet is instant.
//
// Every utterance is gated on a PRIVATE audio route. If the earpiece is not
// connected the point is shown on screen but never spoken, so the sheet can't be
// announced out loud to the person across the table.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Speech from "expo-speech";
import { useTheme } from "./ThemeContext";
import type { Theme } from "./theme";
import { TTS_LANG, type Lang, type Strings } from "./i18n";
import {
  addCue,
  deleteCue,
  listBriefings,
  listCues,
  listTasks,
  moveCue,
  setCueText,
  type Briefing,
  type Cue,
  type Task,
} from "./db";
import {
  currentOutput,
  isPrivateOutput,
  type AudioOutput,
} from "../modules/kairos-audio-route";

type View_ =
  | { kind: "list" }
  | { kind: "pick" } // choose which task gets a sheet
  | { kind: "edit"; task: Task }
  | { kind: "session"; task: Task };

// A dictated note is one blob; a sheet is a list. Split on line breaks first
// (how notes are usually dictated), falling back to sentence ends so a single
// long paragraph still yields usable points.
function splitNote(note: string): string[] {
  const byLine = note
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[-•*\d.)]+\s*/, "").trim())
    .filter(Boolean);
  if (byLine.length > 1) return byLine;
  // Deliberately no lookbehind (`(?<=[.!?])`): Hermes has historically rejected
  // lookbehind at regex-literal parse time, which would crash on import rather
  // than fail gracefully. Matching runs of non-terminators plus their trailing
  // punctuation splits sentences the same way, everywhere.
  return (note.match(/[^.!?]+[.!?]*/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AntiSeche({
  L,
  lang,
  onClose,
}: {
  L: Strings;
  lang: Lang;
  onClose: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme, insets.top, insets.bottom);

  const [view, setView] = useState<View_>({ kind: "list" });
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [candidates, setCandidates] = useState<Task[]>([]);
  const [cues, setCues] = useState<Cue[]>([]);
  const [draft, setDraft] = useState("");
  const [idx, setIdx] = useState(0);
  const [output, setOutput] = useState<AudioOutput>("unknown");
  // Set only when the native route module is missing (older APK): the user
  // vouches for their earpiece once, because we genuinely cannot check.
  const [routeVouched, setRouteVouched] = useState(false);

  const refreshBriefings = useCallback(async () => {
    setBriefings(await listBriefings());
  }, []);

  const refreshCues = useCallback(async (taskId: number) => {
    setCues(await listCues(taskId));
  }, []);

  useEffect(() => {
    refreshBriefings();
  }, [refreshBriefings]);

  // Poll the audio route: a headset can be connected or drop at any moment, and
  // a stale "bluetooth" reading is exactly the failure that speaks out loud.
  useEffect(() => {
    const tick = () => setOutput(currentOutput());
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);

  // Stop any in-flight utterance when the screen goes away. Speech.pause() does
  // not exist on Android, so stop() is the only way to cut a reading short.
  useEffect(() => () => { Speech.stop(); }, []);

  const allows = (out: AudioOutput) =>
    isPrivateOutput(out) || (out === "unknown" && routeVouched);

  const routeOk = allows(output); // drives the badge only

  const say = (text: string) => {
    // Re-read the route AT the moment of speaking rather than trusting `output`:
    // the badge can be a poll interval stale, and an earpiece that dropped in
    // that window is precisely the case that must not reach the loudspeaker.
    const now = currentOutput();
    if (now !== output) setOutput(now);
    if (!allows(now)) return; // silence beats broadcasting the sheet to the room
    Speech.stop();
    Speech.speak(text, { language: TTS_LANG[lang], rate: 1.0 });
  };

  const openEditor = async (task: Task) => {
    await refreshCues(task.id);
    setDraft("");
    setView({ kind: "edit", task });
  };

  const openSession = async (task: Task) => {
    const rows = await listCues(task.id);
    setCues(rows);
    setIdx(0);
    setView({ kind: "session", task });
  };

  const addPoint = async (task: Task) => {
    const text = draft.trim();
    if (!text) return;
    await addCue(task.id, text);
    setDraft("");
    await refreshCues(task.id);
  };

  const importNote = async (task: Task) => {
    if (!task.note) return;
    for (const line of splitNote(task.note)) await addCue(task.id, line);
    await refreshCues(task.id);
  };

  const back = async () => {
    Speech.stop();
    await refreshBriefings();
    setView({ kind: "list" });
  };

  // ── Session ──────────────────────────────────────────────────────────
  if (view.kind === "session") {
    const cue = cues[idx] ?? null;
    const goto = (n: number) => {
      const clamped = Math.max(0, Math.min(cues.length - 1, n));
      setIdx(clamped);
      const next = cues[clamped];
      if (next) say(next.text);
    };
    return (
      <View style={s.screen}>
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>
            {view.task.title}
          </Text>
          <Pressable onPress={back} hitSlop={12}>
            <Text style={s.close}>{L.antisecheEnd}</Text>
          </Pressable>
        </View>

        <View style={[s.routeBadge, routeOk ? s.routeOk : s.routeBad]}>
          <Text style={routeOk ? s.routeOkText : s.routeBadText}>
            {output === "bluetooth"
              ? L.antisecheRouteBluetooth
              : output === "wired"
                ? L.antisecheRouteWired
                : output === "unknown"
                  ? routeVouched
                    ? L.antisecheRouteAssumed
                    : L.antisecheRouteUnknown
                  : L.antisecheRouteSpeaker}
          </Text>
        </View>
        {!routeOk && output === "unknown" && (
          <Pressable style={s.vouchBtn} onPress={() => setRouteVouched(true)}>
            <Text style={s.vouchText}>{L.antisecheVouch}</Text>
          </Pressable>
        )}

        {/* The point is always shown, and only spoken when the route is private:
            reading silently is safe, speaking to the room is not. */}
        <Pressable style={s.stage} onPress={() => goto(idx + 1)}>
          <Text style={s.counter}>
            {cues.length ? `${idx + 1} / ${cues.length}` : ""}
          </Text>
          <Text style={s.cueBig}>{cue ? cue.text : L.antisecheEmpty}</Text>
          <Text style={s.hint}>{L.antisecheTapNext}</Text>
        </Pressable>

        <View style={[s.sessionBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable style={s.navBtn} onPress={() => goto(idx - 1)}>
            <Text style={s.navText}>{L.antisechePrev}</Text>
          </Pressable>
          <Pressable style={s.navBtn} onPress={() => cue && say(cue.text)}>
            <Text style={s.navText}>{L.antisecheRepeat}</Text>
          </Pressable>
          <Pressable style={s.navBtn} onPress={() => goto(idx + 1)}>
            <Text style={s.navText}>{L.antisecheNext}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Editor ───────────────────────────────────────────────────────────
  if (view.kind === "edit") {
    const task = view.task;
    return (
      <View style={s.screen}>
        <View style={s.header}>
          <Text style={s.title} numberOfLines={1}>
            {task.title}
          </Text>
          <Pressable onPress={back} hitSlop={12}>
            <Text style={s.close}>{L.antisecheBack}</Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={s.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={s.section}>{L.antisechePoints}</Text>
          {cues.length === 0 && <Text style={s.cardSub}>{L.antisecheNoPoint}</Text>}
          {cues.map((c, i) => (
            <View key={c.id} style={s.cueRow}>
              <Text style={s.cueNum}>{i + 1}</Text>
              <TextInput
                style={s.cueInput}
                defaultValue={c.text}
                multiline
                placeholderTextColor={theme.muted}
                onEndEditing={async (e) => {
                  const v = e.nativeEvent.text.trim();
                  if (v && v !== c.text) {
                    await setCueText(c.id, v);
                    await refreshCues(task.id);
                  }
                }}
              />
              <View style={s.cueBtns}>
                <Pressable
                  hitSlop={8}
                  onPress={async () => {
                    await moveCue(c.id, "up");
                    await refreshCues(task.id);
                  }}
                >
                  <Text style={s.cueBtn}>↑</Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={async () => {
                    await moveCue(c.id, "down");
                    await refreshCues(task.id);
                  }}
                >
                  <Text style={s.cueBtn}>↓</Text>
                </Pressable>
                <Pressable
                  hitSlop={8}
                  onPress={async () => {
                    await deleteCue(c.id);
                    await refreshCues(task.id);
                  }}
                >
                  <Text style={s.cueDel}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))}

          <View style={s.addRow}>
            <TextInput
              style={s.addInput}
              value={draft}
              onChangeText={setDraft}
              placeholder={L.antisecheAddPlaceholder}
              placeholderTextColor={theme.muted}
              multiline
            />
            <Pressable style={s.addBtn} onPress={() => addPoint(task)}>
              <Text style={s.addBtnText}>{L.antisecheAdd}</Text>
            </Pressable>
          </View>

          {task.note ? (
            <Pressable style={s.secBtn} onPress={() => importNote(task)}>
              <Text style={s.secBtnText}>{L.antisecheImportNote}</Text>
            </Pressable>
          ) : null}

          <Pressable
            style={[s.primaryBtn, cues.length === 0 && s.btnDisabled]}
            disabled={cues.length === 0}
            onPress={() => openSession(task)}
          >
            <Text style={s.primaryBtnText}>{L.antisecheStart}</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // ── Task picker (attach a new sheet) ─────────────────────────────────
  if (view.kind === "pick") {
    return (
      <View style={s.screen}>
        <View style={s.header}>
          <Text style={s.title}>{L.antisechePickTask}</Text>
          <Pressable onPress={() => setView({ kind: "list" })} hitSlop={12}>
            <Text style={s.close}>{L.antisecheBack}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          {candidates.length === 0 && <Text style={s.cardSub}>{L.antisecheNoTask}</Text>}
          {candidates.map((t) => (
            <Pressable key={t.id} style={s.card} onPress={() => openEditor(t)}>
              <View style={s.cardTextCol}>
                <Text style={s.cardLabel} numberOfLines={1}>
                  {t.title}
                </Text>
                {t.due ? <Text style={s.cardSub}>{t.due}</Text> : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Briefing list (home) ─────────────────────────────────────────────
  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>{L.antisecheTitle}</Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={s.close}>{L.antisecheClose}</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>{L.antisecheIntro}</Text>

        <Text style={s.section}>{L.antisecheSheets}</Text>
        {briefings.length === 0 && <Text style={s.cardSub}>{L.antisecheNoSheet}</Text>}
        {briefings.map((b) => (
          <View key={b.id} style={s.card}>
            <Pressable style={s.cardTextCol} onPress={() => openEditor(b)}>
              <Text style={s.cardLabel} numberOfLines={1}>
                {b.title}
              </Text>
              <Text style={s.cardSub}>
                {b.due ? `${b.due} · ` : ""}
                {L.antisechePointCount(b.cue_count)}
              </Text>
            </Pressable>
            <Pressable style={s.playBtn} onPress={() => openSession(b)}>
              <Text style={s.playText}>{L.antisecheStartShort}</Text>
            </Pressable>
          </View>
        ))}

        <Pressable
          style={s.primaryBtn}
          onPress={async () => {
            setCandidates(await listTasks("open"));
            setView({ kind: "pick" });
          }}
        >
          <Text style={s.primaryBtnText}>{L.antisecheNewSheet}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: Theme, insetTop: number, insetBottom: number) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, paddingTop: Math.max(insetTop, 12) },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    title: { fontFamily: t.display.semibold, fontSize: 20, color: t.ink, flexShrink: 1 },
    close: { fontFamily: t.body.semibold, fontSize: 13, color: t.muted },
    body: {
      paddingHorizontal: 20,
      paddingBottom: Math.max(insetBottom, 12) + 48,
    },
    intro: { fontFamily: t.body.regular, fontSize: 13, lineHeight: 19, color: t.muted },
    section: {
      fontFamily: t.body.bold,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.muted,
      marginTop: 22,
      marginBottom: 10,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.line,
      paddingHorizontal: 14,
      paddingVertical: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 8,
    },
    cardTextCol: { flex: 1, gap: 2 },
    cardLabel: { fontFamily: t.body.semibold, fontSize: 15, color: t.ink },
    cardSub: { fontFamily: t.body.regular, fontSize: 12, color: t.muted },

    // Editor
    cueRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.line,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
    },
    cueNum: {
      fontFamily: t.mono.medium,
      fontSize: 12,
      color: t.muted,
      marginTop: 4,
      minWidth: 16,
    },
    cueInput: {
      flex: 1,
      fontFamily: t.body.regular,
      fontSize: 15,
      color: t.ink,
      padding: 0,
    },
    cueBtns: { flexDirection: "row", gap: 10, marginTop: 2 },
    cueBtn: { fontFamily: t.body.semibold, fontSize: 16, color: t.muted },
    cueDel: { fontFamily: t.body.semibold, fontSize: 16, color: t.danger },
    addRow: { flexDirection: "row", alignItems: "flex-end", gap: 10, marginTop: 12 },
    addInput: {
      flex: 1,
      fontFamily: t.body.regular,
      fontSize: 15,
      color: t.ink,
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.line,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    addBtn: {
      backgroundColor: t.accent,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    addBtnText: { fontFamily: t.body.semibold, fontSize: 14, color: "#ffffff" },
    secBtn: {
      marginTop: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.line,
      paddingVertical: 12,
      alignItems: "center",
    },
    secBtnText: { fontFamily: t.body.semibold, fontSize: 14, color: t.ink },
    primaryBtn: {
      marginTop: 18,
      backgroundColor: t.accent,
      borderRadius: 14,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryBtnText: { fontFamily: t.body.semibold, fontSize: 15, color: "#ffffff" },
    btnDisabled: { opacity: 0.4 },
    playBtn: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.accent,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    playText: { fontFamily: t.body.semibold, fontSize: 13, color: t.accent },

    // Session
    routeBadge: {
      marginHorizontal: 20,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      alignItems: "center",
    },
    routeOk: { backgroundColor: t.chipBg },
    routeBad: { backgroundColor: t.danger },
    routeOkText: { fontFamily: t.body.medium, fontSize: 12, color: t.muted },
    routeBadText: { fontFamily: t.body.semibold, fontSize: 12, color: "#ffffff" },
    vouchBtn: {
      marginHorizontal: 20,
      marginTop: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: t.line,
      paddingVertical: 10,
      alignItems: "center",
    },
    vouchText: { fontFamily: t.body.semibold, fontSize: 13, color: t.ink },
    stage: {
      flex: 1,
      marginHorizontal: 20,
      marginTop: 16,
      justifyContent: "center",
      alignItems: "center",
      gap: 14,
    },
    counter: { fontFamily: t.mono.medium, fontSize: 13, color: t.muted },
    cueBig: {
      fontFamily: t.display.semibold,
      fontSize: 26,
      lineHeight: 34,
      color: t.ink,
      textAlign: "center",
    },
    hint: { fontFamily: t.body.regular, fontSize: 12, color: t.muted },
    sessionBar: {
      flexDirection: "row",
      gap: 10,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    navBtn: {
      flex: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.line,
      paddingVertical: 14,
      alignItems: "center",
    },
    navText: { fontFamily: t.body.semibold, fontSize: 14, color: t.ink },
  });
}
