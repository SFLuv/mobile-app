export type ThemePreference = "system" | "light" | "dark";

export type AppPreferences = {
  themePreference: ThemePreference;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
};

export const defaultAppPreferences: AppPreferences = {
  themePreference: "system",
  notificationsEnabled: true,
  hapticsEnabled: true,
};
