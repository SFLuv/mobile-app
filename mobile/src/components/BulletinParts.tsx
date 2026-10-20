import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  ImageStyle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackendClient } from "../services/appBackend";
import { useBulletinPhoto } from "../hooks/useBulletinPhoto";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import {
  BULLETIN_BADGE_LABELS,
  BulletinCategory,
  BulletinPost,
  BulletinRequestError,
  PublicUser,
  REPORT_REASONS,
  ReportReason,
  UserProfile,
} from "../types/bulletin";

export const CATEGORY_ICONS: Record<BulletinCategory, keyof typeof Ionicons.glyphMap> = {
  free: "gift-outline",
  for_sale: "pricetag-outline",
  notice: "megaphone-outline",
};

export function formatPrice(post: Pick<BulletinPost, "category" | "price_sfluv">, tokenSymbol: string): string {
  if (post.category === "free") return "Free";
  if (post.category === "notice") return "";
  return post.price_sfluv ? `${post.price_sfluv} ${tokenSymbol}` : "";
}

export function formatAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export function formatDistance(miles?: number | null): string {
  if (miles === null || miles === undefined) return "";
  return `${miles.toFixed(1)} mi`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Shows a Bulletin photo, fetched with the session; a quiet icon until it arrives. */
export function BulletinPhotoView({
  client,
  photoId,
  fallbackIcon = "image-outline",
  style,
}: {
  client: AppBackendClient | null;
  photoId: number | null | undefined;
  fallbackIcon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ImageStyle>;
}) {
  const { palette } = useAppTheme();
  const uri = useBulletinPhoto(client, photoId);
  if (uri) {
    return <Image source={{ uri }} style={style} resizeMode="cover" />;
  }
  return (
    <View style={[style as object, { alignItems: "center", justifyContent: "center", backgroundColor: palette.surfaceStrong }]}>
      <Ionicons name={fallbackIcon} size={26} color={palette.textMuted} />
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { palette } = useAppTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: palette.primaryMuted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: palette.primaryStrong, fontWeight: "700", fontSize: size * 0.36 }}>{initials(name)}</Text>
    </View>
  );
}

export function BadgeLine({ user }: { user: PublicUser }) {
  const { palette } = useAppTheme();
  const parts: string[] = user.badges.map((badge) => BULLETIN_BADGE_LABELS[badge]).filter(Boolean);
  if (user.good_trades > 0) {
    parts.push(`${user.good_trades} good trade${user.good_trades === 1 ? "" : "s"}`);
  }
  if (parts.length === 0) return null;
  return <Text style={{ color: palette.textMuted, fontSize: 12 }}>{parts.join(" · ")}</Text>;
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "primary" | "warning" }) {
  const { palette } = useAppTheme();
  const colors =
    tone === "primary"
      ? { bg: palette.primaryMuted, fg: palette.primaryStrong }
      : tone === "warning"
        ? { bg: palette.surfaceStrong, fg: palette.warning }
        : { bg: palette.surfaceStrong, fg: palette.textMuted };
  return (
    <View style={{ backgroundColor: colors.bg, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 3 }}>
      <Text style={{ color: colors.fg, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

function sheetStyles(palette: Palette) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: "flex-end" },
    card: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
      maxHeight: "88%",
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
    title: { fontSize: 18, fontWeight: "700", color: palette.text },
    body: { fontSize: 14, color: palette.textMuted, lineHeight: 20, marginBottom: spacing.md },
    label: { fontSize: 13, color: palette.textMuted, marginBottom: 6, marginTop: spacing.sm },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: palette.text,
      backgroundColor: palette.surfaceMuted,
    },
    row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
    rowText: { flex: 1, paddingRight: spacing.md },
    rowTitle: { fontSize: 15, color: palette.text },
    rowHint: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    primary: {
      backgroundColor: palette.primary,
      borderRadius: radii.pill,
      paddingVertical: 13,
      alignItems: "center",
      marginTop: spacing.lg,
    },
    primaryText: { color: palette.white, fontWeight: "700", fontSize: 15 },
    error: { color: palette.danger, fontSize: 13, marginTop: spacing.sm },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      padding: 12,
      marginBottom: 8,
    },
    optionActive: { borderColor: palette.primary, backgroundColor: palette.primaryMuted },
    optionText: { fontSize: 15, color: palette.text },
  });
}

