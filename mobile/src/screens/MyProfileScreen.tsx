import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { SfluvQRCode } from "../components/SfluvQRCode";
import { Avatar } from "../components/BulletinParts";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { BulletinRequestError, UserProfile } from "../types/bulletin";
import { pickAvatarPhoto } from "../utils/avatarPicker";
import { useCopyFeedback } from "../hooks/useCopyFeedback";

/**
 * "My Profile" — what used to be "My QR".
 *
 * ── Why the tab changed ─────────────────────────────────────────────────────
 *
 * The tab held a QR code and a share button, and the public profile it is a code
 * FOR was edited somewhere else entirely: a small person icon in the Messages
 * search bar, which opened a bottom sheet. So the two halves of "how people find
 * and recognise me" lived on different screens, and the half with the name in it
 * was effectively hidden.
 *
 * Now one screen carries both. The QR code is still the first thing on it,
 * because scanning somebody in is the common errand; the profile fields are
 * underneath, where somebody looking for them will actually find them.
 *
 * ── The picture is the public one ───────────────────────────────────────────
 *
 * Unlike a contact's picture — which is your private note about somebody else —
 * this one is yours and everybody who can see your name can see it. The copy
 * says so, because the two are a picture of a person in a round frame either way
 * and nothing else distinguishes them.
 */
