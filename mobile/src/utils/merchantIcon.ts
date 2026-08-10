/**
 * The look of a merchant's map mark, in one place.
 *
 * The same rules are implemented on the web app and the marketing site. They
 * are duplicated rather than shared because the three do not share a package —
 * if you change a colour, a dimension or the initials rule here, change it in
 * `app/frontend/lib/merchant-icon.ts` and `webpage/src/lib/merchants/icon.ts`.
 */

import { OpenState } from "./openingHours";

/** Brand red. A merchant that is open right now. */
export const PIN_OPEN_COLOR = "#eb6c6c";
/** Muted slate. Open/closed has to be legible without reading anything. */
export const PIN_CLOSED_COLOR = "#8d9ba3";

/**
 * The face a generated icon is drawn on.
 *
 * White while open. Closed keeps a trace of brand red rather than going fully
 * grey — a wholly desaturated pin reads as broken or unavailable, where these
 * merchants are simply shut until tomorrow.
 */
export const ICON_FACE_OPEN = "#ffffff";
export const ICON_FACE_CLOSED = "#f6eaea";

/** Initials are black and bold: the strongest contrast against a white face. */
export const ICON_TEXT_COLOR = "#111111";

/**
 * Pin geometry, matching the web surfaces.
 *
 * A stubbier ratio than Google's own marker (26:35 rather than 27:43), ending
 * on a small rounded arc instead of a needle point.
 */
export const PIN_VIEWBOX_WIDTH = 26;
export const PIN_VIEWBOX_HEIGHT = 35;
export const PIN_PATH =
  "M1.74 19.5A13 13 0 1 1 24.26 19.5C21.2 24.8 16.2 29.6 14.1 33.2a1.3 1.3 0 0 1-2.2 0C9.8 29.6 4.8 24.8 1.74 19.5Z";
/** Head-circle centre in viewBox units — where the glyph sits. */
export const PIN_HEAD_CENTRE = { x: 13, y: 13 };
/** Glyph diameter as a fraction of pin width. */
export const PIN_GLYPH_RATIO = 0.6;
/**
 * Inset of the artwork inside its circle, as a fraction of the glyph.
 *
 * Without it the icon runs to the very edge and the pin's white rim disappears
 * behind it, so the mark loses the outline that separates it from the map.
 */
export const PIN_GLYPH_INSET_RATIO = 0.09;

/** Default rendered pin width in device-independent pixels. */
export const PIN_WIDTH = 30;

/** The face colour behind a generated mark. */
export function iconFaceColor(state: OpenState): string {
  return state === "closed" ? ICON_FACE_CLOSED : ICON_FACE_OPEN;
}

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

/** The pin colour for an open state. Unknown hours keep the brand colour:
 *  absence of data is not a claim of closure. */
export function pinColor(state: OpenState): string {
  return state === "closed" ? PIN_CLOSED_COLOR : PIN_OPEN_COLOR;
}
