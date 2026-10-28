import React from "react";
import { Pressable, StyleProp, Text, View, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";

/**
 * Pasting a photo, a link or text into a chat.
 *
 * ── Why this is a control and not the text field's own paste ────────────────
 *
 * React Native's TextInput can only paste text. Long-pressing it with a photo
 * on the clipboard offers nothing, and a link pasted there is just text — which
 * is fine for links, and is why text still pastes normally. Photos need their
 * own way in, so there is a Paste tile in the attachment tray and, when the
 * clipboard is holding an image, a chip above the composer.
 *
 * ── Why the native button where there is one ───────────────────────────────
 *
 * iOS 16 asks "Allow SFLuv to paste?" every time an app reads the clipboard
 * programmatically. `UIPasteControl` — ClipboardPasteButton — is the system's
 * own paste button, and pressing it is the permission, so there is no prompt.
 * Elsewhere (Android, older iOS) reading on tap is the only option and is
 * prompt-free anyway.
 *
 * Arbitrary files — a PDF copied in Files — cannot come off the clipboard
 * through this API, which exposes only images, URLs and text. Sharing to SFLuv
 * from the other app is the route for those.
 */

export type PastedContent =
  | { kind: "image"; dataUri: string }
  | { kind: "text"; text: string };

const IMAGE_OPTIONS = { format: "jpeg" as const, jpegQuality: 0.9 };

function fromPasteEvent(payload: Clipboard.PasteEventPayload): PastedContent | null {
  if (payload.type === "image") {
    return payload.data ? { kind: "image", dataUri: payload.data } : null;
  }
  return payload.text ? { kind: "text", text: payload.text } : null;
}

/** Reads the clipboard on demand: an image if there is one, otherwise text. */
export async function readClipboard(): Promise<PastedContent | null> {
  try {
    if (await Clipboard.hasImageAsync()) {
      const image = await Clipboard.getImageAsync(IMAGE_OPTIONS);
      if (image?.data) {
        return { kind: "image", dataUri: image.data };
      }
    }
    const text = await Clipboard.getStringAsync();
    return text ? { kind: "text", text } : null;
  } catch {
    return null;
  }
}

/**
 * Whether the clipboard holds an image, without reading it — which on iOS is
 * what keeps this from triggering the paste prompt.
 */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

/**
 * The paste button itself. The system's on iOS 16+, a plain icon button
 * otherwise; `onEmpty` runs when there was nothing to paste, which only the
 * fallback can know.
 */
export function PasteButton({
  onPaste,
  onEmpty,
  size,
  background,
  foreground,
  withLabel = false,
  style,
}: {
  onPaste: (content: PastedContent) => void;
  onEmpty?: () => void;
  size: { width: number; height: number };
  background: string;
  foreground: string;
  /** "Paste" beside the icon, for the chip; the tray tile has its own label. */
  withLabel?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (Clipboard.isPasteButtonAvailable) {
    return (
      <Clipboard.ClipboardPasteButton
        acceptedContentTypes={["image", "url", "plain-text"]}
        imageOptions={IMAGE_OPTIONS}
        displayMode={withLabel ? "iconAndLabel" : "iconOnly"}
        cornerStyle={withLabel ? "capsule" : "medium"}
        backgroundColor={background}
        foregroundColor={foreground}
        style={[size, style]}
        onPress={(payload) => {
          const content = fromPasteEvent(payload);
          if (content) {
            onPaste(content);
          } else {
            onEmpty?.();
          }
        }}
      />
    );
  }
  return (
    <Pressable
      style={[
        size,
        {
          backgroundColor: background,
          borderRadius: withLabel ? size.height / 2 : 12,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
      onPress={() => {
        void readClipboard().then((content) => (content ? onPaste(content) : onEmpty?.()));
      }}
      accessibilityRole="button"
      accessibilityLabel="Paste"
    >
      {withLabel ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="clipboard-outline" size={15} color={foreground} />
          <Text style={{ color: foreground, fontSize: 13, fontWeight: "600" }}>Paste</Text>
        </View>
      ) : (
        <Ionicons name="clipboard-outline" size={22} color={foreground} />
      )}
    </Pressable>
  );
}
