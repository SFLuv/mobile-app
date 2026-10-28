import { File, Paths } from "expo-file-system";
import type { ShareIntent } from "expo-share-intent";

import type { ShareTarget } from "../components/ShareSheet";

/**
 * What another app shared into SFLuv, as something the share sheet can send.
 *
 * A file wins over text when there are both — Photos sends the photo and a
 * caption-less text field; Safari sends a page as a web URL plus its title. A
 * page's title and URL become one line of text, title first, so the chat
 * renders the link's card under it. Nothing usable is null, and the share is
 * dropped quietly rather than opening an empty sheet.
 */
export function shareTargetFromIntent(intent: ShareIntent): ShareTarget | null {
  const files = (intent.files ?? [])
    .filter((file) => Boolean(file.path))
    .map((file) => ({
      uri: file.path,
      mimeType: file.mimeType || null,
      fileName: file.fileName || null,
      isImage: Boolean(file.mimeType?.startsWith("image/")),
    }));
  if (files.length > 0) {
    const first = files[0];
    const label =
      files.length > 1 ? `${files.length} files` : first.isImage ? "Photo" : first.fileName || "File";
    return { kind: "files", files, label };
  }

  const url = intent.webUrl?.trim() || "";
  // Safari's share puts the URL in `text` as well (the library does that for
  // compatibility) and the page's title in meta, so the title is read from
  // there when the text is only the URL again.
  const rawText = intent.text?.trim() || "";
  const text = rawText && rawText !== url ? rawText : intent.meta?.title?.trim() || "";
  if (url) {
    return { kind: "text", text: text && !text.includes(url) ? `${text}\n${url}` : text || url, label: "Link" };
  }
  if (text) {
    return { kind: "text", text, label: "Text" };
  }
  return null;
}

/**
 * Deletes the copies an extension handed over: on iOS in the app-group
 * container, which nothing else ever cleans; on Android, usually in the cache.
 *
 * Only ever a COPY. For a file shared from Android's Files app, expo-share-intent
 * can hand over the original's own path, and with storage permission granted
 * for saving photos, deleting it would delete the person's file. So nothing is
 * touched outside this app's cache or an app-group container.
 */
export function discardSharedFiles(uris: string[]) {
  for (const uri of uris) {
    const ours = uri.startsWith(Paths.cache.uri) || uri.includes("/Shared/AppGroup/");
    if (!ours) {
      continue;
    }
    try {
      const file = new File(uri);
      if (file.exists) {
        file.delete();
      }
    } catch {
      // Already gone, or not ours to delete. Either way nothing to do.
    }
  }
}
