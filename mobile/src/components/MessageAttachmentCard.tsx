import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import type { ChatTransactionRef } from "../utils/transactions";
import type { AttachmentKind, MessageAttachment } from "../types/bulletin";
import { displayFileName } from "../utils/attachmentFiles";

/**
 * One card under a message: a photo, a file, a link preview, or a reference to
 * something that lives elsewhere in the app.
 *
 * ── Reference cards are not links ───────────────────────────────────────────
 *
 * Tapping a merchant card opens the merchant sheet the map already has; a
 * volunteer event card opens that event's page; a transaction card opens the
 * transaction sheet the wallet already has. None of them navigate away to a
 * browser, and none of them re-implement those surfaces — the handlers are
 * passed in, so there is exactly one merchant sheet in the app and this is
 * another way to reach it.
 */

export type AttachmentHandlers = {
  onOpenImage?: (attachment: MessageAttachment, uri: string) => void;
  onOpenFile?: (attachment: MessageAttachment) => void;
  /**
   * Opens the transaction sheet.
   *
   * Takes the whole attachment rather than just the hash: the attachment is the
   * only place the chain facts live for a transfer the viewer has no history
   * row for, which is every record shared by somebody else.
   */
  onOpenTransaction?: (ref: ChatTransactionRef) => void;
  onOpenMerchant?: (locationId: number) => void;
  onOpenEvent?: (eventId: string) => void;
  onOpenSupport?: (requestId: number) => void;
};

const FILE_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  "application/pdf": "document-text-outline",
  "text/csv": "grid-outline",
  "text/plain": "document-outline",
  "text/calendar": "calendar-outline",
  "application/zip": "archive-outline",
};

function fileIcon(contentType?: string): keyof typeof Ionicons.glyphMap {
  if (!contentType) return "document-outline";
  if (FILE_ICONS[contentType]) return FILE_ICONS[contentType];
  if (contentType.includes("word")) return "document-text-outline";
  if (contentType.includes("sheet") || contentType.includes("excel")) return "grid-outline";
  if (contentType.includes("presentation") || contentType.includes("powerpoint")) return "easel-outline";
  return "document-outline";
}

/** "2.4 MB". Bytes are never shown — nobody reads a file size in bytes. */
export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const ICON_FOR_KIND: Record<AttachmentKind, keyof typeof Ionicons.glyphMap> = {
  image: "image-outline",
  file: "document-outline",
  link: "link-outline",
  transaction: "swap-horizontal-outline",
  merchant: "storefront-outline",
  event: "calendar-outline",
  support: "help-buoy-outline",
};

/** The label a reply quote shows for a message whose content was an attachment. */
export function attachmentKindLabel(kind?: AttachmentKind): string {
  switch (kind) {
    case "image":
      return "Photo";
    case "file":
      return "File";
    case "link":
      return "Link";
    case "transaction":
      return "Transaction";
    case "merchant":
      return "Merchant";
    case "event":
      return "Event";
    case "support":
      return "Support request";
    default:
      return "Attachment";
  }
}

