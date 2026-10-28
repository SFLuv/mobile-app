import { Directory, File, Paths } from "expo-file-system";
import { useCallback, useEffect, useState } from "react";

import type { MessageAttachment } from "../types/bulletin";
import type { AppBackendClient } from "./appBackend";

/**
 * Photos and files from chats, kept on the device once downloaded.
 *
 * ── What is cached, and what is not ─────────────────────────────────────────
 *
 * Message TEXT is cached aggressively, elsewhere (chatCache.ts): it is small,
 * it is what a thread is, and a thread should open from disk. Attachment BYTES
 * are a different trade. They are large, most are looked at once, and fetching
 * every photo in every thread to warm a cache would spend somebody's data on
 * pictures they scroll past. So bytes are cached only once something actually
 * asked for them, and an attachment that is not on the device says so — a
 * proper "not downloaded" card with its size and a tap to fetch it, instead of
 * a spinner that never resolves or a broken-image box.
 *
 * Photos under AUTO_DOWNLOAD_MAX_BYTES fetch themselves when shown, which is
 * what anybody expects of a photo in a chat; larger ones, and every file, wait
 * to be asked.
 *
 * ── Why a native download ───────────────────────────────────────────────────
 *
 * `File.downloadFileAsync` streams to disk on the native side with our auth
 * headers. The previous path pulled the bytes through `fetch`, base64-encoded
 * them on the JS thread and wrote the string — a third again as much memory as
 * the file, built synchronously, with the whole UI waiting on it.
 *
 * Under the cache directory, so the OS can reclaim space when it needs to; the
 * card then simply reads as not downloaded again, which is the truth.
 */

/** Photos up to this size download as soon as they are on screen. */
export const AUTO_DOWNLOAD_MAX_BYTES = 8 * 1024 * 1024;

let directory: Directory | null = null;

function cacheDirectory(): Directory {
  if (!directory) {
    directory = new Directory(Paths.cache, "chat-attachments");
  }
  if (!directory.exists) {
    directory.create({ intermediates: true, idempotent: true });
  }
  return directory;
}

function extensionOf(attachment: MessageAttachment): string {
  const fromName = attachment.file_name?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (fromName) {
    return fromName.toLowerCase();
  }
  const fromType = attachment.content_type?.split("/")[1]?.split(/[;+]/)[0];
  return fromType && /^[a-z0-9]{1,8}$/i.test(fromType) ? fromType.toLowerCase() : "bin";
}

/**
 * Keyed by conversation and attachment id, which never change, with the real
 * extension so a PDF previewer or the share sheet recognises the file.
 */
function fileFor(conversationId: number, attachment: MessageAttachment): File {
  return new File(cacheDirectory(), `${conversationId}-${attachment.id}.${extensionOf(attachment)}`);
}

/** The local copy's URI, or null if it is not on this device. Synchronous. */
export function localAttachmentUri(conversationId: number, attachment: MessageAttachment): string | null {
  try {
    const file = fileFor(conversationId, attachment);
    return file.exists && (file.size ?? 0) > 0 ? file.uri : null;
  } catch {
    return null;
  }
}

/** Deletes every cached attachment — on sign-out, so the next person's cache starts empty. */
export function clearAttachmentCache() {
  try {
    const dir = new Directory(Paths.cache, "chat-attachments");
    if (dir.exists) {
      dir.delete();
    }
    directory = null;
    const named = new Directory(Paths.cache, "named");
    if (named.exists) {
      named.delete();
    }
  } catch {
    // The OS can reclaim the cache itself; failing to clear it early is not fatal.
  }
}

/** Drops the local copy — used when the one on disk turned out to be unreadable. */
export function forgetAttachment(conversationId: number, attachment: MessageAttachment) {
  try {
    const file = fileFor(conversationId, attachment);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Nothing to forget, or nothing we can do about it.
  }
}

const inFlight = new Map<string, Promise<string>>();
const listeners = new Map<string, Set<(uri: string) => void>>();

function keyOf(conversationId: number, attachmentId: number): string {
  return `${conversationId}:${attachmentId}`;
}

