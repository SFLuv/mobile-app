import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { BulletinRequestError, type Conversation, type UnreadItem } from "../types/bulletin";

/**
 * Reads the server has not confirmed yet, so opening a chat clears it at once.
 *
 * ── The lag this removes ────────────────────────────────────────────────────
 *
 * A chat used to be marked read only after the thread's own fetch came back,
 * and the Messages badge was re-read from the server in the same instant the
 * read was sent — so the badge usually got its answer before the read had
 * landed, and kept the old count until the next poll. Opening a chat could
 * take fifteen seconds to register.
 *
 * Now the read is recorded here as soon as the thread is on screen, from the
 * cache, before any network. Everything that shows unread state draws through
 * it — the inbox rows, the Messages badge — and the server is told behind, and
 * told again until it says yes.
 *
 * ── A watermark, not a flag ─────────────────────────────────────────────────
 *
 * What is recorded is the newest message the person had in front of them. A
 * conversation counts as read while its newest message is no newer than that,
 * so a message arriving after the read shows as unread again without anything
 * here noticing, and a server answer from before the read cannot put the dot
 * back. The server is sent the same id, so it does not mark as read a message
 * that had reached it but not the screen.
 *
 * ── Until the server says yes ───────────────────────────────────────────────
 *
 * Unconfirmed reads are kept on disk, so one made just before the app was
 * closed is still shown, and still sent, on the next launch. A failure retries
 * with backoff and on every return to the foreground. A confirmed read stays
 * until a server answer shows it too, then goes. Like the chat cache, entries
 * belong to whoever made them and read as empty for anybody else.
 */

type Entry = {
  /** The newest message id read. */
  upTo: number;
  /** The newest the server has acknowledged. Caught up when equal to upTo. */
  confirmedUpTo: number;
  at: number;
};
type Stored = { userId: string; entries: Record<string, Entry> };
type Sender = (conversationId: number, upTo: number) => Promise<void>;

const KEY = "sfluv-wallet:pending-reads:v1";
const RETRY_MS = [1_000, 3_000, 10_000, 30_000, 60_000];
/** A read the server never confirmed is still worth sending for this long. */
const UNCONFIRMED_KEEP_MS = 7 * 24 * 60 * 60_000;
/** A confirmed one waiting on a server answer to agree with it. */
const CONFIRMED_KEEP_MS = 24 * 60 * 60_000;
const WRITE_DELAY_MS = 300;

let userId: string | null = null;
let stored: Stored | null = null;
let entries = new Map<number, Entry>();
let version = 0;
let sender: Sender | null = null;
const inFlight = new Set<number>();
const attempts = new Map<number, number>();
const retryTimers = new Map<number, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const confirmedListeners = new Set<(conversationId: number) => void>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let foregroundSubscription: { remove: () => void } | null = null;

function emit() {
  version += 1;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function persist() {
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (!userId) {
      return;
    }
    const value: Stored = { userId, entries: Object.fromEntries([...entries].map(([id, e]) => [String(id), e])) };
    stored = value;
    void AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => {});
  }, WRITE_DELAY_MS);
}

function caughtUp(entry: Entry) {
  return entry.confirmedUpTo >= entry.upTo;
}

/** Loads what is on disk for whoever signs in, and drops what has gone stale. */
function adoptStored() {
  if (!userId || !stored || stored.userId !== userId) {
    return;
  }
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of Object.entries(stored.entries)) {
    const id = Number(key);
    const keep = caughtUp(entry) ? CONFIRMED_KEEP_MS : UNCONFIRMED_KEEP_MS;
    if (!Number.isFinite(id) || now - entry.at > keep) {
      continue;
    }
    const current = entries.get(id);
    if (!current || current.upTo < entry.upTo) {
      entries.set(id, entry);
      changed = true;
    }
  }
  if (changed) {
    emit();
    flushPendingReads();
  }
}

/** Read from disk at launch, beside the chat cache. */
export async function primePendingReads(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    stored = raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    stored = null;
  }
  adoptStored();
}

/** Who the reads are for. Called during render, beside setChatCacheUser. */
export function setPendingReadsUser(next: string | null) {
  if (next === userId) {
    return;
  }
  userId = next;
  entries = new Map();
  for (const timer of retryTimers.values()) {
    clearTimeout(timer);
  }
  retryTimers.clear();
  attempts.clear();
  adoptStored();
}

/** On sign-out: nothing of this person's is sent on somebody else's session. */
export async function clearPendingReads() {
  userId = null;
  stored = null;
  entries = new Map();
  for (const timer of retryTimers.values()) {
    clearTimeout(timer);
  }
  retryTimers.clear();
  attempts.clear();
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  emit();
  await AsyncStorage.removeItem(KEY).catch(() => {});
}

/**
 * How reads reach the server, or null while there is no signed-in client.
 * Binding one sends whatever is waiting.
 */
