import i18next, { type TOptions } from "i18next";
import { useEffect, useState } from "react";
import { initReactI18next } from "react-i18next";
import { I18nManager, NativeModules, Platform } from "react-native";

import { ensureDirection } from "./direction";
import en from "./locales/en.json";
import ar from "./locales/ar.json";
import es from "./locales/es.json";
import vi from "./locales/vi.json";
import zhHant from "./locales/zh-Hant.json";

/**
 * Translations for the app's own text.
 *
 * Everything here is JavaScript (i18next, react-i18next, and the phone's
 * locale read through React Native's own modules), so new languages and newly
 * translated screens ship as over-the-air updates. The one exception is the
 * text of the system permission popups, which lives in the native Info.plist /
 * strings files and needs a store build.
 *
 * English is the source and the fallback: a key missing from another language
 * shows the English, never a blank or a raw key.
 */

export type LanguageOption = {
  /** BCP 47 code, e.g. "en", "es", "zh-Hant", "vi", "ar". */
  code: string;
  /** The language's name in that language, as it should appear in the picker. */
  nativeName: string;
  /** Laid out right to left (Arabic). */
  rtl?: boolean;
};

/**
 * Languages the app ships. A language is listed here only once its file
 * exists; the Settings picker stays hidden while English is the only one.
 */
const RELEASED_LANGUAGES: LanguageOption[] = [
  { code: "en", nativeName: "English" },
  { code: "es", nativeName: "Español" },
  { code: "zh-Hant", nativeName: "繁體中文" },
  { code: "vi", nativeName: "Tiếng Việt" },
  // Right to left: switching to or from it restarts the app once
  // (src/i18n/direction.ts). Offered from 2.5 (Sanchez, 2026-11-20).
  { code: "ar", nativeName: "العربية", rtl: true },
];

/**
 * Languages that are translated and wired up but not offered yet. Development
 * builds include them so they can be worked on; move an entry into
 * RELEASED_LANGUAGES to offer it.
 */
export const UPCOMING_LANGUAGES: LanguageOption[] = [];

/**
 * What the app offers and matches the phone's language against. Development
 * builds include the upcoming languages so they can be worked on and tested;
 * release builds (OTA updates and store builds) only offer released ones.
 */
export const SUPPORTED_LANGUAGES: LanguageOption[] = __DEV__
  ? [...RELEASED_LANGUAGES, ...UPCOMING_LANGUAGES]
  : RELEASED_LANGUAGES;

/** "system" follows the phone's language; anything else is a code above. */
export type LanguagePreference = "system" | string;

const resources = {
  en: { translation: en },
  es: { translation: es },
  "zh-Hant": { translation: zhHant },
  vi: { translation: vi },
  ar: { translation: ar },
};

/** The phone's preferred locale, e.g. "es-US", read without a native add-on. */
export function deviceLocale(): string {
  try {
    if (Platform.OS === "ios") {
      const settings = NativeModules.SettingsManager?.settings;
      const preferred: unknown = settings?.AppleLanguages?.[0] ?? settings?.AppleLocale;
      if (typeof preferred === "string" && preferred) {
        return preferred.replace("_", "-");
      }
    } else {
      const constants = I18nManager.getConstants?.() as { localeIdentifier?: string } | undefined;
      if (constants?.localeIdentifier) {
        return constants.localeIdentifier.replace("_", "-");
      }
    }
  } catch {
    // Fall through to Intl.
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en";
  } catch {
    return "en";
  }
}

/**
 * The best supported language for a locale: an exact match ("zh-Hant"), then
 * the base language ("es-US" to "es"), then English.
 */
export function matchSupportedLanguage(locale: string): string {
  const wanted = locale.toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((language) => language.code.toLowerCase() === wanted);
  if (exact) {
    return exact.code;
  }
  const base = wanted.split("-")[0];
  const byBase = SUPPORTED_LANGUAGES.find((language) => language.code.toLowerCase().split("-")[0] === base);
  return byBase?.code ?? "en";
}

export function resolveLanguage(preference: LanguagePreference | undefined): string {
  if (preference && preference !== "system") {
    return matchSupportedLanguage(preference);
  }
  return matchSupportedLanguage(deviceLocale());
}

/**
 * iOS lays out each piece of text by its first strong character, not by the
 * app's direction, so an Arabic string that starts with "SFLUV" or a number
 * would sit on the left and order its words left to right. A right-to-left
 * mark (U+200F) at the start of every string in a right-to-left language makes
 * iOS treat the text as Arabic. Added here rather than in the translation
 * files so translators never have to handle invisible characters. Text sent
 * out of the app (e.g. the support subject) is requested in English, so it
 * never carries the mark.
 */
const RTL_MARK = "\u200F";
const rtlMarkPostProcessor = {
  type: "postProcessor" as const,
  name: "rtlMark",
  process(value: string, _key: string | string[], options: { lng?: string } | undefined, translator: { language?: string }) {
    // An explicit lng (the English support subject) wins over the app's language.
    const language = options?.lng ?? translator?.language;
    const rtl = Boolean(SUPPORTED_LANGUAGES.find((option) => option.code === language)?.rtl);
    return rtl && typeof value === "string" && value && !value.startsWith(RTL_MARK) ? RTL_MARK + value : value;
  },
};

void i18next.use(initReactI18next).use(rtlMarkPostProcessor).init({
  postProcess: ["rtlMark"],
  resources,
  lng: resolveLanguage("system"),
  fallbackLng: "en",
  interpolation: {
    // React already escapes what it renders.
    escapeValue: false,
  },
  react: {
    // Translations are bundled, never loaded over the network, so nothing to suspend for.
    useSuspense: false,
  },
  returnNull: false,
});

/** Applies a saved preference. Safe to call with the same value repeatedly. */
export function applyLanguagePreference(preference: LanguagePreference | undefined): void {
  const next = resolveLanguage(preference);
  if (i18next.language !== next) {
    void i18next.changeLanguage(next);
  }
  ensureDirection(Boolean(SUPPORTED_LANGUAGES.find((language) => language.code === next)?.rtl));
}

/**
 * Translate outside a component: helpers, alerts, toasts, error messages. The
 * app remounts its screens when the language changes (useAppLanguage below),
 * so text produced this way is never left in the old language on screen.
 * Never call it at module load: a constant built from it would freeze the
 * language the app happened to start in.
 */
export function t(key: string, options?: TOptions): string {
  return i18next.t(key, options) as string;
}

/** The current language, re-rendering on change. App keys its screens on it. */
export function useAppLanguage(): string {
  const [language, setLanguage] = useState(i18next.language);
  useEffect(() => {
    const onChange = (next: string) => setLanguage(next);
    i18next.on("languageChanged", onChange);
    return () => {
      i18next.off("languageChanged", onChange);
    };
  }, []);
  return language;
}

/** The app's language as a locale for dates and numbers ("es", "zh-Hant", ...). */
export function appLocale(): string {
  return i18next.language || "en";
}

export default i18next;