/**
 * Asked once, the first time someone posts or messages: how neighbors will see
 * their name ("First L." suggested), and whether people can find them in search.
 */
export function ProfileSetupSheet({
  visible,
  client,
  onClose,
  onSaved,
}: {
  visible: boolean;
  client: AppBackendClient | null;
  onClose: () => void;
  onSaved: (profile: UserProfile) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => sheetStyles(palette), [palette]);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [discoverable, setDiscoverable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !client) return;
    setError(null);
    void client
      .getMyProfile()
      .then((profile) => {
        setName(profile.exists ? profile.public_name : profile.suggested_public_name || "");
        setHandle(profile.handle ?? "");
        setDiscoverable(profile.discoverable);
      })
      .catch(() => {});
  }, [client, visible]);

  const save = async () => {
    if (!client) return;
    setSaving(true);
    setError(null);
    try {
      const profile = await client.saveMyProfile({
        public_name: name,
        handle: handle.trim() ? handle.trim() : null,
        discoverable,
      });
      onSaved(profile);
    } catch (e) {
      setError(e instanceof BulletinRequestError ? e.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>How should neighbors see you?</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.body}>
              This name shows on your posts and messages. You can change it anytime in Messages.
            </Text>
            <Text style={styles.label}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} maxLength={40} placeholder="Maria G." placeholderTextColor={palette.textMuted} />
            <Text style={styles.label}>Handle (optional)</Text>
            <TextInput
              style={styles.input}
              value={handle}
              onChangeText={(value) => setHandle(value.replace(/^@/, "").toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              placeholder="maria_g"
              placeholderTextColor={palette.textMuted}
            />
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Let neighbors find me</Text>
                <Text style={styles.rowHint}>Off: only people who know your handle can find you.</Text>
              </View>
              <Switch value={discoverable} onValueChange={setDiscoverable} trackColor={{ true: palette.primary }} />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable style={[styles.primary, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
              <Text style={styles.primaryText}>{saving ? "Saving..." : "Save"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Report a post, message, or person. The reported thing leaves the reporter's view right away. */
export function ReportSheet({
  target,
  client,
  onClose,
  onReported,
}: {
  target: { type: "post" | "message" | "user"; id: string; label: string } | null;
  client: AppBackendClient | null;
  onClose: () => void;
  onReported: () => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => sheetStyles(palette), [palette]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(null);
    setDetails("");
    setError(null);
  }, [target?.id, target?.type]);

  const send = async () => {
    if (!client || !target) return;
    if (!reason) {
      setError("Choose a reason first.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await client.reportContent({ target_type: target.type, target_id: target.id, reason, details: details.trim() || undefined });
      onReported();
    } catch (e) {
      setError(e instanceof BulletinRequestError ? e.message : "Couldn't send the report. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={Boolean(target)} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>Report {target?.label ?? ""}</Text>
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={20} color={palette.textMuted} />
              </Pressable>
            </View>
            <Text style={styles.body}>An SFLuv admin will review this within 24 hours. The other person isn't told who reported them.</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {REPORT_REASONS.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.option, reason === option.value && styles.optionActive]}
                  onPress={() => setReason(option.value)}
                >
                  <Ionicons
                    name={reason === option.value ? "radio-button-on" : "radio-button-off"}
                    size={18}
                    color={reason === option.value ? palette.primary : palette.textMuted}
                  />
                  <Text style={styles.optionText}>{option.label}</Text>
                </Pressable>
              ))}
              <Text style={styles.label}>Anything else we should know? (optional)</Text>
              <TextInput
                style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]}
                value={details}
                onChangeText={setDetails}
                multiline
                maxLength={1000}
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Pressable style={[styles.primary, sending && { opacity: 0.6 }]} onPress={send} disabled={sending}>
                <Text style={styles.primaryText}>{sending ? "Sending..." : "Send report"}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
