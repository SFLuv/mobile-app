import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Paths } from "expo-file-system";
import { WebView } from "react-native-webview";

import { AppBackendClient } from "../services/appBackend";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";
import { formatFileSize } from "./MessageAttachmentCard";
import { cacheAttachment, fileTypeIcon, saveAttachment } from "../utils/attachmentFiles";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { MessageAttachment } from "../types/bulletin";

/**
 * An attachment, full screen, with a way to keep it.
 *
 * ── What can actually be shown here ─────────────────────────────────────────
 *
 * Three renderers, picked from the attachment's type:
 *
 *   Photos        the image itself, loaded by the native image loader with our
 *                 session on the request — no base64, no JS-thread work.
 *   PDFs          a WebView over the downloaded file. WKWebView renders PDF
 *                 natively, so on iOS this is a real viewer: pages, scrolling,
 *                 pinch to zoom. Android's WebView does not render PDF at all,
 *                 so there it falls through to the card below rather than
 *                 showing a blank page that looks broken.
 *   Text and CSV  the text, in a monospaced scroll. These are text; showing a
 *                 document icon for a file whose whole content is three lines
 *                 of CSV was the silliest case of the old behaviour.
 *
 * Anything else — Word, Excel, PowerPoint, archives — genuinely cannot be
 * rendered without a converter, so it keeps the card that says what it is and
 * offers to hand it to an app that can open it.
 *
 * ── Why the download happens here and not in the thread ─────────────────────
 *
 * Nothing is fetched until this opens. A thread full of documents costs nothing
 * to scroll past; opening one is the deliberate act that pays for the bytes.
 */
export function AttachmentPreview({
  attachment,
  conversationId,
  client,
  senderName,
  onClose,
  onToast,
}: {
  /** The attachment to show, or null when closed. */
  attachment: MessageAttachment | null;
  conversationId: number;
  client: AppBackendClient | null;
  senderName?: string;
  onClose: () => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const kind = previewKind(attachment);

  useEffect(() => {
    setSource(null);
    setLocalUri(null);
    setText(null);
    setFailed(false);

    if (!attachment || !client || kind === "unsupported") {
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      if (kind === "image") {
        const value = await client.getConversationAttachmentSource(conversationId, attachment.id);
        if (!cancelled) {
          if (value) setSource(value);
          else setFailed(true);
        }
        return;
      }
      if (kind === "text") {
        const value = await client.getConversationAttachmentText(conversationId, attachment.id);
        if (!cancelled) {
          if (value !== null) setText(value);
          else setFailed(true);
        }
        return;
      }
      // PDF. The WebView needs a real file on disk rather than a stream, so the
      // bytes come down and are written to the cache first.
      const uri = await cacheAttachment(client, conversationId, attachment);
      if (!cancelled) {
        setLocalUri(uri);
      }
    };

    void load()
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attachment, client, conversationId, kind]);

  const save = async () => {
    if (!attachment || !client || saving) {
      return;
    }
    setSaving(true);
    try {
      const outcome = await saveAttachment(client, conversationId, attachment);
      switch (outcome.status) {
        case "saved-to-photos":
          onToast("Saved to your photos.", "success");
          break;
        case "shared":
          // No toast: the share sheet is its own confirmation, and one behind
          // it would land after the person has already moved on.
          break;
        case "denied":
        case "failed":
          onToast(outcome.message, "error");
          break;
      }
    } finally {
      setSaving(false);
    }
  };

  const typeInfo = attachment ? fileTypeIcon(attachment) : null;
  // The name belongs in the chrome for everything except a photo, where the
  // picture is self-evidently the content and a caption over it is in the way.
  const showTitle = Boolean(attachment) && kind !== "image";

  return (
    <Modal visible={Boolean(attachment)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {/* The backdrop closes; the content does not, so a tap on the document
            itself is not a dismissal. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.white} />
          </Pressable>
          {showTitle ? (
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {attachment?.file_name || "File"}
              </Text>
              <Text style={styles.headerMeta} numberOfLines={1}>
                {[typeInfo?.label, formatFileSize(attachment?.size_bytes)].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ) : null}
          <Pressable
            style={styles.saveButton}
            onPress={() => void save()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={kind === "image" ? "Save to photos" : "Save file"}
          >
            <Ionicons name="download-outline" size={17} color={palette.white} />
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>

        {attachment ? (
          loading ? (
            <ThemedActivityIndicator size="large" color={palette.white} />
          ) : failed ? (
            <FileCard
              attachment={attachment}
              typeInfo={typeInfo}
              senderName={senderName}
              hint="That file couldn't be downloaded. Try again, or save it to open elsewhere."
              styles={styles}
              palette={palette}
            />
          ) : kind === "image" && source ? (
            <Image source={source} style={styles.image} resizeMode="contain" />
          ) : kind === "text" && text !== null ? (
            <View style={styles.textSheet}>
              <ScrollView
                style={styles.textScroll}
                contentContainerStyle={styles.textContent}
                horizontal={false}
              >
                {/* Horizontal scroll inside the vertical one: a CSV row is
                    wider than a phone and wrapping it destroys the columns. */}
                <ScrollView horizontal showsHorizontalScrollIndicator>
                  <Text style={styles.textBody}>{text}</Text>
                </ScrollView>
              </ScrollView>
            </View>
          ) : kind === "pdf" && localUri ? (
            <View style={styles.docSheet}>
              <WebView
                source={{ uri: localUri }}
                style={styles.webview}
                originWhitelist={["*"]}
                // The file is in our own cache; WKWebView still has to be told
                // it may read from there.
                allowingReadAccessToURL={Paths.cache.uri}
                allowFileAccess
                allowFileAccessFromFileURLs
                allowUniversalAccessFromFileURLs
                startInLoadingState
                renderLoading={() => (
                  <View style={styles.webviewLoading}>
                    <ThemedActivityIndicator size="large" />
                  </View>
                )}
                onError={() => setFailed(true)}
              />
            </View>
          ) : (
            <FileCard
              attachment={attachment}
              typeInfo={typeInfo}
              senderName={senderName}
              hint="Save it to open in another app."
              styles={styles}
              palette={palette}
            />
          )
        ) : null}
      </View>
    </Modal>
  );
}

