import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import type { ChatMessage, Conversation } from "../types/bulletin";

/**
 * The inbox and recent threads, on disk, so Messages opens on what was there
 * last time instead of a spinner.
 *
 * ── Text, aggressively ──────────────────────────────────────────────────────
 *
 * A conversation's text is small and it is the conversation, so it is kept:
 * the inbox, and the newest THREAD_KEEP messages of the THREAD_LIMIT threads
 * opened most recently. Opening either draws the cached copy on the first
 * frame — from memory if it has been seen this session, from disk otherwise —
 * and the network replaces it behind. Attachment bytes are not here; see
 * attachmentCache.ts for why they are fetched on demand instead.
 *
 * ── Why caching this is safe ────────────────────────────────────────────────
 *
 * It authorises nothing: every read is still answered by the server, which is
 * what replaces this the moment it replies. Two people can share a phone, so
 * every entry carries the id of whoever it belongs to and reads as empty for
 * anybody else; signing out deletes the signed-out person's entries outright.
 *
 * Writes are debounced, so a thread receiving a burst of messages is written
 * once rather than once per message.
 */

const PREFIX = "sfluv-wallet:chat-cache:v1:";
const INBOX_KEY = `${PREFIX}inbox`;
const INDEX_KEY = `${PREFIX}threads`;
const threadKey = (conversationId: number) => `${PREFIX}thread:${conversationId}`;

/** Messages kept per thread — the newest ones, which is what a thread opens on. */
const THREAD_KEEP = 120;
/**
 * Bytes kept per thread, whatever the count. Messages run to 2,000 characters
 * and replies repeat what they quote, so 120 of them can be hundreds of KB;
 * thirty such threads would exceed Android's whole AsyncStorage database, and
 * past that every write in the app fails silently. Oldest dropped first.
 */
const THREAD_MAX_BYTES = 60_000;
/** Threads kept on disk. Android's AsyncStorage is capped at a few MB in all. */
const THREAD_LIMIT = 30;
const INBOX_KEEP = 200;
const WRITE_DELAY_MS = 400;

type StoredInbox = { userId: string; conversations: Conversation[]; savedAt: number };
export type CachedThread = {
  userId: string;
  conversation: Conversation | null;
  messages: ChatMessage[];
  hasMore: boolean;
  savedAt: number;
};
type ThreadIndex = { userId: string; ids: number[] };

let userId: string | null = null;
let inbox: StoredInbox | null = null;
/** See noteThreadNewest. */
let threadNewest = new Map<number, ChatMessage>();
let threadNewestVersion = 0;
const threadNewestListeners = new Set<() => void>();
const threads = new Map<number, CachedThread>();
let index: ThreadIndex | null = null;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function writeLater(key: string, value: () => unknown) {
  const pending = timers.get(key);
  if (pending) {
    clearTimeout(pending);
  }
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void AsyncStorage.setItem(key, JSON.stringify(value())).catch(() => {});
    }, WRITE_DELAY_MS),
  );
}

/**
 * Reads the inbox into memory before anything renders, so the Messages tab can
 * draw it synchronously. Called once at launch, beside the beta cache.
 */
export async function primeChatCache(): Promise<void> {
  try {
    const [rawInbox, rawIndex] = await Promise.all([
      AsyncStorage.getItem(INBOX_KEY),
      AsyncStorage.getItem(INDEX_KEY),
    ]);
    inbox = rawInbox ? (JSON.parse(rawInbox) as StoredInbox) : null;
    index = rawIndex ? (JSON.parse(rawIndex) as ThreadIndex) : null;
  } catch {
    inbox = null;
    index = null;
  }
}

/**
 * Who the cache is for. Set as soon as sign-in knows, which is well before the
 * profile has loaded; until then every read is a miss.
 */
export function setChatCacheUser(next: string | null) {
  if (next === userId) {
    return;
  }
  userId = next;
  threads.clear();
  threadNewest = new Map();
}

/** Deletes everything cached for somebody — on sign-out. */
export async function clearChatCache(_forUser: string | null) {
  for (const pending of timers.values()) {
    clearTimeout(pending);
  }
  timers.clear();
  threads.clear();
  threadNewest = new Map();
  inbox = null;
  index = null;
  // Nobody, until sign-in says otherwise, so a save racing the sign-out cannot
  // write the cleared data straight back.
  userId = null;
  // By prefix rather than from the index: a thread saved for somebody whose
  // index was replaced by the next person's is not in the index any more, and
  // would otherwise stay on disk for good.
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((key) => key.startsWith(PREFIX)));
  } catch {
    // Best effort; the entries carry their owner and read as empty for anyone else.
  }
}

