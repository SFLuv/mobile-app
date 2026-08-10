/**
 * The look of a merchant's map mark, in one place.
 *
 * The same rules are implemented on the web app and the marketing site. They
 * are duplicated rather than shared because the three do not share a package —
 * if you change a colour or the initials rule here, change it in
 * `app/frontend/lib/merchant-icon.ts` and `webpage/src/lib/merchants/icon.ts`.
 */

import { OpenState } from "./openingHours";

/** Brand red. A merchant that is open right now. */
export const PIN_OPEN_COLOR = "#eb6c6c";
/** Muted slate. Open/closed has to be legible without reading anything. */
export const PIN_CLOSED_COLOR = "#8d9ba3";

/**
 * Gradients for generated icons, all drawn from the SFLuv palette. Several
 * rather than one so a street of merchants without logos still reads as
 * distinct pins rather than a row of identical marks.
 */
export const ICON_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#f08a7c", "#eb6c6c"],
  ["#eb6c6c", "#c94f4f"],
  ["#f2a17c", "#e07a5f"],
  ["#12495a", "#0b303b"],
  ["#2f7b86", "#12495a"],
  ["#d98b8b", "#8f2e2e"],
];

/**
 * Up to two initials for a business name.
 *
 * Leading articles are dropped ("The Mill" reads as M, not TM) and a lone
 * ampersand is skipped, so "Bob & Sons" is BS. Falls back to the first two
 * characters when there is only one word.
 */
export function merchantInitials(name: string): string {
  const cleaned = (name || "").replace(/[^\p{L}\p{N}\s'&-]/gu, " ").trim();
  if (cleaned === "") {
    return "?";
  }

  const words = cleaned
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .filter((word) => word !== "&");

  const meaningful = words.length > 1 ? words.filter((word) => !/^(the|a|an|el|la|le)$/i.test(word)) : words;
  const source = meaningful.length > 0 ? meaningful : words;

  if (source.length === 0) {
    return "?";
  }
  if (source.length === 1) {
    return source[0].slice(0, 2).toUpperCase();
  }
  return (source[0][0] + source[1][0]).toUpperCase();
}

/**
 * A stable gradient for a name. Deterministic so a merchant's generated mark is
 * the same on every device and every launch — a pin that changes colour between
 * visits is not an identity.
 */
export function merchantGradient(name: string): readonly [string, string] {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return ICON_GRADIENTS[hash % ICON_GRADIENTS.length];
}

/** The pin colour for an open state. Unknown hours keep the brand colour:
 *  absence of data is not a claim of closure. */
export function pinColor(state: OpenState): string {
  return state === "closed" ? PIN_CLOSED_COLOR : PIN_OPEN_COLOR;
}
