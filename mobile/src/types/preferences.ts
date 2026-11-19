export type ThemePreference = "system" | "light" | "dark";
export type SendFlowEntryMode = "manual" | "scan";

export type AppPreferences = {
  themePreference: ThemePreference;
  notificationsEnabled: boolean;
  hapticsEnabled: boolean;
  defaultSendEntryMode: SendFlowEntryMode;
  showImproverPanel: boolean;
  showVolunteerPanel: boolean;
  /** "system" follows the phone's language; otherwise a code from src/i18n. */
  languagePreference: string;
};

export const defaultAppPreferences: AppPreferences = {
  themePreference: "system",
  notificationsEnabled: true,
  hapticsEnabled: true,
  defaultSendEntryMode: "manual",
  showImproverPanel: true,
  showVolunteerPanel: true,
  languagePreference: "system",
};
