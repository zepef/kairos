// Settings.tsx — the Réglages screen (design 5.4), reached from the home ⚙
// button. Themed by the active theme; the Appearance tiles preview and switch
// the three themes live. TTS + language (previously in the bottom bar) live here.
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useTheme } from "./ThemeContext";
import { THEMES, THEME_ORDER, type Theme } from "./theme";
import { LangToggle } from "./flags";
import { Orb } from "./Orb";
import type { Lang, Strings } from "./i18n";
import type { CalInfo } from "./gcal";

export default function Settings({
  lang,
  setLang,
  ttsOn,
  setTtsOn,
  onClose,
  L,
  gcalEnabled,
  setGcalEnabled,
  gcalCalendars,
  gcalCalendarId,
  onSelectCalendar,
  gcalBusy,
  onSyncNow,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  ttsOn: boolean;
  setTtsOn: (b: boolean) => void;
  onClose: () => void;
  L: Strings;
  gcalEnabled: boolean;
  setGcalEnabled: (b: boolean) => void;
  gcalCalendars: CalInfo[];
  gcalCalendarId: string | null;
  onSelectCalendar: (id: string) => void;
  gcalBusy: boolean;
  onSyncNow: () => Promise<string>;
}) {
  const { theme, name, setTheme } = useTheme();
  const s = makeStyles(theme);
  const [syncMsg, setSyncMsg] = useState("");
  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>{L.settingsTitle}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={s.close}>{L.closeBtn}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {/* Apparence */}
        <Text style={s.section}>{L.settingsAppearance}</Text>
        <View style={s.tileRow}>
          {THEME_ORDER.map((tn) => {
            const selected = tn === name;
            return (
              <Pressable
                key={tn}
                style={[s.tile, selected && s.tileSel]}
                onPress={() => setTheme(tn)}
              >
                <Orb theme={THEMES[tn]} vState="idle" size={40} animated={false} />
                <Text style={s.tileName}>{L.themeName[tn]}</Text>
              </Pressable>
            );
          })}
        </View>

        {/* Langue */}
        <Text style={s.section}>{L.settingsLanguage}</Text>
        <View style={s.card}>
          <Text style={s.cardLabel}>{L.settingsInterfaceVoice}</Text>
          <LangToggle lang={lang} onChange={setLang} />
        </View>

        {/* Voix */}
        <Text style={s.section}>{L.settingsVoice}</Text>
        <View style={s.card}>
          <View style={s.cardTextCol}>
            <Text style={s.cardLabel}>{L.settingsSpokenReplies}</Text>
            <Text style={s.cardSub}>{L.settingsSpokenRepliesSub}</Text>
          </View>
          <Switch
            value={ttsOn}
            onValueChange={setTtsOn}
            trackColor={{ true: theme.accent, false: theme.line }}
            thumbColor="#ffffff"
          />
        </View>

        {/* Synchronisation (Google Agenda) */}
        <Text style={s.section}>{L.settingsSync}</Text>
        <View style={s.card}>
          <View style={s.cardTextCol}>
            <Text style={s.cardLabel}>{L.settingsSyncGoogle}</Text>
            <Text style={s.cardSub}>{L.settingsSyncSub}</Text>
          </View>
          <Switch
            value={gcalEnabled}
            onValueChange={setGcalEnabled}
            trackColor={{ true: theme.accent, false: theme.line }}
            thumbColor="#ffffff"
          />
        </View>
        {gcalEnabled && (
          <View style={s.cardCol}>
            {gcalCalendars.length === 0 ? (
              <Text style={s.cardSub}>{L.settingsSyncNoCalendar}</Text>
            ) : (
              gcalCalendars.map((c) => {
                const sel = c.id === gcalCalendarId;
                return (
                  <Pressable
                    key={c.id}
                    style={[s.calRow, sel && s.calRowSel]}
                    onPress={() => onSelectCalendar(c.id)}
                  >
                    <View style={s.cardTextCol}>
                      <Text style={s.cardLabel} numberOfLines={1}>
                        {c.title}
                      </Text>
                      {c.sourceName ? (
                        <Text style={s.cardSub} numberOfLines={1}>
                          {c.sourceName}
                        </Text>
                      ) : null}
                    </View>
                    {sel ? <Text style={s.calCheck}>✓</Text> : null}
                  </Pressable>
                );
              })
            )}
            <Pressable
              style={[
                s.syncBtn,
                (!gcalCalendarId || gcalBusy) && s.syncBtnDisabled,
              ]}
              disabled={!gcalCalendarId || gcalBusy}
              onPress={async () => setSyncMsg(await onSyncNow())}
            >
              <Text style={s.syncBtnText}>{L.settingsSyncNow}</Text>
            </Pressable>
            {syncMsg ? <Text style={s.syncMsg}>{syncMsg}</Text> : null}
          </View>
        )}

        {/* Modèle et confidentialité */}
        <Text style={s.section}>{L.settingsModelPrivacy}</Text>
        <View style={s.cardCol}>
          <View style={s.modelRow}>
            <Text style={s.modelName}>{L.settingsModelName}</Text>
            <Text style={s.ready}>{L.settingsReady}</Text>
          </View>
          <Text style={s.modelMeta}>{L.settingsModelMeta}</Text>
          <Text style={s.privacy}>
            {gcalEnabled ? L.settingsPrivacyLineSync : L.settingsPrivacyLine}
          </Text>
        </View>

        <Text style={s.footer}>{L.versionLabel}</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, paddingTop: 54 },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: { fontFamily: t.display.semibold, fontSize: 20, color: t.ink },
    close: { fontFamily: t.body.semibold, fontSize: 13, color: t.muted },
    body: { paddingHorizontal: 20, paddingBottom: 64 },
    section: {
      fontFamily: t.body.bold,
      fontSize: 11,
      letterSpacing: 1.2,
      textTransform: "uppercase",
      color: t.muted,
      marginTop: 22,
      marginBottom: 10,
    },
    tileRow: { flexDirection: "row", gap: 12 },
    tile: {
      flex: 1,
      paddingVertical: 14,
      paddingHorizontal: 6,
      borderRadius: 14,
      backgroundColor: t.surface,
      borderWidth: 2,
      borderColor: t.line,
      alignItems: "center",
      gap: 8,
    },
    tileSel: { borderColor: t.accent },
    tileName: { fontFamily: t.body.semibold, fontSize: 12, color: t.ink },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.line,
      padding: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    cardTextCol: { flex: 1, paddingRight: 12 },
    cardLabel: { fontFamily: t.body.medium, fontSize: 14.5, color: t.ink },
    cardSub: { fontFamily: t.body.regular, fontSize: 12, color: t.muted, marginTop: 2 },
    cardCol: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.line,
      padding: 14,
    },
    modelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    modelName: { fontFamily: t.display.semibold, fontSize: 15, color: t.ink },
    ready: { fontFamily: t.body.semibold, fontSize: 12, color: t.accent2 },
    modelMeta: { fontFamily: t.body.regular, fontSize: 12, color: t.muted, marginTop: 4 },
    privacy: { fontFamily: t.body.medium, fontSize: 12, color: t.ink, marginTop: 10 },
    calRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.line,
      marginBottom: 8,
    },
    calRowSel: { borderColor: t.accent },
    calCheck: { fontFamily: t.body.bold, fontSize: 14, color: t.accent, marginLeft: 8 },
    syncBtn: {
      marginTop: 4,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: t.accent,
      alignItems: "center",
    },
    syncBtnDisabled: { opacity: 0.4 },
    syncBtnText: { fontFamily: t.display.semibold, fontSize: 14, color: t.bg },
    syncMsg: {
      fontFamily: t.body.regular,
      fontSize: 12,
      color: t.muted,
      marginTop: 8,
      textAlign: "center",
    },
    footer: {
      fontFamily: t.body.medium,
      fontSize: 12,
      color: t.muted,
      textAlign: "center",
      marginTop: 26,
    },
  });
}
