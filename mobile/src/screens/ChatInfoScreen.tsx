import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Avatar, BadgeLine } from "../components/BulletinParts";
import { formatFileSize } from "../components/MessageAttachmentCard";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { fileTypeIcon } from "../utils/attachmentFiles";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import {
  BulletinRequestError,
  Conversation,
  ConversationFile,
  ConversationMember,
  ConversationRole,
} from "../types/bulletin";

/**
 * What the info button opens: everything about one conversation.
 *
 * ── Why this replaced the "..." menu ────────────────────────────────────────
 *
 * The thread header used to carry an ellipsis that opened a four-item Alert:
 * block, report, archive, cancel. That was fine for a two-person thread with
 * nothing to administer, and wrong the moment groups arrived — a group has a
 * name, a picture, a member list with roles, and a set of permissions, none of
 * which fit in an action sheet.
 *
 * So the glyph became an "i", which promises a screen about this thing rather
 * than a list of verbs, and the verbs moved onto it. The direct-thread version
 * keeps the same four actions it always had; they are just somewhere a fifth
 * could be added.
 *
 * ── Permissions, as the UI applies them ─────────────────────────────────────
 *
 * The server is authoritative — every rule here is enforced in app_chat_group.go
 * and none of this is load-bearing for safety. What the UI does is not offer a
 * control that would be refused, because a button that returns an error is worse
 * than no button:
 *
 *   - Owner: rename, change the picture, add, remove anybody, promote, demote,
 *     hand the group over. Cannot leave without handing it over first.
 *   - Admin: rename, change the picture, add, remove plain members. Cannot touch
 *     another admin, and cannot change roles.
 *   - Member: leave.
 */

type Segment = "about" | "files";

const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: "about", label: "About" },
  { value: "files", label: "Files" },
];

