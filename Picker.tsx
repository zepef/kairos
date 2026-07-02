// Picker.tsx — the theme-selection / model-loading screen (design 5.1). It
// replaces the old spinner splash: while the on-device model loads, the user
// picks a style and the whole screen re-skins live on each tap. When the model
// is ready the progress bar becomes a "Commencer" button.
//
// The voice/model logic stays in App; this screen only reflects loadPct + a
// ready/error flag and reports theme/lang/start via callbacks.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "./ThemeContext";
import { THEMES, THEME_ORDER, type Theme } from "./theme";
import { LangToggle } from "./flags";
import { Orb, LogoMark } from "./Orb";
import type { Lang, Strings } from "./i18n";

export default function Picker({
  lang,
  setLang,
  L,
  loadPct,
  ready,
  onStart,
  error,
  onRetry,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  L: Strings;
  loadPct: number;
  ready: boolean;
  onStart: () => void;
  error?: boolean;
  onRetry?: () => void;
}) {
  const { theme, name, setTheme } = useTheme();
  const s = makeStyles(theme);
  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.brand}>
          <LogoMark theme={theme} size={26} />
          <Text style={s.brandName}>Kairos</Text>
        </View>
        <LangToggle lang={lang} onChange={setLang} />
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>{L.pickerTitle}</Text>
        <Text style={s.subtitle}>{L.pickerSubtitle}</Text>

        <View style={s.cards}>
          {THEME_ORDER.map((tn) => {
            const selected = tn === name;
            return (
              <Pressable
                key={tn}
                style={[s.card, selected && s.cardSel]}
                onPress={() => setTheme(tn)}
              >
                <Orb theme={THEMES[tn]} vState="idle" size={46} animated={selected} />
                <View style={s.cardText}>
                  <Text style={s.cardName}>{L.themeName[tn]}</Text>
                  <Text style={s.cardTag}>{L.themeTag[tn]}</Text>
                </View>
                {selected && (
                  <View style={s.check}>
                    <Text style={s.checkMark}>✓</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.footer}>
        {error ? (
          <Pressable style={s.startBtn} onPress={onRetry}>
            <Text style={s.startText}>{L.loadFailed}</Text>
          </Pressable>
        ) : ready ? (
          <Pressable style={s.startBtn} onPress={onStart}>
            <Text style={s.startText}>{L.pickerStart}</Text>
          </Pressable>
        ) : (
          <>
            <View style={s.progRow}>
              <Text style={s.progLabel}>{L.pickerLoading}</Text>
              <Text style={s.progPct}>{loadPct}%</Text>
            </View>
            <View style={s.track}>
              <LinearGradient
                colors={[theme.accent, theme.accent2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[s.fill, { width: `${Math.max(4, loadPct)}%` }]}
              />
            </View>
            <Text style={s.caption}>{L.pickerOnceOffline}</Text>
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, paddingTop: 50 },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 9 },
    brandName: { fontFamily: t.display.semibold, fontSize: 17, color: t.ink },
    body: { paddingHorizontal: 20, paddingTop: 8 },
    title: {
      fontFamily: t.display.semibold,
      fontSize: 21,
      letterSpacing: -0.2,
      color: t.ink,
    },
    subtitle: { fontFamily: t.body.regular, fontSize: 12.5, color: t.muted, marginTop: 3 },
    cards: { marginTop: 18, gap: 11 },
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      padding: 13,
      borderRadius: 16,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
    },
    cardSel: { borderColor: t.accent, borderWidth: 2 },
    cardText: { flex: 1 },
    cardName: { fontFamily: t.display.semibold, fontSize: 15, color: t.ink },
    cardTag: { fontFamily: t.body.regular, fontSize: 12, color: t.muted, marginTop: 2 },
    check: {
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.accent,
      alignItems: "center",
      justifyContent: "center",
    },
    checkMark: { color: t.bg, fontSize: 13, fontFamily: t.body.bold },
    footer: { paddingHorizontal: 20, paddingBottom: 45, paddingTop: 8 },
    progRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    progLabel: { fontFamily: t.body.regular, fontSize: 12, color: t.muted },
    progPct: {
      fontFamily: t.body.bold,
      fontSize: 12,
      color: t.accent,
      fontVariant: ["tabular-nums"],
    },
    track: { height: 6, borderRadius: 3, backgroundColor: t.line, overflow: "hidden" },
    fill: { height: 6, borderRadius: 3 },
    caption: { fontFamily: t.body.regular, fontSize: 11, color: t.muted, marginTop: 10, textAlign: "center" },
    startBtn: {
      padding: 14,
      borderRadius: 14,
      backgroundColor: t.accent,
      alignItems: "center",
    },
    startText: { fontFamily: t.display.semibold, fontSize: 15, color: t.bg },
  });
}
