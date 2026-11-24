import * as WebBrowser from "expo-web-browser";
import { mobileConfig } from "../config";
import { AppClientConfig } from "../types/app";
import { SfluvUniversalLink, parseSfluvUniversalLink } from "./universalLinks";

/**
 * Every link the phone can hand the app, classified.
 *
 * The web app's association files (/.well-known/apple-app-site-association and
 * /.well-known/assetlinks.json) claim every path on app.sfluv.org, and the
 * Android intent filter in app.config.ts matches every path too. So once the
 * app is installed, every app.sfluv.org link in an email opens here rather
 * than in a browser: the organization invitation, the email verification link,
 * the workflow photo pages, the notification hub's admin links. Only the
 * payment and reference links were recognised, and everything else was
 * dropped without a word: the app came to the front and nothing happened.
 *
 * So every link on the domain now ends somewhere:
 * - payment and reference links, exactly as before (parseSfluvUniversalLink);
 * - the emailed links the app can finish itself: joining an organization and
 *   verifying an email address;
 * - pages the app has its own screen for;
 * - and everything else back to the web page it is, in a browser.
 */
export type SfluvAppLink =
  | SfluvUniversalLink
  /** `/organization/join?token=…`, from an organization invite email. */
  | { type: "orgjoin"; token: string; href: string }
  /** `/verify?token=…`, from an email verification email. */
  | { type: "verifyemail"; token: string; href: string }
  /** A web page the app has its own screen for. */
  | { type: "screen"; screen: AppLinkScreen; href: string }
  /** The bare domain: opening the app is the whole of it. */
  | { type: "home"; href: string }
  /** A page only the web has. Opened in a browser. */
  | { type: "web"; href: string };

export type AppLinkScreen = "settings" | "map" | "contacts" | "wallet";

type AppLinkConfig = Pick<AppClientConfig, "alias" | "appOrigin" | "tokenDecimals">;

/** Web paths with a screen of their own in the app. */
const SCREEN_PATHS: Record<string, AppLinkScreen> = {
  "/settings": "settings",
  "/map": "map",
  "/contacts": "contacts",
  "/wallets": "wallet",
};

/**
 * Splits an https URL by hand.
 *
 * React Native's own URL never throws on a bad string, and its search params
 * cut a value at its first "=", so it is not trusted with either job here.
 */
function splitHttpsURL(rawURL: string): { host: string; path: string; query: string } | null {
  const match = rawURL.trim().match(/^https:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?/i);
  if (!match) {
    return null;
  }
  const host = match[1].replace(/^[^@]*@/, "").toLowerCase();
  return { host, path: match[2] || "/", query: match[3] || "" };
}

function queryParam(query: string, name: string): string {
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    const key = separator >= 0 ? pair.slice(0, separator) : pair;
    if (key !== name) {
      continue;
    }
    const value = separator >= 0 ? pair.slice(separator + 1) : "";
    try {
      return decodeURIComponent(value.replace(/\+/g, " ")).trim();
    } catch {
      return value.trim();
    }
  }
  return "";
}

function appHost(config?: AppLinkConfig): string {
  return splitHttpsURL(config?.appOrigin || mobileConfig.appOrigin)?.host ?? "";
}

/** Whether a URL is on the app's own web domain: the links the OS sends here. */
export function isAppDomainURL(rawURL: string, config?: AppLinkConfig): boolean {
  const parts = splitHttpsURL(rawURL);
  return Boolean(parts && parts.host === appHost(config));
}

export function parseSfluvAppLink(rawURL: string, config?: AppLinkConfig): SfluvAppLink | null {
  const trimmed = rawURL.trim();
  if (!trimmed) {
    return null;
  }

  const known = parseSfluvUniversalLink(trimmed, config);
  if (known) {
    return known;
  }

  // Not on the domain: a sign-in callback, the share extension, the W-9 return
  // page's sfluv:// link, or another site. None of it is this router's.
  const parts = splitHttpsURL(trimmed);
  if (!parts || parts.host !== appHost(config)) {
    return null;
  }

  const path = parts.path.replace(/\/+$/, "").toLowerCase() || "/";
  const token = queryParam(parts.query, "token");

  if (path === "/organization/join" && token) {
    return { type: "orgjoin", token, href: trimmed };
  }
  if (path === "/verify" && token) {
    return { type: "verifyemail", token, href: trimmed };
  }
  const screen = SCREEN_PATHS[path];
  if (screen) {
    return { type: "screen", screen, href: trimmed };
  }
  if (path === "/") {
    return { type: "home", href: trimmed };
  }
  return { type: "web", href: trimmed };
}

/**
 * Opens a page in the in-app browser.
 *
 * Not Linking.openURL. These pages are on the app's own domain, and handing
 * one to the system routes it straight back here (Android does so always, as
 * the verified handler), so the page would never be shown. The in-app browser
 * loads the address it is given without asking which app claims it.
 *
 * Resolves false when no browser could be shown.
 */
export async function openWebPage(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    return false;
  }
}

/** A path on the web app, e.g. "/settings", as an absolute URL. */
export function webAppURL(path: string, config?: AppLinkConfig): string {
  const origin = (config?.appOrigin || mobileConfig.appOrigin).trim().replace(/\/+$/, "");
  const match = origin.match(/^https?:\/\/[^/?#]+/i);
  return `${match ? match[0] : origin}${path}`;
}