/**
 * Downloads an attachment into the cache, or returns the copy already there.
 *
 * Shared while in flight, so a photo shown twice on screen, or tapped twice,
 * downloads once; and every card showing it is told when it lands.
 */
export function downloadAttachment(
  client: AppBackendClient,
  conversationId: number,
  attachment: MessageAttachment,
): Promise<string> {
  // In flight first: during a download the target does not exist yet (see
  // below), but checking the disk first was how a half-finished file used to
  // be handed out as complete.
  const key = keyOf(conversationId, attachment.id);
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }
  const existing = localAttachmentUri(conversationId, attachment);
  if (existing) {
    return Promise.resolve(existing);
  }
  const task = (async () => {
    const headers = await client.getImageAuthHeaders();
    if (!headers) {
      throw new Error("Sign in again to download this.");
    }
    const target = fileFor(conversationId, attachment);
    // ── Into a .part file, moved into place only when complete ─────────────
    //
    // On Android, expo-file-system streams straight into the destination, so
    // a connection lost half-way left a truncated file at the real name —
    // and every later look saw a file of non-zero size and called it
    // downloaded: "On this device" on a broken PDF, forever. iOS downloads to
    // a temporary file itself; doing it here makes both platforms the same.
    const partial = new File(cacheDirectory(), `${target.name}.part`);
    try {
      if (partial.exists) {
        partial.delete();
      }
      const file = await File.downloadFileAsync(
        client.conversationAttachmentURL(conversationId, attachment.id),
        partial,
        { headers, idempotent: true },
      );
      if (target.exists) {
        target.delete();
      }
      file.move(target);
    } catch (error) {
      try {
        if (partial.exists) {
          partial.delete();
        }
      } catch {
        // Nothing more to tidy.
      }
      throw error;
    }
    for (const listener of listeners.get(key) ?? []) {
      listener(target.uri);
    }
    return target.uri;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

/**
 * Puts a file the person already has — one they just sent — into the cache
 * under the attachment it became, so their own photo shows from disk at once
 * instead of being downloaded back from the server it was uploaded to.
 */
export function seedAttachment(conversationId: number, attachment: MessageAttachment, localUri: string) {
  try {
    const target = fileFor(conversationId, attachment);
    if (target.exists) {
      return;
    }
    new File(localUri).copy(target);
  } catch {
    // Only a head start. The card downloads it like anything else.
  }
}

export type AttachmentFileState =
  | { status: "cached"; uri: string }
  | { status: "downloading" }
  | { status: "not-downloaded" }
  | { status: "failed"; message: string };

/**
 * An attachment's on-device state, and a way to fetch it.
 *
 * `auto` starts the download as soon as the card mounts, for photos small
 * enough that asking would be fussy.
 */
export function useAttachmentFile(
  client: AppBackendClient | null,
  conversationId: number,
  attachment: MessageAttachment,
  auto: boolean,
): { state: AttachmentFileState; download: () => void } {
  const [state, setState] = useState<AttachmentFileState>(() => {
    const uri = localAttachmentUri(conversationId, attachment);
    return uri ? { status: "cached", uri } : { status: "not-downloaded" };
  });

  const download = useCallback(() => {
    if (!client) {
      return;
    }
    setState({ status: "downloading" });
    downloadAttachment(client, conversationId, attachment)
      .then((uri) => setState({ status: "cached", uri }))
      .catch((e: unknown) =>
        setState({
          status: "failed",
          message: e instanceof Error && e.message ? e.message : "Couldn't download this.",
        }),
      );
    // attachment.id identifies the attachment; the object itself is rebuilt on
    // every thread read and must not restart the download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, client, conversationId]);

  // Another card finishing the same download updates this one too.
  useEffect(() => {
    const key = keyOf(conversationId, attachment.id);
    const listener = (uri: string) => setState({ status: "cached", uri });
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) {
        listeners.delete(key);
      }
    };
  }, [attachment.id, conversationId]);

  useEffect(() => {
    const uri = localAttachmentUri(conversationId, attachment);
    if (uri) {
      setState({ status: "cached", uri });
      return;
    }
    if (auto && client) {
      download();
    }
    // Same reasoning as above: keyed on the id, not the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, auto, client, conversationId, download]);

  return { state, download };
}
