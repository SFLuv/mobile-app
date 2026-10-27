import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Avatar, BadgeLine } from "../components/BulletinParts";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { BulletinRequestError, PublicUser } from "../types/bulletin";

/**
 * Choosing who to message: one person, or several for a group.
 *
 * ── Why saved contacts appear here ──────────────────────────────────────────
 *
 * Searching people on SFLuv only finds those who chose to be findable, or whose
 * exact @handle you already know. That is the right rule for strangers — being
 * in the app is not consent to being looked up by name — and the wrong one for
 * somebody whose wallet address is already in your phone.
 *
 * So the server searches your own contacts alongside the public directory, and
 * a contact match comes back under the name YOU saved rather than the public
 * name they chose, because that is what you typed and what you expect to see.
 * The row is marked "In your contacts" so it is distinguishable from a stranger
 * with a similar name.
 *
 * Nothing about this tells you whether a contact has an account. They either
 * appear here, because they do, or they do not — the same way a phone shows
 * iMessage for some numbers and SMS for others without ever announcing it.
 */
export function NewMessageScreen({
  backendClient,
  hapticsEnabled,
  /** Pre-selects group mode, for "add people" from a group's info screen. */
  mode = "choose",
  /** Set when adding to an existing group, which changes the action's wording. */
  addingToConversationId,
  onBack,
  onStartDirect,
  onCreateGroup,
  onAddToGroup,
  onToast,
}: {
  backendClient: AppBackendClient | null;
  hapticsEnabled: boolean;
  mode?: "choose" | "group" | "add";
  addingToConversationId?: number;
  onBack: () => void;
  onStartDirect: (userId: string) => void;
  onCreateGroup: (title: string, userIds: string[]) => Promise<void>;
  onAddToGroup?: (conversationId: number, userIds: string[]) => Promise<void>;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [merchants, setMerchants] = useState<
    Array<{ location_id: number; name: string; owner_user_id: string }>
  >([]);
  const [selected, setSelected] = useState<PublicUser[]>([]);
  const [groupMode, setGroupMode] = useState(mode !== "choose");
  const [groupTitle, setGroupTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const isAdding = mode === "add";

  const search = useCallback(
    async (text: string) => {
      if (!backendClient) {
        return;
      }
      const trimmed = text.trim().replace(/^@/, "");
      if (trimmed.length < 2) {
        setResults(null);
        setMerchants([]);
        return;
      }
      try {
        const found = await backendClient.searchSFLuvUsers(text.trim());
        setResults(found.users);
        setMerchants(found.merchants);
      } catch {
        setResults([]);
        setMerchants([]);
      }
    },
    [backendClient],
  );

  useEffect(() => {
    const timer = setTimeout(() => void search(query), 280);
    return () => clearTimeout(timer);
  }, [query, search]);

  const toggle = (user: PublicUser) => {
    triggerClickHaptic(hapticsEnabled);
    setSelected((current) =>
      current.some((entry) => entry.user_id === user.user_id)
        ? current.filter((entry) => entry.user_id !== user.user_id)
        : [...current, user],
    );
  };

  const submit = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      if (isAdding && addingToConversationId && onAddToGroup) {
        await onAddToGroup(
          addingToConversationId,
          selected.map((entry) => entry.user_id),
        );
        onBack();
        return;
      }
      const title = groupTitle.trim();
      if (!title) {
        onToast("Give the group a name.", "error");
        return;
      }
      await onCreateGroup(
        title,
        selected.map((entry) => entry.user_id),
      );
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't do that.", "error");
    } finally {
      setBusy(false);
    }
  };

  const searching = query.trim().replace(/^@/, "").length >= 2;
  const rows = [
    ...(results ?? []).map((user) => ({
      key: `u:${user.user_id}`,
      userId: user.user_id,
      title: user.public_name,
      user,
    })),
    // Merchants are an account too — the owner's — so messaging one is messaging
    // a person. Kept visually distinct because the name is the shop's.
    ...merchants.map((merchant) => ({
      key: `m:${merchant.location_id}`,
      userId: merchant.owner_user_id,
      title: merchant.name,
      user: null as PublicUser | null,
    })),
  ];

  const canSubmit = isAdding
    ? selected.length > 0
    : selected.length > 0 && groupTitle.trim().length > 0;

  return (
    <SwipeBack onBack={onBack} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isAdding ? "Add people" : groupMode ? "New group" : "New message"}
        </Text>
        {isAdding ? (
          <View style={{ width: 26 }} />
        ) : (
          <Pressable
            onPress={() => {
              setGroupMode((current) => !current);
              setSelected([]);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={groupMode ? "Message one person instead" : "Create a group instead"}
          >
            <Ionicons
              name={groupMode ? "person-outline" : "people-outline"}
              size={22}
              color={palette.primaryStrong}
            />
          </Pressable>
        )}
      </View>

      {groupMode && !isAdding ? (
        <TextInput
          style={styles.groupTitleInput}
          value={groupTitle}
          onChangeText={setGroupTitle}
          placeholder="Group name"
          placeholderTextColor={palette.textMuted}
          maxLength={60}
        />
      ) : null}

      {selected.length > 0 ? (
        <View style={styles.chips}>
          {selected.map((entry) => (
            <Pressable
              key={entry.user_id}
              style={styles.chip}
              onPress={() => toggle(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry.public_name}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>
                {entry.public_name}
              </Text>
              <Ionicons name="close" size={13} color={palette.primaryStrong} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts and people on SFLuv"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          !searching ? (
            <View style={styles.hint}>
              <Ionicons name="people-outline" size={28} color={palette.textMuted} />
              <Text style={styles.hintText}>
                Search for someone by name or @username. People you&apos;ve saved as contacts show
                up here too.
              </Text>
            </View>
          ) : results === null ? (
            <View style={styles.hint}>
              <ThemedActivityIndicator />
            </View>
          ) : (
            <View style={styles.hint}>
              <Text style={styles.hintText}>
                No one found. People only show up here if they&apos;ve chosen to be findable, if you
                search their exact @username, or if they&apos;re already one of your contacts.
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const chosen = selected.some((entry) => entry.user_id === item.userId);
          return (
            <Pressable
              style={styles.row}
              onPress={() => {
                if (groupMode || isAdding) {
                  toggle(
                    item.user ?? {
                      user_id: item.userId,
                      public_name: item.title,
                      badges: [],
                      good_trades: 0,
                    },
                  );
                  return;
                }
                triggerClickHaptic(hapticsEnabled);
                onStartDirect(item.userId);
              }}
            >
              <Avatar name={item.title} />
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.user?.saved_contact ? (
                  <Text style={styles.rowContact}>In your contacts</Text>
                ) : item.user ? (
                  <BadgeLine user={item.user} />
                ) : (
                  <Text style={styles.rowMeta}>Merchant</Text>
                )}
              </View>
              {groupMode || isAdding ? (
                <Ionicons
                  name={chosen ? "checkmark-circle" : "ellipse-outline"}
                  size={21}
                  color={chosen ? palette.primary : palette.borderStrong}
                />
              ) : (
                <Ionicons name="chevron-forward" size={17} color={palette.textMuted} />
              )}
            </Pressable>
          );
        }}
      />

      {groupMode || isAdding ? (
        <View style={styles.footer}>
          <Pressable
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            onPress={() => void submit()}
            disabled={!canSubmit || busy}
            accessibilityRole="button"
          >
            <Text style={styles.submitText}>
              {busy
                ? "Working…"
                : isAdding
                  ? `Add ${selected.length || ""}`.trim()
                  : `Create group${selected.length ? ` (${selected.length + 1})` : ""}`}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </SwipeBack>
  );
}

function createStyles(palette: Palette) {
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
    groupTitleInput: {
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: palette.text,
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      backgroundColor: palette.primaryMuted,
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
      maxWidth: 160,
    },
    chipText: { fontSize: 13, color: palette.primaryStrong, fontWeight: "600" },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginHorizontal: spacing.md,
      marginTop: spacing.sm,
      paddingHorizontal: 12,
      borderRadius: radii.pill,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    searchInput: { flex: 1, paddingVertical: 10, fontSize: 15, color: palette.text },
    listContent: { padding: spacing.md },
    row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    rowBody: { flex: 1 },
    rowName: { fontSize: 15, fontWeight: "600", color: palette.text },
    rowMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    rowContact: { fontSize: 12, color: palette.primaryStrong, marginTop: 2, fontWeight: "600" },
    hint: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
    hintText: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 19,
      paddingHorizontal: spacing.lg,
    },
    footer: {
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    submit: {
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
      paddingVertical: 13,
      alignItems: "center",
    },
    submitDisabled: { opacity: 0.4 },
    submitText: { color: palette.white, fontWeight: "700", fontSize: 15 },
  });
}
