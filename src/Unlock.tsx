// Unlock.tsx — the app-lock gate shown before anything else when a passcode/
// encryption is set. Presentational like Picker: the actual biometric check, key
// derivation and DB open live in App via callbacks. Deliberately silent (no TTS)
// — nothing is spoken or read before the user has authenticated.
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "./ThemeContext";
import type { Theme } from "./theme";
import { LangToggle } from "./flags";
import { LogoMark } from "./Orb";
import type { Lang, Strings } from "./i18n";

export type UnlockResult = "ok" | "bad" | "lockedout";

export default function Unlock({
  lang,
  setLang,
  L,
  biometricAvailable,
  autoBiometric,
  onBiometric,
  onPasscode,
  lockoutUntil,
  onResetLock,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  L: Strings;
  biometricAvailable: boolean;
  autoBiometric: boolean;
  onBiometric: () => Promise<void>;
  onPasscode: (code: string) => Promise<UnlockResult>;
  lockoutUntil: number | null;
  onResetLock?: () => void;
}) {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme, insets.top);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Live clock so the lockout countdown ticks down.
  const [now, setNow] = useState(() => Date.now());
  const firedBiometric = useRef(false);

  const lockedFor =
    lockoutUntil && lockoutUntil > now
      ? Math.ceil((lockoutUntil - now) / 1000)
      : 0;

  useEffect(() => {
    if (!lockoutUntil) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  // Auto-fire the biometric prompt once on mount when it's available.
  useEffect(() => {
    if (autoBiometric && biometricAvailable && !firedBiometric.current) {
      firedBiometric.current = true;
      tryBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryBiometric = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onBiometric(); // resolves after boot (unmounts us) or falls through
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (busy || !code || lockedFor > 0) return;
    setBusy(true);
    setError("");
    try {
      const r = await onPasscode(code);
      if (r === "bad") setError(L.unlockWrong);
      else if (r === "lockedout") setError(L.unlockLockedOut(lockedFor || 0));
      if (r !== "ok") setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.brand}>
          <LogoMark theme={theme} size={26} />
          <Text style={s.brandName}>Kairos</Text>
        </View>
        <LangToggle lang={lang} onChange={setLang} />
      </View>

      <View style={s.body}>
        <View style={s.lockBadge}>
          <Text style={s.lockGlyph}>🔒</Text>
        </View>
        <Text style={s.title}>{L.unlockTitle}</Text>
        <Text style={s.subtitle}>{L.unlockSubtitle}</Text>

        <TextInput
          style={s.input}
          value={code}
          onChangeText={(t) => {
            setCode(t);
            if (error) setError("");
          }}
          placeholder={L.unlockCodePlaceholder}
          placeholderTextColor={theme.muted}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          importantForAutofill="no"
          autoFocus={!biometricAvailable}
          editable={!busy && lockedFor === 0}
          onSubmitEditing={submit}
          returnKeyType="go"
        />

        {error ? <Text style={s.error}>{error}</Text> : null}
        {lockedFor > 0 ? (
          <Text style={s.error}>{L.unlockLockedOut(lockedFor)}</Text>
        ) : null}

        <Pressable
          style={[s.primaryBtn, (busy || lockedFor > 0 || !code) && s.btnDisabled]}
          onPress={submit}
          disabled={busy || lockedFor > 0 || !code}
        >
          {busy ? (
            <ActivityIndicator color={theme.bg} />
          ) : (
            <Text style={s.primaryText}>{L.unlockSubmit}</Text>
          )}
        </Pressable>

        {biometricAvailable ? (
          <Pressable
            style={s.secondaryBtn}
            onPress={tryBiometric}
            disabled={busy}
          >
            <Text style={s.secondaryText}>{L.unlockUseBiometric}</Text>
          </Pressable>
        ) : null}

        {onResetLock ? (
          <Pressable style={s.resetBtn} onPress={onResetLock} hitSlop={10}>
            <Text style={s.resetText}>{L.unlockForgotCode}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(t: Theme, insetTop: number) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg, paddingTop: Math.max(insetTop, 12) },
    header: {
      paddingHorizontal: 20,
      paddingBottom: 6,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 9 },
    brandName: { fontFamily: t.display.semibold, fontSize: 17, color: t.ink },
    body: {
      flex: 1,
      paddingHorizontal: 28,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    lockBadge: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 6,
    },
    lockGlyph: { fontSize: 28 },
    title: {
      fontFamily: t.display.semibold,
      fontSize: 20,
      color: t.ink,
      textAlign: "center",
    },
    subtitle: {
      fontFamily: t.body.regular,
      fontSize: 13,
      color: t.muted,
      textAlign: "center",
      marginBottom: 8,
    },
    input: {
      width: "100%",
      maxWidth: 320,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 12,
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      fontFamily: t.body.medium,
      fontSize: 16,
      color: t.ink,
      textAlign: "center",
    },
    error: {
      fontFamily: t.body.medium,
      fontSize: 12.5,
      color: t.danger,
      textAlign: "center",
    },
    primaryBtn: {
      width: "100%",
      maxWidth: 320,
      paddingVertical: 14,
      borderRadius: 14,
      backgroundColor: t.accent,
      alignItems: "center",
      marginTop: 4,
    },
    btnDisabled: { opacity: 0.4 },
    primaryText: { fontFamily: t.display.semibold, fontSize: 15, color: t.bg },
    secondaryBtn: { paddingVertical: 12, alignItems: "center" },
    secondaryText: { fontFamily: t.body.semibold, fontSize: 14, color: t.accent },
    resetBtn: { paddingVertical: 10, alignItems: "center" },
    resetText: { fontFamily: t.body.medium, fontSize: 12.5, color: t.muted },
  });
}