/** The cached inbox for whoever is signed in, or null. Synchronous. */
export function cachedInbox(): Conversation[] | null {
  return userId && inbox?.userId === userId ? inbox.conversations : null;
}

export function saveInbox(conversations: Conversation[]) {
  if (!userId) {
    return;
  }
  inbox = { userId, conversations: conversations.slice(0, INBOX_KEEP), savedAt: Date.now() };
  const snapshot = inbox;
  writeLater(INBOX_KEY, () => snapshot);
}

/** A thread seen this session, synchronously, or null. */
export function cachedThreadNow(conversationId: number): CachedThread | null {
  const entry = threads.get(conversationId);
  return entry && entry.userId === userId ? entry : null;
}

/** A thread from memory or disk, or null. */
export async function cachedThread(conversationId: number): Promise<CachedThread | null> {
  const now = cachedThreadNow(conversationId);
  if (now || !userId) {
    return now;
  }
  try {
    const raw = await AsyncStorage.getItem(threadKey(conversationId));
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as CachedThread;
    if (stored.userId !== userId) {
      return null;
    }
    // A save from the network may have landed while the disk was being read;
    // that copy is newer and wins.
    const fresher = threads.get(conversationId);
    if (fresher && fresher.userId === userId) {
      return fresher;
    }
    threads.set(conversationId, stored);
    return stored;
  } catch {
    return null;
  }
}

export function saveThread(
  conversationId: number,
  value: { conversation: Conversation | null; messages: ChatMessage[]; hasMore: boolean },
) {
  if (!userId) {
    return;
  }
  let kept = value.messages.slice(-THREAD_KEEP);
  while (kept.length > 20 && JSON.stringify(kept).length > THREAD_MAX_BYTES) {
    kept = kept.slice(Math.ceil(kept.length / 4));
  }
  const entry: CachedThread = {
    userId,
    conversation: value.conversation,
    messages: kept,
    // Trimmed means there is more on the server even if the last page said not.
    hasMore: value.hasMore || kept.length < value.messages.length,
    savedAt: Date.now(),
  };
  threads.set(conversationId, entry);
  writeLater(threadKey(conversationId), () => entry);

  // Most-recently-saved first; the oldest past the limit are evicted.
  const ids = [conversationId, ...((index?.userId === userId ? index.ids : []) ?? []).filter((id) => id !== conversationId)];
  const evicted = ids.slice(THREAD_LIMIT);
  index = { userId, ids: ids.slice(0, THREAD_LIMIT) };
  const snapshot = index;
  writeLater(INDEX_KEY, () => snapshot);
  if (evicted.length > 0) {
    void AsyncStorage.multiRemove(evicted.map(threadKey)).catch(() => {});
  }
}

/**
 * A message sent from outside the thread — the share sheet — put into the
 * cached thread, so opening the chat shows it on the first frame. In memory
 * only: the thread writes itself to disk once it has its own copy from the
 * server, and the first page it fetches replaces this. Without a cached thread
 * it starts one, with the inbox's copy of the conversation for the header.
 */
export function noteSentMessage(conversationId: number, message: ChatMessage) {
  if (!userId) {
    return;
  }
  const entry = cachedThreadNow(conversationId);
  const messages = entry?.messages ?? [];
  if (messages.some((existing) => existing.id === message.id)) {
    return;
  }
  threads.set(conversationId, {
    userId,
    conversation: entry?.conversation ?? cachedConversation(conversationId),
    messages: [...messages, message].sort((left, right) => left.id - right.id),
    hasMore: entry?.hasMore ?? false,
    savedAt: Date.now(),
  });
}

/**
 * A message that arrived for a thread not on screen, put into that thread's
 * in-memory copy if there is one — so opening it from the in-app banner shows
 * the message that was announced, on the first frame. A thread with no copy in
 * memory is left alone: starting one with only this message would hide the
 * older history on disk until the fetch, and the chat's catching-up state
 * covers that case instead.
 */
