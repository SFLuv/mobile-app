import type { MessageMention } from "../types/bulletin";

/**
 * @-tags in chat, Telegram style.
 *
 * ── What is stored ──────────────────────────────────────────────────────────
 *
 * The body keeps plain text, "@Maria are you coming?", so an older app, the
 * web and the push all read it as written. Beside it the message carries who
 * each tag is: a span of the body (UTF-16 offsets, JavaScript's own string
 * indexing) and a user id. Each reader's app then draws the tag with the name
 * THEY saved that person as, falling back to what was typed.
 *
 * ── How a tag gets into a message ───────────────────────────────────────────
 *
 * Typing "@" and some letters offers the group's members; picking one replaces
 * the "@letters" with "@Name ". The picks are remembered, and at send time each
 * one is found in the text again. Finding rather than tracking offsets through
 * every keystroke means an edit anywhere in the draft cannot leave a tag
 * pointing at the wrong words, and a tag the person deleted simply is not
 * found, so it is not sent.
 */

/** A person picked from the suggestions, and the text that was inserted for them. */
export type MentionPick = { userId: string; label: string };

/** The "@letters" being typed at the caret, if any. */
export type ActiveMention = { start: number; query: string };

const MAX_QUERY = 32;

/**
 * The tag being typed at the caret: an "@" at the start or after a space, and
 * no space between it and the caret. Null when the caret is anywhere else.
 */
export function activeMention(text: string, caret: number): ActiveMention | null {
  const end = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, end);
  const match = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!match || match[2].length > MAX_QUERY) {
    return null;
  }
  return { start: end - match[2].length - 1, query: match[2] };
}

/** The draft with the "@letters" at `active` replaced by "@label ", and where the caret goes. */
export function insertMention(
  text: string,
  active: ActiveMention,
  label: string,
): { text: string; caret: number } {
  const queryEnd = active.start + 1 + active.query.length;
  const inserted = `@${label} `;
  // Swallow a space that was already there, rather than leave two.
  const rest = text.slice(queryEnd).replace(/^ /, "");
  return { text: text.slice(0, active.start) + inserted + rest, caret: active.start + inserted.length };
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/**
 * The tags in `body` for the people picked while writing it, in order. Each
 * pick is matched to the first "@label" not already taken, standing on its own
 * (not the start of a longer word). A pick whose text was deleted is dropped.
 */
export function collectMentions(body: string, picks: MentionPick[]): MessageMention[] {
  const taken: Array<[number, number]> = [];
  const mentions: MessageMention[] = [];
  const seen = new Set<string>();
  for (const pick of picks) {
    const needle = `@${pick.label}`;
    let from = 0;
    while (from <= body.length) {
      const at = body.indexOf(needle, from);
      if (at < 0) {
        break;
      }
      const end = at + needle.length;
      const startsClean = at === 0 || /\s/.test(body[at - 1]);
      const endsClean = end >= body.length || !WORD_CHAR.test(body[end]);
      const overlaps = taken.some(([s, e]) => at < e && end > s);
      if (startsClean && endsClean && !overlaps) {
        const key = `${pick.userId}:${at}`;
        if (!seen.has(key)) {
          seen.add(key);
          taken.push([at, end]);
          mentions.push({ user_id: pick.userId, offset: at, length: needle.length });
        }
        break;
      }
      from = at + 1;
    }
  }
  return mentions.sort((a, b) => a.offset - b.offset).slice(0, 50);
}

/** The picks a message was sent with, so editing it keeps its tags. */
export function picksFromMessage(body: string, mentions: MessageMention[] | undefined): MentionPick[] {
  return validMentions(body, mentions).map((mention) => ({
    userId: mention.user_id,
    label: body.slice(mention.offset + 1, mention.offset + mention.length),
  }));
}

/** Mentions that fit the body, in order, without overlaps. Anything else is ignored. */
export function validMentions(body: string, mentions: MessageMention[] | undefined): MessageMention[] {
  if (!mentions || mentions.length === 0) {
    return [];
  }
  const sorted = [...mentions]
    .filter(
      (m) =>
        Number.isInteger(m.offset) &&
        Number.isInteger(m.length) &&
        m.offset >= 0 &&
        m.length > 1 &&
        m.offset + m.length <= body.length &&
        typeof m.user_id === "string" &&
        m.user_id !== "",
    )
    .sort((a, b) => a.offset - b.offset);
  const kept: MessageMention[] = [];
  let lastEnd = 0;
  for (const mention of sorted) {
    if (mention.offset >= lastEnd) {
      kept.push(mention);
      lastEnd = mention.offset + mention.length;
    }
  }
  return kept;
}

export type MentionSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; text: string; userId: string };

/**
 * The body cut into plain text and tags, each tag written "@<name>" with the
 * name this reader saved that person as (nameFor), or what was typed.
 */
export function mentionSegments(
  body: string,
  mentions: MessageMention[] | undefined,
  nameFor: (userId: string, fallback: string) => string,
): MentionSegment[] {
  const valid = validMentions(body, mentions);
  if (valid.length === 0) {
    return [{ kind: "text", text: body }];
  }
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const mention of valid) {
    if (mention.offset > cursor) {
      segments.push({ kind: "text", text: body.slice(cursor, mention.offset) });
    }
    const typed = body.slice(mention.offset + 1, mention.offset + mention.length);
    segments.push({ kind: "mention", text: `@${nameFor(mention.user_id, typed)}`, userId: mention.user_id });
    cursor = mention.offset + mention.length;
  }
  if (cursor < body.length) {
    segments.push({ kind: "text", text: body.slice(cursor) });
  }
  return segments;
}

/** The body as one string with each tag in this reader's names, for a preview line. */
export function bodyWithMentionNames(
  body: string,
  mentions: MessageMention[] | undefined,
  nameFor: (userId: string, fallback: string) => string,
): string {
  return mentionSegments(body, mentions, nameFor)
    .map((segment) => segment.text)
    .join("");
}
