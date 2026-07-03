// ThemeContext.tsx — the active theme, shared across the whole UI so any screen
// (or the landscape calendar) can read design tokens without prop-threading.
// The value is owned by App, which persists the choice in SQLite (getSetting/
// setSetting) and gates first paint on the bundled fonts (useAppFonts).
import { createContext, useContext } from "react";
import { THEMES, DEFAULT_THEME, type Theme, type ThemeName } from "./theme";

export type ThemeContextValue = {
  theme: Theme;
  name: ThemeName;
  setTheme: (name: ThemeName) => void;
};

export const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES[DEFAULT_THEME],
  name: DEFAULT_THEME,
  setTheme: () => {},
});

export const useTheme = (): ThemeContextValue => useContext(ThemeContext);

// Runtime guard for a persisted / user-supplied value expected to be a ThemeName.
export function isThemeName(v: unknown): v is ThemeName {
  return v === "signal" || v === "local" || v === "onDevice";
}
