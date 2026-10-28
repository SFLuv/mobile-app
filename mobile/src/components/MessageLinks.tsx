import React, { useMemo } from "react";
import { Linking, StyleProp, Text, TextStyle } from "react-native";

import type { AppBackendClient } from "../services/appBackend";
import { useLinkPreview } from "../services/linkPreviews";
import type { MessageAttachment } from "../types/bulletin";
import { linkSegments } from "../utils/links";
import { AttachmentHandlers, MessageAttachmentCard } from "./MessageAttachmentCard";

/**
 * A message's text with its links made tappable.
 *
 * Parsed from the text on every render of the bubble — which is cheap, the
 * memo keeps it to once per body — so every message gets it, including ones
 * sent before links stopped being attachments. A link keeps the bubble's long
 * press, so pressing and holding a link menus the message like any other part
 * of it rather than doing nothing.
 */
export function LinkifiedText({
  text,
  style,
  linkStyle,
  onLongPress,
  onPressLink,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  linkStyle: StyleProp<TextStyle>;
  onLongPress?: () => void;
  /**
   * A tap on a link. The thread passes its tap dispatcher, so a double tap on
   * a link likes the message like a double tap anywhere else on the bubble;
   * without one the link simply opens.
   */
  onPressLink?: (href: string) => void;
}) {
  const segments = useMemo(() => linkSegments(text), [text]);
  if (!segments.some((segment) => segment.kind === "link")) {
    return <Text style={style}>{text}</Text>;
  }
  return (
    <Text style={style}>
      {segments.map((segment, index) =>
        segment.kind === "link" ? (
          <Text
            key={index}
            style={linkStyle}
            onPress={() =>
              onPressLink ? onPressLink(segment.href) : void Linking.openURL(segment.href).catch(() => {})
            }
            onLongPress={onLongPress}
            suppressHighlighting={false}
            accessibilityRole="link"
          >
            {segment.text}
          </Text>
        ) : (
          <Text key={index}>{segment.text}</Text>
        ),
      )}
    </Text>
  );
}

/**
 * The card for a link found in a message's text.
 *
 * Rendered through MessageAttachmentCard's own link branch, from a synthetic
 * attachment, so a link typed today and a link frozen onto a message last week
 * look identical — one card design, not two that drift. The id is negative so
 * it can never collide with a stored attachment's.
 *
 * Until the metadata arrives the card shows the URL itself, never a blank box:
 * for a message that is nothing but a link, this card is the whole message.
 */
export function DerivedLinkCard({
  url,
  messageId,
  conversationId,
  client,
  tokenSymbol,
  mine,
  handlers,
  onLongPress,
}: {
  url: string;
  messageId: number;
  conversationId: number;
  client: AppBackendClient | null;
  tokenSymbol: string;
  mine: boolean;
  handlers: AttachmentHandlers;
  onLongPress?: () => void;
}) {
  const preview = useLinkPreview(client, url);
  const attachment = useMemo<MessageAttachment>(
    () => ({
      id: -messageId,
      kind: "link",
      position: 0,
      link_url: preview?.url || url,
      link_title: preview?.title ?? "",
      link_description: preview?.description ?? "",
      link_image_url: preview?.imageUrl ?? "",
      link_site_name: preview?.siteName ?? "",
    }),
    [messageId, preview, url],
  );
  return (
    <MessageAttachmentCard
      attachment={attachment}
      conversationId={conversationId}
      client={client}
      tokenSymbol={tokenSymbol}
      mine={mine}
      handlers={handlers}
      onLongPress={onLongPress}
    />
  );
}
