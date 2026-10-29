import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { SfluvQRCode } from "../components/SfluvQRCode";
import { Avatar, BadgeLine } from "../components/BulletinParts";
import type { PublicUser } from "../types/bulletin";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { AppClientConfig, AppContact } from "../types/app";
import { buildUniversalAddContactLink } from "../utils/universalLinks";
import { pickAvatarPhoto } from "../utils/avatarPicker";
import { useCopyFeedback } from "../hooks/useCopyFeedback";
import { contactPictureChanged } from "../services/contactPictures";

/**
 * One person: what you saved about them, and what they published about
 * themselves.
 *
 * ── Why these are one screen ────────────────────────────────────────────────
 *
 * They were two ideas with no single place to see them. A contact was a name
 * and an address you chose; a public profile was a display name, username and
 * badges the account chose. Tapping a contact showed only the first, so
 * somebody who was both — most saved contacts, as it turns out, since the link
 * resolves automatically — appeared twice in the app with no connection
 * between them.
 *
 * Now the private half is the editable top of the screen and the public half is
 * a section under it, loaded when the address resolves to an account. The
 * distinction is kept visible rather than merged, because it matters: the name
 * and note are yours and nobody else sees them, and the profile is theirs and
 * you cannot change it.
 */

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
  /** Their public profile, when this contact's address belongs to an account. */
  const [profile, setProfile] = useState<PublicUser | null>(null);
  const [profileAvatarUri, setProfileAvatarUri] = useState<string | null>(null);
  /**
   * From the tap until the picture is saved or the picker is cancelled. The
   * spinner shows on the picture at once, so the moment before the picker
   * appears reads as working rather than as a tap that missed, and it is
   * still there, behind the picker, for the upload once a photo is chosen.
   */
  const [pictureBusy, setPictureBusy] = useState(false);
  const { copied: addressCopied, copy } = useCopyFeedback();

  useEffect(() => {
    if (!backendClient || !contact.userId) {
      setProfile(null);
      setProfileAvatarUri(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [publicUser, uri] = await Promise.all([
          backendClient.getPublicUserProfile(contact.userId!),
          backendClient.getUserAvatarDataUri(contact.userId!),
        ]);
        if (!cancelled) {
          setProfile(publicUser);
          setProfileAvatarUri(uri);
        }
      } catch {
        // No profile, or unreachable. The private half of the screen is still
        // the whole point of it, so this fails quietly.
        if (!cancelled) {
          setProfile(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendClient, contact.userId]);

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
    if (pictureBusy || !backendClient) {
      return;
    }
    setPictureBusy(true);
    try {
      const picked = await pickAvatarPhoto();
      if (!picked) {
        return;
      }
      await backendClient.uploadContactAvatar(contact.id, picked);
      setAvatarUri(picked.uri);
      contactPictureChanged();
      onChanged();
    } catch {
      onToast("Couldn't save that picture.", "error");
    } finally {
      setPictureBusy(false);
    }
  };

  const removePicture = async () => {
    if (pictureBusy || !backendClient) {
      return;
    }
    setPictureBusy(true);
    try {
      await backendClient.deleteContactAvatar(contact.id);
      setAvatarUri(null);
      contactPictureChanged();
      onChanged();
    } catch {
      onToast("Couldn't remove that picture.", "error");
    } finally {
      setPictureBusy(false);
    }
  };

  const confirmDelete = () => {
    Alert.alert(`Delete ${contact.name}?`, "This removes them from your contacts.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onDeleted },
    ]);
  };

  const dirty = name.trim() !== contact.name || (notes ?? "") !== (contact.notes ?? "");

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
            disabled={pictureBusy}
            accessibilityRole="button"
            accessibilityLabel="Contact picture"
            accessibilityState={{ busy: pictureBusy }}
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatar} />
            ) : (
              <Avatar name={contact.name || "?"} size={86} />
            )}
            {pictureBusy ? (
              <View style={styles.avatarBusy}>
                <ActivityIndicator color={palette.white} />
              </View>
            ) : null}
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
          onPress={() => void copy(contact.address, "Address copied")}
          accessibilityRole="button"
          accessibilityLabel="Copy wallet address"
        >
          <Text style={styles.address} numberOfLines={2}>
            {contact.address}
          </Text>
          <Ionicons
            name={addressCopied ? "checkmark" : "copy-outline"}
            size={17}
            color={addressCopied ? palette.success : palette.textMuted}
          />
        </Pressable>

        {/* Their profile. Read-only, and labelled as theirs — the fields above
            are what you chose to call them, this is what they chose to be
            called, and conflating the two would make a private note look
            published. */}
        {profile ? (
          <>
            <Text style={styles.label}>Their SFLuv profile</Text>
            <View style={styles.profileCard}>
              {profileAvatarUri ? (
                <Image source={{ uri: profileAvatarUri }} style={styles.profileAvatar} />
              ) : (
                <Avatar name={profile.public_name} size={44} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {profile.public_name}
                </Text>
                {profile.handle ? (
                  <Text style={styles.profileHandle}>@{profile.handle}</Text>
                ) : null}
                <BadgeLine user={profile} />
              </View>
            </View>
          </>
        ) : null}

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

        {/* An explicit Save, shown only when something has changed.
            The fields still save on blur, which is what stops a note being lost
            by walking away — but blur-only gave no way to tell whether an edit
            had been kept, and on a screen holding somebody's private notes that
            uncertainty is worth a button. */}
        {dirty ? (
          <Pressable
            style={[styles.saveButton, saving && styles.saveButtonBusy]}
            onPress={() => void persist({ name: name.trim(), notes })}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save changes"
          >
            <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Save changes"}</Text>
          </Pressable>
        ) : null}
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
    avatarBusy: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 43,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
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
    profileCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.sm,
    },
    profileAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surfaceStrong },
    profileName: { fontSize: 15, fontWeight: "700", color: palette.text },
    profileHandle: { fontSize: 12, color: palette.textMuted, marginTop: 1 },
    saveButton: {
      marginTop: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingVertical: 13,
      alignItems: "center",
    },
    saveButtonBusy: { opacity: 0.6 },
    saveButtonText: { color: palette.white, fontWeight: "700", fontSize: 15 },
  });
}