export function MessageAttachmentCard({
  attachment,
  conversationId,
  client,
  tokenSymbol,
  mine,
  handlers,
  onLongPress,
}: {
  attachment: MessageAttachment;
  conversationId: number;
  client: AppBackendClient | null;
  tokenSymbol: string;
  mine: boolean;
  handlers: AttachmentHandlers;
  /**
   * The thread's long-press menu — react, reply, copy.
   *
   * Passed down so a card gets the same actions as a bubble: there is no reason
   * you can react to "nice" and not to the photo it was about. Every Pressable
   * below forwards it, which is why it is threaded through rather than wrapped
   * around the card — a wrapper would swallow the tap that opens the thing.
   */
  onLongPress?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  switch (attachment.kind) {
    case "image":
      return (
        <AttachmentImage
          attachment={attachment}
          conversationId={conversationId}
          client={client}
          onOpen={handlers.onOpenImage}
          onLongPress={onLongPress}
        />
      );

    case "file":
      return (
        <Pressable
          style={[styles.card, mine ? styles.cardMine : undefined]}
          onPress={() => handlers.onOpenFile?.(attachment)}
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`File: ${displayFileName(attachment.file_name) || "attachment"}`}
        >
          <View style={styles.iconWrap}>
            <Ionicons name={fileIcon(attachment.content_type)} size={20} color={palette.primaryStrong} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {displayFileName(attachment.file_name) || "Attachment"}
            </Text>
            {formatFileSize(attachment.size_bytes) ? (
              <Text style={styles.cardMeta}>{formatFileSize(attachment.size_bytes)}</Text>
            ) : null}
          </View>
          <Ionicons name="download-outline" size={18} color={palette.textMuted} />
        </Pressable>
      );

    case "link":
      return (
        <Pressable
          style={[styles.linkCard, mine ? styles.cardMine : undefined]}
          onPress={() => {
            if (attachment.link_url) {
              void Linking.openURL(attachment.link_url).catch(() => {});
            }
          }}
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="link"
          accessibilityLabel={attachment.link_title || attachment.link_url || "Link"}
        >
          {attachment.link_image_url ? (
            <Image source={{ uri: attachment.link_image_url }} style={styles.linkImage} resizeMode="cover" />
          ) : null}
          <View style={styles.linkText}>
            {attachment.link_site_name ? (
              <Text style={styles.linkSite} numberOfLines={1}>
                {attachment.link_site_name}
              </Text>
            ) : null}
            <Text style={styles.cardTitle} numberOfLines={2}>
              {attachment.link_title || attachment.link_url}
            </Text>
            {attachment.link_description ? (
              <Text style={styles.cardMeta} numberOfLines={2}>
                {attachment.link_description}
              </Text>
            ) : null}
          </View>
        </Pressable>
      );

    case "transaction":
      // ── A RECORD, not a payment ──────────────────────────────────────────
      //
      // This is somebody sharing a transaction out of their history. A payment
      // made inside the chat is a different thing and renders differently, in
      // ChatScreen: a dollar sign and the amount alone.
      //
      // The two were nearly identical and that was the problem — "I paid you
      // 5 SFLUV just now" and "look at this transfer from March" are not the
      // same claim, and a reader should not have to work out which one they are
      // looking at. So a record gets the receipt icon, a title, and the amount
      // demoted to the subtitle; a payment gets the amount and nothing else.
      // Both open the same transaction sheet.
      return (
        <Pressable
          style={[styles.referenceCard, mine ? styles.cardMine : undefined]}
          onPress={() =>
            attachment.tx_hash &&
            handlers.onOpenTransaction?.({
              txHash: attachment.tx_hash,
              amountSfluvBase: attachment.tx_amount_sfluv_base,
              from: attachment.tx_from,
              to: attachment.tx_to,
              at: attachment.tx_at,
            })
          }
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel="Transaction record"
        >
          <View style={styles.referenceBanner}>
            <Ionicons name="receipt-outline" size={15} color={palette.primaryStrong} />
            <Text style={styles.referenceKicker}>Transaction record</Text>
          </View>
          <View style={styles.referenceBody}>
            <Text style={styles.referenceTitle} numberOfLines={1}>
              {/* "Confirming" rather than "missing": a transfer shared seconds
                  after it was made is simply not indexed yet, and the two are
                  indistinguishable from here. */}
              {attachment.unavailable
                ? "Confirming on the network…"
                : `${formatBaseAmount(attachment.tx_amount_sfluv_base)} ${tokenSymbol}`}
            </Text>
            {!attachment.unavailable && attachment.tx_at ? (
              <Text style={styles.referenceDetail}>{formatTxDate(attachment.tx_at)}</Text>
            ) : null}
            <Text style={styles.referenceAction}>View transaction</Text>
          </View>
        </Pressable>
      );

    case "merchant":
      return (
        <Pressable
          style={[styles.referenceCard, mine ? styles.cardMine : undefined]}
          onPress={() => attachment.location_id && handlers.onOpenMerchant?.(attachment.location_id)}
          disabled={attachment.unavailable}
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`Merchant: ${attachment.location_name ?? "unavailable"}`}
        >
          <View style={styles.referenceBanner}>
            <Ionicons name="storefront" size={15} color={palette.primaryStrong} />
            <Text style={styles.referenceKicker} numberOfLines={1}>
              SFLuv merchant
            </Text>
          </View>
          <View style={styles.referenceBody}>
            <Text style={styles.referenceTitle} numberOfLines={2}>
              {attachment.unavailable ? "Merchant no longer listed" : attachment.location_name}
            </Text>
            {!attachment.unavailable && attachment.location_address ? (
              <Text style={styles.referenceDetail} numberOfLines={2}>
                {attachment.location_address}
              </Text>
            ) : null}
            {attachment.unavailable ? null : (
              <Text style={styles.referenceAction}>View on the map</Text>
            )}
          </View>
        </Pressable>
      );

    case "event":
      // A card with the detail on it, not a calendar glyph.
      //
      // It rendered as an icon and a title, which told somebody almost nothing
      // about whether to tap: when is it, is it still happening, is it the one
      // they were already going to. A shared event is an invitation, so the
      // card carries what you would want to know before answering — the day,
      // the time, and whether it has passed — in the banner-and-detail shape
      // the link preview already uses, so the two read as the same kind of
      // object.
      return (
        <Pressable
          style={[styles.referenceCard, mine ? styles.cardMine : undefined]}
          onPress={() => attachment.event_id && handlers.onOpenEvent?.(attachment.event_id)}
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`Volunteer event: ${attachment.event_title ?? "unavailable"}`}
        >
          <View style={styles.referenceBanner}>
            <Ionicons name="calendar" size={15} color={palette.primaryStrong} />
            <Text style={styles.referenceKicker} numberOfLines={1}>
              {attachment.unavailable ? "Past event" : "Volunteer event"}
            </Text>
          </View>
          <View style={styles.referenceBody}>
            <Text style={styles.referenceTitle} numberOfLines={2}>
              {attachment.event_title || "Volunteer event"}
            </Text>
            {attachment.event_start_at ? (
              <Text style={styles.referenceDetail} numberOfLines={1}>
                {formatEventWhen(attachment.event_start_at, attachment.event_end_at)}
              </Text>
            ) : null}
            <Text style={styles.referenceAction} numberOfLines={1}>
              {/* An event that has finished still shows its title and date — it
                  is marked past rather than hidden, because "we did this
                  together last week" is a thing people share. */}
              {attachment.unavailable ? "This event has finished" : "View event and sign up"}
            </Text>
          </View>
        </Pressable>
      );

    case "support":
      return (
        <Pressable
          style={[styles.referenceCard, styles.supportCard]}
          onPress={() =>
            attachment.support_request_id && handlers.onOpenSupport?.(attachment.support_request_id)
          }
          onLongPress={onLongPress}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel="Support request"
        >
          <View style={styles.referenceBanner}>
            <Ionicons name="help-buoy" size={15} color={palette.primaryStrong} />
            <Text style={styles.referenceKicker} numberOfLines={1}>
              {attachment.support_reference
                ? `Support · ${attachment.support_reference}`
                : "Support request"}
            </Text>
          </View>
          <View style={styles.referenceBody}>
            <Text style={styles.referenceTitle} numberOfLines={2}>
              {attachment.support_subject || "Your message to SFLuv"}
            </Text>
            <Text style={styles.referenceDetail}>
              {/* Never the body or the email — see resolveSupportCard. */}
              We have your request and someone is looking at it.
            </Text>
          </View>
        </Pressable>
      );

    default:
      return (
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons
              name={ICON_FOR_KIND[attachment.kind] ?? "attach-outline"}
              size={20}
              color={palette.textMuted}
            />
          </View>
          <View style={styles.cardBody}>
            {/* A kind this build does not know: a newer server added one. Shown
                as a neutral card rather than dropped, so the message is not
                silently empty. */}
            <Text style={styles.cardTitle}>Attachment</Text>
            <Text style={styles.cardMeta}>Update SFLuv to see this.</Text>
          </View>
        </View>
      );
  }
}