export function ChatInfoScreen({
  conversation,
  myUserId,
  backendClient,
  hapticsEnabled,
  onBack,
  onConversationChanged,
  onLeft,
  onOpenMember,
  onAddMembers,
  onToast,
}: {
  conversation: Conversation;
  /**
   * The signed-in account. Needed because leaving a group is "remove me", and
   * the member list cannot say which row is you — several people share a role.
   */
  myUserId: string;
  backendClient: AppBackendClient | null;
  hapticsEnabled: boolean;
  onBack: () => void;
  /** Re-read after a change, so the thread header updates too. */
  onConversationChanged: () => void;
  /** Left the group, or archived the thread: there is nothing to go back to. */
  onLeft: () => void;
  onOpenMember: (userId: string) => void;
  /** Opens the picker, which reports back which people were chosen. */
  onAddMembers: (conversationId: number) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [segment, setSegment] = useState<Segment>("about");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title ?? "");
  const [busy, setBusy] = useState(false);
  const [iconUri, setIconUri] = useState<string | null>(null);

  const isGroup = conversation.kind === "group";
  const myRole: ConversationRole = conversation.my_role ?? "member";
  const isOwner = myRole === "owner";
  const canAdminister = isOwner || myRole === "admin";

  useEffect(() => {
    setTitle(conversation.title ?? "");
  }, [conversation.title]);

  // The group picture, fetched through the session like any other attachment.
  useEffect(() => {
    if (!backendClient || !conversation.icon_attachment_id) {
      setIconUri(null);
      return;
    }
    let cancelled = false;
    void backendClient
      .getConversationAttachmentDataUri(conversation.id, conversation.icon_attachment_id)
      .then((uri) => {
        if (!cancelled) {
          setIconUri(uri);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [backendClient, conversation.icon_attachment_id, conversation.id]);

  const run = async (work: () => Promise<void>, failure: string) => {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await work();
      onConversationChanged();
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : failure, "error");
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = () =>
    run(async () => {
      const next = title.trim();
      if (!next || next === conversation.title) {
        setRenaming(false);
        return;
      }
      await backendClient?.updateGroupConversation(conversation.id, { title: next });
      setRenaming(false);
    }, "Couldn't rename the group.");

  const changePicture = () =>
    run(async () => {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onToast("SFLuv needs photo access to set a group picture.", "error");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets[0]) {
        return;
      }
      await backendClient?.uploadGroupIcon(conversation.id, {
        uri: result.assets[0].uri,
        mimeType: result.assets[0].mimeType,
        fileName: result.assets[0].fileName,
      });
    }, "Couldn't set the group picture.");

  const confirmLeave = () => {
    if (isOwner) {
      // The server refuses this, and saying why is more use than letting them
      // press it and read an error.
      Alert.alert(
        "You own this group",
        "Make somebody else the owner first, then you can leave.",
        [{ text: "OK" }],
      );
      return;
    }
    Alert.alert("Leave this group?", "You'll stop receiving its messages.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () =>
          void run(async () => {
            // Removing yourself IS leaving, as far as the server is concerned —
            // one endpoint, one rule, and the permission check there treats
            // actor == target as the thing any member may do.
            await backendClient?.removeGroupMember(conversation.id, myUserId);
            onLeft();
          }, "Couldn't leave the group."),
      },
    ]);
  };

  return (
    <SwipeBack onBack={onBack} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isGroup ? "Group info" : "Info"}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.segments}>
        <SegmentedTabs
          segments={SEGMENTS}
          value={segment}
          onChange={setSegment}
          hapticsEnabled={hapticsEnabled}
        />
      </View>

      {segment === "files" ? (
        <ConversationFiles
          conversationId={conversation.id}
          backendClient={backendClient}
          onToast={onToast}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.identity}>
            <Pressable
              onPress={isGroup && canAdminister ? () => void changePicture() : undefined}
              disabled={!isGroup || !canAdminister}
              accessibilityRole={isGroup && canAdminister ? "button" : undefined}
              accessibilityLabel={isGroup && canAdminister ? "Change the group picture" : undefined}
            >
              {iconUri ? (
                <Image source={{ uri: iconUri }} style={styles.icon} />
              ) : (
                <Avatar
                  name={isGroup ? conversation.title || "Group" : conversation.other_user.public_name}
                  size={76}
                />
              )}
              {isGroup && canAdminister ? (
                <View style={styles.iconBadge}>
                  <Ionicons name="camera" size={13} color={palette.white} />
                </View>
              ) : null}
            </Pressable>

            {isGroup && renaming ? (
              <View style={styles.renameRow}>
                <TextInput
                  style={styles.renameInput}
                  value={title}
                  onChangeText={setTitle}
                  maxLength={60}
                  autoFocus
                  placeholder="Group name"
                  placeholderTextColor={palette.textMuted}
                />
                <Pressable onPress={() => void saveTitle()} hitSlop={8} accessibilityLabel="Save name">
                  <Ionicons name="checkmark" size={22} color={palette.primaryStrong} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={styles.nameRow}
                onPress={isGroup && canAdminister ? () => setRenaming(true) : undefined}
                disabled={!isGroup || !canAdminister}
              >
                <Text style={styles.name}>
                  {isGroup ? conversation.title || "Group" : conversation.other_user.public_name}
                </Text>
                {isGroup && canAdminister ? (
                  <Ionicons name="pencil" size={14} color={palette.textMuted} />
                ) : null}
              </Pressable>
            )}

            {isGroup ? (
              <Text style={styles.subtitle}>
                {conversation.member_count ?? 0}{" "}
                {conversation.member_count === 1 ? "person" : "people"}
              </Text>
            ) : (
              <BadgeLine user={conversation.other_user} />
            )}
          </View>

          {isGroup ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Members</Text>
                {canAdminister ? (
                  <Pressable
                    onPress={() => {
                      triggerClickHaptic(hapticsEnabled);
                      onAddMembers(conversation.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Add people"
                  >
                    <Text style={styles.sectionAction}>Add</Text>
                  </Pressable>
                ) : null}
              </View>

              {(conversation.members ?? []).map((member) => (
                <MemberRow
                  key={member.user.user_id}
                  member={member}
                  myRole={myRole}
                  myUserId={myUserId}
                  onOpen={() => onOpenMember(member.user.user_id)}
                  onRemove={() =>
                    void run(
                      () =>
                        backendClient?.removeGroupMember(conversation.id, member.user.user_id) ??
                        Promise.resolve(),
                      "Couldn't remove them.",
                    )
                  }
                  onSetRole={(role) =>
                    void run(
                      () =>
                        backendClient?.setGroupMemberRole(conversation.id, member.user.user_id, role) ??
                        Promise.resolve(),
                      "Couldn't change their role.",
                    )
                  }
                />
              ))}

              <Pressable style={styles.dangerRow} onPress={confirmLeave} disabled={busy}>
                <Ionicons name="exit-outline" size={19} color={palette.danger} />
                <Text style={styles.dangerText}>Leave group</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.actions}>
              <Pressable
                style={styles.actionRow}
                onPress={() => onOpenMember(conversation.other_user.user_id)}
              >
                <Ionicons name="person-outline" size={19} color={palette.text} />
                <Text style={styles.actionText}>View profile</Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
              </Pressable>

              <Pressable
                style={styles.actionRow}
                onPress={() =>
                  void run(async () => {
                    if (conversation.blocked_by_me) {
                      await backendClient?.unblockUser(conversation.other_user.user_id);
                      onToast("Unblocked.", "success");
                    } else {
                      await backendClient?.blockUser(conversation.other_user.user_id);
                      onToast("Blocked. They can't message you.", "success");
                    }
                  }, "Couldn't change that.")
                }
              >
                <Ionicons
                  name={conversation.blocked_by_me ? "lock-open-outline" : "ban-outline"}
                  size={19}
                  color={conversation.blocked_by_me ? palette.text : palette.danger}
                />
                <Text
                  style={[styles.actionText, !conversation.blocked_by_me && { color: palette.danger }]}
                >
                  {conversation.blocked_by_me
                    ? `Unblock ${conversation.other_user.public_name}`
                    : `Block ${conversation.other_user.public_name}`}
                </Text>
              </Pressable>

              <Pressable
                style={styles.actionRow}
                onPress={() =>
                  Alert.alert(
                    "Archive this conversation?",
                    "It comes back if either of you sends a message.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Archive",
                        onPress: () =>
                          void run(async () => {
                            await backendClient?.archiveConversation(conversation.id);
                            onLeft();
                          }, "Couldn't archive that."),
                      },
                    ],
                  )
                }
              >
                <Ionicons name="archive-outline" size={19} color={palette.text} />
                <Text style={styles.actionText}>Archive conversation</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
    </SwipeBack>
  );
}

function MemberRow({
  member,
  myRole,
  myUserId,
  onOpen,
  onRemove,
  onSetRole,
}: {
  member: ConversationMember;
  myRole: ConversationRole;
  myUserId: string;
  onOpen: () => void;
  onRemove: () => void;
  onSetRole: (role: ConversationRole) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  // Mirrors the server's rules so nothing is offered that would be refused.
  // See the header note.
  const isMe = member.user.user_id === myUserId;
  const canRemove =
    !member.left &&
    !isMe &&
    member.role !== "owner" &&
    (myRole === "owner" || (myRole === "admin" && member.role === "member"));
  // Not on yourself: the owner demoting themselves, or an admin dropping their
  // own rank, is a different decision with different consequences, and the one
  // that matters — handing the group over — has its own confirmation.
  const canChangeRole = myRole === "owner" && !isMe && member.role !== "owner" && !member.left;

  const openMenu = () => {
    const options: Array<{ text: string; style?: "destructive" | "cancel"; onPress?: () => void }> = [
      { text: "View profile", onPress: onOpen },
    ];
    if (canChangeRole) {
      options.push(
        member.role === "admin"
          ? { text: "Remove as admin", onPress: () => onSetRole("member") }
          : { text: "Make admin", onPress: () => onSetRole("admin") },
      );
      options.push({
        text: "Make owner",
        onPress: () =>
          Alert.alert(
            "Hand the group over?",
            `${member.user.public_name} will own this group and you'll become an admin. This can't be undone by you.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Hand over", style: "destructive", onPress: () => onSetRole("owner") },
            ],
          ),
      });
    }
    if (canRemove) {
      options.push({
        text: `Remove ${member.user.public_name}`,
        style: "destructive",
        onPress: onRemove,
      });
    }
    options.push({ text: "Cancel", style: "cancel" });
    Alert.alert(member.user.public_name, undefined, options);
  };

  return (
    <Pressable style={styles.memberRow} onPress={openMenu}>
      <Avatar name={member.user.public_name} size={38} />
      <View style={styles.memberBody}>
        <Text style={[styles.memberName, member.left && styles.memberLeft]} numberOfLines={1}>
          {member.user.public_name}
        </Text>
        <Text style={styles.memberMeta} numberOfLines={1}>
          {member.left
            ? "Left the group"
            : member.inactive
              ? "Can't receive messages right now"
              : [
                  member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "",
                  isMe ? "You" : member.user.handle ? `@${member.user.handle}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || "Member"}
        </Text>
      </View>
      {member.role === "owner" ? (
        <Ionicons name="star" size={15} color={palette.warning} />
      ) : member.role === "admin" ? (
        <Ionicons name="shield-checkmark" size={15} color={palette.primaryStrong} />
      ) : null}
    </Pressable>
  );
}

/**
 * Every photo and file shared in the thread, searchable by name.
 *
 * Searching on the server rather than filtering a loaded list: a long-running
 * group can have hundreds, and "find the PDF Maria sent in March" is the thing
 * this tab exists for.
 */
function ConversationFiles({
  conversationId,
  backendClient,
  onToast,
}: {
  conversationId: number;
  backendClient: AppBackendClient | null;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<ConversationFile[] | null>(null);
  /** The file open in the full-screen preview, with its save button. */
  const [preview, setPreview] = useState<ConversationFile | null>(null);

  const load = useCallback(
    async (search: string) => {
      if (!backendClient) {
        return;
      }
      try {
        setFiles(await backendClient.searchConversationFiles(conversationId, search));
      } catch {
        setFiles((current) => current ?? []);
        onToast("Couldn't load this conversation's files.", "error");
      }
    },
    [backendClient, conversationId, onToast],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(query), query ? 280 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search files"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={17} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={files ?? []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        ListEmptyComponent={
          files === null ? (
            <View style={styles.filesEmpty}>
              <ThemedActivityIndicator />
            </View>
          ) : (
            <View style={styles.filesEmpty}>
              <Ionicons name="folder-open-outline" size={28} color={palette.textMuted} />
              <Text style={styles.filesEmptyText}>
                {query ? "Nothing matches that." : "No photos or files shared yet."}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          // An icon per file TYPE, not per category. "Find the CSV Maria sent"
          // is the errand this list exists for, and a spreadsheet that looks
          // like a PDF does not help with it.
          const typeInfo = fileTypeIcon(item);
          return (
            <Pressable
              style={styles.fileRow}
              onPress={() => setPreview(item)}
              accessibilityRole="button"
              accessibilityLabel={`${typeInfo.label}: ${item.file_name || "file"}`}
            >
              <View style={styles.fileIcon}>
                <Ionicons
                  name={typeInfo.icon as keyof typeof Ionicons.glyphMap}
                  size={19}
                  color={palette.primaryStrong}
                />
              </View>
              <View style={styles.memberBody}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {item.file_name || (item.kind === "image" ? "Photo" : "File")}
                </Text>
                <Text style={styles.memberMeta} numberOfLines={1}>
                  {[
                    typeInfo.label,
                    formatFileSize(item.size_bytes),
                    item.sender_name,
                    formatDate(item.created_at),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={palette.textMuted} />
            </Pressable>
          );
        }}
      />

      {/* The same preview the thread uses, so a file found by search opens
          exactly as it would from the message it arrived in. */}
      <AttachmentPreview
        attachment={preview}
        conversationId={conversationId}
        client={backendClient}
        senderName={preview?.sender_name}
        onClose={() => setPreview(null)}
        onToast={onToast}
      />
    </View>
  );
}

function formatDate(seconds: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    segments: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    content: { padding: spacing.md, paddingBottom: spacing.xxl },

    identity: { alignItems: "center", paddingVertical: spacing.lg, gap: 6 },
    icon: { width: 76, height: 76, borderRadius: 38, backgroundColor: palette.surfaceStrong },
    iconBadge: {
      position: "absolute",
      right: -2,
      bottom: -2,
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: palette.primary,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: palette.background,
    },
    nameRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
    name: { fontSize: 19, fontWeight: "700", color: palette.text },
    subtitle: { fontSize: 13, color: palette.textMuted },
    renameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm,
      width: "100%",
    },
    renameInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceMuted,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 16,
      color: palette.text,
    },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionAction: { fontSize: 14, fontWeight: "600", color: palette.primaryStrong },

    memberRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    memberBody: { flex: 1 },
    memberName: { fontSize: 15, fontWeight: "600", color: palette.text },
    memberLeft: { color: palette.textMuted },
    memberMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },

    actions: { marginTop: spacing.md, gap: 2 },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 13,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.sm,
    },
    actionText: { flex: 1, fontSize: 15, color: palette.text },

    dangerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 14,
      marginTop: spacing.lg,
      justifyContent: "center",
    },
    dangerText: { fontSize: 15, fontWeight: "600", color: palette.danger },

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
    searchInput: { flex: 1, paddingVertical: 9, fontSize: 15, color: palette.text },
    fileRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
    fileIcon: {
      width: 36,
      height: 36,
      borderRadius: radii.sm,
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    filesEmpty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm },
    filesEmptyText: { fontSize: 14, color: palette.textMuted, textAlign: "center" },
  });
}
