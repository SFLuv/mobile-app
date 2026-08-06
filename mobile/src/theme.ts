import React, { PropsWithChildren, createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { ThemePreference } from "./types/preferences";

export type Palette = {
  background: string;
  backgroundMuted: string;
  surface: string;
  surfaceMuted: string;
  surfaceStrong: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  primaryMuted: string;
  navy: string;
  navyStrong: string;
  navySoft: string;
  accent: string;
  text: string;
  textMuted: string;
  success: string;
  warning: string;
  danger: string;
  white: string;
  overlay: string;
  shadow: string;
};

export const lightPalette: Palette = {
  background: "#fef4ee",
  backgroundMuted: "#f7ebe4",
  surface: "#ffffff",
  surfaceMuted: "#fbf4f0",
  surfaceStrong: "#f5ece7",
  border: "#e6dcd7",
  borderStrong: "#d3c5bd",
  primary: "#eb6c6c",
  primaryStrong: "#eb6c6c",
  primarySoft: "#fcd9d2",
  primaryMuted: "#fdeae5",
  navy: "#0b303b",
  navyStrong: "#08242c",
  navySoft: "#eef3f4",
  accent: "#f1e8e2",
  text: "#101820",
  textMuted: "#4a6069",
  success: "#137333",
  warning: "#9a6414",
  danger: "#b00020",
  white: "#ffffff",
  overlay: "rgba(11, 48, 59, 0.38)",
  shadow: "rgb(11, 48, 59)",
};

export const darkPalette: Palette = {
  background: "#0a1a20",
  backgroundMuted: "#0f2530",
  surface: "#132a33",
  surfaceMuted: "#17323d",
  surfaceStrong: "#1d3d49",
  border: "#2a4b57",
  borderStrong: "#3f6472",
  primary: "#eb6c6c",
  primaryStrong: "#eb6c6c",
  primarySoft: "#3b2529",
  primaryMuted: "#2d1c20",
  navy: "#d8e6ea",
  navyStrong: "#f0f7f9",
  navySoft: "#1d3d49",
  accent: "#17323d",
  text: "#eaf3f5",
  textMuted: "#9db4bd",
  success: "#4ec38c",
  warning: "#d9a75b",
  danger: "#ff8a80",
  white: "#ffffff",
  overlay: "rgba(3, 12, 16, 0.74)",
  shadow: "rgb(0, 0, 0)",
};

export const palette = lightPalette;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  xxl: 36,
};

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
};

export function getShadows(themePalette: Palette) {
  const onDark = themePalette.background === darkPalette.background;
  return {
    card: {
      shadowColor: themePalette.shadow,
      shadowOpacity: onDark ? 0.45 : 0.1,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
    soft: {
      shadowColor: themePalette.shadow,
      shadowOpacity: onDark ? 0.35 : 0.06,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 6 },
      elevation: 3,
    },
  };
}

export const shadows = getShadows(lightPalette);

type ThemeMode = "light" | "dark";

type AppTheme = {
  palette: Palette;
  shadows: ReturnType<typeof getShadows>;
  mode: ThemeMode;
  isDark: boolean;
};

const defaultTheme: AppTheme = {
  palette: lightPalette,
  shadows,
  mode: "light",
  isDark: false,
};

const ThemeContext = createContext<AppTheme>(defaultTheme);

export function AppThemeProvider({
  preference,
  children,
}: PropsWithChildren<{ preference: ThemePreference }>) {
  const systemScheme = useColorScheme();
  const mode: ThemeMode =
    preference === "system" ? (systemScheme === "dark" ? "dark" : "light") : preference;
  const resolvedPalette = mode === "dark" ? darkPalette : lightPalette;

  const value = useMemo<AppTheme>(
    () => ({
      palette: resolvedPalette,
      shadows: getShadows(resolvedPalette),
      mode,
      isDark: mode === "dark",
    }),
    [mode, resolvedPalette],
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

export function useAppTheme(): AppTheme {
  return useContext(ThemeContext);
}
