/**
 * Finding links in message text.
 *
 * Links are rendered from the text a message carries, on every client, rather
 * than frozen onto the message as an attachment when it is sent. So what was
 * typed is exactly what is stored and exactly what a notification shows, and a
 * link in a message sent before this existed renders the same as one sent
 * after it.
 *
 * Deliberately conservative. An explicit `http(s)://` or `www.` always counts.
 * A bare `host.tld` only counts for a short list of common TLDs, because most
 * two-letter strings after a dot are not TLDs anybody means as one — "notes.md",
 * "report.pdf", "see you at 3.30" — and a card or an underline appearing under
 * one of those is absurd. Somebody whose bare link on an unusual TLD is not
 * recognised can add the scheme; somebody whose filename turns into a link has
 * nothing they can do.
 */

export type TextSegment =
  | { kind: "text"; text: string }
  | { kind: "link"; text: string; href: string };

const BARE_TLDS =
  "com|org|net|edu|gov|io|co|app|dev|ai|me|us|ly|info|biz|xyz|so|gg|fm|tv|to|news|page|site|link|city|community|social";

// A bare host may carry a two-letter country part after a listed ending —
// bbc.co.uk, amazon.com.au, service.gov.uk — and must then END: a host that
// carries on with ".something" was cut short at a listed ending, and linking
// "bbc.co" for "bbc.co.uk" sends the reader somewhere else entirely.
const LINK_PATTERN = new RegExp(
  "(?:https?:\\/\\/[^\\s<>\"']+)" +
    "|(?:\\bwww\\.[^\\s<>\"']+)" +
    `|(?:\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${BARE_TLDS})(?:\\.[a-z]{2})?\\b(?!\\.[a-z0-9])(?:\\/[^\\s<>"']*)?)`,
  "gi",
);

/**
 * Punctuation that ends a sentence rather than a URL. "Look at sfluv.org." is
 * a link to sfluv.org, not to "sfluv.org.". A closing bracket is only trimmed
 * when the URL has no opening one, so Wikipedia's "Foo_(bar)" survives.
 */
function trimTrailing(raw: string): string {
  const unbalanced = (text: string, open: string, close: string) =>
    text.endsWith(close) && text.split(open).length < text.split(close).length;
  // Repeated until nothing changes, because the two interleave: in
  // "(see https://x.com/a.)" the bracket hides the full stop, and in
  // "https://x.com/a)." the full stop hides the bracket.
  let out = raw;
  for (;;) {
    const before = out;
    out = out.replace(/[.,;:!?'"]+$/, "");
    if (unbalanced(out, "(", ")") || unbalanced(out, "[", "]") || unbalanced(out, "{", "}")) {
      out = out.slice(0, -1);
    }
    if (out === before) {
      return out;
    }
  }
}

/**
 * Whether a character is part of a word, for deciding that a match starts in
 * the middle of one. Anything outside ASCII counts: "música.com" is a word
 * with an accent in it, not the link "sica.com".
 */
function isWordChar(char: string): boolean {
  return /[a-z0-9_]/i.test(char) || char.charCodeAt(0) > 127;
}

function hrefFor(text: string): string {
  return /^https?:\/\//i.test(text) ? text : `https://${text}`;
}

/**
 * Text split into plain runs and links, in order. Joining every segment's
 * `text` gives back the input exactly.
 */
export function linkSegments(text: string): TextSegment[] {
  const out: TextSegment[] = [];
  let cursor = 0;
  LINK_PATTERN.lastIndex = 0;
  for (let match = LINK_PATTERN.exec(text); match; match = LINK_PATTERN.exec(text)) {
    const start = match.index;
    // An explicit http(s) link counts wherever it is. A bare host does not
    // when it is the middle of something else: either side of an email
    // address ("bob.dev@gmail.com" is neither bob.dev nor gmail.com), part of
    // a longer dotted name, or the tail of a word. Checked by hand rather than
    // with a lookbehind so the pattern does not depend on the engine.
    if (!/^https?:\/\//i.test(match[0])) {
      const before = start > 0 ? text[start - 1] : "";
      const after = text[start + match[0].length] ?? "";
      if (before === "@" || before === "." || (before && isWordChar(before)) || after === "@") {
        continue;
      }
    }
    const linkText = trimTrailing(match[0]);
    if (!linkText) {
      continue;
    }
    if (start > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, start) });
    }
    out.push({ kind: "link", text: linkText, href: hrefFor(linkText) });
    cursor = start + linkText.length;
    LINK_PATTERN.lastIndex = cursor;
  }
  if (cursor < text.length) {
    out.push({ kind: "text", text: text.slice(cursor) });
  }
  return out;
}

/** The first link in some text, as a fetchable URL, or null. */
export function firstLink(text: string): string | null {
  for (const segment of linkSegments(text)) {
    if (segment.kind === "link") {
      return segment.href;
    }
  }
  return null;
}

/**
 * Whether some text is nothing but this link, as a person would judge it:
 * case, scheme, "www." and a trailing slash do not count.
 */
export function isSameLink(text: string, url: string): boolean {
  const bare = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  return bare(text) !== "" && bare(text) === bare(url);
}

/** The host of a URL for display — "sfluv.org" — or the input if unparseable. */
export function hostOf(url: string): string {
  const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?#:]+)/i);
  return match?.[1] ?? url;
}