/** What this attachment can be rendered as. */
function previewKind(attachment: MessageAttachment | null): "image" | "pdf" | "text" | "unsupported" {
  if (!attachment) {
    return "unsupported";
  }
  if (attachment.kind === "image" || attachment.content_type?.startsWith("image/")) {
    return "image";
  }
  const type = attachment.content_type ?? "";
  const name = (attachment.file_name ?? "").toLowerCase();
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";

  if (type === "application/pdf" || ext === "pdf") {
    // Android's WebView has no PDF renderer, so there is nothing to render into
    // on that platform — the card and the share sheet are the honest answer.
    return Platform.OS === "ios" ? "pdf" : "unsupported";
  }
  if (type.startsWith("text/") || ext === "txt" || ext === "csv" || ext === "ics") {
    return "text";
  }
  return "unsupported";
}

/** What is shown for a format nothing on the device can render inline. */
function FileCard({
  attachment,
  typeInfo,
  senderName,
  hint,
  styles,
  palette,
}: {
  attachment: MessageAttachment;
  typeInfo: { icon: string; label: string } | null;
  senderName?: string;
  hint: string;
  styles: ReturnType<typeof createStyles>;
  palette: Palette;
}) {
  return (
    <View style={styles.fileCard} pointerEvents="box-none">
      <View style={styles.fileIcon}>
        <Ionicons
          name={(typeInfo?.icon ?? "document-outline") as keyof typeof Ionicons.glyphMap}
          size={38}
          color={palette.primaryStrong}
        />
      </View>
      <Text style={styles.fileName} numberOfLines={3}>
        {attachment.file_name || "File"}
      </Text>
      <Text style={styles.fileMeta}>
        {[typeInfo?.label, formatFileSize(attachment.size_bytes), senderName].filter(Boolean).join(" · ")}
      </Text>
      <Text style={styles.fileHint}>{hint}</Text>
    </View>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.93)",
      alignItems: "center",
      justifyContent: "center",
    },
    header: {
      position: "absolute",
      top: 48,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      // Above the viewer: a WebView is a native view and will otherwise draw
      // over the controls.
      zIndex: 5,
    },
    headerTitleWrap: { flex: 1 },
    headerTitle: { color: palette.white, fontWeight: "700", fontSize: 15 },
    headerMeta: { color: "rgba(255,255,255,0.65)", fontSize: 12, marginTop: 1 },
    saveButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: "rgba(255,255,255,0.18)",
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    saveText: { color: palette.white, fontWeight: "700", fontSize: 14 },
    image: { width: "94%", height: "74%" },
    // The document viewers get a panel rather than the full screen, so the
    // backdrop is still tappable at the edges to close.
    docSheet: {
      width: "94%",
      height: "76%",
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: palette.background,
    },
    webview: { flex: 1, backgroundColor: palette.background },
    webviewLoading: {
      ...StyleSheet.absoluteFillObject,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.background,
    },
    textSheet: {
      width: "94%",
      height: "76%",
      borderRadius: radii.lg,
      overflow: "hidden",
      backgroundColor: palette.background,
    },
    textScroll: { flex: 1 },
    textContent: { padding: spacing.md },
    textBody: {
      color: palette.text,
      fontSize: 12,
      lineHeight: 18,
      fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    fileCard: {
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.xl,
    },
    fileIcon: {
      width: 84,
      height: 84,
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    fileName: { color: palette.white, fontSize: 17, fontWeight: "700", textAlign: "center" },
    fileMeta: { color: "rgba(255,255,255,0.72)", fontSize: 13, textAlign: "center" },
    fileHint: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: spacing.sm, textAlign: "center" },
  });
}
