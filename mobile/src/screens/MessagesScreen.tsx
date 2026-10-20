import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackendClient } from "../services/appBackend";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import {
  Avatar,
  BadgeLine,
  BulletinPhotoView,
  CATEGORY_ICONS,
  ProfileSetupSheet,
  ReportSheet,
  formatAgo,
} from "../components/BulletinParts";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { BulletinRequestError, ChatMessage, Conversation, PublicUser } from "../types/bulletin";

type Segment = "chats" | "contacts";

const SEGMENTS: Array<{ value: Segment; label: string }> = [
  { value: "chats", label: "Chats" },
  { value: "contacts", label: "Contacts" },
];

const THREAD_POLL_MS = 4000;
const INBOX_POLL_MS = 15000;

type Props = {
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled: boolean;
  /** The existing contacts screen, shown under the Contacts segment. */
  contactsElement: React.ReactNode;
  requestedSegment?: Segment;
  requestedSegmentNonce?: number;
  requestedConversationId?: number | null;
  requestedConversationNonce?: number;
  onPayInConversation: (conversation: Conversation) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
};

export function formatSfluvAmount(base?: string | null): string {
  if (!base) return "";
  const value = Number(base) / 1_000_000;
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function MessagesScreen({
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  contactsElement,
  requestedSegment,
  requestedSegmentNonce,
  requestedConversationId,
  requestedConversationNonce,
  onPayInConversation,
  onToast,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [segment, setSegment] = useState<Segment>(requestedSegment ?? "chats");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicUser[] | null>(null);
  const [merchantResults, setMerchantResults] = useState<Array<{ location_id: number; name: string; owner_user_id: string }>>([]);
  const [profileRetry, setProfileRetry] = useState<null | (() => void)>(null);
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    if (requestedSegment) setSegment(requestedSegment);
  }, [requestedSegment, requestedSegmentNonce]);

  useEffect(() => {
    if (requestedConversationId) {
      setSegment("chats");
      setOpenId(requestedConversationId);
    }
  }, [requestedConversationId, requestedConversationNonce]);

  const loadInbox = useCallback(async () => {
    if (!backendClient) return;
    try {
      setConversations(await backendClient.getConversations());
    } catch {
      setConversations((current) => current ?? []);
    }
  }, [backendClient]);

  useEffect(() => {
    void loadInbox();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void loadInbox();
    }, INBOX_POLL_MS);
    return () => clearInterval(interval);
  }, [loadInbox]);

  // Search runs as the person types, after a short pause.
  useEffect(() => {
    const q = query.trim();
    if (!backendClient || q.replace(/^@/, "").length < 2) {
      setResults(null);
      setMerchantResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void backendClient
        .searchSFLuvUsers(q)
        .then((r) => {
          setResults(r.users);
          setMerchantResults(r.merchants);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [backendClient, query]);

  const startWith = useCallback(
    async (userId: string) => {
      if (!backendClient) return;
      const run = async () => {
        const conversation = await backendClient.startConversation(userId, null);
        setQuery("");
        setOpenId(conversation.id);
      };
      try {
        await run();
      } catch (e) {
        if (e instanceof BulletinRequestError && e.code === "profile_required") {
          setProfileRetry(() => () => void run().catch((err) => onToast(err?.message || "Something went wrong.", "error")));
          return;
        }
        onToast(e instanceof BulletinRequestError ? e.message : "Couldn't start a conversation.", "error");
      }
    },
    [backendClient, onToast],
  );

  const renderConversation = ({ item }: { item: Conversation }) => {
    const last = item.last_message;
    const preview =
      last?.kind === "payment"
        ? last.is_mine
          ? `You sent ${formatSfluvAmount(last.amount_sfluv_base) || ""} ${tokenSymbol}`.replace("  ", " ")
          : `Sent you ${formatSfluvAmount(last.amount_sfluv_base) || ""} ${tokenSymbol}`.replace("  ", " ")
        : (last?.is_mine ? "You: " : "") + (last?.body ?? "");
    return (
      <Pressable
        style={styles.row}
        onPress={() => {
          triggerClickHaptic(hapticsEnabled);
          setOpenId(item.id);
        }}
      >
        <Avatar name={item.other_user.public_name} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.rowName} numberOfLines={1}>
              {item.other_user.public_name}
            </Text>
            <Text style={styles.rowTime}>{formatAgo(item.last_message_at)}</Text>
          </View>
          <View style={styles.rowPreviewLine}>
            {item.post ? <Ionicons name={CATEGORY_ICONS[item.post.category]} size={13} color={palette.textMuted} /> : null}
            <Text style={[styles.rowPreview, item.unread_count > 0 && styles.rowPreviewUnread]} numberOfLines={1}>
              {item.post ? `${item.post.title} · ` : ""}
              {preview}
            </Text>
          </View>
        </View>
        {item.unread_count > 0 ? <View style={styles.unreadDot} /> : null}
      </Pressable>
    );
  };

  const searching = query.trim().replace(/^@/, "").length >= 2;

  return (
    <View style={styles.screen}>
      <View style={styles.top}>
        <SegmentedTabs segments={SEGMENTS} value={segment} onChange={setSegment} hapticsEnabled={hapticsEnabled} />
      </View>

      {segment === "contacts" ? (
        <View style={{ flex: 1 }}>{contactsElement}</View>
      ) : (
        <>
          <View style={styles.searchRow}>
            <Ionicons name="search" size={16} color={palette.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people on SFLuv"
              placeholderTextColor={palette.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={palette.textMuted} />
              </Pressable>
            ) : (
              <Pressable onPress={() => setEditingProfile(true)} hitSlop={8} accessibilityLabel="Your public name and privacy">
                <Ionicons name="person-circle-outline" size={20} color={palette.textMuted} />
              </Pressable>
            )}
          </View>

          {searching ? (
            <FlatList
              data={[
                ...(results ?? []).map((u) => ({ key: `u:${u.user_id}`, userId: u.user_id, title: u.public_name, user: u as PublicUser | null })),
                ...merchantResults.map((m) => ({ key: `m:${m.location_id}`, userId: m.owner_user_id, title: m.name, user: null as PublicUser | null })),
              ]}
              keyExtractor={(item) => item.key}
              contentContainerStyle={styles.listContent}
              ListEmptyComponent={
                results === null ? (
                  <View style={styles.centerState}>
                    <ThemedActivityIndicator />
                  </View>
                ) : (
                  <Text style={styles.emptyBody}>
                    No one found. People only show up here if they've chosen to be findable, or if you search their exact @handle.
                  </Text>
                )
              }
              renderItem={({ item }) => (
                <Pressable style={styles.row} onPress={() => void startWith(item.userId)}>
                  <Avatar name={item.title} />
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{item.title}</Text>
                    {item.user ? <BadgeLine user={item.user} /> : <Text style={styles.rowPreview}>Merchant</Text>}
                  </View>
                  <Ionicons name="chatbubble-outline" size={18} color={palette.textMuted} />
                </Pressable>
              )}
            />
          ) : (
            <FlatList
              data={conversations ?? []}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderConversation}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  tintColor={palette.primary}
                  onRefresh={() => {
                    setRefreshing(true);
                    void loadInbox().finally(() => setRefreshing(false));
                  }}
                />
              }
              ListEmptyComponent={
                conversations === null ? (
                  <View style={styles.centerState}>
                    <ThemedActivityIndicator />
                  </View>
                ) : (
                  <View style={styles.centerState}>
                    <Ionicons name="chatbubbles-outline" size={32} color={palette.textMuted} />
                    <Text style={styles.emptyTitle}>No messages yet</Text>
                    <Text style={styles.emptyBody}>Message someone from a Bulletin post, or search for a neighbor above.</Text>
                  </View>
                )
              }
            />
          )}
        </>
      )}

      <ChatThreadModal
        conversationId={openId}
        backendClient={backendClient}
        tokenSymbol={tokenSymbol}
        onClose={() => {
          setOpenId(null);
          void loadInbox();
        }}
        onPay={onPayInConversation}
        onToast={onToast}
      />

      <ProfileSetupSheet
        visible={Boolean(profileRetry) || editingProfile}
        client={backendClient}
        onClose={() => {
          setProfileRetry(null);
          setEditingProfile(false);
        }}
        onSaved={() => {
          const retry = profileRetry;
          setProfileRetry(null);
          setEditingProfile(false);
          retry?.();
        }}
      />
    </View>
  );
}

