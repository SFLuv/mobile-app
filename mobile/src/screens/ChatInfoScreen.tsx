import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "../components/AppText";
import { Ionicons } from "@expo/vector-icons";

import { AppBackendClient } from "../services/appBackend";
import { SwipeBack } from "../components/SwipeBack";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { BadgeLine } from "../components/BulletinParts";
import { ChatAvatar } from "../components/ChatAvatar";
import { formatFileSize } from "../components/MessageAttachmentCard";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { displayFileName, fileTypeIcon } from "../utils/attachmentFiles";
import { pickAvatarPhoto } from "../utils/avatarPicker";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { useContactNames } from "../services/contactOverrides";
import { triggerClickHaptic } from "../utils/haptics";
import {
  BulletinRequestError,
  ChatMessage,
  Conversation,
  ConversationFile,
  ConversationMember,
  ConversationRole,
} from "../types/bulletin";
import { t } from "../i18n";
import { dirIcon } from "../i18n/direction";
import { appLocale } from "../i18n";
import { bodyWithMentionNames } from "../utils/mentions";

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

/** Built per call so labels follow the current language. */
const SEGMENTS = (): Array<{ value: Segment; label: string }> => [
  { value: "about", label: t("chatInfo.about") },
  { value: "files", label: t("chatInfo.files") },
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
  onJumpToMessage,
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
  /** A search result was picked: close this and show it in the thread. */
  onJumpToMessage?: (messageId: number) => void;
}) {
  const { palette } = useAppTheme();
  const nameFor = useContactNames();
  // Searching the conversation's messages. While there is a query, its results
  // stand in for the rest of the screen.
  const [messageQuery, setMessageQuery] = useState("");
  const otherName = conversation.other_user
    ? nameFor(conversation.other_user.user_id, conversation.other_user.public_name)
    : "";
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [segment, setSegment] = useState<Segment>("about");
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(conversation.title ?? "");
  const [busy, setBusy] = useState(false);
  /** A picture being picked or saved: a spinner on the picture itself. */
  const [pictureBusy, setPictureBusy] = useState(false);
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
    }, t("chatInfo.couldnTRenameTheGroup"));

  const changePicture = () =>
    run(async () => {
      setPictureBusy(true);
      try {
        const picked = await pickAvatarPhoto();
        if (!picked) {
          return;
        }
        await backendClient?.uploadGroupIcon(conversation.id, picked);
      } finally {
        setPictureBusy(false);
      }
    }, t("chatInfo.couldnTSetTheGroup"));

  const confirmLeave = () => {
    if (isOwner) {
      // The server refuses this, and saying why is more use than letting them
      // press it and read an error.
      Alert.alert(
        t("chatInfo.youOwnThisGroup"),
        t("chatInfo.makeSomebodyElseTheOwner"),
        [{ text: t("common.ok") }],
      );
      return;
    }
    Alert.alert(t("chatInfo.leaveThisGroup"), t("chatInfo.youLlStopReceivingIts"), [
      { text: t("chatInfo.cancel"), style: "cancel" },
      {
        text: t("chatInfo.leave"),
        style: "destructive",
        onPress: () =>
          void run(async () => {
            // Removing yourself IS leaving, as far as the server is concerned —
            // one endpoint, one rule, and the permission check there treats
            // actor == target as the thing any member may do.
            await backendClient?.removeGroupMember(conversation.id, myUserId);
            onLeft();
          }, t("chatInfo.couldnTLeaveTheGroup")),
      },
    ]);
  };

  return (
    <SwipeBack onBack={onBack} style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("chatInfo.back")}>
          <Ionicons name={dirIcon("chevron-back")} size={26} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isGroup ? t("chatInfo.groupInfo") : t("chatInfo.info")}</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={palette.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={messageQuery}
          onChangeText={setMessageQuery}
          placeholder={t("chatInfo.searchMessages")}
          placeholderTextColor={palette.textMuted}
          autoCorrect={false}
          returnKeyType="search"
        />
        {messageQuery ? (
          <Pressable onPress={() => setMessageQuery("")} hitSlop={8} accessibilityLabel={t("chatInfo.clearSearch")}>
            <Ionicons name="close-circle" size={17} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {messageQuery.trim() ? (
        <MessageSearch
          conversationId={conversation.id}
          backendClient={backendClient}
          query={messageQuery.trim()}
          otherName={otherName}
          onOpen={(messageId) => onJumpToMessage?.(messageId)}
        />
      ) : (
      <>
      <View style={styles.segments}>
        <SegmentedTabs
          segments={SEGMENTS()}
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
              accessibilityLabel={isGroup && canAdminister ? t("chatInfo.changeTheGroupPicture") : undefined}
            >
              {iconUri ? (
                <Image source={{ uri: iconUri }} style={styles.icon} />
              ) : (
                <ChatAvatar
                  client={backendClient}
                  name={isGroup ? conversation.title || t("chatInfo.group") : otherName}
                  size={76}
                  userId={isGroup ? null : conversation.other_user.user_id}
                />
              )}
              {pictureBusy ? (
                <View style={styles.iconBusy}>
                  <ActivityIndicator color={palette.white} />
                </View>
              ) : null}
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
                  placeholder={t("chatInfo.groupName")}
                  placeholderTextColor={palette.textMuted}
                />
                <Pressable onPress={() => void saveTitle()} hitSlop={8} accessibilityLabel={t("chatInfo.saveName")}>
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
                  {isGroup ? conversation.title || t("chatInfo.group") : otherName}
                </Text>
                {isGroup && canAdminister ? (
                  <Ionicons name="pencil" size={14} color={palette.textMuted} />
                ) : null}
              </Pressable>
            )}

            {isGroup ? (
              <Text style={styles.subtitle}>
                {t("components.shareSheet.peopleCount", { count: conversation.member_count ?? 0 })}
              </Text>
            ) : (
              <BadgeLine user={conversation.other_user} />
            )}
          </View>

          {isGroup ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t("chatInfo.members")}</Text>
                {canAdminister ? (
                  <Pressable
                    onPress={() => {
                      triggerClickHaptic(hapticsEnabled);
                      onAddMembers(conversation.id);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t("chatInfo.addPeople")}
                  >
                    <Text style={styles.sectionAction}>{t("chatInfo.add")}</Text>
                  </Pressable>
                ) : null}
              </View>

              {(conversation.members ?? []).map((member) => (
                <MemberRow
                  key={member.user.user_id}
                  member={member}
                  myRole={myRole}
                  myUserId={myUserId}
                  client={backendClient}
                  onOpen={() => onOpenMember(member.user.user_id)}
                  onRemove={() =>
                    void run(
                      () =>
                        backendClient?.removeGroupMember(conversation.id, member.user.user_id) ??
                        Promise.resolve(),
                      t("chatInfo.couldnTRemoveThem"),
                    )
                  }
                  onSetRole={(role) =>
                    void run(
                      () =>
                        backendClient?.setGroupMemberRole(conversation.id, member.user.user_id, role) ??
                        Promise.resolve(),
                      t("chatInfo.couldnTChangeTheirRole"),
                    )
                  }
                />
              ))}

              <Pressable style={styles.dangerRow} onPress={confirmLeave} disabled={busy}>
                <Ionicons name="exit-outline" size={19} color={palette.danger} />
                <Text style={styles.dangerText}>{t("chatInfo.leaveGroup")}</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.actions}>
              <Pressable
                style={styles.actionRow}
                onPress={() => onOpenMember(conversation.other_user.user_id)}
              >
                <Ionicons name="person-outline" size={19} color={palette.text} />
                <Text style={styles.actionText}>{t("chatInfo.viewProfile")}</Text>
                <Ionicons name={dirIcon("chevron-forward")} size={16} color={palette.textMuted} />
              </Pressable>

              <Pressable
                style={styles.actionRow}
                onPress={() =>
                  void run(async () => {
                    if (conversation.blocked_by_me) {
                      await backendClient?.unblockUser(conversation.other_user.user_id);
                      onToast(t("chatInfo.unblocked"), "success");
                    } else {
                      await backendClient?.blockUser(conversation.other_user.user_id);
                      onToast(t("chatInfo.blockedTheyCanTMessage"), "success");
                    }
                  }, t("chatInfo.couldnTChangeThat"))
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
                    ? t("chatInfo.unblockName", { name: otherName })
                    : t("chatInfo.blockName", { name: otherName })}
                </Text>
              </Pressable>

              <Pressable
                style={styles.actionRow}
                onPress={() =>
                  Alert.alert(
                    t("chatInfo.archiveThisConversation"),
                    t("chatInfo.itComesBackIfEither"),
                    [
                      { text: t("chatInfo.cancel"), style: "cancel" },
                      {
                        text: t("chatInfo.archive"),
                        onPress: () =>
                          void run(async () => {
                            await backendClient?.archiveConversation(conversation.id);
                            onLeft();
                          }, t("chatInfo.couldnTArchiveThat")),
                      },
                    ],
                  )
                }
              >
                <Ionicons name="archive-outline" size={19} color={palette.text} />
                <Text style={styles.actionText}>{t("chatInfo.archiveConversation")}</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      )}
      </>
      )}
    </SwipeBack>
  );
}

