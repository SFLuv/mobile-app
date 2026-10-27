import React, { useEffect, useMemo, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";
import { formatFileSize } from "./MessageAttachmentCard";
import { fileTypeIcon, saveAttachment } from "../utils/attachmentFiles";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { MessageAttachment } from "../types/bulletin";

/**
 * An attachment, full screen, with a way to keep it.
 *
 * ── Why a preview rather than straight to the share sheet ───────────────────
 *
 * Tapping a file used to say "opening files is coming soon", and tapping a
 * photo opened a bare image with no way to save it. Both are the same gap: the
 * app could show you something and then offered nothing to do with it.
 *
 * A photo is previewed inline, which is the whole content. A document is not —
 * rendering a PDF needs a viewer this app does not have — so it shows what it
 * is, how big, and who sent it, and the useful action is to hand it to
 * something that CAN open it. Saying that plainly beats a blank viewer that
 * looks broken.
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
  const [uri, setUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const isImage = attachment?.kind === "image";

  useEffect(() => {
    if (!attachment || !client || !isImage) {
      setUri(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void client
      .getConversationAttachmentDataUri(conversationId, attachment.id)
      .then((value) => {
        if (!cancelled) {
          setUri(value);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachment, client, conversationId, isImage]);

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

  return (
    <Modal
      visible={Boolean(attachment)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* The backdrop closes; the content does not, so a tap on the photo
            itself is not a dismissal. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={palette.white} />
          </Pressable>
          <Pressable
            style={styles.saveButton}
            onPress={() => void save()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={isImage ? "Save to photos" : "Save file"}
          >
            <Ionicons name="download-outline" size={17} color={palette.white} />
            <Text style={styles.saveText}>{saving ? "Saving…" : "Save"}</Text>
          </Pressable>
        </View>

        {attachment ? (
          isImage ? (
            loading || !uri ? (
              <ThemedActivityIndicator size="large" color={palette.white} />
            ) : (
              <Image source={{ uri }} style={styles.image} resizeMode="contain" />
            )
          ) : (
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
                {[typeInfo?.label, formatFileSize(attachment.size_bytes), senderName]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Text style={styles.fileHint}>
                Save it to open in another app.
              </Text>
            </View>
          )
        ) : null}
      </View>
    </Modal>
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
    },
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
    fileHint: { color: "rgba(255,255,255,0.5)", fontSize: 12, marginTop: spacing.sm },
  });
}
