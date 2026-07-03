// Orb.tsx — the voice orb (the product's heart) + the header logo mark.
//
// The orb replaces the old logo-bitmap push-to-talk button. It is a pure VISUAL
// component: the Pressable / mic wiring stays in App.renderTalk. Given the theme
// tokens + a voice state, it renders pulse rings, a breathing gradient disc and
// a per-theme "heart" (Signal chevron · Local clay mic · On-Device equalizer +
// gemma-4-e2b label), plus a listening state (equalizer bars in the listen hue).
//
// Every animation uses useNativeDriver so it runs on the UI thread and stays
// smooth even while the JS thread freezes in bursts during model loading.
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  Line,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import type { Theme } from "./theme";

export type OrbVState = "idle" | "listening" | "understanding";

// ── Equalizer bars — used for the On-Device heart and the listening state ──
function EqBars({
  color,
  height,
  count = 5,
  animated,
}: {
  color: string;
  height: number;
  count?: number;
  animated: boolean;
}) {
  const bars = useRef(
    Array.from({ length: count }, () => new Animated.Value(0.5)),
  ).current;
  useEffect(() => {
    if (!animated) {
      bars.forEach((b, i) => b.setValue(0.4 + ((i % 3) * 0.25)));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 90),
          Animated.timing(b, {
            toValue: 1,
            duration: 340 + i * 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(b, {
            toValue: 0.34,
            duration: 340 + i * 50,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [animated, bars]);

  const barW = Math.max(2, height * 0.16);
  return (
    <View style={{ height, flexDirection: "row", alignItems: "center", gap: barW * 0.7 }}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            width: barW,
            height,
            borderRadius: barW / 2,
            backgroundColor: i === count - 1 ? color : color,
            transform: [{ scaleY: b }],
          }}
        />
      ))}
    </View>
  );
}

// ── Per-theme static glyphs ──
function Chevron({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path
        d="M27 62 L50 39 L73 62"
        stroke={color}
        strokeWidth={9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

function Mic({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x="39" y="22" width="22" height="40" rx="11" fill={color} />
      <Path
        d="M30 50 a20 20 0 0 0 40 0"
        stroke={color}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
      />
      <Line x1="50" y1="70" x2="50" y2="80" stroke={color} strokeWidth={6} strokeLinecap="round" />
    </Svg>
  );
}

// ── Pulsing ring (idle / listening) ──
function PulseRing({
  color,
  ring,
  delay,
}: {
  color: string;
  ring: number;
  delay: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 3200,
        delay,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [v, delay]);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1.5] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: ring,
        height: ring,
        borderRadius: ring / 2,
        borderWidth: 1.5,
        borderColor: color,
        opacity,
        transform: [{ scale }],
      }}
    />
  );
}

// ── Gradient disc ──
function Disc({ size, stops }: { size: number; stops: string[] }) {
  const [a, b, c] = stops;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="orbDisc" cx="32%" cy="26%" r="80%">
          <Stop offset="0" stopColor={a} />
          <Stop offset="0.5" stopColor={b} />
          <Stop offset="1" stopColor={c} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#orbDisc)" />
    </Svg>
  );
}

export function Orb({
  theme,
  vState,
  size,
  animated = true,
}: {
  theme: Theme;
  vState: OrbVState;
  size: number;
  animated?: boolean;
}) {
  const mini = size < 100;
  const listening = vState === "listening";
  const disc = Math.round(size * (mini ? 0.94 : 0.72));

  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animated, breathe]);
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  // The heart (idle) or the listening equalizer.
  let heart: ReactNode;
  if (listening) {
    heart = <EqBars color={theme.listen} height={disc * 0.34} count={5} animated={animated} />;
  } else if (theme.logo === "chevron") {
    heart = <Chevron size={disc * 0.66} color={theme.accent} />;
  } else if (theme.logo === "clay") {
    heart = <Mic size={disc * 0.6} color={theme.accent} />;
  } else {
    // On-Device: equalizer + model label.
    heart = (
      <View style={{ alignItems: "center", gap: disc * 0.06 }}>
        <EqBars color={theme.accent} height={disc * 0.26} count={4} animated={animated} />
        {!mini && (
          <Text style={{ fontFamily: theme.mono.regular, fontSize: Math.max(8, disc * 0.075), color: theme.accent }}>
            gemma-4-e2b
          </Text>
        )}
      </View>
    );
  }

  const ringColor1 = listening ? theme.listen : theme.accent;
  const ringColor2 = listening ? theme.listen : theme.accent2;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {!mini && animated && (
        <>
          <PulseRing color={ringColor1} ring={size * 0.72} delay={0} />
          <PulseRing color={ringColor2} ring={size * 0.72} delay={1600} />
        </>
      )}
      <Animated.View
        style={[
          styles.discWrap,
          {
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            shadowColor: theme.orbGlow,
            transform: [{ scale }],
          },
        ]}
      >
        <Disc size={disc} stops={theme.orbDisc} />
        {/* inset ring for definition */}
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              borderRadius: disc / 2,
              borderWidth: 1.5,
              borderColor: theme.dark ? theme.accent : "rgba(20,25,40,0.06)",
              opacity: theme.dark ? 0.35 : 1,
            },
          ]}
          pointerEvents="none"
        />
      </Animated.View>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={styles.center}>{heart}</View>
      </View>
    </View>
  );
}

// ── Header logo mark (26×26 rounded square) ──
export function LogoMark({ theme, size = 26 }: { theme: Theme; size?: number }) {
  let bg: string;
  let glyph: ReactNode;
  if (theme.logo === "chevron") {
    bg = theme.accent;
    glyph = <Chevron size={size * 0.72} color="#ffffff" />;
  } else if (theme.logo === "clay") {
    bg = theme.accent;
    glyph = <Mic size={size * 0.66} color="#fbf3e7" />;
  } else {
    bg = "#1b2029";
    glyph = <EqBars color={theme.accent} height={size * 0.5} count={3} animated={false} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.27),
        backgroundColor: bg,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {glyph}
    </View>
  );
}

const styles = StyleSheet.create({
  discWrap: {
    alignItems: "center",
    justifyContent: "center",
    // Soft glow (Android colored elevation + iOS shadow).
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
