import React, { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";

import type { AppBackendClient } from "../services/appBackend";
import { useContactPictureFor, useContactPictureVersion } from "../services/contactPictures";
import { useAppTheme } from "../theme";

/**
 * A person's or a group's picture, for chat surfaces: the inbox, a sender's
 * bubble, the in-app banner.
 *
 * ── Initials first, picture on top ──────────────────────────────────────────
 *
 * The initials are always drawn, and the picture is laid over them. The older
 * version showed one or the other, switching on the image's error — so a
 * person with no picture showed an empty circle for as long as their 404 took,
 * and then initials popped in. Layered, the circle is never empty, and a
 * picture that loads simply covers what was already there. "Even with the
 * default picture" in a banner means exactly this: initials on the person's
 * own circle, never the app's logo.
 *
 * Somebody whose picture failed is not asked for again for a couple of
 * minutes, so a list of their messages is one request rather than one per row.
 * Only minutes: an <Image> error cannot say WHY it failed, and offline, a
 * timeout or a just-expired token look exactly like "has no picture" — which
 * used to hide that person's picture for the rest of the session.
 */

const HEADER_TTL_MS = 4 * 60 * 1000;
let cachedHeaders: { value: Record<string, string>; at: number } | null = null;
let pendingHeaders: Promise<Record<string, string> | null> | null = null;
const AVATAR_RETRY_MS = 2 * 60 * 1000;
const failedUserAvatars = new Map<string, number>();

function avatarRecentlyFailed(userId: string): boolean {
  const at = failedUserAvatars.get(userId);
  if (at === undefined) {
    return false;
  }
  if (Date.now() - at > AVATAR_RETRY_MS) {
    failedUserAvatars.delete(userId);
    return false;
  }
  return true;
}

/**
 * Auth headers for an image request, shared by every avatar on screen.
 *
 * One token fetch for the whole inbox rather than one per row. Refreshed after
 * a few minutes, well inside the access token's own lifetime.
 */
export function useImageAuthHeaders(client: AppBackendClient | null): Record<string, string> | null {
  const fresh = cachedHeaders && Date.now() - cachedHeaders.at < HEADER_TTL_MS ? cachedHeaders.value : null;
  const [headers, setHeaders] = useState<Record<string, string> | null>(fresh);

  useEffect(() => {
    if (!client) {
      return;
    }
    if (cachedHeaders && Date.now() - cachedHeaders.at < HEADER_TTL_MS) {
      setHeaders(cachedHeaders.value);
      return;
    }
    let cancelled = false;
    if (!pendingHeaders) {
      pendingHeaders = client
        .getImageAuthHeaders()
        .then((value) => {
          if (value) {
            cachedHeaders = { value, at: Date.now() };
          }
          return value;
        })
        .catch(() => null)
        .finally(() => {
          pendingHeaders = null;
        });
    }
    void pendingHeaders.then((value) => {
      if (!cancelled && value) {
        setHeaders(value);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return headers;
}

/** Up to two initials from a display name. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

export function ChatAvatar({
  client,
  name,
  size = 36,
  userId,
  conversationId,
  iconAttachmentId,
  contactId,
}: {
  client: AppBackendClient | null;
  name: string;
  size?: number;
  /** A person's picture. The one you gave them as a contact wins over theirs. */
  userId?: string | null;
  /** A group's picture: both are needed to address the attachment. */
  conversationId?: number | null;
  iconAttachmentId?: number | null;
  /** A saved contact's picture, for a contact with no account to match by. */
  contactId?: number | null;
}) {
  const { palette } = useAppTheme();
  const headers = useImageAuthHeaders(client);
  const [failed, setFailed] = useState(false);
  // Your picture for them failed: fall back to their own rather than initials.
  const [contactFailed, setContactFailed] = useState(false);
  const isGroup = Boolean(conversationId && iconAttachmentId);
  const matchedContactId = useContactPictureFor(isGroup ? null : userId);
  const pictureVersion = useContactPictureVersion();
  const ownContactId = contactId ?? matchedContactId;

  // A different subject is a different picture; forget the last one's error.
  useEffect(() => {
    setFailed(false);
    setContactFailed(false);
  }, [userId, conversationId, iconAttachmentId, ownContactId, pictureVersion]);

  let uri: string | null = null;
  let showingContact = false;
  if (client && headers && !failed) {
    if (isGroup) {
      uri = client.conversationAttachmentURL(conversationId!, iconAttachmentId!);
    } else if (ownContactId && !contactFailed) {
      uri = client.contactAvatarURL(ownContactId, pictureVersion);
      showingContact = true;
    } else if (userId && !avatarRecentlyFailed(userId)) {
      uri = client.userAvatarURL(userId);
    }
  }

  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[round, { backgroundColor: palette.primaryMuted, alignItems: "center", justifyContent: "center" }]}>
      <Text
        style={{ color: palette.primaryStrong, fontWeight: "700", fontSize: Math.max(9, size * 0.36) }}
        allowFontScaling={false}
      >
        {avatarInitials(name)}
      </Text>
      {uri && headers ? (
        <Image
          source={{ uri, headers }}
          style={[round, { position: "absolute", top: 0, left: 0 }]}
          onError={() => {
            if (showingContact) {
              setContactFailed(true);
              return;
            }
            if (userId && !iconAttachmentId) {
              failedUserAvatars.set(userId, Date.now());
            }
            setFailed(true);
          }}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}
