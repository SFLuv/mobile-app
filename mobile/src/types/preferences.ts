export type ThemePreference = "system" | "light" | "dark";

export type AppPreferences = {
  themePreference: ThemePreference;
  hapticsEnabled: boolean;
};

export const defaultAppPreferences: AppPreferences = {
  themePreference: "system",
  hapticsEnabled: true,
};
