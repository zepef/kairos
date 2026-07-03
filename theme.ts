// theme.ts — Kairos design-system tokens.
//
// Three hot-swappable themes (from the redesign handoff, README §7). Every
// colour and font in the UI reads from here; nothing visual is hard-coded
// downstream. Switching theme re-skins the whole app instantly (see
// ThemeContext + makeStyles(theme) factories in each screen).
//
// Typography note: with @expo-google-fonts each WEIGHT is a distinct font
// family — React Native's `fontWeight` does NOT apply to custom fonts. So a
// family is exposed as a FontSet of weight-named families; styles pick the
// weight by family name (e.g. theme.display.semibold), never via fontWeight.

export type ThemeName = "signal" | "local" | "onDevice";

// One family, at the four weights the UI uses (400/500/600/700).
export type FontSet = {
  regular: string; // 400
  medium: string; // 500
  semibold: string; // 600
  bold: string; // 700
};

export type Theme = {
  name: ThemeName;
  // Dark surfaces → light status bar + a few contrast flips downstream.
  dark: boolean;

  // ── Colours (README §7) ──
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accent2: string;
  listen: string;
  danger: string;
  indicator: string;
  panelBg: string;
  panelBorder: string;
  chipBg: string;

  // ── Type ──
  display: FontSet; // titles / display
  body: FontSet; // UI body text
  mono: FontSet; // monospace accents (gemma-4-e2b label, metrics)

  // ── Orb / logo ──
  orbDisc: string[]; // radial-gradient stops for the breathing orb disc
  orbGlow: string; // outer glow / shadow colour of the orb
  logo: "chevron" | "clay" | "eq"; // per-theme logo mark + orb heart kind
};

// Font family names. These strings MUST match the keys registered by
// useAppFonts() in fonts.ts (which are the @expo-google-fonts export names).
const SPACE_GROTESK: FontSet = {
  regular: "SpaceGrotesk_400Regular",
  medium: "SpaceGrotesk_500Medium",
  semibold: "SpaceGrotesk_600SemiBold",
  bold: "SpaceGrotesk_700Bold",
};
const HANKEN: FontSet = {
  regular: "HankenGrotesk_400Regular",
  medium: "HankenGrotesk_500Medium",
  semibold: "HankenGrotesk_600SemiBold",
  bold: "HankenGrotesk_700Bold",
};
const NEWSREADER: FontSet = {
  regular: "Newsreader_400Regular",
  medium: "Newsreader_500Medium",
  semibold: "Newsreader_600SemiBold",
  bold: "Newsreader_700Bold",
};
const IBM_SANS: FontSet = {
  regular: "IBMPlexSans_400Regular",
  medium: "IBMPlexSans_500Medium",
  semibold: "IBMPlexSans_600SemiBold",
  bold: "IBMPlexSans_700Bold",
};
// Mono is loaded only up to 600 (it's used sparingly); bold aliases 600.
const IBM_MONO: FontSet = {
  regular: "IBMPlexMono_400Regular",
  medium: "IBMPlexMono_500Medium",
  semibold: "IBMPlexMono_600SemiBold",
  bold: "IBMPlexMono_600SemiBold",
};

// 7.1 Signal — "lumineux, confiant" (default).
export const SIGNAL: Theme = {
  name: "signal",
  dark: false,
  bg: "#f6f8fc",
  surface: "#ffffff",
  ink: "#14213a",
  muted: "#8793a3",
  line: "#e6ecf4",
  accent: "#2f6fed",
  accent2: "#17b3b0",
  listen: "#2e9e5b",
  danger: "#e0564b",
  indicator: "rgba(20,25,40,0.22)",
  panelBg: "#ffffff",
  panelBorder: "#e2e9f3",
  chipBg: "#eaf1ff",
  display: SPACE_GROTESK,
  body: HANKEN,
  mono: IBM_MONO,
  orbDisc: ["#ffffff", "#ecf3ff", "#ddedff"],
  orbGlow: "rgba(47,111,237,0.5)",
  logo: "chevron",
};

// 7.2 Local — "chaleureux, humain, analogique".
export const LOCAL: Theme = {
  name: "local",
  dark: false,
  bg: "#f7f2e8",
  surface: "#fbf7ee",
  ink: "#2b2620",
  muted: "#9a8f7c",
  line: "#e5dccb",
  accent: "#b5623c",
  accent2: "#7c8c5a",
  listen: "#7c8c5a",
  danger: "#c0563a",
  indicator: "rgba(60,45,25,0.22)",
  panelBg: "#fbf7ee",
  panelBorder: "#e3d8c4",
  chipBg: "#f3ead9",
  display: NEWSREADER,
  body: HANKEN,
  mono: IBM_MONO,
  orbDisc: ["#fbf7ee", "#ece1cd", "#dccdb2"],
  orbGlow: "rgba(78,64,42,0.5)",
  logo: "clay",
};

// 7.3 On-Device — "technique, offline-first".
export const ON_DEVICE: Theme = {
  name: "onDevice",
  dark: true,
  bg: "#0b0d11",
  surface: "#12151c",
  ink: "#e7ecf2",
  muted: "#8791a0",
  line: "#1f242e",
  accent: "#2ee6c6",
  accent2: "#7c8cff",
  listen: "#2ee6c6",
  danger: "#ff7a6b",
  indicator: "rgba(255,255,255,0.28)",
  panelBg: "#12151c",
  panelBorder: "#1f242e",
  chipBg: "#161b24",
  display: IBM_SANS,
  body: IBM_SANS,
  mono: IBM_MONO,
  orbDisc: ["#1b2029", "#0f1218", "#0b0d11"],
  orbGlow: "rgba(46,230,198,0.4)",
  logo: "eq",
};

export const THEMES: Record<ThemeName, Theme> = {
  signal: SIGNAL,
  local: LOCAL,
  onDevice: ON_DEVICE,
};

// Display order in the picker / settings tiles.
export const THEME_ORDER: ThemeName[] = ["signal", "local", "onDevice"];
export const DEFAULT_THEME: ThemeName = "signal";
