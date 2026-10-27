import React, { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { BulletinRequestError, UserProfile } from "../types/bulletin";
import { ThemedActivityIndicator } from "./ThemedActivityIndicator";

/**
 * The one thing somebody has to do before they can use Messages: choose how
 * other people see them.
 *
 * ── Why this is a gate and not a settings screen ────────────────────────────
 *
 * It used to be a bottom sheet behind a small person icon in the Messages search
 * bar, opened only if you went looking for it. Which meant most people never
 * did, and a message from them arrived labelled with whatever fallback the
 * server had — so the first thing a neighbor saw was a stranger with no name.
 *
 * Now it is asked once, the first time the Chats tab is opened, and it cannot be
 * skipped: the alternative to answering is going back to where you were. That is
 * a deliberate cost, and it is the smallest one available — two fields — for the
 * thing it buys, which is that nobody is ever messaged by a nameless account.
 *
 * ── Why "cancel" goes back rather than closing ──────────────────────────────
 *
 * Closing onto the Chats tab would leave somebody looking at a chat list they
 * cannot use, with no explanation and no way to get the prompt back. Returning
 * them to the tab they came from is the honest outcome: they declined, so they
 * are where they were before they asked.
 *
 * ── Why the visibility toggle defaults on, but creates nothing ──────────────
 *
 * Being findable is what makes Messages work at all — a neighborhood directory
 * nobody is in is not a directory — so it is the sensible default and it is
 * presented plainly, not buried. But NOTHING is written until Continue is
 * pressed. Somebody who opens this and backs out has no profile, is not
 * discoverable, and is not in anybody's search results. The default is a
 * suggestion on a form, not a decision made for them.
 */
export function ProfileSetupModal({
  visible,
  client,
  /**
   * Shown as a first-run gate rather than an edit. Changes the copy, makes the
   * fields required, and turns Cancel into "go back".
   */
  mode,
  onCancel,
  onSaved,
}: {
  visible: boolean;
  client: AppBackendClient | null;
  mode: "required" | "edit";
  onCancel: () => void;
  onSaved: (profile: UserProfile) => void;
}) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  // On by default — see the note above. Nothing is written until Continue.
  const [discoverable, setDiscoverable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !client) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void client
      .getMyProfile()
      .then((profile) => {
        if (cancelled) {
          return;
        }
        setName(profile.exists ? profile.public_name : profile.suggested_public_name || "");
        setHandle(profile.handle ?? "");
        // An existing profile keeps its own setting; a new one starts on.
        setDiscoverable(profile.exists ? profile.discoverable : true);
      })
      .catch(() => {
        if (!cancelled) {
          // A failed read is not a failed save. The form still works with empty
          // fields, which is the state a first-time user is in anyway.
          setName("");
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
  }, [client, visible]);

  const trimmedName = name.trim();
  const trimmedHandle = handle.trim();
  // A username is required in the gate and optional when editing: somebody who
  // set one up before this existed has none, and forcing one on them to change
  // their display name would be a migration disguised as a form.
  const ready =
    trimmedName.length > 0 && (mode === "edit" || /^[a-z0-9_]{3,20}$/.test(trimmedHandle));

  const save = async () => {
    if (!client || !ready) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const profile = await client.saveMyProfile({
        public_name: trimmedName,
        handle: trimmedHandle ? trimmedHandle : null,
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Centred, matching the Participate tab's volunteer/improver choice.
            A bottom sheet reads as dismissible, and this one is a decision. */}
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="person-circle-outline" size={22} color={palette.primaryStrong} />
            </View>
            <Text style={styles.title}>
              {mode === "required" ? "Set up your profile" : "Your profile"}
            </Text>
            <Text style={styles.subtitle}>
              {mode === "required"
                ? "Messages need a name other people can recognise. You can change it any time."
                : "This is how neighbors see you on the Bulletin and in Messages."}
            </Text>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ThemedActivityIndicator />
            </View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.scroll}
            >
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
              <Text style={styles.hint}>Shown on your messages and posts.</Text>

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
                Letters, numbers and underscores. People can find you by this exactly, even if
                you&apos;re not listed below.
              </Text>

              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Let neighbors find me</Text>
                  <Text style={styles.rowHint}>
                    Off: only people who know your username can start a chat.
                  </Text>
                </View>
                <Switch
                  value={discoverable}
                  onValueChange={setDiscoverable}
                  trackColor={{ true: palette.primary }}
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}
            </ScrollView>
          )}

          <View style={styles.actions}>
            <Pressable style={styles.secondary} onPress={onCancel} disabled={saving}>
              <Text style={styles.secondaryText}>{mode === "required" ? "Not now" : "Cancel"}</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, (!ready || saving) && styles.primaryDisabled]}
              onPress={() => void save()}
              disabled={!ready || saving}
            >
              <Text style={styles.primaryText}>
                {saving ? "Saving…" : mode === "required" ? "Continue" : "Save"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    card: {
      width: "100%",
      maxWidth: 420,
      maxHeight: "86%",
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      padding: spacing.lg,
      ...shadows.card,
    },
    header: { alignItems: "center", marginBottom: spacing.md },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.sm,
    },
    title: { fontSize: 19, fontWeight: "700", color: palette.text, textAlign: "center" },
    subtitle: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      marginTop: 6,
      lineHeight: 18,
    },
    scroll: { flexGrow: 0 },
    loading: { paddingVertical: spacing.xl, alignItems: "center" },
    label: { fontSize: 13, fontWeight: "600", color: palette.text, marginTop: spacing.md, marginBottom: 6 },
    hint: { fontSize: 12, color: palette.textMuted, marginTop: 5, lineHeight: 16 },
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
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.lg,
      gap: spacing.md,
    },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, color: palette.text, fontWeight: "600" },
    rowHint: { fontSize: 12, color: palette.textMuted, marginTop: 3, lineHeight: 16 },
    error: { color: palette.danger, fontSize: 13, marginTop: spacing.md },
    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
    secondary: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
    },
    secondaryText: { color: palette.textMuted, fontWeight: "600", fontSize: 15 },
    primary: {
      flex: 1.4,
      paddingVertical: 13,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      alignItems: "center",
    },
    primaryDisabled: { opacity: 0.45 },
    primaryText: { color: palette.white, fontWeight: "700", fontSize: 15 },
  });
}
