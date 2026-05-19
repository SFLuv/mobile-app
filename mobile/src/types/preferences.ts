export type ThemePreference = "system" | "light" | "dark";
export type SendFlowEntryMode = "manual" | "scan";

export type AppPreferences = {
  themePreference: ThemePreference;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  defaultSendEntryMode: SendFlowEntryMode;
  showImproverPanel: boolean;
};

export const defaultAppPreferences: AppPreferences = {
  themePreference: "system",
  notificationsEnabled: true,
  hapticsEnabled: true,
  defaultSendEntryMode: "manual",
  showImproverPanel: true,
};
