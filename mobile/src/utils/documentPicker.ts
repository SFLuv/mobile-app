/**
 * Picking a file to attach, without making the module a hard dependency.
 *
 * ── Why this is loaded lazily ───────────────────────────────────────────────
 *
 * expo-document-picker has native code, so it only exists in a binary built
 * after it was added to package.json. A plain top-level import would throw on
 * any build made before that — including the 2.1 build in the store and every
 * copy of it already on a phone, which receive JavaScript updates over the air
 * but not new native modules.
 *
 * So it is required at the moment of use, inside a try, and a build without it
 * reports "unavailable" rather than crashing. The attachment tray turns that
 * into a line telling the person to update, which is a true and actionable
 * thing to say — unlike a crash, and unlike a button that silently does nothing.
 *
 * Photos do not go through here: expo-image-picker is already in the binary, so
 * sending a picture works on the build that is shipping now and only files wait
 * for the next one.
 */

export type PickedDocument = {
  uri: string;
  mimeType?: string | null;
  fileName?: string | null;
};

/** Returns the files chosen, or the sentinel "unavailable" on an older binary. */
export async function pickDocuments(): Promise<PickedDocument[] | "unavailable"> {
  let picker: typeof import("expo-document-picker") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    picker = require("expo-document-picker") as typeof import("expo-document-picker");
  } catch {
    return "unavailable";
  }
  if (!picker?.getDocumentAsync) {
    return "unavailable";
  }

  try {
    const result = await picker.getDocumentAsync({
      multiple: true,
      // Everything, filtered server-side against the allowlist in
      // app_chat_attachment.go. Restricting the picker here as well would mean
      // two lists to keep in step, and the one that matters for safety is the
      // server's.
      type: "*/*",
      // Copied into the app's cache so the URI is still readable when the
      // upload runs: a document-provider URI can expire the moment the picker
      // closes.
      copyToCacheDirectory: true,
    });
    if (result.canceled) {
      return [];
    }
    return result.assets.map((asset) => ({
      uri: asset.uri,
      mimeType: asset.mimeType,
      fileName: asset.name,
    }));
  } catch {
    // A picker that fails to open is the same as one that is not there, as far
    // as the caller can do anything about it.
    return "unavailable";
  }
}