export function MyProfileScreen({
  backendClient,
  shareQRValue,
  shareAddress,
  /** Whether messaging is available to this account. */
  chatEnabled,
  onToast,
}: {
  backendClient: AppBackendClient | null;
  /** The add-contact link this account's QR encodes. Absent while the wallet loads. */
  shareQRValue: string | null;
  shareAddress?: string;
  chatEnabled: boolean;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [discoverable, setDiscoverable] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** From the tap until the picture is saved or the picker is cancelled. */
  const [pictureBusy, setPictureBusy] = useState(false);
  const { copied: addressCopied, copy } = useCopyFeedback();

  const load = useCallback(async () => {
    if (!backendClient) {
      setLoading(false);
      return;
    }
    try {
      const loaded = await backendClient.getMyProfile();
      setProfile(loaded);
      setName(loaded.exists ? loaded.public_name : loaded.suggested_public_name || "");
      setHandle(loaded.handle ?? "");
      setDiscoverable(loaded.discoverable);
      if (loaded.exists) {
        const uri = await backendClient.getUserAvatarDataUri(loaded.user_id);
        setAvatarUri(uri);
      }
    } catch {
      setError("Couldn't load your profile.");
    } finally {
      setLoading(false);
    }
  }, [backendClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (next?: { discoverable?: boolean }) => {
    if (!backendClient || saving) {
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Your profile needs a display name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await backendClient.saveMyProfile({
        public_name: trimmedName,
        handle: handle.trim() ? handle.trim() : null,
        discoverable: next?.discoverable ?? discoverable,
      });
      setProfile(saved);
      setDiscoverable(saved.discoverable);
      onToast("Profile saved.", "success");
    } catch (e) {
      setError(e instanceof BulletinRequestError ? e.message : "Couldn't save your profile.");
      // Put the switch back where it was: leaving it showing a state the server
      // refused is how somebody believes they are hidden when they are not.
      if (next?.discoverable !== undefined) {
        setDiscoverable(!next.discoverable);
      }
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
      await backendClient.uploadMyProfileAvatar(picked);
      setAvatarUri(picked.uri);
      onToast("Picture saved.", "success");
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
      await backendClient.deleteMyProfileAvatar();
      setAvatarUri(null);
    } catch {
      onToast("Couldn't remove that picture.", "error");
    } finally {
      setPictureBusy(false);
    }
  };

  const dirty =
    profile !== null &&
    (name.trim() !== (profile.exists ? profile.public_name : "") ||
      (handle.trim() || null) !== (profile.handle ?? null));

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* ── The QR code, first, because scanning somebody in is the errand ── */}
      {shareQRValue ? (
        <View style={styles.qrCard}>
          <SfluvQRCode value={shareQRValue} />
          {shareAddress ? <Text style={styles.qrAddress}>{shortAddress(shareAddress)}</Text> : null}
          <View style={styles.qrActions}>
            <Pressable
              style={styles.qrAction}
              onPress={() => {
                void Share.share({ message: shareQRValue }).catch(() => {});
              }}
              accessibilityRole="button"
              accessibilityLabel="Share your contact link"
            >
              <Ionicons name="share-social-outline" size={16} color={palette.primaryStrong} />
              <Text style={styles.qrActionText}>Share</Text>
            </Pressable>
            <Pressable
              style={styles.qrAction}
              onPress={() => void copy(shareAddress || shareQRValue, "Address copied")}
              accessibilityRole="button"
              accessibilityLabel="Copy your wallet address"
            >
              <Ionicons
                name={addressCopied ? "checkmark" : "copy-outline"}
                size={16}
                color={palette.primaryStrong}
              />
              <Text style={styles.qrActionText}>{addressCopied ? "Copied" : "Copy address"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="wallet-outline" size={20} color={palette.textMuted} />
          <Text style={styles.body}>
            Your wallet is still loading. Once it&apos;s ready, your contact QR will appear here.
          </Text>
        </View>
      )}

      {/* ── The public profile ───────────────────────────────────────────── */}
      <Text style={styles.sectionTitle}>Public profile</Text>
      <Text style={styles.sectionBody}>
        {chatEnabled
          ? "How neighbors see you on the Bulletin and in Messages."
          : "How neighbors see you on the Bulletin."}
      </Text>

      {loading ? (
        <View style={styles.loading}>
          <ThemedActivityIndicator />
        </View>
      ) : (
        <View style={styles.profileCard}>
          <View style={styles.avatarRow}>
            <Pressable
              onPress={() =>
                avatarUri
                  ? Alert.alert("Your picture", "Everyone who can see your name can see this.", [
                      { text: "Change", onPress: () => void changePicture() },
                      { text: "Remove", style: "destructive", onPress: () => void removePicture() },
                      { text: "Cancel", style: "cancel" },
                    ])
                  : void changePicture()
              }
              disabled={pictureBusy}
              accessibilityRole="button"
              accessibilityLabel="Your profile picture"
              accessibilityState={{ busy: pictureBusy }}
            >
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatar} />
              ) : (
                <Avatar name={name || "?"} size={64} />
              )}
              {pictureBusy ? (
                <View style={styles.avatarBusy}>
                  <ActivityIndicator color={palette.white} />
                </View>
              ) : null}
              <View style={styles.avatarBadge}>
                <Ionicons name="camera" size={12} color={palette.white} />
              </View>
            </Pressable>
            <View style={styles.avatarText}>
              <Text style={styles.avatarTitle}>Profile picture</Text>
              <Text style={styles.avatarHint}>
                Public. Everyone who can see your name can see this.
              </Text>
            </View>
          </View>

          <Text style={styles.label}>Display name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            maxLength={40}
            placeholder="Maria G."
            placeholderTextColor={palette.textMuted}
            autoCapitalize="words"
          />

          <Text style={styles.label}>Username</Text>
          <View style={styles.handleRow}>
            <Text style={styles.handlePrefix}>@</Text>
            <TextInput
              style={styles.handleInput}
              value={handle}
              onChangeText={(value) => setHandle(value.replace(/^@/, "").toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              placeholder="maria_g"
              placeholderTextColor={palette.textMuted}
            />
          </View>
          <Text style={styles.hint}>
            People can find you by this exactly, even if you&apos;re not listed below.
          </Text>

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.switchTitle}>Let neighbors find me</Text>
              <Text style={styles.switchHint}>
                Off: only people who know your username can start a chat.
              </Text>
            </View>
            <Switch
              value={discoverable}
              onValueChange={(value) => {
                setDiscoverable(value);
                // Saved immediately: a visibility switch that needs a separate
                // Save press is one somebody flips, leaves, and believes.
                void save({ discoverable: value });
              }}
              trackColor={{ true: palette.primary }}
              disabled={saving || !profile?.exists}
            />
          </View>
          {!profile?.exists ? (
            <Text style={styles.hint}>
              Save your name first, then you can choose whether to be listed.
            </Text>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {dirty ? (
            <Pressable
              style={[styles.saveButton, saving && { opacity: 0.6 }]}
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
            >
              <Text style={styles.saveButtonText}>{saving ? "Saving…" : "Save profile"}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },

    qrCard: {
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.lg,
      ...shadows.soft,
    },
    qrAddress: { fontSize: 13, color: palette.textMuted, fontVariant: ["tabular-nums"] },
    qrActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    qrAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    qrActionText: { fontSize: 13, fontWeight: "600", color: palette.primaryStrong },

    emptyCard: {
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
    },
    body: { fontSize: 13, color: palette.textMuted, textAlign: "center", lineHeight: 19 },

    sectionTitle: { fontSize: 16, fontWeight: "700", color: palette.text, marginTop: spacing.sm },
    sectionBody: { fontSize: 13, color: palette.textMuted, marginTop: -spacing.xs, lineHeight: 18 },

    loading: { paddingVertical: spacing.xl, alignItems: "center" },

    profileCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
    },
    avatarRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.sm },
    avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: palette.surfaceStrong },
    avatarBusy: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 32,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
    avatarBadge: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: palette.surface,
    },
    avatarText: { flex: 1 },
    avatarTitle: { fontSize: 15, fontWeight: "600", color: palette.text },
    avatarHint: { fontSize: 12, color: palette.textMuted, marginTop: 2, lineHeight: 17 },

    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.text,
      marginTop: spacing.md,
      marginBottom: 6,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 11,
      fontSize: 15,
      color: palette.text,
      backgroundColor: palette.surfaceMuted,
    },
    handleRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceMuted,
      paddingHorizontal: 12,
    },
    handlePrefix: { fontSize: 15, color: palette.textMuted, marginRight: 2 },
    handleInput: { flex: 1, paddingVertical: 11, fontSize: 15, color: palette.text },
    hint: { fontSize: 12, color: palette.textMuted, marginTop: 5, lineHeight: 16 },

    switchRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    switchText: { flex: 1 },
    switchTitle: { fontSize: 15, fontWeight: "600", color: palette.text },
    switchHint: { fontSize: 12, color: palette.textMuted, marginTop: 3, lineHeight: 16 },

    error: { fontSize: 13, color: palette.danger, marginTop: spacing.md },
    saveButton: {
      marginTop: spacing.lg,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingVertical: 13,
      alignItems: "center",
    },
    saveButtonText: { color: palette.white, fontWeight: "700", fontSize: 15 },
  });
}