// ── Thread ───────────────────────────────────────────────────────────────────

function ChatThreadModal({
  conversationId,
  backendClient,
  tokenSymbol,
  onClose,
  onPay,
  onToast,
}: {
  conversationId: number | null;
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  onClose: () => void;
  onPay: (conversation: Conversation) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [report, setReport] = useState<{ type: "message" | "user"; id: string; label: string } | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  // Whether the first page has arrived for this thread; only that page decides
  // "are there older messages", later polls must not reset it.
  const firstPageLoaded = useRef(false);

  const refresh = useCallback(async () => {
    if (!backendClient || !conversationId) return;
    try {
      const [conv, page] = await Promise.all([
        backendClient.getConversation(conversationId),
        backendClient.getConversationMessages(conversationId),
      ]);
      setConversation(conv);
      setMessages((current) => {
        // Keep older pages already loaded; replace the newest page.
        const newest = new Set(page.messages.map((m) => m.id));
        const older = current.filter((m) => !newest.has(m.id) && m.id < (page.messages[0]?.id ?? Infinity));
        return [...older, ...page.messages];
      });
      if (!firstPageLoaded.current) {
        firstPageLoaded.current = true;
        setHasMore(page.has_more);
      }
      void backendClient.markConversationRead(conversationId).catch(() => {});
    } catch (e) {
      if (e instanceof BulletinRequestError && e.status === 404) {
        onToast(e.message, "error");
        onClose();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendClient, conversationId]);

  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setDraft("");
    setFeedbackSent(false);
    firstPageLoaded.current = false;
    if (!conversationId) return;
    void refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [conversationId, refresh]);

  const loadOlder = async () => {
    if (!backendClient || !conversationId || !hasMore || messages.length === 0) return;
    try {
      const page = await backendClient.getConversationMessages(conversationId, messages[0].id);
      setMessages((current) => [...page.messages, ...current]);
      setHasMore(page.has_more);
    } catch {
      // Older messages are a nicety; the thread still works without them.
    }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || !backendClient || !conversationId) return;
    setSending(true);
    try {
      const message = await backendClient.sendConversationMessage(conversationId, body);
      setMessages((current) => [...current, message]);
      setDraft("");
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't send. Try again.", "error");
    } finally {
      setSending(false);
    }
  };

  const openMenu = () => {
    if (!conversation || !backendClient) return;
    const name = conversation.other_user.public_name;
    Alert.alert(name, undefined, [
      conversation.blocked_by_me
        ? {
            text: `Unblock ${name}`,
            onPress: () =>
              void backendClient
                .unblockUser(conversation.other_user.user_id)
                .then(() => refresh())
                .catch(() => onToast("Couldn't unblock.", "error")),
          }
        : {
            text: `Block ${name}`,
            style: "destructive",
            onPress: () =>
              void backendClient
                .blockUser(conversation.other_user.user_id)
                .then(() => {
                  onToast("Blocked. They can't message you.", "success");
                  return refresh();
                })
                .catch(() => onToast("Couldn't block.", "error")),
          },
      { text: `Report ${name}`, onPress: () => setReport({ type: "user", id: conversation.other_user.user_id, label: name }) },
      {
        text: "Archive conversation",
        onPress: () =>
          void backendClient
            .archiveConversation(conversation.id)
            .then(onClose)
            .catch(() => onToast("Couldn't archive.", "error")),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const post = conversation?.post ?? null;
  const iAmAuthor = Boolean(post && conversation && post.author_id !== conversation.other_user.user_id);
  const canPay = Boolean(conversation?.pay_address) && !conversation?.blocked_by_me && (!post || post.accepts_sfluv || post.category !== "for_sale");
  const tradeDone = post && (post.status === "sold" || post.status === "claimed");

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.kind === "payment") {
      const amount = formatSfluvAmount(item.amount_sfluv_base);
      return (
        <View style={styles.paymentLine}>
          <Ionicons
            name={item.payment_verified ? "checkmark-circle" : "time-outline"}
            size={16}
            color={item.payment_verified ? palette.success : palette.textMuted}
          />
          <Text style={[styles.paymentText, !item.payment_verified && { color: palette.textMuted }]}>
            {item.is_mine ? "You sent" : "Sent you"} {amount ? `${amount} ${tokenSymbol}` : tokenSymbol}
            {item.payment_verified ? "" : " (confirming)"}
          </Text>
        </View>
      );
    }
    return (
      <Pressable
        onLongPress={() => {
          if (!item.is_mine) setReport({ type: "message", id: String(item.id), label: "this message" });
        }}
        style={[styles.bubble, item.is_mine ? styles.bubbleMine : styles.bubbleTheirs]}
      >
        <Text style={item.is_mine ? styles.bubbleTextMine : styles.bubbleText}>{item.body}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={conversationId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 0}>
        <View style={styles.threadScreen}>
          <View style={styles.threadHeader}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back">
              <Ionicons name="chevron-down" size={24} color={palette.text} />
            </Pressable>
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={styles.threadName} numberOfLines={1}>
                {conversation?.other_user.public_name ?? ""}
              </Text>
              {conversation ? <BadgeLine user={conversation.other_user} /> : null}
            </View>
            <Pressable onPress={openMenu} hitSlop={10} accessibilityLabel="More options">
              <Ionicons name="ellipsis-horizontal" size={22} color={palette.text} />
            </Pressable>
          </View>

          {post ? (
            <View style={styles.postChip}>
              <BulletinPhotoView client={backendClient} photoId={post.photo_id} fallbackIcon={CATEGORY_ICONS[post.category]} style={styles.postChipPhoto} />
              <View style={{ flex: 1 }}>
                <Text style={styles.postChipTitle} numberOfLines={1}>
                  {post.title}
                </Text>
                <Text style={styles.postChipMeta}>
                  {[
                    post.category === "free" ? "Free" : post.price_sfluv ? `${post.price_sfluv} ${tokenSymbol}` : "",
                    post.accepts_cash ? "Cash OK" : "",
                    post.status === "active" ? "" : post.status === "sold" ? "Sold" : post.status === "claimed" ? "Claimed" : "Unavailable",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </View>
              {iAmAuthor && post.status === "active" && post.category !== "notice" ? (
                <Pressable
                  onPress={() =>
                    void backendClient
                      ?.updateBulletinPost(post.id, { status: post.category === "free" ? "claimed" : "sold" })
                      .then(() => refresh())
                      .catch((e) => onToast(e?.message || "Couldn't update.", "error"))
                  }
                >
                  <Text style={styles.postChipAction}>{post.category === "free" ? "Mark claimed" : "Mark sold"}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => String(m.id)}
            renderItem={renderMessage}
            contentContainerStyle={styles.threadContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListHeaderComponent={
              hasMore ? (
                <Pressable onPress={() => void loadOlder()} style={styles.loadOlder}>
                  <Text style={styles.loadOlderText}>Load earlier messages</Text>
                </Pressable>
              ) : null
            }
            ListFooterComponent={
              tradeDone && !feedbackSent && conversation ? (
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackText}>How did it go with {conversation.other_user.public_name}?</Text>
                  <View style={styles.feedbackButtons}>
                    {[true, false].map((positive) => (
                      <Pressable
                        key={String(positive)}
                        style={styles.feedbackButton}
                        onPress={() =>
                          void backendClient
                            ?.leaveBulletinFeedback(post!.id, conversation.other_user.user_id, positive)
                            .then(() => {
                              setFeedbackSent(true);
                              onToast("Thanks for the feedback.", "success");
                            })
                            .catch((e) => onToast(e?.message || "Couldn't save feedback.", "error"))
                        }
                        accessibilityLabel={positive ? "It went well" : "It didn't go well"}
                      >
                        <Ionicons name={positive ? "thumbs-up-outline" : "thumbs-down-outline"} size={20} color={palette.text} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null
            }
          />

          {conversation?.blocked_by_me ? (
            <View style={styles.blockedBar}>
              <Text style={styles.blockedText}>You blocked {conversation.other_user.public_name}.</Text>
            </View>
          ) : (
            <View style={styles.composer}>
              {canPay && conversation ? (
                <Pressable style={styles.payButton} onPress={() => onPay(conversation)} accessibilityLabel={`Send ${tokenSymbol}`}>
                  <Ionicons name="paper-plane-outline" size={16} color={palette.primaryStrong} />
                  <Text style={styles.payButtonText}>{tokenSymbol}</Text>
                </Pressable>
              ) : null}
              <TextInput
                style={styles.composerInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Message"
                placeholderTextColor={palette.textMuted}
                multiline
                maxLength={2000}
              />
              <Pressable
                style={[styles.sendButton, (!draft.trim() || sending) && { opacity: 0.4 }]}
                onPress={() => void send()}
                disabled={!draft.trim() || sending}
                accessibilityLabel="Send message"
              >
                <Ionicons name="arrow-up" size={18} color={palette.white} />
              </Pressable>
            </View>
          )}
        </View>
        <ReportSheet
          target={report}
          client={backendClient}
          onClose={() => setReport(null)}
          onReported={() => {
            setReport(null);
            onToast("Thanks. We'll take a look.", "success");
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    top: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
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
    listContent: { paddingHorizontal: spacing.md, paddingBottom: 120, flexGrow: 1 },
    row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border },
    rowBody: { flex: 1, minWidth: 0 },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
    rowName: { fontSize: 15, fontWeight: "600", color: palette.text, flexShrink: 1 },
    rowTime: { fontSize: 12, color: palette.textMuted, marginLeft: 8 },
    rowPreviewLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
    rowPreview: { fontSize: 13, color: palette.textMuted, flexShrink: 1 },
    rowPreviewUnread: { color: palette.text, fontWeight: "600" },
    unreadDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: palette.primary },
    centerState: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 8, flexGrow: 1 },
    emptyTitle: { fontSize: 16, fontWeight: "600", color: palette.text },
    emptyBody: { fontSize: 14, color: palette.textMuted, textAlign: "center", lineHeight: 20, padding: spacing.md },
    threadScreen: { flex: 1, backgroundColor: palette.background },
    threadHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    threadName: { fontSize: 16, fontWeight: "700", color: palette.text },
    postChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      margin: spacing.md,
      marginBottom: 0,
      padding: 8,
      borderRadius: radii.sm,
      backgroundColor: palette.surfaceMuted,
    },
    postChipPhoto: { width: 40, height: 40, borderRadius: 8 },
    postChipTitle: { fontSize: 14, color: palette.text },
    postChipMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    postChipAction: { fontSize: 13, color: palette.primaryStrong, fontWeight: "600" },
    threadContent: { padding: spacing.md, gap: 8, flexGrow: 1 },
    loadOlder: { alignItems: "center", paddingVertical: 8 },
    loadOlderText: { fontSize: 13, color: palette.primaryStrong },
    bubble: { maxWidth: "80%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.md },
    bubbleMine: { alignSelf: "flex-end", backgroundColor: palette.primary },
    bubbleTheirs: { alignSelf: "flex-start", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
    bubbleText: { fontSize: 15, color: palette.text },
    bubbleTextMine: { fontSize: 15, color: palette.white },
    paymentLine: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 4 },
    paymentText: { fontSize: 13, color: palette.success, fontWeight: "600" },
    feedbackCard: { alignItems: "center", gap: 8, padding: spacing.md, marginTop: spacing.md, borderRadius: radii.md, backgroundColor: palette.surfaceMuted },
    feedbackText: { fontSize: 14, color: palette.text },
    feedbackButtons: { flexDirection: "row", gap: spacing.lg },
    feedbackButton: { padding: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border },
    composer: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      padding: spacing.sm,
      paddingBottom: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      backgroundColor: palette.background,
    },
    payButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: radii.pill,
      backgroundColor: palette.primaryMuted,
    },
    payButtonText: { fontSize: 13, fontWeight: "700", color: palette.primaryStrong },
    composerInput: {
      flex: 1,
      maxHeight: 120,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      fontSize: 15,
      color: palette.text,
    },
    sendButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: palette.primary, alignItems: "center", justifyContent: "center" },
    blockedBar: { padding: spacing.md, paddingBottom: spacing.xl, borderTopWidth: 1, borderTopColor: palette.border, alignItems: "center" },
    blockedText: { fontSize: 13, color: palette.textMuted },
  });
}
