import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { SfluvQRCode } from "../components/SfluvQRCode";
import { Avatar } from "../components/BulletinParts";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { AppClientConfig, AppContact } from "../types/app";
import { buildUniversalAddContactLink } from "../utils/universalLinks";

/**
 * One contact, as a card.
 *
 * ── Why the list became cards and a screen ──────────────────────────────────
 *
 * Contacts was a flat list of name-and-address rows with an inline edit mode:
 * tapping a row swapped it for two text fields. That is the cheapest thing to
 * build and it caps what a contact can ever be — there is nowhere to put a note,
 * a picture, or anything else, because the row is the whole UI.
 *
 * So a row now opens this, the way iMessage opens a contact card. The things
 * that were impossible before — "which Maria is this", "he pays on Thursdays" —
 * have somewhere to live.
 *
 * ── Everything here is private ──────────────────────────────────────────────
 *
 * The name, the note and the picture are the OWNER's record of somebody else.
 * None of it is visible to the contact, and none of it touches their public
 * profile: if they are an SFLuv account they have their own name and picture,
 * which they chose, and this screen deliberately does not show or overwrite
 * those. It is an address book entry, not a profile.
 */
export function ContactDetailScreen({
  contact,
  clientConfig,
  backendClient,
  onBack,
  onChanged,
  onDeleted,
  onSend,
  onMessage,
  onToast,
}: {
  contact: AppContact;
  clientConfig: AppClientConfig;
  backendClient: AppBackendClient | null;
  onBack: () => void;
  /** Re-read the list, so the row behind this reflects a rename. */
  onChanged: () => void;
  onDeleted: () => void;
  onSend: (contact: AppContact) => void;
  /**
   * Opens a chat. Offered only when the address belongs to an SFLuv account and
   * the viewer has messaging — see the note on AppContact.userId for why the
   * link itself is never announced.
   */
  onMessage?: (contact: AppContact) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [name, setName] = useState(contact.name);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    setName(contact.name);
    setNotes(contact.notes ?? "");
  }, [contact.id, contact.name, contact.notes]);

  useEffect(() => {
    if (!backendClient || !contact.hasAvatar) {
      setAvatarUri(null);
      return;
    }
    let cancelled = false;
    void backendClient
      .getContactAvatarDataUri(contact.id)
      .then((uri) => {
        if (!cancelled) {
          setAvatarUri(uri);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backendClient, contact.hasAvatar, contact.id]);

  // Saved on blur rather than behind a Save button: there are two fields, and a
  // button would mean a note somebody typed and walked away from is lost.
  const persist = async (patch: { name?: string; notes?: string }) => {
    if (!backendClient || saving) {
      return;
    }
    setSaving(true);
    try {
      await backendClient.patchContact(contact.id, patch);
      onChanged();
    } catch {
      onToast("Couldn't save that.", "error");
    } finally {
      setSaving(false);
    }
  };

  const changePicture = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      onToast("SFLuv needs photo access to set a picture.", "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0] || !backendClient) {
      return;
    }
    try {
      await backendClient.uploadContactAvatar(contact.id, {
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType,
        fileName: result.assets[0].fileName,
      });
      setAvatarUri(result.assets[0].uri);
      onChanged();
    } catch {
      onToast("Couldn't save that picture.", "error");
    }
  };

  const removePicture = async () => {
    if (!backendClient) {
      return;
    }
    try {
      await backendClient.deleteContactAvatar(contact.id);
      setAvatarUri(null);
      onChanged();
    } catch {
      onToast("Couldn't remove that picture.", "error");
    }
  };

  const confirmDelete = () => {
    Alert.alert(`Delete ${contact.name}?`, "This removes them from your contacts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDeleted },
    ]);
  };

  const shareLink = buildUniversalAddContactLink({ address: contact.address }, clientConfig);

  return (
    <SwipeBack onBack={onBack} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Contact</Text>
        <Pressable
          onPress={confirmDelete}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${contact.name}`}
        >
          <Ionicons name="trash-outline" size={21} color={palette.danger} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.identity}>
          <Pressable
            onPress={() =>
              avatarUri
                ? Alert.alert("Contact picture", undefined, [
                    { text: "Change", onPress: () => void changePicture() },
                    { text: "Remove", style: "destructive", onPress: () => void removePicture() },
                    { text: "Cancel", style: "cancel" },
                  ])
                : void changePicture()
            }
            accessibilityRole="button"
            accessibilityLabel="Contact picture"
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <Avatar name={contact.name || "?"} size={86} />
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={13} color={palette.white} />
            </View>
          </Pressable>

          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={() => {
              const next = name.trim();
              if (!next) {
                setName(contact.name);
                return;
              }
              if (next !== contact.name) {
                void persist({ name: next });
              }
            }}
            maxLength={60}
            placeholder="Name"
            placeholderTextColor={palette.textMuted}
            textAlign="center"
          />
        </View>

        <View style={styles.quickActions}>
          <QuickAction
            icon="arrow-up-circle-outline"
            label="Send"
            onPress={() => onSend(contact)}
          />
          {/* Present only when the address belongs to an account. The app never
              says "they have an account" — the button simply exists, the same
              way a phone's contact card shows iMessage for some numbers. */}
          {contact.userId && onMessage ? (
            <QuickAction
              icon="chatbubble-outline"
              label="Message"
              onPress={() => onMessage(contact)}
            />
          ) : null}
          <QuickAction
            icon="qr-code-outline"
            label="QR"
            onPress={() => setShowQR((current) => !current)}
          />
          <QuickAction
            icon="share-outline"
            label="Share"
            onPress={() => {
              void Share.share({
                message: `${contact.name} on SFLuv: ${shareLink}`,
              }).catch(() => {});
            }}
          />
        </View>

        {showQR ? (
          <View style={styles.qrCard}>
            <SfluvQRCode value={shareLink} size={190} />
            <Text style={styles.qrHint}>Scan to add {contact.name} as a contact.</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Wallet address</Text>
        <Pressable
          style={styles.addressRow}
          onPress={() => {
            void Clipboard.setStringAsync(contact.address);
            onToast("Address copied.", "success");
          }}
          accessibilityRole="button"
          accessibilityLabel="Copy wallet address"
        >
          <Text style={styles.address} numberOfLines={2}>
            {contact.address}
          </Text>
          <Ionicons name="copy-outline" size={17} color={palette.textMuted} />
        </Pressable>

        <Text style={styles.label}>Notes</Text>
        <TextInput
          style={styles.notes}
          value={notes}
          onChangeText={setNotes}
          onBlur={() => {
            if ((notes ?? "") !== (contact.notes ?? "")) {
              void persist({ notes });
            }
          }}
          placeholder="Anything you want to remember about them."
          placeholderTextColor={palette.textMuted}
          multiline
          maxLength={2000}
          textAlignVertical="top"
        />
        <Text style={styles.privateHint}>
          Only you can see this name, picture and note.
        </Text>
      </ScrollView>
    </SwipeBack>
  );
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      style={{ alignItems: "center", gap: 5, flex: 1 }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: radii.md,
          backgroundColor: palette.primaryMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={21} color={palette.primaryStrong} />
      </View>
      <Text style={{ fontSize: 11, color: palette.textMuted }}>{label}</Text>
    </Pressable>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
    },
    headerTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },

    identity: { alignItems: "center", paddingVertical: spacing.lg },
    avatar: { width: 86, height: 86, borderRadius: 43, backgroundColor: palette.surfaceStrong },
    avatarBadge: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 27,
      height: 27,
      borderRadius: 14,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: palette.background,
    },
    nameInput: {
      marginTop: spacing.md,
      fontSize: 21,
      fontWeight: "700",
      color: palette.text,
      minWidth: 180,
      paddingVertical: 4,
    },

    quickActions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },

    qrCard: {
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.lg,
      marginBottom: spacing.lg,
      ...shadows.soft,
    },
    qrHint: { fontSize: 12, color: palette.textMuted, textAlign: "center" },

    label: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
      marginTop: spacing.sm,
    },
    addressRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      padding: 12,
    },
    address: { flex: 1, fontSize: 13, color: palette.text, fontVariant: ["tabular-nums"] },
    notes: {
      minHeight: 110,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      padding: 12,
      fontSize: 15,
      color: palette.text,
      lineHeight: 21,
    },
    privateHint: { fontSize: 12, color: palette.textMuted, marginTop: spacing.sm, textAlign: "center" },
  });
}
