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
  background: "#f3efea",
  backgroundMuted: "#ece5de",
  surface: "#ffffff",
  surfaceMuted: "#f8f3ef",
  surfaceStrong: "#f5efea",
  border: "#ded5cf",
  borderStrong: "#cfc3ba",
  primary: "#ef6d66",
  primaryStrong: "#d95a53",
  primarySoft: "#fde7e2",
  primaryMuted: "#fde7e2",
  navy: "#3a2c2f",
  navyStrong: "#2d2124",
  navySoft: "#f5eae7",
  accent: "#efe6df",
  text: "#201f24",
  textMuted: "#6e6974",
  success: "#178257",
  warning: "#a66a1f",
  danger: "#cf4d43",
  white: "#ffffff",
  overlay: "rgba(24, 19, 24, 0.34)",
  shadow: "rgba(36, 24, 24, 0.12)",
};

export const darkPalette: Palette = {
  background: "#10161b",
  backgroundMuted: "#141c22",
  surface: "#172129",
  surfaceMuted: "#1c2831",
  surfaceStrong: "#24313c",
  border: "#31404d",
  borderStrong: "#4a5b68",
  primary: "#ef6d66",
  primaryStrong: "#ff8e88",
  primarySoft: "#382528",
  primaryMuted: "#2c1f21",
  navy: "#d9d0cb",
  navyStrong: "#f2ebe5",
  navySoft: "#2a3640",
  accent: "#1c2831",
  text: "#f2ebe5",
  textMuted: "#a9b4bd",
  success: "#57c896",
  warning: "#d7a456",
  danger: "#ff8a80",
  white: "#ffffff",
  overlay: "rgba(2, 6, 10, 0.72)",
  shadow: "rgba(0, 0, 0, 0.42)",
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
  sm: 12,
  md: 18,
  lg: 28,
  xl: 36,
  pill: 999,
};

export function getShadows(themePalette: Palette) {
  return {
    card: {
      shadowColor: themePalette.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 12 },
      elevation: 5,
    },
    soft: {
      shadowColor: themePalette.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
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
