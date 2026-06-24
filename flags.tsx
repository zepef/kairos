import { Pressable, StyleSheet, View } from "react-native";
import type { Lang } from "./i18n";

// Flags are drawn with plain Views (not emoji): Android's system font has no
// regional-indicator flag glyphs, so 🇫🇷/🇺🇸 would render as "FR"/"US" letter
// boxes. Tiny Views render identically on every device with zero assets.

// France: three equal vertical bands — blue / white / red.
function FrFlag({ w = 26 }: { w?: number }) {
  const h = Math.round((w * 2) / 3);
  return (
    <View style={[styles.flag, { width: w, height: h }]}>
      <View style={[styles.band, { backgroundColor: "#0055A4" }]} />
      <View style={[styles.band, { backgroundColor: "#ffffff" }]} />
      <View style={[styles.band, { backgroundColor: "#EF4135" }]} />
    </View>
  );
}

// United States: simplified stars-and-stripes — 7 red / 6 white horizontal
// stripes with a solid blue canton in the top-left (stars omitted at this size).
function UsFlag({ w = 26 }: { w?: number }) {
  const h = Math.round((w * 2) / 3);
  const stripes = Array.from({ length: 13 }, (_, i) => (
    <View
      key={i}
      style={{ flex: 1, backgroundColor: i % 2 === 0 ? "#B22234" : "#ffffff" }}
    />
  ));
  return (
    // Column layout: the 13 stripes stack top-to-bottom (horizontal stripes).
    <View style={[styles.flag, { flexDirection: "column", width: w, height: h }]}>
      {stripes}
      <View
        style={[
          styles.canton,
          { width: w * 0.42, height: h * (7 / 13) },
        ]}
      />
    </View>
  );
}

export function Flag({ lang, w }: { lang: Lang; w?: number }) {
  return lang === "fr" ? <FrFlag w={w} /> : <UsFlag w={w} />;
}

// Segmented FR | US toggle: both flags side by side, the active language bright
// and the other dimmed. Tapping a flag selects that language. This is the
// "drapeau français-américain" used to switch languages from the bottom bar.
export function LangToggle({
  lang,
  onChange,
}: {
  lang: Lang;
  onChange: (l: Lang) => void;
}) {
  return (
    <View style={styles.toggle}>
      <Pressable
        onPress={() => onChange("fr")}
        hitSlop={8}
        style={[styles.slot, lang === "fr" ? styles.active : styles.inactive]}
      >
        <FrFlag w={24} />
      </Pressable>
      <Pressable
        onPress={() => onChange("en")}
        hitSlop={8}
        style={[styles.slot, lang === "en" ? styles.active : styles.inactive]}
      >
        <UsFlag w={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  flag: {
    flexDirection: "row",
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#c4c9d0",
    overflow: "hidden",
  },
  band: { flex: 1 },
  canton: { position: "absolute", left: 0, top: 0, backgroundColor: "#3C3B6E" },
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  slot: {
    paddingHorizontal: 3,
    paddingVertical: 3,
    borderRadius: 4,
  },
  active: { opacity: 1, backgroundColor: "#e7eefc" },
  inactive: { opacity: 0.4 },
});