export function bindReadSender(next: Sender | null) {
  sender = next;
  if (next && !foregroundSubscription) {
    let previous = AppState.currentState;
    foregroundSubscription = AppState.addEventListener("change", (state) => {
      if (previous !== "active" && state === "active") {
        flushPendingReads();
      }
      previous = state;
    });
  }
  if (next) {
    flushPendingReads();
  }
}

/** The thread is on screen with messages up to `upTo` in it. */
export function noteRead(conversationId: number, upTo: number) {
  if (!userId || !conversationId || !(upTo > 0)) {
    return;
  }
  const current = entries.get(conversationId);
  if (current && current.upTo >= upTo) {
    return;
  }
  entries.set(conversationId, { upTo, confirmedUpTo: current?.confirmedUpTo ?? 0, at: Date.now() });
  emit();
  persist();
  send(conversationId);
}

function send(conversationId: number) {
  const entry = entries.get(conversationId);
  if (!sender || !entry || caughtUp(entry) || inFlight.has(conversationId) || retryTimers.has(conversationId)) {
    return;
  }
  const forUser = userId;
  const upTo = entry.upTo;
  inFlight.add(conversationId);
  sender(conversationId, upTo).then(
    () => {
      inFlight.delete(conversationId);
      if (userId !== forUser) {
        return;
      }
      attempts.delete(conversationId);
      const now = entries.get(conversationId);
      if (now) {
        now.confirmedUpTo = Math.max(now.confirmedUpTo, upTo);
        persist();
      }
      for (const listener of confirmedListeners) {
        listener(conversationId);
      }
      // A newer read noted while this one was in flight.
      send(conversationId);
    },
    (error: unknown) => {
      inFlight.delete(conversationId);
      if (userId !== forUser) {
        return;
      }
      // Not a member any more, or the thread is gone: there is nothing to
      // mark, and retrying would only fail forever.
      if (error instanceof BulletinRequestError && (error.status === 403 || error.status === 404)) {
        entries.delete(conversationId);
        attempts.delete(conversationId);
        emit();
        persist();
        return;
      }
      const attempt = attempts.get(conversationId) ?? 0;
      attempts.set(conversationId, attempt + 1);
      const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)];
      retryTimers.set(
        conversationId,
        setTimeout(() => {
          retryTimers.delete(conversationId);
          send(conversationId);
        }, delay),
      );
    },
  );
}

/** Sends every read still waiting. On binding a client and on foreground. */
export function flushPendingReads() {
  for (const [conversationId, timer] of retryTimers) {
    clearTimeout(timer);
    retryTimers.delete(conversationId);
  }
  for (const conversationId of entries.keys()) {
    send(conversationId);
  }
}

/** After the server confirms a read — the moment its own counts agree. */
export function onReadConfirmed(listener: (conversationId: number) => void) {
  confirmedListeners.add(listener);
  return () => {
    confirmedListeners.delete(listener);
  };
}

/** Re-renders a component whenever a read is noted, confirmed or dropped. */
export function usePendingReadsVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

function readThrough(conversationId: number): number {
  return entries.get(conversationId)?.upTo ?? 0;
}

/** The inbox as it should be drawn: read here means read, whatever the server last said. */
export function applyPendingReads(conversations: Conversation[]): Conversation[] {
  if (entries.size === 0) {
    return conversations;
  }
  return conversations.map((conversation) =>
    conversation.unread_count > 0 && (conversation.last_message?.id ?? 0) <= readThrough(conversation.id)
      ? { ...conversation, unread_count: 0 }
      : conversation,
  );
}

/** The summary's unread conversations, less those read here. */
export function countUnread(items: UnreadItem[]): number {
  return items.filter((item) => item.last_message_id > readThrough(item.conversation_id)).length;
}

/**
 * Forgets confirmed reads a server answer now agrees with — read there, or
 * overtaken by a newer message. Unconfirmed ones are kept: the server still
 * has to be told.
 */
export function reconcileWithInbox(conversations: Conversation[]) {
  let changed = false;
  for (const conversation of conversations) {
    const entry = entries.get(conversation.id);
    if (!entry || !caughtUp(entry)) {
      continue;
    }
    if (conversation.unread_count === 0 || (conversation.last_message?.id ?? 0) > entry.upTo) {
      entries.delete(conversation.id);
      changed = true;
    }
  }
  if (changed) {
    emit();
    persist();
  }
}

/** The summary's version of the same: a conversation it does not list is read. */
export function reconcileWithSummary(items: UnreadItem[]) {
  const unread = new Map(items.map((item) => [item.conversation_id, item.last_message_id]));
  let changed = false;
  for (const [conversationId, entry] of entries) {
    if (!caughtUp(entry)) {
      continue;
    }
    const newest = unread.get(conversationId);
    if (newest === undefined || newest > entry.upTo) {
      entries.delete(conversationId);
      changed = true;
    }
  }
  if (changed) {
    emit();
    persist();
  }
}
