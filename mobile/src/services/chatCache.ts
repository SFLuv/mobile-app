import AsyncStorage from "@react-native-async-storage/async-storage";

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
}

/** Deletes everything cached for somebody — on sign-out. */
export async function clearChatCache(_forUser: string | null) {
  for (const pending of timers.values()) {
    clearTimeout(pending);
  }
  timers.clear();
  threads.clear();
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
