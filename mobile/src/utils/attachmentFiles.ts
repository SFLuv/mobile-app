import { File, Paths } from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import * as Sharing from "expo-sharing";

import type { AppBackendClient } from "../services/appBackend";
import type { MessageAttachment } from "../types/bulletin";

/**
 * Getting an attachment off the server and onto the device.
 *
 * ── Why the bytes come down as base64 and not a direct download ─────────────
 *
 * The attachment route is authenticated, and `FileSystem.downloadAsync` cannot
 * carry our session the way `authFetch` does — it would need the token in a
 * header it does not let us set reliably. So the client fetches the bytes
 * through the same path everything else uses and writes them to the cache
 * itself. The cost is holding one file in memory; the cap on an attachment is
 * 25 MB, which is the ceiling on that.
 *
 * Two destinations, because they are genuinely different things to a person:
 * a photo belongs in their camera roll, and a document belongs wherever the
 * share sheet puts it. Saving a PDF to Photos would fail, and "downloading" a
 * picture into an app-private cache nobody can browse is not saving it.
 */

/**
 * A filename safe to write to disk, derived from what the sender called it.
 *
 * The sender's name has already been sanitised server-side; this guards the
 * local write specifically, and keeps the name recognisable so the share sheet
 * offers something a person can identify.
 */
function safeName(attachment: MessageAttachment): string {
  const raw = attachment.file_name?.trim() || `attachment-${attachment.id}`;
  return raw.replace(/[^\w.\- ]+/g, "_").slice(0, 120);
}

/** Writes an attachment into the app's cache and returns the local file URI. */
export async function cacheAttachment(
  client: AppBackendClient,
  conversationId: number,
  attachment: MessageAttachment,
): Promise<string> {
  const dataUri = await client.getConversationAttachmentDataUri(conversationId, attachment.id);
  if (!dataUri) {
    throw new Error("That file could not be downloaded.");
  }
  const base64 = dataUri.slice(dataUri.indexOf(",") + 1);
  // expo-file-system 19's object API. The older
  // `writeAsStringAsync(uri, ...)` helpers moved to `expo-file-system/legacy`
  // in this major; using the current API rather than the compatibility entry
  // keeps this off a deprecation path from the day it is written.
  const file = new File(Paths.cache, safeName(attachment));
  if (file.exists) {
    // A second save of the same attachment should overwrite rather than fail,
    // and rather than accumulate "1-name.pdf" copies in the cache.
    file.delete();
  }
  file.create();
  file.write(base64, { encoding: "base64" });
  return file.uri;
}

export type SaveOutcome =
  | { status: "saved-to-photos" }
  | { status: "shared" }
  | { status: "denied"; message: string }
  | { status: "failed"; message: string };

/**
 * Saves an attachment somewhere the person can get at it again.
 *
 * A photo goes to the camera roll, which needs permission and is the only
 * destination that counts as "saved" for an image. Anything else is handed to
 * the OS share sheet, which is how a document reaches Files, Drive, email or
 * whatever else they use — there is no single "downloads folder" on iOS to put
 * it in.
 */
export async function saveAttachment(
  client: AppBackendClient,
  conversationId: number,
  attachment: MessageAttachment,
): Promise<SaveOutcome> {
  let localUri: string;
  try {
    localUri = await cacheAttachment(client, conversationId, attachment);
  } catch (error) {
    return { status: "failed", message: (error as Error)?.message || "That file could not be downloaded." };
  }

  if (attachment.kind === "image") {
    const permission = await MediaLibrary.requestPermissionsAsync();
    if (!permission.granted) {
      // Refused rather than silently falling back to the share sheet: they
      // asked to save it to their photos, and a share sheet is a different
      // thing that would look like the save had worked.
      return {
        status: "denied",
        message: "SFLuv needs permission to add photos to your library.",
      };
    }
    try {
      await MediaLibrary.saveToLibraryAsync(localUri);
      return { status: "saved-to-photos" };
    } catch (error) {
      return { status: "failed", message: (error as Error)?.message || "Couldn't save that photo." };
    }
  }

  if (!(await Sharing.isAvailableAsync())) {
    return { status: "failed", message: "This device has nowhere to save that file." };
  }
  try {
    await Sharing.shareAsync(localUri, {
      mimeType: attachment.content_type || undefined,
      dialogTitle: attachment.file_name || "Save file",
    });
    return { status: "shared" };
  } catch (error) {
    return { status: "failed", message: (error as Error)?.message || "Couldn't save that file." };
  }
}

/**
 * The icon for a file, chosen from its type.
 *
 * Specific enough to be useful at a glance in the files list: a spreadsheet
 * should not look like a PDF, because "find the CSV Maria sent" is the errand
 * that list exists for.
 */
export function fileTypeIcon(attachment: MessageAttachment): {
  icon: string;
  label: string;
} {
  return fileTypeIconFor({
    contentType: attachment.content_type,
    fileName: attachment.file_name,
    isImage: attachment.kind === "image",
  });
}

/**
 * The same choice, for a file that is not an attachment yet.
 *
 * The composer stages local files before they are sent and wants the same icon
 * the thread will show once they are — so this takes the three fields the
 * decision actually needs rather than a server-shaped attachment.
 */
export function fileTypeIconFor({
  contentType,
  fileName,
  isImage,
}: {
  contentType?: string | null;
  fileName?: string | null;
  isImage?: boolean;
}): { icon: string; label: string } {
  const type = contentType ?? "";
  const name = (fileName ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  if (isImage || type.startsWith("image/")) {
    return { icon: "image", label: "Photo" };
  }
  if (type === "application/pdf" || ext === "pdf") {
    return { icon: "document-text", label: "PDF" };
  }
  if (type.includes("sheet") || type.includes("excel") || ext === "csv" || ext === "xlsx" || ext === "xls") {
    return { icon: "grid", label: ext === "csv" ? "CSV" : "Spreadsheet" };
  }
  if (type.includes("word") || ext === "doc" || ext === "docx" || ext === "rtf") {
    return { icon: "document", label: "Document" };
  }
  if (type.includes("presentation") || type.includes("powerpoint") || ext === "ppt" || ext === "pptx") {
    return { icon: "easel", label: "Slides" };
  }
  if (type === "application/zip" || ext === "zip") {
    return { icon: "archive", label: "Archive" };
  }
  if (type === "text/calendar" || ext === "ics") {
    return { icon: "calendar", label: "Calendar" };
  }
  if (type.startsWith("text/") || ext === "txt") {
    return { icon: "document-outline", label: "Text" };
  }
  return { icon: "document-outline", label: ext ? ext.toUpperCase() : "File" };
}
