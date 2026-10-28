import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

import type { AppBackendClient } from "./appBackend";

/**
 * Link card metadata, fetched by the client and cached on it.
 *
 * Every message containing a link renders its card from here, so the same URL
 * in twenty messages, or scrolled past twenty times, is fetched once. Three
 * layers, cheapest first:
 *
 * - **Memory**, read synchronously as the initial state, so a card that has
 *   been seen this session renders complete on the first frame instead of
 *   growing into place.
 * - **AsyncStorage**, for a week, so a cold start does not refetch every card
 *   in the thread it opens to.
 * - **The server**, which itself caches for twenty minutes, so a link dropped
 *   into a group is scraped once rather than once per member.
 *
 * A request in flight is shared, so a thread rendering one link six times
 * makes one request.
 *
 * ── Bounded on disk ─────────────────────────────────────────────────────────
 *
 * One storage entry holding at most MAX_STORED previews, oldest-saved dropped
 * first, expired ones swept when it is read. It used to be an entry per URL
 * that nothing ever deleted, and on Android every AsyncStorage key shares one
 * database of a few MB — past which every write in the app fails silently.
 */
export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  imageUrl: string;
  siteName: string;
}

const STORAGE_KEY = "sfluv-wallet:link-previews:v2";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * A page with no metadata, or one that refused us, is remembered briefly —
 * long enough not to hammer it while scrolling, short enough that a site which
 * was down gets another chance.
 */
const EMPTY_TTL_MS = 30 * 60 * 1000;
const MAX_STORED = 300;
const WRITE_DELAY_MS = 1000;

type Entry = { preview: LinkPreview; expires: number; savedAt: number };

const memory = new Map<string, Entry>();
const inFlight = new Map<string, Promise<LinkPreview>>();
/** URLs whose entry belongs on disk, as opposed to an offline failure. */
const persisted = new Set<string>();
let loaded: Promise<void> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function bare(url: string): LinkPreview {
  return { url, title: "", description: "", imageUrl: "", siteName: "" };
}

function isEmpty(preview: LinkPreview): boolean {
  return !preview.title && !preview.description && !preview.imageUrl && !preview.siteName;
}

function fresh(entry: Entry | undefined): entry is Entry {
  return Boolean(entry && entry.expires > Date.now());
}

/** Reads the stored previews once, dropping the expired ones as it goes. */
function loadStored(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        const stored = raw ? (JSON.parse(raw) as Record<string, Entry>) : {};
        for (const [url, entry] of Object.entries(stored)) {
          if (fresh(entry) && !memory.has(url)) {
            memory.set(url, entry);
            persisted.add(url);
          }
        }
      })
      .catch(() => {});
  }
  return loaded;
}

function scheduleWrite() {
  if (writeTimer) {
    clearTimeout(writeTimer);
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const kept = [...persisted]
      .map((url) => [url, memory.get(url)] as const)
      .filter((pair): pair is readonly [string, Entry] => fresh(pair[1]))
      .sort((a, b) => b[1].savedAt - a[1].savedAt)
      .slice(0, MAX_STORED);
    persisted.clear();
    kept.forEach(([url]) => persisted.add(url));
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept))).catch(() => {});
  }, WRITE_DELAY_MS);
}

/** What is already known about a URL, without doing any work. */
export function peekLinkPreview(url: string): LinkPreview | null {
  const entry = memory.get(url);
  return fresh(entry) ? entry.preview : null;
}

function remember(url: string, preview: LinkPreview, persist: boolean) {
  const now = Date.now();
  memory.set(url, { preview, expires: now + (isEmpty(preview) ? EMPTY_TTL_MS : TTL_MS), savedAt: now });
  if (persist) {
    persisted.add(url);
    scheduleWrite();
  }
}

async function load(client: AppBackendClient, url: string): Promise<LinkPreview> {
  await loadStored();
  const stored = peekLinkPreview(url);
  if (stored) {
    return stored;
  }
  try {
    const meta = await client.previewLink(url);
    const preview: LinkPreview = {
      url: meta.url || url,
      title: meta.title,
      description: meta.description,
      imageUrl: meta.image_url,
      siteName: meta.site_name,
    };
    remember(url, preview, true);
    return preview;
  } catch {
    // Offline, or the server refused the URL. Remembered in memory only, so
    // the card stops retrying for this session but a later one tries again.
    const preview = bare(url);
    remember(url, preview, false);
    return preview;
  }
}

/** Forgets every preview — on sign-out, with the rest of the chat caches. */
export async function clearLinkPreviews() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  memory.clear();
  persisted.clear();
  loaded = null;
  await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
}

/** A URL's card metadata: null until known, then the preview (possibly bare). */
export function useLinkPreview(client: AppBackendClient | null, url: string | null): LinkPreview | null {
  const [preview, setPreview] = useState<LinkPreview | null>(() => (url ? peekLinkPreview(url) : null));

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    const known = peekLinkPreview(url);
    if (known) {
      setPreview(known);
      return;
    }
    setPreview(null);
    if (!client) {
      return;
    }
    let cancelled = false;
    let pending = inFlight.get(url);
    if (!pending) {
      pending = load(client, url).finally(() => inFlight.delete(url));
      inFlight.set(url, pending);
    }
    void pending.then((next) => {
      if (!cancelled) {
        setPreview(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, url]);

  return preview;
}