function MemberRow({
  member,
  myRole,
  myUserId,
  client,
  onOpen,
  onRemove,
  onSetRole,
}: {
  member: ConversationMember;
  myRole: ConversationRole;
  myUserId: string;
  /** For the member's picture; initials without it. */
  client: AppBackendClient | null;
  onOpen: () => void;
  onRemove: () => void;
  onSetRole: (role: ConversationRole) => void;
}) {
  const { palette } = useAppTheme();
  const nameFor = useContactNames();
  const memberName = nameFor(member.user.user_id, member.user.public_name);
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
      { text: t("chatInfo.viewProfile"), onPress: onOpen },
    ];
    if (canChangeRole) {
      options.push(
        member.role === "admin"
          ? { text: t("chatInfo.removeAsAdmin"), onPress: () => onSetRole("member") }
          : { text: t("chatInfo.makeAdmin"), onPress: () => onSetRole("admin") },
      );
      options.push({
        text: t("chatInfo.makeOwner"),
        onPress: () =>
          Alert.alert(
            t("chatInfo.handTheGroupOver"),
            t("chatInfo.willOwnThisGroupAnd", { memberName }),
            [
              { text: t("chatInfo.cancel"), style: "cancel" },
              { text: t("chatInfo.handOver"), style: "destructive", onPress: () => onSetRole("owner") },
            ],
          ),
      });
    }
    if (canRemove) {
      options.push({
        text: t("common.removeName", { name: memberName }),
        style: "destructive",
        onPress: onRemove,
      });
    }
    options.push({ text: t("chatInfo.cancel"), style: "cancel" });
    Alert.alert(memberName, undefined, options);
  };

  return (
    <Pressable style={styles.memberRow} onPress={openMenu}>
      <ChatAvatar client={client} name={memberName} size={38} userId={member.user.user_id} />
      <View style={styles.memberBody}>
        <Text style={[styles.memberName, member.left && styles.memberLeft]} numberOfLines={1}>
          {memberName}
        </Text>
        <Text style={styles.memberMeta} numberOfLines={1}>
          {member.left
            ? t("chatInfo.leftTheGroup")
            : member.inactive
              ? t("chatInfo.canTReceiveMessagesRight")
              : [
                  member.role === "owner" ? t("chatInfo.owner") : member.role === "admin" ? t("chatInfo.admin") : "",
                  isMe ? t("chatInfo.you") : member.user.handle ? `@${member.user.handle}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ") || t("chatInfo.member")}
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
/**
 * Messages in this conversation containing the query, newest first, each with
 * who said it and when. Tapping one closes the info screen and scrolls the
 * thread to it. Tags read in this reader's names, as in the thread.
 */
function MessageSearch({
  conversationId,
  backendClient,
  query,
  otherName,
  onOpen,
}: {
  conversationId: number;
  backendClient: AppBackendClient | null;
  query: string;
  otherName: string;
  onOpen: (messageId: number) => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const nameFor = useContactNames();
  const [results, setResults] = useState<ChatMessage[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // The server has no search yet (an older backend): say so instead of "no results".
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!backendClient || query.length < 2) {
      setResults(query.length < 2 ? [] : null);
      setHasMore(false);
      return;
    }
    let cancelled = false;
    setResults(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const page = await backendClient.searchConversationMessages(conversationId, query);
          if (!cancelled) {
            setResults(page.messages);
            setHasMore(page.has_more);
            setUnavailable(false);
          }
        } catch (error) {
          if (cancelled) {
            return;
          }
          setResults([]);
          setHasMore(false);
          setUnavailable(error instanceof BulletinRequestError && (error.status === 404 || error.status === 405));
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backendClient, conversationId, query]);

  const loadMore = async () => {
    const last = results?.[results.length - 1];
    if (!backendClient || !hasMore || loadingMore || !last) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await backendClient.searchConversationMessages(conversationId, query, last.id);
      setResults((current) => {
        const known = new Set((current ?? []).map((m) => m.id));
        return [...(current ?? []), ...page.messages.filter((m) => !known.has(m.id))];
      });
      setHasMore(page.has_more);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <FlatList
      data={results ?? []}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      onEndReachedThreshold={0.4}
      onEndReached={() => void loadMore()}
      ListEmptyComponent={
        results === null ? (
          <View style={styles.filesEmpty}>
            <ThemedActivityIndicator />
          </View>
        ) : (
          <View style={styles.filesEmpty}>
            <Ionicons name="search-outline" size={28} color={palette.textMuted} />
            <Text style={styles.filesEmptyText}>
              {unavailable
                ? t("chatInfo.searchNotAvailableYet")
                : query.length < 2
                  ? t("chatInfo.typeTwoLetters")
                  : t("chatInfo.noMessagesMatch")}
            </Text>
          </View>
        )
      }
      ListFooterComponent={loadingMore ? <ThemedActivityIndicator /> : null}
      renderItem={({ item }) => {
        const text = bodyWithMentionNames(item.body ?? "", item.mentions, nameFor);
        const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
        // A window around the match, so it is on screen even in a long message.
        const start = at > 40 ? at - 30 : 0;
        const prefix = start > 0 ? "…" : "";
        const before = text.slice(start, Math.max(at, start));
        const match = at >= 0 ? text.slice(at, at + query.length) : "";
        const after = at >= 0 ? text.slice(at + query.length) : text.slice(start);
        const who = item.is_mine
          ? t("chat.you")
          : nameFor(item.sender_id, item.sender_name || otherName || t("chat.message"));
        const when = new Date(item.created_at).toLocaleDateString(appLocale(), {
          month: "short",
          day: "numeric",
          year: new Date(item.created_at).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
        });
        return (
          <Pressable
            style={styles.searchResult}
            onPress={() => onOpen(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`${who}, ${when}: ${text}`}
          >
            <View style={styles.searchResultHead}>
              <Text style={styles.memberName} numberOfLines={1}>
                {who}
              </Text>
              <Text style={styles.memberMeta}>{when}</Text>
            </View>
            <Text style={styles.searchResultBody} numberOfLines={2}>
              {prefix}
              {before}
              <Text style={styles.searchResultMatch}>{match}</Text>
              {after}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

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
        onToast(t("chatInfo.couldnTLoadThisConversation"), "error");
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
          placeholder={t("chatInfo.searchFiles")}
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel={t("chatInfo.clearSearch")}>
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
                {query ? t("chatInfo.nothingMatchesThat") : t("chatInfo.noPhotosOrFilesShared")}
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
              accessibilityLabel={`${typeInfo.label}: ${displayFileName(item.file_name) || t("utils.attachmentFiles.file")}`}
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
                  {displayFileName(item.file_name) ||
                    (item.kind === "image" ? t("utils.attachmentFiles.photo") : t("utils.attachmentFiles.file"))}
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
              <Ionicons name={dirIcon("chevron-forward")} size={15} color={palette.textMuted} />
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
  return new Date(seconds * 1000).toLocaleDateString(appLocale(), { month: "short", day: "numeric" });
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
    iconBusy: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 38,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
    },
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
    searchResult: {
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      gap: 3,
    },
    searchResultHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
    searchResultBody: { fontSize: 14, color: palette.text, lineHeight: 19 },
    searchResultMatch: { fontWeight: "700", color: palette.primaryStrong },
    filesEmptyText: { fontSize: 14, color: palette.textMuted, textAlign: "center" },
  });
}