export function mergeIntoCachedThread(conversationId: number, message: ChatMessage) {
  const entry = cachedThreadNow(conversationId);
  if (!entry || entry.messages.some((existing) => existing.id === message.id)) {
    return;
  }
  threads.set(conversationId, {
    ...entry,
    messages: [...entry.messages, message].sort((left, right) => left.id - right.id),
  });
}

/** A conversation's header data from the cache — its thread, or the inbox. */
export function cachedConversation(conversationId: number): Conversation | null {
  const fromThread = cachedThreadNow(conversationId)?.conversation;
  if (fromThread) {
    return fromThread;
  }
  return cachedInbox()?.find((conversation) => conversation.id === conversationId) ?? null;
}

/** Drops one thread — when it is deleted or left. */
export function forgetThread(conversationId: number) {
  threads.delete(conversationId);
  const pending = timers.get(threadKey(conversationId));
  if (pending) {
    clearTimeout(pending);
    timers.delete(threadKey(conversationId));
  }
  void AsyncStorage.removeItem(threadKey(conversationId)).catch(() => {});
}

/**
 * The newest message an open thread has, ahead of what the inbox last heard.
 *
 * ── Why the inbox lagged a send ─────────────────────────────────────────────
 *
 * The inbox re-reads itself on every socket frame, and the server never sends
 * the sender a frame for their own message: it has already answered them. So a
 * message you sent reached the inbox only on its next fifteen-second poll, and
 * going back to Messages showed the line before it.
 *
 * Now a thread on screen reports its newest message here, sent or received,
 * and the inbox draws it over the server's copy until a server answer has it
 * too. It is an overlay rather than a write into the cached inbox, so a server
 * read that was already in flight when you sent cannot put the old line back:
 * the overlay holds until a server answer at least as new as it arrives.
 */
export function noteThreadNewest(conversationId: number, message: ChatMessage) {
  if (!userId) {
    return;
  }
  const known = threadNewest.get(conversationId);
  if (known && known.id === message.id) {
    // The same message, edited or deleted since. The overlay follows the edit
    // and goes with the deletion, so the row never shows words that are gone.
    if (known === message) {
      return;
    }
    if (message.deleted) {
      threadNewest.delete(conversationId);
    } else {
      threadNewest.set(conversationId, message);
    }
    emitThreadNewest();
    return;
  }
  if (message.deleted) {
    return;
  }
  const inInbox = cachedInbox()?.find((conversation) => conversation.id === conversationId)?.last_message;
  if ((known && known.id > message.id) || (inInbox && inInbox.id >= message.id)) {
    return;
  }
  threadNewest.set(conversationId, message);
  emitThreadNewest();
}

function emitThreadNewest() {
  threadNewestVersion += 1;
  for (const listener of threadNewestListeners) {
    listener();
  }
}

/** Re-renders a component whenever an open thread reports a newer message. */
export function useThreadNewestVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      threadNewestListeners.add(listener);
      return () => {
        threadNewestListeners.delete(listener);
      };
    },
    () => threadNewestVersion,
  );
}

/** The inbox as it should be drawn: each thread's newer message in it, newest activity first. */
export function withThreadNewest(conversations: Conversation[]): Conversation[] {
  if (threadNewest.size === 0) {
    return conversations;
  }
  let changed = false;
  const next = conversations.map((conversation) => {
    const newer = threadNewest.get(conversation.id);
    if (!newer || (conversation.last_message?.id ?? 0) >= newer.id) {
      return conversation;
    }
    changed = true;
    // A reaction is shown only while it is newer than the last message, and
    // this message is newer than it.
    return { ...conversation, last_message: newer, last_message_at: newer.created_at, latest_reaction: undefined };
  });
  if (!changed) {
    return conversations;
  }
  // The server's order: newest activity first, id breaking ties.
  return next.sort(
    (left, right) =>
      Date.parse(right.last_message_at) - Date.parse(left.last_message_at) || right.id - left.id,
  );
}

/** Drops what a server answer has caught up with. */
export function reconcileThreadNewest(conversations: Conversation[]) {
  for (const conversation of conversations) {
    const newer = threadNewest.get(conversation.id);
    if (newer && (conversation.last_message?.id ?? 0) >= newer.id) {
      threadNewest.delete(conversation.id);
    }
  }
}
