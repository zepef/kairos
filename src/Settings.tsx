// Settings.tsx — the Réglages screen (design 5.4), reached from the home ⚙
// button. Themed by the active theme; the Appearance tiles preview and switch
// the three themes live. TTS + language (previously in the bottom bar) live here.
import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./ThemeContext";
import { THEMES, THEME_ORDER, type Theme } from "./theme";
import { LangToggle } from "./flags";
import { Orb } from "./Orb";
import type { Lang, Strings } from "./i18n";
import type { CalInfo } from "./gcal";
import type { KeyMode } from "./security";

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
  lockEnabled,
  biometricAvail,
  passcodeSet,
  onToggleLock,
  onSetPasscode,
  encEnabled,
  keyMode,
  zkBiometric,
  securityBusy,
  onToggleEnc,
  onEnableZk,
  onDisableZk,
  onSetZkBiometric,
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
  lockEnabled: boolean;
  biometricAvail: boolean;
  passcodeSet: boolean;
  onToggleLock: (b: boolean) => Promise<void>;
  onSetPasscode: (code: string) => Promise<void>;
  encEnabled: boolean;
  keyMode: KeyMode;
  zkBiometric: boolean;
  securityBusy: boolean;
  onToggleEnc: (b: boolean) => Promise<void>;
  onEnableZk: (code: string) => Promise<boolean>;
  onDisableZk: () => Promise<void>;
  onSetZkBiometric: (b: boolean) => Promise<void>;
}) {
  const { theme, name, setTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme, insets.top);
  const [syncMsg, setSyncMsg] = useState("");
  // Passcode-set inline flow (used both to first-set and to change the code).
  const [pcOpen, setPcOpen] = useState(false);
  const [pc1, setPc1] = useState("");
  const [pc2, setPc2] = useState("");
  const [pcErr, setPcErr] = useState("");
  const [pcBusy, setPcBusy] = useState(false); // no concurrent setPasscode runs
  // Zero-knowledge activation inline flow (re-enter the passcode to derive key).
  const [zkOpen, setZkOpen] = useState(false);
  const [zkPc, setZkPc] = useState("");
  const [secMsg, setSecMsg] = useState("");

  const closePasscode = () => {
    setPcOpen(false);
    setPc1("");
    setPc2("");
    setPcErr("");
  };
  const savePasscode = async () => {
    if (pcBusy) return; // a second tap must never start a second setPasscode run
    if (pc1.length < 4) return setPcErr(L.lockPasscodeTooShort);
    if (pc1 !== pc2) return setPcErr(L.lockPasscodeMismatch);
    setPcBusy(true);
    try {
      await onSetPasscode(pc1);
      if (!lockEnabled) await onToggleLock(true); // first-set also enables the lock
      closePasscode();
      setSecMsg(L.lockPasscodeSaved);
    } finally {
      setPcBusy(false);
    }
  };
  const onLockSwitch = async (b: boolean) => {
    setSecMsg("");
    if (b) {
      if (!passcodeSet) return setPcOpen(true); // must set a code first
      await onToggleLock(true);
    } else {
      if (encEnabled && keyMode === "zk") return setSecMsg(L.encZkNeedsLock);
      await onToggleLock(false);
    }
  };
  const openZk = () => {
    setSecMsg("");
    Alert.alert(L.encZkWarnTitle, L.encZkWarnBody, [
      { text: L.lockCancel, style: "cancel" },
      {
        text: L.encZkConfirm,
        style: "destructive",
        onPress: () => setZkOpen(true),
      },
    ]);
  };
  const confirmZk = async () => {
    const ok = await onEnableZk(zkPc);
    setZkOpen(false);
    setZkPc("");
    if (!ok) setSecMsg(L.unlockWrong);
  };
  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>{L.settingsTitle}</Text>
        <Pressable onPress={onClose} hitSlop={10}>
          <Text style={s.close}>{L.closeBtn}</Text>
        </Pressable>
      </View>

      {/* keyboardShouldPersistTaps: without it (RN default "never") the first tap
          on any control while the keyboard is up is swallowed to dismiss it — so
          "Enregistrer" under the auto-focused passcode field silently did nothing,
          and users tapped again and again. */}
      <ScrollView
        contentContainerStyle={s.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
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

        {/* Verrouillage */}
        <Text style={s.section}>{L.settingsLock}</Text>
        <View style={s.card}>
          <View style={s.cardTextCol}>
            <Text style={s.cardLabel}>{L.settingsLock}</Text>
            <Text style={s.cardSub}>{L.settingsLockSub}</Text>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={onLockSwitch}
            trackColor={{ true: theme.accent, false: theme.line }}
            thumbColor="#ffffff"
          />
        </View>
        {lockEnabled && (
          <View style={s.cardCol}>
            <Text style={s.cardSub}>
              {biometricAvail
                ? L.lockBiometricAvailable
                : L.lockBiometricUnavailable}
            </Text>
            <Pressable style={s.secBtn} onPress={() => setPcOpen(true)}>
              <Text style={s.secBtnText}>{L.lockChangePasscode}</Text>
            </Pressable>
          </View>
        )}
        {pcOpen && (
          <View style={s.cardCol}>
            <TextInput
              style={s.pinInput}
              value={pc1}
              onChangeText={setPc1}
              placeholder={L.lockPasscodePlaceholder}
              placeholderTextColor={theme.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              importantForAutofill="no"
              autoFocus
            />
            <TextInput
              style={s.pinInput}
              value={pc2}
              onChangeText={setPc2}
              placeholder={L.lockPasscodeConfirmPlaceholder}
              placeholderTextColor={theme.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              importantForAutofill="no"
            />
            {pcErr ? <Text style={s.warnText}>{pcErr}</Text> : null}
            <View style={s.btnRow}>
              <Pressable
                style={[s.secBtn, pcBusy && s.btnDisabled]}
                onPress={savePasscode}
                disabled={pcBusy}
              >
                <Text style={s.secBtnText}>{L.lockSave}</Text>
              </Pressable>
              <Pressable style={s.secBtn} onPress={closePasscode} disabled={pcBusy}>
                <Text style={s.secBtnMuted}>{L.lockCancel}</Text>
              </Pressable>
            </View>
          </View>
        )}
        {secMsg ? <Text style={s.syncMsg}>{secMsg}</Text> : null}

        {/* Chiffrement */}
        <Text style={s.section}>{L.settingsEncryption}</Text>
        <View style={s.card}>
          <View style={s.cardTextCol}>
            <Text style={s.cardLabel}>{L.settingsEncryption}</Text>
            <Text style={s.cardSub}>{L.settingsEncryptionSub}</Text>
          </View>
          <Switch
            value={encEnabled}
            onValueChange={onToggleEnc}
            disabled={securityBusy}
            trackColor={{ true: theme.accent, false: theme.line }}
            thumbColor="#ffffff"
          />
        </View>
        {encEnabled && (
          <View style={s.cardCol}>
            <Text style={s.cardSub}>
              {L.encMode} ·{" "}
              {keyMode === "zk" ? L.encModeZk : L.encModeRecoverable}
            </Text>
            {keyMode === "recoverable" ? (
              <>
                <Pressable
                  style={[
                    s.dangerBtn,
                    (!(lockEnabled && passcodeSet) || securityBusy) &&
                      s.btnDisabled,
                  ]}
                  disabled={!(lockEnabled && passcodeSet) || securityBusy}
                  onPress={openZk}
                >
                  <Text style={s.dangerBtnText}>{L.encEnableZk}</Text>
                </Pressable>
                {!(lockEnabled && passcodeSet) ? (
                  <Text style={s.cardSub}>{L.encZkNeedsLock}</Text>
                ) : null}
              </>
            ) : (
              <>
                <View style={s.zkRow}>
                  <View style={s.cardTextCol}>
                    <Text style={s.cardLabel}>{L.encZkBiometric}</Text>
                    <Text style={s.cardSub}>{L.encZkBiometricSub}</Text>
                  </View>
                  <Switch
                    value={zkBiometric}
                    onValueChange={onSetZkBiometric}
                    disabled={securityBusy}
                    trackColor={{ true: theme.accent, false: theme.line }}
                    thumbColor="#ffffff"
                  />
                </View>
                <Pressable
                  style={[s.secBtn, securityBusy && s.btnDisabled]}
                  disabled={securityBusy}
                  onPress={onDisableZk}
                >
                  <Text style={s.secBtnText}>{L.encDisableZk}</Text>
                </Pressable>
              </>
            )}
            {zkOpen && (
              <View>
                <Text style={s.cardSub}>{L.encZkEnterPasscode}</Text>
                <TextInput
                  style={s.pinInput}
                  value={zkPc}
                  onChangeText={setZkPc}
                  placeholder={L.unlockCodePlaceholder}
                  placeholderTextColor={theme.muted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  spellCheck={false}
                  importantForAutofill="no"
                  autoFocus
                />
                <View style={s.btnRow}>
                  <Pressable style={s.dangerBtn} onPress={confirmZk}>
                    <Text style={s.dangerBtnText}>{L.encZkConfirm}</Text>
                  </Pressable>
                  <Pressable
                    style={s.secBtn}
                    onPress={() => {
                      setZkOpen(false);
                      setZkPc("");
                    }}
                  >
                    <Text style={s.secBtnMuted}>{L.lockCancel}</Text>
                  </Pressable>
                </View>
              </View>
            )}
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
            {encEnabled
              ? L.settingsPrivacyLineEncrypted
              : gcalEnabled
                ? L.settingsPrivacyLineSync
                : L.settingsPrivacyLine}
          </Text>
        </View>

        <Text style={s.footer}>{L.versionLabel}</Text>
      </ScrollView>
    </View>
  );
}

function makeStyles(t: Theme, insetTop: number) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, paddingTop: Math.max(insetTop, 12) },
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
    // ── Security sections ──
    pinInput: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: t.bg,
      borderWidth: 1.5,
      borderColor: t.line,
      fontFamily: t.body.medium,
      fontSize: 15,
      color: t.ink,
    },
    btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
    secBtn: {
      flex: 1,
      marginTop: 8,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: t.line,
      alignItems: "center",
    },
    secBtnText: { fontFamily: t.body.semibold, fontSize: 13.5, color: t.accent },
    secBtnMuted: { fontFamily: t.body.semibold, fontSize: 13.5, color: t.muted },
    dangerBtn: {
      flex: 1,
      marginTop: 8,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: t.danger,
      alignItems: "center",
    },
    dangerBtnText: { fontFamily: t.display.semibold, fontSize: 13.5, color: t.bg },
    btnDisabled: { opacity: 0.4 },
    warnText: {
      fontFamily: t.body.medium,
      fontSize: 12.5,
      color: t.danger,
      marginTop: 6,
    },
    zkRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
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