/**
 * A photo in a thread.
 *
 * Fetched through the session rather than used as an <Image> URL, because the
 * route is authenticated: an Image with a bare uri sends no token and renders
 * nothing. The placeholder is sized from the stored dimensions so the thread
 * does not reflow under the reader when the bytes land.
 */
function AttachmentImage({
  attachment,
  conversationId,
  client,
  onOpen,
  onLongPress,
}: {
  attachment: MessageAttachment;
  conversationId: number;
  client: AppBackendClient | null;
  onOpen?: (attachment: MessageAttachment, uri: string) => void;
  onLongPress?: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);

  // Only the authenticated URL and its headers are resolved here — the bytes
  // are the native image loader's job. This used to pull the whole image
  // through fetch and base64 it on the JS thread; see the note on
  // getConversationAttachmentSource for what that cost.
  useEffect(() => {
    if (!client) {
      return;
    }
    let cancelled = false;
    void client
      .getConversationAttachmentSource(conversationId, attachment.id)
      .then((value) => {
        if (!cancelled) {
          if (value) {
            setSource(value);
          } else {
            setFailed(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.id, client, conversationId]);

  // Capped so a tall photo cannot take the whole thread, and squared off when
  // the server did not record dimensions.
  const ratio =
    attachment.image_width && attachment.image_height
      ? attachment.image_width / attachment.image_height
      : 1;
  const width = 232;
  const height = Math.max(120, Math.min(320, width / Math.max(0.5, Math.min(2.2, ratio))));

  if (!source || failed) {
    return (
      <View style={[styles.imagePlaceholder, { width, height }]}>
        <Ionicons
          name={failed ? "image-outline" : "cloud-download-outline"}
          size={22}
          color={palette.textMuted}
        />
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => onOpen?.(attachment, source.uri)}
      onLongPress={onLongPress}
      delayLongPress={280}
      accessibilityRole="imagebutton"
      accessibilityLabel={displayFileName(attachment.file_name) || "Photo"}
    >
      {/* The placeholder stays underneath rather than being swapped out, so the
          bubble is the right size from the first frame and the photo fades onto
          it instead of the thread reflowing when it arrives. */}
      <View style={[styles.imagePlaceholder, { width, height, position: "absolute" }]} />
      <Image
        source={source}
        style={[styles.image, { width, height }]}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    </Pressable>
  );
}

/** The date a shared transaction happened, for the record card's subtitle. */
function formatTxDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: new Date(seconds * 1000).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

function formatBaseAmount(base?: string): string {
  if (!base) return "—";
  const value = Number(base) / 1_000_000;
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** "Sat 2 Nov · 9:00 – 12:00", or just the day when there is no end. */
function formatEventWhen(startSeconds: number, endSeconds?: number): string {
  const start = new Date(startSeconds * 1000);
  const day = start.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const from = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endSeconds) {
    return `${day} · ${from}`;
  }
  const to = new Date(endSeconds * 1000).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} · ${from} – ${to}`;
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.sm,
      maxWidth: 268,
    },
    // On the sender's side the bubble is already tinted, so the card drops its
    // own fill and keeps only the border — otherwise it reads as a second,
    // paler bubble inside the first.
    cardMine: { backgroundColor: palette.surfaceMuted },
    supportCard: { borderColor: palette.primarySoft, backgroundColor: palette.primaryMuted },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: radii.sm,
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    cardBody: { flex: 1 },
    cardTitle: { fontSize: 14, fontWeight: "600", color: palette.text },
    cardMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    // The reference-card shape: a kicker banner saying WHAT this is, then the
    // detail. Shared by the event and merchant cards so a shared thing reads
    // the same way whatever kind it is — and the same way a link preview does.
    referenceCard: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      overflow: "hidden",
      maxWidth: 268,
      minWidth: 212,
    },
    referenceBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      backgroundColor: palette.primaryMuted,
    },
    referenceKicker: {
      fontSize: 10,
      fontWeight: "800",
      color: palette.primaryStrong,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    referenceBody: { padding: spacing.sm, gap: 3 },
    referenceTitle: { fontSize: 14, fontWeight: "700", color: palette.text },
    referenceDetail: { fontSize: 12, color: palette.textMuted },
    referenceAction: { fontSize: 12, fontWeight: "600", color: palette.primaryStrong, marginTop: 2 },
    linkCard: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      overflow: "hidden",
      maxWidth: 268,
    },
    linkImage: { width: "100%", height: 132, backgroundColor: palette.surfaceStrong },
    linkText: { padding: spacing.sm },
    linkSite: {
      fontSize: 11,
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 3,
    },
    image: { borderRadius: radii.md, backgroundColor: palette.surfaceStrong },
    imagePlaceholder: {
      borderRadius: radii.md,
      backgroundColor: palette.surfaceStrong,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
