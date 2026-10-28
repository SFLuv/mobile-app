import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Easing,
  AppState,
  FlatList,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { AppBackendClient } from "../services/appBackend";
import { useStuckWatch } from "../services/observability";
import { SwipeBack, type SwipeBackHandle } from "../components/SwipeBack";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Avatar, BadgeLine } from "../components/BulletinParts";
import {
  MessageAttachmentCard,
  attachmentKindLabel,
  type AttachmentHandlers,
} from "../components/MessageAttachmentCard";
import type { ChatTransactionRef } from "../utils/transactions";
import {
  buildUniversalEventLink,
  buildUniversalMerchantLink,
  buildUniversalTransactionLink,
} from "../utils/universalLinks";
import { ChatComposer, type AttachmentOption, type ComposerMode } from "../components/ChatComposer";
import { AttachmentPreview } from "../components/AttachmentPreview";
import { displayFileName, saveAttachment } from "../utils/attachmentFiles";
import { Palette, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import type { RealtimeEvent } from "../services/realtime";
import { useTypingIndicators, useTypingReporter } from "../hooks/useRealtime";
import { useKeyboardLift } from "../hooks/useKeyboardLift";

/**
 * SFLuv's own mark, bundled rather than fetched.
 *
 * The same asset the QR code centres on and the volunteer screens use, so the
 * currency looks the same everywhere it appears.
 */
const SFLUV_MARK = require("../../assets/qr-logo.png");
import {
  BulletinRequestError,
  ChatMessage,
  Conversation,
  MessageAttachment,
} from "../types/bulletin";

/**
 * One conversation, as a screen.
 *
 * ── Why this is a screen and not the modal it replaces ──────────────────────
 *
 * It was a pageSheet modal, which brought three problems that are all really the
 * same problem — a modal is not part of the navigation stack:
 *
 *   - It could not be swiped back, only pulled down by its handle.
 *   - The app's top bar stayed visible above it, so the chat had two headers.
 *   - The keyboard fought it. A transparent-background modal is not moved by
 *     iOS for the keyboard, which is why the composer overlapped it on some
 *     devices.
 *
 * As a screen it gets the swipe-back gesture every other pushed screen has, one
 * header, and a KeyboardAvoidingView that works.
 *
 * ── The inverted list, which is the keyboard fix ────────────────────────────
 *
 * The list is `inverted`, so index 0 is the NEWEST message and the list's
 * natural resting position is the bottom. That is what makes the Telegram
 * behaviour fall out for free: whatever is bottom-most stays pinned just above
 * the composer, the keyboard opening pushes the composer up and the content with
 * it, and scrolling up through history still works while the keyboard is open.
 *
 * The version this replaces was a normal list with
 * `onContentSizeChange -> scrollToEnd`, which is the thing that misbehaved: the
 * keyboard changes the content size, so opening it fired a scroll, which fought
 * whatever the person was reading. Inverting removes the scroll-to-bottom call
 * entirely rather than trying to time it better.
 *
 * ── Opens with the keyboard up ─────────────────────────────────────────────
 *
 * Because opening a chat is nearly always opening it to say something. The
 * exception is a thread reached from a notification, where the person came to
 * READ — so that case is passed `autoFocus: false` by the shell.
 */

/**
 * How far the thread slides to reveal timestamps, and how wide the column is.
 *
 * One constant for both, because they are the same measurement: the reveal is
 * complete exactly when the column is fully on screen.
 */
const STAMP_COLUMN_WIDTH = 56;

/** Sideways travel before the timestamp swipe takes the touch at all. */
const STAMP_SWIPE_SLOP = 16;

/** One row of the thread: a message, or a date between sessions. */
type ChatRow =
  | {
      kind: "message";
      message: ChatMessage;
      previousInTime?: ChatMessage;
      /** The chronologically NEWER neighbour, for deciding where a run ends. */
      nextInTime?: ChatMessage;
    }
  | { kind: "separator"; label: string; key: string };

/** iMessage's six, which cover almost every reaction anybody actually sends. */
const DEFAULT_REACTIONS = ["❤️", "👍", "👎", "😂", "‼️", "❓"];

/** A wider set behind "more", so the picker needs no native dependency. */
const MORE_REACTIONS = [
  "🙏", "🎉", "🔥", "😮", "😢", "😡", "👀", "💪", "🤝", "✅",
  "🌮", "☕", "🚲", "🌱", "🏡", "💰", "⭐", "🫶", "😅", "🤔",
];

const THREAD_POLL_MS = 15_000;

type Props = {
  conversationId: number;
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled: boolean;
  /** Available balance, for the amount pad. Already display-formatted. */
  availableBalance?: string;
  /** False when the chat was reached from a notification: they came to read. */
  autoFocus?: boolean;
  /**
   * A line to prefill the composer with, applied once.
   *
   * Used by the support-reply flow: a staff member pressing "Message" on a
   * support alert gets an opening sentence to edit rather than a blank field,
   * and the ticket itself is already in the thread as a reference card.
   */
  initialDraft?: string | null;
  onInitialDraftApplied?: () => void;
  onBack: () => void;
  onOpenInfo: (conversation: Conversation) => void;
  /**
   * Signs and broadcasts a transfer, then attaches it. Lives in the shell
   * because it needs the wallet signer, which this screen has no business
   * holding.
   */
  onSendPayment?: (input: {
    conversationId: number;
    payAddress: string;
    amount: string;
    note: string;
  }) => Promise<void>;
  onOpenTransaction?: (ref: ChatTransactionRef) => void;
  onOpenMerchant?: (locationId: number) => void;
  onOpenEvent?: (eventId: string) => void;
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void;
  sendTyping: (conversationId: number, typing: boolean) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
  /** Reported so the inbox and the dock badge can clear without a round trip. */
  onRead?: (conversationId: number) => void;
};

export function ChatScreen({
  conversationId,
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  availableBalance,
  autoFocus = true,
  initialDraft,
  onInitialDraftApplied,
  onBack,
  onOpenInfo,
  onSendPayment,
  onOpenTransaction,
  onOpenMerchant,
  onOpenEvent,
  subscribe,
  sendTyping,
  onToast,
  onRead,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // A thread that never loads, and a message that never finishes sending.
  useStuckWatch("chat: open conversation", conversation === null, { conversation_id: conversationId });
  useStuckWatch("chat: send message", sending, { conversation_id: conversationId });
  const [mode, setMode] = useState<ComposerMode>("text");
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<ChatMessage | null>(null);
  /**
   * The attachment open in the full-screen preview.
   *
   * One surface for photos and files, replacing a bare image viewer with no
   * save button and a toast saying files were "coming soon".
   */
  const [previewAttachment, setPreviewAttachment] = useState<MessageAttachment | null>(null);
  /** The message being edited, if any. Its text is loaded into the composer. */
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  /**
   * Multi-select for bulk deletion.
   *
   * null means not in selection mode at all, which is different from an empty
   * set: entering the mode changes the header and the composer, so "no messages
   * picked yet" has to be distinguishable from "not selecting".
   */
  const [selectedIds, setSelectedIds] = useState<number[] | null>(null);

  /**
   * Attachments chosen but not yet sent.
   *
   * ── Why picking no longer sends ───────────────────────────────────────────
   *
   * Choosing a photo used to post it immediately, which meant there was no
   * moment at which you could say anything about it: the picture arrived, and
   * then a second message explaining it arrived after. Staging them puts the
   * send under the person's control, the way every other chat app works.
   *
   * `splitAt` is where the caret was when the attachment was picked, so the
   * draft can be cut into the part that goes BEFORE it and the part that goes
   * after — iMessage's behaviour, where text either side of an inserted photo
   * becomes its own message on its own side of it.
   */
  const [staged, setStaged] = useState<{
    files: Array<{ uri: string; mimeType?: string | null; fileName?: string | null; isImage: boolean }>;
    reference?: {
      kind: "transaction" | "merchant" | "event";
      label: string;
      txHash?: string;
      locationId?: number;
      eventId?: string;
    };
    /**
     * A payment composed on the amount pad but not yet made.
     *
     * Staged rather than sent from the pad, because the money moving is the one
     * thing in this composer that cannot be taken back. Everything else here is
     * reviewed before it is sent and a transfer should not be the exception —
     * so the pad composes it, the chip shows what is about to happen, and the
     * send button is what spends.
     */
    payment?: { amount: string; note: string };
    splitAt: number;
  } | null>(null);
  const caretRef = useRef(0);

  const inputRef = useRef<TextInput | null>(null);
  const swipeRef = useRef<SwipeBackHandle>(null);

  /**
   * Swipe the thread left to reveal each message's time.
   *
   * iMessage's gesture, and the reason it is a gesture rather than a permanent
   * column: a timestamp on every bubble is clutter 95% of the time and exactly
   * what you want the other 5%. The whole list slides as one so the times line
   * up in a column, rather than each bubble growing a label.
   *
   * Horizontal-and-leftward only, and it gives up the touch unless the movement
   * is clearly sideways — the same ratio test SwipeBack uses, mirrored, so the
   * two gestures cannot both claim a drag. Released, it springs back.
   */
  const stampReveal = useRef(new Animated.Value(0)).current;
  const stampResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dx < -STAMP_SWIPE_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
        onPanResponderMove: (_event, gesture) => {
          // Resisted, not one-to-one: the thread trails the finger and eases
          // into the width of the stamp column instead of stopping dead at it,
          // so a sideways brush while scrolling barely moves it. Past the
          // column there is nothing more to reveal.
          const pulled = Math.max(0, -gesture.dx - STAMP_SWIPE_SLOP);
          const eased = STAMP_COLUMN_WIDTH * (1 - Math.exp(-pulled / (STAMP_COLUMN_WIDTH * 2.2)));
          stampReveal.setValue(-eased);
        },
        onPanResponderRelease: () => {
          Animated.spring(stampReveal, {
            toValue: 0,
            useNativeDriver: true,
            friction: 9,
            tension: 110,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(stampReveal, { toValue: 0, useNativeDriver: true, friction: 9, tension: 110 }).start();
        },
      }),
    [stampReveal],
  );
  const firstPageLoaded = useRef(false);

  /**
   * The parent's callbacks, held in refs.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * `refresh` is a useCallback. It used to list `onRead`, `onToast` and
   * `onBack` among its dependencies, and the reset effect below listed
   * `refresh` among its own. The shell passes `onRead` as an inline arrow and
   * `showToast` as a plain function, so both get a new identity on every shell
   * render — and the shell re-renders constantly: balance polls, transaction
   * polls, the notification feed, the unread poll, every AppState change.
   *
   * So several times a minute `refresh` changed identity, the reset effect
   * re-ran, and it does this:
   *
   *     setConversation(null); setMessages([]); setDraft(""); setMode("text");
   *
   * which blanks the thread and reloads it (the flicker), closes the send-SFLUV
   * pad or the attachment tray mid-use, and throws away whatever the person had
   * typed. The draft loss is the worst of it and was silent.
   *
   * Refs fix it at this end rather than by asking the shell to memoize
   * everything: a screen that resets itself when its parent re-renders is
   * broken regardless of how carefully the parent is written, and the next
   * callback added to the shell would have reintroduced it.
   */
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  const {
    ref: keyboardRef,
    onLayout: measureKeyboardGap,
    lift,
  } = useKeyboardLift();

  /**
   * A link found in what the person is typing, and its scraped card.
   *
   * ── Why this replaced a tray option ──────────────────────────────────────
   *
   * "Link" used to be a button in the attachment tray that read the clipboard
   * and asked for confirmation. That is backwards: nobody decides to attach a
   * link, they paste one into the message they are already writing. So the
   * draft is watched instead, and the card appears above the composer the way
   * every other chat app does it — which also means the sender sees what the
   * recipient will see before sending, which the tray version never offered.
   *
   * `dismissed` is kept per URL so that closing a card does not just make it
   * reappear on the next keystroke.
   */
  const [linkPreview, setLinkPreview] = useState<{
    /**
     * The URL exactly as `firstURL` produced it from the draft.
     *
     * Kept alongside the server's normalized `url` because the two can differ
     * — the server may add a trailing slash, drop a default port, or follow a
     * redirect — and everything that compares a preview against the current
     * draft has to compare like with like. Keying on the server's version
     * instead caused two bugs: dismissing a card did not stick, and the
     * "already previewed this" guard never matched, so the effect refetched
     * every 600ms for as long as the link sat in the draft.
     */
    detectedUrl: string;
    url: string;
    title: string;
    description: string;
    imageUrl: string;
    siteName: string;
  } | null>(null);
  const [dismissedLinks, setDismissedLinks] = useState<string[]>([]);

  const typing = useTypingIndicators(conversationId, subscribe);
  const reportTyping = useTypingReporter(conversationId, sendTyping);

  /**
   * The list's rows: messages and date separators, interleaved.
   *
   * ── Why separators are their own row ──────────────────────────────────────
   *
   * They were rendered inside the message row, which put a centred full-width
   * label inside a flex row laid out for a bubble and a timestamp — so it was
   * squeezed beside the bubble, inherited the row's alignment, and slid
   * sideways with the timestamp-reveal gesture. A separator is not part of a
   * message and does not behave like one; it is its own row.
   *
   * ── The ordering, which is easy to get backwards ──────────────────────────
   *
   * The list is inverted, so index 0 renders at the BOTTOM. The array therefore
   * runs newest to oldest. A separator has to appear visually ABOVE the message
   * whose session it opens, which means it comes AFTER that message in the
   * array.
   */
  const rows = useMemo<ChatRow[]>(() => {
    const ordered = [...messages].reverse();
    const out: ChatRow[] = [];
    ordered.forEach((message, index) => {
      out.push({
        kind: "message",
        message,
        previousInTime: ordered[index + 1],
        nextInTime: index > 0 ? ordered[index - 1] : undefined,
      });
      const separator = sessionSeparator(ordered[index + 1], message);
      if (separator) {
        out.push({ kind: "separator", label: separator, key: `sep:${message.id}` });
      }
    });
    return out;
  }, [messages]);

  const isGroup = conversation?.kind === "group";

  /**
   * Headers that let <Image> fetch an authenticated avatar.
   *
   * Resolved once per thread rather than per bubble: a busy group draws a lot
   * of avatars, and the token behind them is the same one every time.
   */
  const [imageAuthHeaders, setImageAuthHeaders] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (!backendClient || !isGroup) {
      return;
    }
    let cancelled = false;
    void backendClient
      .getImageAuthHeaders()
      .then((headers) => {
        if (!cancelled) {
          setImageAuthHeaders(headers);
        }
      })
      .catch(() => {
        // Initials are a complete fallback, so this needs no handling beyond
        // leaving the headers null.
      });
    return () => {
      cancelled = true;
    };
  }, [backendClient, isGroup]);
  /**
   * The id of your own newest message, which is the only one that shows a
   * delivery state.
   */
  const lastOwnMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].is_mine && messages[index].kind !== "system") {
        return messages[index].id;
      }
    }
    return null;
  }, [messages]);

  // ── Loading ───────────────────────────────────────────────────────────────

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!backendClient || !conversationId) {
        return;
      }
      try {
        const [conv, page] = await Promise.all([
          backendClient.getConversation(conversationId),
          backendClient.getConversationMessages(conversationId),
        ]);
        setConversation(conv);
        setMessages((current) => {
          // The newest page replaces its own range; older pages already loaded
          // are kept, so a poll does not discard history somebody scrolled to.
          const newest = new Set(page.messages.map((m) => m.id));
          const oldestInPage = page.messages[0]?.id ?? Number.POSITIVE_INFINITY;
          const older = current.filter((m) => !newest.has(m.id) && m.id < oldestInPage);
          return [...older, ...page.messages];
        });
        if (!firstPageLoaded.current) {
          firstPageLoaded.current = true;
          setHasMore(page.has_more);
        }
        void backendClient.markConversationRead(conversationId).catch(() => {});
        onReadRef.current?.(conversationId);
      } catch (e) {
        if (e instanceof BulletinRequestError && e.status === 404) {
          onToastRef.current(e.message, "error");
          onBackRef.current();
          return;
        }
        if (!options?.silent) {
          // A failed load leaves whatever was already on screen. An empty
          // thread and an unreachable one are different things, and showing
          // the first for the second is how a chat looks deleted.
          onToastRef.current("Couldn't refresh this conversation.", "error");
        }
      }
    },
    // Only what changes WHAT is fetched. The callbacks are read through refs
    // above precisely so they cannot land here — see the note on those refs.
    [backendClient, conversationId],
  );

  // Resets only when the THREAD changes. `refresh` is deliberately not a
  // dependency: it is stable now, but listing it here is what made a parent
  // re-render wipe the composer, and nothing should be able to do that again.
  // The fetch is the effect below rather than this one, so that a thread is
  // re-fetched in cases where it must not be reset.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setDraft("");
    setReplyingTo(null);
    setMode("text");
    firstPageLoaded.current = false;
  }, [conversationId]);

  // ── Why the fetch is keyed on `refresh` and not on the thread ─────────────
  //
  // `refresh` changes identity on exactly two things: the thread, and the
  // backend client appearing. The second is what this is for.
  //
  // Opening a chat from a notification — especially a cold start, where the
  // tapped notification is what launched the app — mounts this screen before
  // sign-in has finished, so backendClient is still null and refresh returns
  // without fetching. Keyed on the thread alone, nothing re-ran when the client
  // did arrive: the screen sat on its spinner, which is the chat that "loads
  // forever when opened from a notification". (The fifteen-second poll did
  // eventually rescue it, which is why it looked intermittent rather than
  // broken.)
  //
  // Safe for the flicker this file is otherwise careful about, because it only
  // fetches: nothing here clears the composer or the message list.
  useEffect(() => {
    void refresh({ silent: true });
  }, [refresh]);

  // Applied after the reset above rather than with it, so switching threads
  // cannot wipe a draft that was handed in for the thread being opened. Cleared
  // immediately so it is used once: it is an opening line, not a saved draft,
  // and it must not reappear after the person sends or deletes it.
  useEffect(() => {
    if (!initialDraft) {
      return;
    }
    setDraft(initialDraft);
    onInitialDraftApplied?.();
  }, [initialDraft, onInitialDraftApplied]);

  // A slow safety net rather than the main source: the socket carries new
  // messages, and this catches a thread whose socket dropped without the client
  // noticing. Four seconds became fifteen when the socket arrived.
  useEffect(() => {
    const interval = setInterval(() => {
      if (AppState.currentState === "active") {
        void refresh({ silent: true });
      }
    }, THREAD_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  // ── Live updates ──────────────────────────────────────────────────────────

  useEffect(() => {
    return subscribe((event) => {
      if (event.conversation_id !== conversationId) {
        return;
      }
      if (event.kind === "message.new") {
        const incoming = event.data as ChatMessage | undefined;
        if (!incoming?.id) {
          return;
        }
        setMessages((current) =>
          current.some((m) => m.id === incoming.id) ? current : [...current, incoming],
        );
        // Reading it is implied by having it on screen, so the unread state is
        // cleared here rather than waiting for the next poll.
        void backendClient?.markConversationRead(conversationId).catch(() => {});
        onReadRef.current?.(conversationId);
        return;
      }
      if (event.kind === "message.updated") {
        const updated = event.data as ChatMessage | undefined;
        if (!updated?.id) {
          return;
        }
        // Replaced in place, not appended: this is the same message with new
        // text, and appending would show it twice.
        setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
        return;
      }
      if (event.kind === "message.deleted") {
        const data = event.data as { message_id?: number } | undefined;
        if (!data?.message_id) {
          return;
        }
        // Turned into a tombstone rather than removed, matching what the
        // server's own read path returns.
        setMessages((current) =>
          current.map((m) =>
            m.id === data.message_id
              ? { ...m, deleted: true, body: "", attachments: [], reactions: [] }
              : m,
          ),
        );
        return;
      }
      if (event.kind === "message.reaction") {
        const data = event.data as
          | { message_id?: number; reactions?: ChatMessage["reactions"] }
          | undefined;
        if (!data?.message_id) {
          return;
        }
        setMessages((current) =>
          current.map((m) =>
            m.id === data.message_id ? { ...m, reactions: data.reactions ?? [] } : m,
          ),
        );
        return;
      }
      if (event.kind === "conversation.updated") {
        // Membership, title or picture. Re-read rather than patched: the event
        // says what changed, not to what.
        void refresh({ silent: true });
      }
    });
    // onRead is read through its ref, for the reason given on those refs.
  }, [backendClient, conversationId, refresh, subscribe]);

  // Chats open ready to type. See the header note on why this is the default
  // and when it is not.
  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 320);
    return () => clearTimeout(timer);
  }, [autoFocus, conversationId]);

  /**
   * Watches the draft for a URL and fetches its card.
   *
   * Debounced, because this runs per keystroke and each fetch makes the server
   * reach out to somebody else's site. Only the FIRST url in the draft is
   * previewed: a message with three links is a message, not three cards, and
   * picking the first is both predictable and what the recipient's own card
   * will show.
   */
  useEffect(() => {
    const found = firstURL(draft);
    if (!found) {
      setLinkPreview(null);
      return;
    }
    if (dismissedLinks.includes(found)) {
      setLinkPreview(null);
      return;
    }
    if (linkPreview?.detectedUrl === found) {
      return;
    }
    if (!backendClient) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      void backendClient
        .previewLink(found)
        .then((meta) => {
          if (cancelled) {
            return;
          }
          setLinkPreview({
            detectedUrl: found,
            // The server's normalized url is what gets stored on the message,
            // so that is what gets SENT; `found` is only for comparing against
            // the draft.
            url: meta.url || found,
            title: meta.title,
            description: meta.description,
            imageUrl: meta.image_url,
            siteName: meta.site_name,
          });
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          // A link we cannot read is still a link worth sending. The card shows
          // the bare URL rather than vanishing, so the sender can see it was
          // recognised.
          setLinkPreview({
            detectedUrl: found,
            url: found,
            title: "",
            description: "",
            imageUrl: "",
            siteName: "",
          });
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [backendClient, dismissedLinks, draft, linkPreview?.detectedUrl]);

  const loadOlder = async () => {
    if (!backendClient || !hasMore || loadingOlder || messages.length === 0) {
      return;
    }
    setLoadingOlder(true);
    try {
      const page = await backendClient.getConversationMessages(conversationId, messages[0].id);
      setMessages((current) => [...page.messages, ...current]);
      setHasMore(page.has_more);
    } catch {
      // Older messages are a nicety; the thread works without them.
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── Sending ───────────────────────────────────────────────────────────────

  const send = async () => {
    const body = draft.trim();
    if (!body || !backendClient || sending) {
      return;
    }
    setSending(true);
    const replyTo = replyingTo?.id ?? null;
    try {
      // A detected link is sent as a link attachment with the message as its
      // caption, so the recipient gets the card rather than a bare URL. The
      // server re-scrapes and stores the metadata itself — what is sent here is
      // the url, not the preview, so a card cannot be forged by the sender.
      //
      // Read from the draft at send time rather than from the preview card,
      // which only appears 600ms after typing stops: sent before then, a link
      // used to go out as plain text. The card's normalized url is used when
      // it is in hand for this same link.
      const detected = firstURL(body);
      const linkUrl =
        detected && !dismissedLinks.includes(detected)
          ? linkPreview?.detectedUrl === detected
            ? linkPreview.url
            : detected
          : null;
      const sendPlain = () => backendClient.sendConversationMessage(conversationId, body, replyTo);
      const message = linkUrl
        ? await backendClient
            .attachConversationReference(conversationId, {
              kind: "link",
              link_url: linkUrl,
              body,
              reply_to_id: replyTo,
            })
            // Something that only looked like a link ("notes.md") is refused
            // as one; it is still a message.
            .catch((e: unknown) => {
              if (e instanceof BulletinRequestError && e.code === "bad_link") {
                return sendPlain();
              }
              throw e;
            })
        : await sendPlain();
      setMessages((current) => [...current, message]);
      setDraft("");
      setReplyingTo(null);
      setLinkPreview(null);
      setDismissedLinks([]);
      reportTyping(false);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't send. Try again.", "error");
    } finally {
      setSending(false);
    }
  };

  /** Stages files for the next send, rather than posting them now. */
  const stageAttachments = (
    files: Array<{ uri: string; mimeType?: string | null; fileName?: string | null; isImage: boolean }>,
  ) => {
    if (files.length === 0) {
      return;
    }
    setMode("text");
    setStaged((current) => ({
      files: [...(current?.files ?? []), ...files].slice(0, 10),
      reference: current?.reference,
      // The caret when the FIRST attachment of a batch was added. Adding a
      // second photo should not move where the text splits.
      splitAt: current?.splitAt ?? caretRef.current,
    }));
    setTimeout(() => inputRef.current?.focus(), 120);
  };

  /**
   * Stages a composed payment for the next send, rather than paying now.
   *
   * Deliberately the only thing staged: the tray refuses to open the pad while
   * a file or a reference is waiting, so there is nothing here to preserve, and
   * writing it this way means a payment can never arrive carrying a photo it
   * would have to throw away.
   */
  const stagePayment = (amount: string, note: string) => {
    setMode("text");
    setStaged({
      files: [],
      payment: { amount, note },
      splitAt: caretRef.current,
    });
    setTimeout(() => inputRef.current?.focus(), 120);
  };

  /**
   * Sends the staged attachments and the draft around them.
   *
   * Up to three messages, in the order they read: the text before the
   * attachment, the attachment, then the text after. Each is a separate send
   * because each is a separate message — which is what makes a photo with a
   * sentence either side look like it does in iMessage rather than like a
   * caption.
   */
  const sendStaged = async () => {
    if (!backendClient || !staged || sending) {
      return;
    }
    const before = draft.slice(0, staged.splitAt).trim();
    const after = draft.slice(staged.splitAt).trim();

    setSending(true);
    try {
      // The payment first and on its own path: it is a chain transfer, not a
      // POST, and onSendPayment both moves the money and posts the bubble. It
      // throws if the transfer failed, which leaves everything else unsent —
      // correct, because a note that reads "here you go" under a payment that
      // did not happen is worse than nothing.
      if (staged.payment) {
        if (!conversation?.pay_address || !onSendPayment) {
          // Refused out loud. Falling through would send the text and quietly
          // drop the payment, which is the one failure here nobody would
          // notice until they were asked where the money was.
          onToast("This conversation can't take a payment.", "error");
          return;
        }
        await onSendPayment({
          conversationId,
          payAddress: conversation.pay_address,
          amount: staged.payment.amount,
          // Whatever was typed alongside it becomes the note, since a payment
          // is one message and cannot have text either side of it the way an
          // attachment can.
          note: staged.payment.note || draft.trim(),
        });
        setStaged(null);
        setDraft("");
        setReplyingTo(null);
        reportTyping(false);
        await refresh({ silent: true });
        return;
      }

      if (before) {
        const leading = await backendClient.sendConversationMessage(
          conversationId,
          before,
          replyingTo?.id ?? null,
        );
        setMessages((current) => [...current, leading]);
      }

      if (staged.files.length > 0) {
        const message = await backendClient.uploadConversationAttachments(
          conversationId,
          staged.files,
          // The reply is attached to the FIRST message sent, not repeated on
          // each — three messages all quoting the same thing reads as three
          // replies.
          { replyToId: before ? null : replyingTo?.id ?? null },
        );
        setMessages((current) => [...current, message]);
      } else if (staged.reference) {
        const message = await backendClient.attachConversationReference(conversationId, {
          kind: staged.reference.kind,
          tx_hash: staged.reference.txHash,
          location_id: staged.reference.locationId,
          event_id: staged.reference.eventId,
          reply_to_id: before ? null : staged.reference ? replyingTo?.id ?? null : null,
        });
        setMessages((current) => [...current, message]);
      }

      if (after) {
        const trailing = await backendClient.sendConversationMessage(conversationId, after, null);
        setMessages((current) => [...current, trailing]);
      }

      setStaged(null);
      setDraft("");
      setReplyingTo(null);
      reportTyping(false);
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Couldn't send that.", "error");
    } finally {
      setSending(false);
    }
  };


  // ── Attachment options ────────────────────────────────────────────────────

  const attachmentOptions: AttachmentOption[] = useMemo(() => {
    const options: AttachmentOption[] = [
      {
        id: "photo",
        label: "Photos",
        icon: "image-outline",
        onPress: () => {
          void (async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              onToast("SFLuv needs photo access to send a picture.", "error");
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsMultipleSelection: true,
              selectionLimit: 10,
              quality: 0.85,
            });
            if (result.canceled) {
              return;
            }
            stageAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: asset.fileName,
                isImage: true,
              })),
            );
          })();
        },
      },
      {
        id: "camera",
        label: "Camera",
        icon: "camera-outline",
        onPress: () => {
          void (async () => {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              onToast("SFLuv needs camera access to take a picture.", "error");
              return;
            }
            const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
            if (result.canceled) {
              return;
            }
            stageAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: asset.fileName,
                isImage: true,
              })),
            );
          })();
        },
      },
      {
        id: "file",
        label: "File",
        icon: "document-outline",
        onPress: () => {
          void (async () => {
            const result = await DocumentPicker.getDocumentAsync({
              multiple: true,
              // Everything, filtered server-side against the allowlist in
              // app_chat_attachment.go. Restricting the picker here too would
              // mean two lists to keep in step, and the one that matters for
              // safety is the server's.
              type: "*/*",
              // Copied into the app's cache so the URI is still readable when
              // the upload runs: a document-provider URI can expire the moment
              // the picker closes.
              copyToCacheDirectory: true,
            });
            if (result.canceled || result.assets.length === 0) {
              return;
            }
            stageAttachments(
              result.assets.map((asset) => ({
                uri: asset.uri,
                mimeType: asset.mimeType,
                fileName: displayFileName(asset.name),
                isImage: Boolean(asset.mimeType?.startsWith("image/")),
              })),
            );
          })();
        },
      },
    ];

    // Direct threads only — there is no single recipient in a group. The server
    // refuses it there as well rather than trusting this.
    if (!isGroup && conversation?.pay_address && onSendPayment) {
      options.push({
        id: "pay",
        label: `Send ${tokenSymbol}`,
        icon: "cash-outline",
        // Refused while something else is staged rather than allowed and then
        // silently dropped: a payment is one message and cannot carry a photo,
        // so sending both would have to discard one of them.
        disabledReason:
          staged && (staged.files.length > 0 || staged.reference)
            ? "Send what's attached first."
            : undefined,
        onPress: () => setMode("amount"),
      });
    }

    return options;
  }, [
    conversation?.pay_address,
    isGroup,
    onSendPayment,
    onToast,
    staged,
    stageAttachments,
    tokenSymbol,
  ]);

  // ── Message actions ───────────────────────────────────────────────────────

  const toggleReaction = async (message: ChatMessage, emoji: string) => {
    if (!backendClient) {
      return;
    }
    triggerClickHaptic(hapticsEnabled);
    setActionTarget(null);
    setReactionPickerFor(null);
    try {
      const result = await backendClient.toggleMessageReaction(conversationId, message.id, emoji);
      setMessages((current) =>
        current.map((m) => (m.id === message.id ? { ...m, reactions: result.reactions } : m)),
      );
    } catch {
      onToast("Couldn't react to that message.", "error");
    }
  };

  /**
   * Resolves a tap on a message into single, double or long.
   *
   * ── Why this is hand-rolled rather than two onPress handlers ──────────────
   *
   * A double tap is two single taps as far as Pressable is concerned, so
   * "double tap to like" and "tap to open the link" fight: the first tap of a
   * like would open the link and leave the thread. The single-tap action is
   * therefore DELAYED by the double-tap window and cancelled if a second tap
   * arrives — which is the only way to tell the two apart, and is why opening
   * a reference feels a fraction slower than it did.
   *
   * Long-press is handled separately by Pressable and must also not open
   * anything: holding something to react to it should not navigate away from
   * the thread you are reacting in.
   */
  const DOUBLE_TAP_MS = 240;
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef(0);

  useEffect(
    () => () => {
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
      }
    },
    [],
  );

  const handleMessageTap = (message: ChatMessage, openSingle?: () => void) => {
    // Selection mode owns every tap: picking messages is the only thing
    // happening, and opening something mid-selection would lose the selection.
    if (selectedIds !== null) {
      if (!message.deleted) {
        setSelectedIds((current) =>
          current?.includes(message.id)
            ? current.filter((id) => id !== message.id)
            : [...(current ?? []), message.id],
        );
      }
      return;
    }

    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      // Second tap: cancel the pending single and react instead.
      lastTapRef.current = 0;
      if (tapTimer.current) {
        clearTimeout(tapTimer.current);
        tapTimer.current = null;
      }
      if (!message.deleted) {
        void toggleReaction(message, DEFAULT_REACTIONS[0]);
      }
      return;
    }

    lastTapRef.current = now;
    if (!openSingle) {
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapTimer.current = null;
      openSingle();
    }, DOUBLE_TAP_MS);
  };

  /** How long a message stays editable. Mirrors the server's EditWindow. */
  const EDIT_WINDOW_MS = 5 * 60 * 1000;

  const canEdit = (message: ChatMessage): boolean =>
    message.is_mine &&
    !message.deleted &&
    (message.kind === "text" || message.kind === "attachment") &&
    Date.now() - new Date(message.created_at).getTime() < EDIT_WINDOW_MS;

  const submitEdit = async () => {
    const target = editing;
    const body = draft.trim();
    if (!target || !body || !backendClient || sending) {
      return;
    }
    setSending(true);
    try {
      const updated = await backendClient.editConversationMessage(conversationId, target.id, body);
      setMessages((current) => current.map((m) => (m.id === updated.id ? updated : m)));
      setEditing(null);
      setDraft("");
    } catch (e) {
      onToast(
        e instanceof BulletinRequestError ? e.message : "Couldn't save that edit.",
        "error",
      );
    } finally {
      setSending(false);
    }
  };

  const deleteMessages = async (ids: number[]) => {
    if (!backendClient || ids.length === 0) {
      return;
    }
    const failed: number[] = [];
    for (const id of ids) {
      try {
        await backendClient.deleteConversationMessage(conversationId, id);
        // Marked locally rather than removed: the server keeps a tombstone, and
        // dropping the row here would make the thread disagree with itself
        // until the next read.
        setMessages((current) =>
          current.map((m) =>
            m.id === id
              ? { ...m, deleted: true, body: "", attachments: [], reactions: [] }
              : m,
          ),
        );
      } catch {
        failed.push(id);
      }
    }
    setSelectedIds(null);
    if (failed.length > 0) {
      onToast(
        failed.length === ids.length
          ? "Couldn't delete that."
          : `Deleted ${ids.length - failed.length} of ${ids.length}.`,
        "error",
      );
    }
  };

  const confirmDelete = (ids: number[]) => {
    Alert.alert(
      ids.length === 1 ? "Delete this message?" : `Delete ${ids.length} messages?`,
      "This removes it for everyone in the chat. They'll see that a message was deleted.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void deleteMessages(ids) },
      ],
    );
  };

  /**
   * What "Copy" puts on the clipboard.
   *
   * For a plain message, its text. For a message whose content is a card, the
   * thing the card points AT — because that is what somebody copying a preview
   * wants to paste somewhere, and copying the card's scraped title instead
   * would hand them our words about the link rather than the link.
   *
   * ── Why an internal reference copies as a universal link ───────────────────
   *
   * A merchant, an event or a transaction copied out of a chat used to give a
   * bare database id, or — for a transaction — a bare hash, which pasted into a
   * message means nothing to whoever receives it. These are the same things the
   * share sheet hands out, so they copy as the same universal links: they open
   * the item in the app for somebody who has it, and land on a page describing
   * it for somebody who does not.
   *
   * The builders are shared with the share sheet rather than reimplemented, so
   * there is one URL shape per kind and no second place for it to drift.
   */
  const copyMessage = async (message: ChatMessage) => {
    setActionTarget(null);

    const attachment = message.attachments?.[0];
    const referenceLink = (): string => {
      try {
        if (attachment?.kind === "merchant" && attachment.location_id !== undefined) {
          return buildUniversalMerchantLink({ locationId: attachment.location_id });
        }
        if (attachment?.kind === "event" && attachment.event_id) {
          return buildUniversalEventLink({ eventId: attachment.event_id });
        }
        if (attachment?.kind === "transaction" && attachment.tx_hash) {
          return buildUniversalTransactionLink({ txHash: attachment.tx_hash });
        }
        // A payment made in the chat is not an attachment, but it points at a
        // transaction just the same.
        if (message.kind === "payment" && message.tx_hash) {
          return buildUniversalTransactionLink({ txHash: message.tx_hash });
        }
      } catch {
        // A malformed id. Falls through to the body rather than copying a URL
        // that goes nowhere.
      }
      return "";
    };

    const fromAttachment = attachment?.kind === "link" ? attachment.link_url : referenceLink();

    // The body wins when there is one AND it is not just the bare link the
    // card already represents — a sentence containing a link copies as the
    // sentence, a message that is only a link copies as the URL.
    const body = message.body?.trim() ?? "";
    const bodyIsJustTheLink =
      Boolean(fromAttachment) && body.replace(fromAttachment ?? "", "").trim() === "";
    const text = body && !bodyIsJustTheLink ? body : fromAttachment || body;

    if (!text) {
      onToast("There's nothing to copy.", "info");
      return;
    }
    await Clipboard.setStringAsync(text);
    onToast("Copied.", "success");
  };

  // ── Rendering ─────────────────────────────────────────────────────────────

  const attachmentHandlers: AttachmentHandlers = useMemo(
    () => ({
      onOpenImage: (attachment) => setPreviewAttachment(attachment),
      onOpenFile: (attachment) => setPreviewAttachment(attachment),
      onOpenTransaction,
      onOpenMerchant,
      onOpenEvent,
      onOpenSupport: () => {
        // The card is the context, not a destination: the person reading it is
        // either the sender of the request or the staff member answering it,
        // and both already know what it says.
      },
    }),
    [onOpenEvent, onOpenMerchant, onOpenTransaction, onToast],
  );

  /**
   * The attachment handlers for one message, with every open routed through the
   * tap dispatcher.
   *
   * Built per message rather than once, because the dispatcher needs to know
   * WHICH message a double tap should heart — and the card only knows about its
   * own attachment.
   */
  const cardHandlersFor = (message: ChatMessage): AttachmentHandlers => ({
    onOpenImage: (attachment) =>
      handleMessageTap(message, () => setPreviewAttachment(attachment)),
    onOpenFile: (attachment) => handleMessageTap(message, () => setPreviewAttachment(attachment)),
    onOpenTransaction: (ref) =>
      handleMessageTap(message, () => attachmentHandlers.onOpenTransaction?.(ref)),
    onOpenMerchant: (locationId) =>
      handleMessageTap(message, () => attachmentHandlers.onOpenMerchant?.(locationId)),
    onOpenEvent: (eventId) =>
      handleMessageTap(message, () => attachmentHandlers.onOpenEvent?.(eventId)),
    onOpenSupport: () => handleMessageTap(message),
  });

  const renderRow = ({ item: row }: { item: ChatRow }) => {
    if (row.kind === "separator") {
      return (
        <View style={styles.daySeparatorRow}>
          <Text style={styles.daySeparator}>{row.label}</Text>
        </View>
      );
    }

    const item = row.message;
    const olderNeighbour = row.previousInTime;
    const newerNeighbour = row.nextInTime;

    if (item.kind === "system") {
      return (
        <View style={styles.systemLine}>
          <Text style={styles.systemText}>{item.body}</Text>
        </View>
      );
    }

    // A run of messages from one person shows their name once, on the oldest of
    // the run — the one with a different sender above it.
    const showSender =
      isGroup &&
      !item.is_mine &&
      (!olderNeighbour || olderNeighbour.sender_id !== item.sender_id || olderNeighbour.kind === "system");

    const isPayment = item.kind === "payment";

    // ── Who said it, in a group ──────────────────────────────────────────────
    //
    // Telegram's arrangement: a small picture beside the bubble, on the LAST
    // message of a run from one person, bottom-aligned, with the others in the
    // run indented to match. The name already appears once at the top of the
    // run; the picture is what makes a busy group scannable without reading
    // any names at all.
    //
    // Shown for other people only. Your own messages are on the other side of
    // the screen, which already says they are yours.
    const avatarRole = !isGroup || item.is_mine
      ? "none"
      : !newerNeighbour || newerNeighbour.sender_id !== item.sender_id || newerNeighbour.kind === "system"
        ? "show"
        : "spacer";

    return (
      <Animated.View
        style={[
          styles.messageRow,
          item.is_mine ? styles.messageRowMine : undefined,
          { transform: [{ translateX: stampReveal }] },
        ]}
      >
        {avatarRole === "show" ? (
          <SenderAvatar
            userId={item.sender_id}
            name={item.sender_name || ""}
            client={backendClient}
            headers={imageAuthHeaders}
          />
        ) : avatarRole === "spacer" ? (
          <View style={styles.senderAvatarSpacer} />
        ) : null}

        <View
          style={[
            styles.messageColumn,
            // The avatar column costs the bubble its width, so the cap comes
            // down by that much — otherwise a long message in a group pushes
            // past the edge of the screen.
            avatarRole !== "none" ? styles.messageColumnWithAvatar : undefined,
          ]}
        >
          {showSender ? <Text style={styles.senderName}>{item.sender_name}</Text> : null}

          <Pressable
            onLongPress={() => {
              // A deleted message has no actions worth offering.
              if (item.deleted) {
                return;
              }
              triggerClickHaptic(hapticsEnabled);
              setActionTarget(item);
            }}
            // Through the dispatcher: a double tap hearts the message, and a
            // single tap on a bubble with nothing to open does nothing.
            onPress={() => handleMessageTap(item)}
            delayLongPress={280}
            style={
              selectedIds === null
                ? undefined
                : selectedIds.includes(item.id)
                  ? styles.selectedRow
                  : styles.unselectedRow
            }
          >
            {/* Select mode: every message gets a check, filled on the picked
                ones, and the rest dim. A tint alone was too faint to tell at a
                glance which of several messages were picked. */}
            {selectedIds !== null && !item.deleted ? (
              <View
                pointerEvents="none"
                style={[
                  styles.selectCheck,
                  item.is_mine ? styles.selectCheckMine : styles.selectCheckTheirs,
                  selectedIds.includes(item.id) ? styles.selectCheckOn : undefined,
                ]}
              >
                {selectedIds.includes(item.id) ? (
                  <Ionicons name="checkmark" size={14} color={palette.white} />
                ) : null}
              </View>
            ) : null}
            {/* A deleted message keeps its place.
                Removing the row would turn any reply to it into a
                non-sequitur, and would quietly change what the conversation
                looks like it was. The body is already blanked by the server —
                there is nothing here to hide. */}
            {item.deleted ? (
              <View style={styles.deletedBubble}>
                <Text style={styles.deletedText}>Message was deleted</Text>
              </View>
            ) : null}

            {!item.deleted && item.reply_to ? (
              <View style={[styles.quote, item.is_mine ? styles.quoteMine : undefined]}>
                <View style={styles.quoteStripe} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.quoteName} numberOfLines={1}>
                    {item.reply_to.sender_name || "Message"}
                  </Text>
                  <Text
                    style={[styles.quoteBody, item.reply_to.deleted && styles.quoteBodyDeleted]}
                    numberOfLines={2}
                  >
                    {item.reply_to.deleted
                      ? "Message was deleted"
                      : item.reply_to.body?.trim() ||
                        attachmentKindLabel(item.reply_to.attachment_kind)}
                  </Text>
                </View>
              </View>
            ) : null}

            {item.deleted ? null : isPayment ? (
              // ── A PAYMENT, not a record ────────────────────────────────────
              //
              // Money moving inside this conversation. Deliberately shaped
              // nothing like the transaction-record card in
              // MessageAttachmentCard: a dollar sign rather than a receipt, and
              // the amount is the whole content rather than a subtitle under a
              // title. "I just paid you 5 SFLUV" and "here is a transfer from
              // March" are different claims and should not have to be told
              // apart by reading carefully.
              //
              // Both open the same transaction sheet, so the detail is one tap
              // away from either.
              <Pressable
                style={styles.paymentBubble}
                onPress={() =>
                  handleMessageTap(item, () => {
                    if (!item.tx_hash) {
                      return;
                    }
                    // A payment bubble carries no addresses — only the amount
                    // and who posted it — so `mine` is what tells the sheet
                    // which way the money went.
                    onOpenTransaction?.({
                      txHash: item.tx_hash,
                      amountSfluvBase: item.amount_sfluv_base,
                      at: Math.floor(new Date(item.created_at).getTime() / 1000),
                      mine: item.is_mine,
                    });
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Payment, ${formatSfluvAmount(item.amount_sfluv_base)} ${tokenSymbol}`}
              >
                {/* SFLuv's mark, not a dollar sign. This is not dollars: a
                    green $ on a payment of a local currency names the wrong
                    unit, and it is the same mark the QR code and the volunteer
                    screens already use, so a payment in the chat looks like
                    the currency it is. */}
                <View style={styles.paymentIcon}>
                  <Image source={SFLUV_MARK} style={styles.paymentMark} resizeMode="contain" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentAmount}>
                    {formatSfluvAmount(item.amount_sfluv_base) || "—"} {tokenSymbol}
                  </Text>
                  {/* The sender's note, when they wrote one. Kept because the
                      amount pad offers the field — not a "detail" we added, but
                      something they chose to say. */}
                  {item.body ? <Text style={styles.paymentNote}>{item.body}</Text> : null}
                  {/* A state, not a detail: an unconfirmed amount must not read
                      as a settled one. */}
                  {!item.payment_verified ? (
                    <Text style={styles.paymentPending}>Confirming…</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={15} color={palette.textMuted} />
              </Pressable>
            ) : (
              (() => {
                const attachments = item.attachments ?? [];
                const body = item.body?.trim() ?? "";
                const emojiOnly = attachments.length === 0 && isEmojiOnly(body);

                // ── A link that IS the message ────────────────────────────
                //
                // When the whole message is one link, the card says everything
                // and the URL beneath it is noise. When the link is one part of
                // a sentence, the sentence has to survive — so the text renders
                // as a normal bubble and the card goes under it, rather than the
                // text becoming a caption clamped under an image.
                //
                // Compared loosely: the server stores its normalized form
                // ("https://sfluv.org/"), so "Sfluv.org" as typed never matched
                // exactly and the message showed as a bubble AND a card.
                const soleLink =
                  attachments.length === 1 &&
                  attachments[0].kind === "link" &&
                  Boolean(attachments[0].link_url) &&
                  isSameLink(body, attachments[0].link_url ?? "");

                return (
                  <View style={styles.messageStack}>
                    {/* The text, in a normal bubble, whenever there is text
                        worth showing. */}
                    {body && !soleLink ? (
                      emojiOnly ? (
                        <Text style={styles.emojiOnly}>{item.body}</Text>
                      ) : (
                        <View
                          style={[
                            styles.bubble,
                            item.is_mine ? styles.bubbleMine : styles.bubbleTheirs,
                          ]}
                        >
                          <Text style={item.is_mine ? styles.bubbleTextMine : styles.bubbleText}>
                            {item.body}
                          </Text>
                        </View>
                      )
                    ) : null}

                    {attachments.map((attachment: MessageAttachment) => (
                      <MessageAttachmentCard
                        key={attachment.id}
                        attachment={attachment}
                        conversationId={conversationId}
                        client={backendClient}
                        tokenSymbol={tokenSymbol}
                        mine={item.is_mine}
                        // The card's own open action is routed through the tap
                        // dispatcher, so a double tap hearts the message instead
                        // of opening the thing twice, and a long press menus it
                        // instead of navigating away from the thread.
                        handlers={cardHandlersFor(item)}
                        onLongPress={() => {
                          if (item.deleted) {
                            return;
                          }
                          triggerClickHaptic(hapticsEnabled);
                          setActionTarget(item);
                        }}
                      />
                    ))}
                  </View>
                );
              })()
            )}
          </Pressable>

          {/* Delivery state, on your own most recent message only.
              iMessage's placement, and for its reason: a status under every
              bubble is noise, and the only one anybody checks is the last one
              they sent. "Read" needs everybody in a group, not whoever opened
              it first — see OtherMemberReadState. */}
          {item.is_mine && !item.deleted && item.id === lastOwnMessageId ? (
            <Text style={styles.deliveryState}>
              {conversation && (conversation.other_last_read_message_id ?? 0) >= item.id
                ? "Read"
                : "Delivered"}
            </Text>
          ) : null}

          {item.edited_at && !item.deleted ? (
            <Text style={[styles.editedMark, item.is_mine && styles.editedMarkMine]}>edited</Text>
          ) : null}

          {item.reactions?.length ? (
            <View style={[styles.reactionRow, item.is_mine ? styles.reactionRowMine : undefined]}>
              {item.reactions.map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  style={[styles.reactionChip, reaction.mine ? styles.reactionChipMine : undefined]}
                  onPress={() => void toggleReaction(item, reaction.emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`${reaction.emoji} ${reaction.count}${reaction.mine ? ", yours" : ""}`}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  {reaction.count > 1 ? (
                    <Text style={styles.reactionCount}>{reaction.count}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* The revealed time. Positioned just off the right edge, so it slides
            into view as the thread moves left and occupies no space at rest. */}
        <Text style={styles.messageStamp}>{formatMessageStamp(item.created_at)}</Text>
      </Animated.View>
    );
  };

  const headerTitle = isGroup
    ? conversation?.title || "Group"
    : conversation?.other_user.public_name || "";
  const headerSubtitle = isGroup
    ? `${conversation?.member_count ?? 0} ${conversation?.member_count === 1 ? "person" : "people"}`
    : null;

  const composerDisabledReason = conversation?.blocked_by_me
    ? `You blocked ${conversation.other_user.public_name}.`
    : conversation?.other_user_inactive
      ? `${conversation.other_user.public_name} can't receive messages right now.`
      : null;

  return (
    <SwipeBack ref={swipeRef} onBack={onBack} style={styles.screen} enabled={mode === "text"}>
      {/* The chat's own header. The shell hides its top bar for this screen, so
          this is the only one — see the note at the top of the file. */}
      <View style={styles.header}>
        {/* The animated close, not onBack directly: a button that snaps the
            screen away while the swipe glides it away is the same exit looking
            like two different things. */}
        <Pressable
          onPress={() => swipeRef.current?.close()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={26} color={palette.text} />
        </Pressable>
        <Pressable
          style={styles.headerIdentity}
          onPress={() => conversation && onOpenInfo(conversation)}
          accessibilityRole="button"
          accessibilityLabel={isGroup ? "Group info" : "Contact info"}
        >
          <Avatar name={headerTitle || "?"} size={32} />
          <View style={styles.headerText}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {headerTitle}
            </Text>
            {headerSubtitle ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {headerSubtitle}
              </Text>
            ) : conversation ? (
              <BadgeLine user={conversation.other_user} />
            ) : null}
          </View>
        </Pressable>
        <Pressable
          onPress={() => {
            // The keyboard goes with it. Info is a screen, not a sheet over
            // this one, so a keyboard left standing there belongs to a text
            // field that is no longer on screen — it covers half the info
            // screen and the only way to get rid of it is to come back here.
            Keyboard.dismiss();
            if (conversation) {
              onOpenInfo(conversation);
            }
          }}
          hitSlop={10}
          accessibilityRole="button"
          // Replaces the "..." this had: a menu glyph promises a list of
          // actions, and what is actually behind it is a screen about this
          // conversation. The actions moved onto that screen.
          accessibilityLabel={isGroup ? "Group info" : "Conversation info"}
        >
          <Ionicons name="information-circle-outline" size={24} color={palette.text} />
        </Pressable>

        {/* The sending indicator, on the header's bottom edge.
            It used to sit on top of the composer, which put it in the one place
            a progress bar should not be: under your thumbs, moving, while you
            are typing the next message. Here it reads as the screen's own
            loading state — the same place a browser puts one — and it is clear
            of the keyboard entirely.
            Absolutely positioned, so a send does not nudge the whole thread
            down by two points as the bar appears. Rendered unconditionally
            because it owns its own mounting: `active` going false is what
            starts the run-out. */}
        <SendingBar active={sending} />
      </View>

      {/* The measured keyboard lift, not a KeyboardAvoidingView.
          KAV with "padding" adds the keyboard height measured from the WINDOW
          bottom, but this view's bottom edge is already above it — the shell
          wraps every screen in a SafeAreaView — so it overshot by the bottom
          inset and left a band of background under the composer. See
          useKeyboardLift. */}
      <View ref={keyboardRef} onLayout={measureKeyboardGap} style={[styles.body, { paddingBottom: lift }]}>
        <FlatList
          {...stampResponder.panHandlers}
          // Inverted: index 0 is the newest message, so the resting position is
          // the bottom and the keyboard cannot fight a scroll-to-end. See the
          // note at the top of the file.
          inverted
          data={rows}
          keyExtractor={(row) => (row.kind === "separator" ? row.key : String(row.message.id))}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onEndReachedThreshold={0.4}
          // "End" on an inverted list is the TOP, which is where older messages
          // are — so this is the infinite scroll backwards through history.
          onEndReached={() => void loadOlder()}
          ListFooterComponent={
            loadingOlder ? (
              <View style={styles.loadingOlder}>
                <ThemedActivityIndicator />
              </View>
            ) : null
          }
          ListEmptyComponent={
            conversation ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={30} color={palette.textMuted} />
                <Text style={styles.emptyText}>Say hello.</Text>
              </View>
            ) : (
              <View style={styles.empty}>
                <ThemedActivityIndicator />
              </View>
            )
          }
        />

        {/* ── Why the typing bubble is not in the list ─────────────────────────
            It was the inverted list's ListHeaderComponent, which is that
            list's visual bottom and looks like the right place for it. The
            problem is what happens when a message arrives while it is up: a
            new cell is inserted at index 0, which in an inverted list is the
            same edge the header occupies, and for the frame between the cell
            mounting and its height being measured the two are laid out over
            each other. That is the reported overlap.
            As a sibling of the list it cannot overlap list content at all, and
            it pushes the thread up by its own height when it appears, which is
            what iMessage and Telegram both do. */}
        {typing.length > 0 ? (
          <View style={styles.typingRow}>
            <View style={styles.typingBubble}>
              <TypingDots />
            </View>
            {isGroup ? (
              <Text style={styles.typingWho} numberOfLines={1}>
                {typing.length === 1
                  ? `${typing[0].userName} is typing`
                  : `${typing.length} people are typing`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Selection mode replaces the composer: you are deleting, not
            writing, and leaving a text field up invites typing into a mode
            that would discard it. */}
        {selectedIds !== null ? (
          <View style={styles.selectionBar}>
            <Pressable onPress={() => setSelectedIds(null)} hitSlop={8}>
              <Text style={styles.selectionCount}>Cancel</Text>
            </Pressable>
            <Text style={styles.selectionCount}>
              {selectedIds.length} selected
            </Text>
            <Pressable
              style={[
                styles.selectionDelete,
                selectedIds.length === 0 && styles.selectionDeleteDisabled,
              ]}
              onPress={() => confirmDelete(selectedIds)}
              disabled={selectedIds.length === 0}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selectedIds.length} messages`}
            >
              <Ionicons name="trash-outline" size={16} color={palette.white} />
              <Text style={styles.selectionDeleteText}>Delete</Text>
            </Pressable>
          </View>
        ) : composerDisabledReason ? (
          <View style={styles.blockedBar}>
            <Text style={styles.blockedText}>{composerDisabledReason}</Text>
          </View>
        ) : (
          <>
          {editing ? (
            <View style={styles.editBanner}>
              <Ionicons name="pencil" size={13} color={palette.primaryStrong} />
              <Text style={styles.editBannerText} numberOfLines={1}>
                Editing a message
              </Text>
              <Pressable
                onPress={() => {
                  setEditing(null);
                  setDraft("");
                }}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Stop editing"
              >
                <Ionicons name="close" size={16} color={palette.textMuted} />
              </Pressable>
            </View>
          ) : null}
          <ChatComposer
            mode={mode}
            onModeChange={setMode}
            draft={draft}
            onDraftChange={(value) => {
              setDraft(value);
              reportTyping(value.trim().length > 0);
            }}
            onSend={() => void (editing ? submitEdit() : staged ? sendStaged() : send())}
            sending={sending}
            attachmentOptions={attachmentOptions}
            onStageAmount={
              !isGroup && conversation?.pay_address && onSendPayment ? stagePayment : undefined
            }
            stagedPayment={staged?.payment ?? null}
            onRemoveStagedPayment={() =>
              setStaged((current) => {
                if (!current) {
                  return null;
                }
                // Dropping the payment with nothing else staged clears the
                // whole staging state, so the composer goes back to plain text
                // rather than holding an empty tray.
                const rest = { ...current, payment: undefined };
                return rest.files.length === 0 && !rest.reference ? null : rest;
              })
            }
            tokenSymbol={tokenSymbol}
            availableBalance={availableBalance}
            replyingTo={
              replyingTo
                ? {
                    id: replyingTo.id,
                    senderName: replyingTo.is_mine
                      ? "You"
                      : replyingTo.sender_name || conversation?.other_user.public_name || "Message",
                    body: replyingTo.body?.trim() || attachmentKindLabel(replyingTo.attachments?.[0]?.kind),
                  }
                : null
            }
            onCancelReply={() => setReplyingTo(null)}
            stagedAttachments={staged?.files}
            onRemoveStaged={(index) =>
              setStaged((current) => {
                if (!current) {
                  return null;
                }
                const files = current.files.filter((_, i) => i !== index);
                // Nothing staged any more means nothing to stage FOR, so the
                // split point goes too.
                return files.length === 0 && !current.reference ? null : { ...current, files };
              })
            }
            onCaretChange={(position) => {
              caretRef.current = position;
            }}
            linkPreview={linkPreview}
            onDismissLinkPreview={() => {
              // Remembered per URL, so dismissing does not just make the card
              // come back on the next keystroke.
              if (linkPreview) {
                // The DETECTED url, which is what the effect compares against.
                setDismissedLinks((current) => [...current, linkPreview.detectedUrl]);
              }
              setLinkPreview(null);
            }}
            hapticsEnabled={hapticsEnabled}
            inputRef={inputRef}
            placeholder={editing ? "Edit your message" : "Message"}
          />
          </>
        )}
      </View>

      {/* ── Long-press actions ────────────────────────────────────────────── */}
      <Modal
        visible={Boolean(actionTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setActionTarget(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionTarget(null)}>
          <Pressable style={styles.actionCard} onPress={() => {}}>
            <View style={styles.quickReactions}>
              {DEFAULT_REACTIONS.map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.quickReaction}
                  onPress={() => actionTarget && void toggleReaction(actionTarget, emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={styles.quickReactionEmoji}>{emoji}</Text>
                </Pressable>
              ))}
              <Pressable
                style={styles.quickReaction}
                onPress={() => {
                  setReactionPickerFor(actionTarget);
                  setActionTarget(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="More reactions"
              >
                <Ionicons name="add" size={20} color={palette.textMuted} />
              </Pressable>
            </View>

            <ActionRow
              icon="arrow-undo-outline"
              label="Reply"
              onPress={() => {
                setReplyingTo(actionTarget);
                setActionTarget(null);
                setMode("text");
                setTimeout(() => inputRef.current?.focus(), 120);
              }}
            />
            <ActionRow
              icon="copy-outline"
              label="Copy"
              onPress={() => actionTarget && void copyMessage(actionTarget)}
            />
            {/* Editing is offered only inside the window, and the window is
                checked again by the server — this hides an option that would
                be refused rather than relying on the client's clock to
                enforce it. */}
            {actionTarget && canEdit(actionTarget) ? (
              <ActionRow
                icon="pencil-outline"
                label="Edit"
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  setEditing(target);
                  setDraft(target.body ?? "");
                  setReplyingTo(null);
                  setMode("text");
                  setTimeout(() => inputRef.current?.focus(), 120);
                }}
              />
            ) : null}
            {actionTarget?.attachments?.some(
              (a) => a.kind === "image" || a.kind === "file",
            ) ? (
              <ActionRow
                icon="download-outline"
                label={
                  actionTarget.attachments?.[0]?.kind === "image" ? "Save to photos" : "Save file"
                }
                onPress={() => {
                  const target = actionTarget?.attachments?.find(
                    (a) => a.kind === "image" || a.kind === "file",
                  );
                  setActionTarget(null);
                  if (!target || !backendClient) {
                    return;
                  }
                  void (async () => {
                    const outcome = await saveAttachment(backendClient, conversationId, target);
                    if (outcome.status === "saved-to-photos") {
                      onToast("Saved to your photos.", "success");
                    } else if (outcome.status === "denied" || outcome.status === "failed") {
                      onToast(outcome.message, "error");
                    }
                  })();
                }}
              />
            ) : null}
            {actionTarget?.is_mine ? (
              <ActionRow
                icon="trash-outline"
                label="Delete"
                destructive
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  if (target) {
                    confirmDelete([target.id]);
                  }
                }}
              />
            ) : null}
            {actionTarget?.is_mine ? (
              <ActionRow
                icon="checkmark-circle-outline"
                label="Select more…"
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  // Seeded with the message that was long-pressed, so the
                  // first tap after entering the mode adds a second rather
                  // than starting over.
                  setSelectedIds(target ? [target.id] : []);
                }}
              />
            ) : null}
            {actionTarget && !actionTarget.is_mine ? (
              <ActionRow
                icon="flag-outline"
                label="Report"
                destructive
                onPress={() => {
                  const target = actionTarget;
                  setActionTarget(null);
                  if (!target || !backendClient) {
                    return;
                  }
                  Alert.alert(
                    "Report this message?",
                    "An SFLuv admin will review it. The sender isn't told who reported them.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Report",
                        style: "destructive",
                        onPress: () =>
                          void backendClient
                            .reportContent({
                              target_type: "message",
                              target_id: String(target.id),
                              reason: "other",
                            })
                            .then(() => onToast("Thanks. We'll take a look.", "success"))
                            .catch(() => onToast("Couldn't send that report.", "error")),
                      },
                    ],
                  );
                }}
              />
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── The wider emoji set ───────────────────────────────────────────── */}
      <Modal
        visible={Boolean(reactionPickerFor)}
        transparent
        animationType="fade"
        onRequestClose={() => setReactionPickerFor(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setReactionPickerFor(null)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <Text style={styles.pickerTitle}>React</Text>
            <View style={styles.pickerGrid}>
              {[...DEFAULT_REACTIONS, ...MORE_REACTIONS].map((emoji) => (
                <Pressable
                  key={emoji}
                  style={styles.pickerCell}
                  onPress={() => reactionPickerFor && void toggleReaction(reactionPickerFor, emoji)}
                  accessibilityRole="button"
                  accessibilityLabel={`React ${emoji}`}
                >
                  <Text style={styles.pickerEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── An attachment, full screen, with a way to keep it ───────────── */}
      <AttachmentPreview
        attachment={previewAttachment}
        conversationId={conversationId}
        client={backendClient}
        senderName={
          messages.find((m) => m.attachments?.some((a) => a.id === previewAttachment?.id))
            ?.sender_name
        }
        onClose={() => setPreviewAttachment(null)}
        onToast={onToast}
      />
    </SwipeBack>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  destructive,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.sm,
        paddingVertical: 13,
        paddingHorizontal: spacing.md,
      }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={19} color={destructive ? palette.danger : palette.text} />
      <Text style={{ fontSize: 15, color: destructive ? palette.danger : palette.text }}>{label}</Text>
    </Pressable>
  );
}

/**
 * A hairline under the conversation's name showing a message in flight.
 *
 * ── Why it fills rather than sweeps, and why it finishes ────────────────────
 *
 * This was an indeterminate sweep that was simply unmounted the moment the
 * send resolved, so the common case — a send that takes a fraction of a
 * second — was a bar that appeared mid-stride and vanished mid-stride. It read
 * as something being interrupted rather than something completing.
 *
 * Now it has an end. The fill creeps toward nine tenths while the send is in
 * flight, slowing as it goes, and never arrives on its own: arriving means
 * delivered, and only the server can say that. When the send resolves it runs
 * the last tenth quickly and fades, so every send — however short — is seen to
 * finish. The creep is still not a measurement, and is honest about that by
 * decelerating instead of advancing steadily.
 */
/** How long a send runs before the bar appears. */
const SENDING_BAR_DELAY_MS = 200;

function SendingBar({ active }: { active: boolean }) {
  const { palette } = useAppTheme();
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(0)).current;
  // Whether a run is in progress, as a ref rather than state so the effect
  // below depends on `active` alone and is not re-entered by its own
  // setMounted.
  const running = useRef(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (active) {
      // Only for a send that is visibly taking time. Most land within a couple
      // of hundred milliseconds, and a bar flashing on every one of those is
      // noise; a send that resolves inside the delay never shows it at all.
      const timer = setTimeout(() => {
        running.current = true;
        setMounted(true);
        progress.setValue(0);
        fade.setValue(1);
        Animated.timing(progress, {
          toValue: 0.9,
          duration: 2400,
          // Decelerating: fast off the mark, then slower and slower short of the
          // end. A linear creep to 90% looks like a measurement of something.
          easing: Easing.out(Easing.quad),
          useNativeDriver: false,
        }).start();
      }, SENDING_BAR_DELAY_MS);
      return () => clearTimeout(timer);
    }

    if (!running.current) {
      return;
    }
    running.current = false;
    Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(fade, { toValue: 0, duration: 220, useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (finished) {
        setMounted(false);
      }
    });
  }, [active, fade, progress]);

  if (!mounted) {
    // Nothing at all, not a zero-height box: a 2pt track sitting under the
    // header at all times is a line the design does not have.
    return null;
  }

  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        overflow: "hidden",
        backgroundColor: palette.surfaceStrong,
        opacity: fade,
      }}
    >
      <Animated.View
        style={{
          height: 2,
          backgroundColor: palette.primary,
          width: progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
        }}
      />
    </Animated.View>
  );
}

/**
 * A group member's picture beside their message.
 *
 * Falls back to their initials, which is also what happens for somebody who has
 * not set a picture: the avatar route answers 404 for them, so the image simply
 * errors and the initials take over. Asking the server first who has a picture
 * would be a request per member to avoid a 404 per member.
 */
function SenderAvatar({
  userId,
  name,
  client,
  headers,
}: {
  userId: string;
  name: string;
  client: AppBackendClient | null;
  headers: Record<string, string> | null;
}) {
  const { palette } = useAppTheme();
  const [failed, setFailed] = useState(false);

  // Built as one object so the headers' presence and the URL cannot disagree.
  const source =
    client && headers && !failed ? { uri: client.userAvatarURL(userId), headers } : null;

  return (
    <View style={{ width: AVATAR_SIZE, marginRight: 6, justifyContent: "flex-end" }}>
      {source ? (
        <Image
          source={source}
          style={{ width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 }}
          onError={() => setFailed(true)}
        />
      ) : (
        <View
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: AVATAR_SIZE / 2,
            backgroundColor: palette.primaryMuted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: palette.primaryStrong, fontWeight: "700", fontSize: 11 }}>
            {senderInitials(name)}
          </Text>
        </View>
      )}
    </View>
  );
}

/** The width of a sender avatar, and of the gap left for one. */
const AVATAR_SIZE = 26;

/** Up to two initials from a display name, for somebody with no picture. */
function senderInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "?";
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Three dots that fade in sequence, which is what "typing" looks like. */
function TypingDots() {
  const { palette } = useAppTheme();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setStep((current) => (current + 1) % 3), 320);
    return () => clearInterval(interval);
  }, []);
  return (
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[0, 1, 2].map((index) => (
        <View
          key={index}
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: palette.textMuted,
            opacity: index === step ? 1 : 0.35,
          }}
        />
      ))}
    </View>
  );
}


/**
 * The centred date/time shown between two messages, or null for none.
 *
 * iMessage's rule, approximately: a line appears when the conversation resumes
 * after a real gap, not between every message. An hour is the threshold —
 * shorter than that is one sitting and a line would just be clutter; longer and
 * "when was this" becomes a question worth answering without making somebody
 * swipe for it.
 *
 * Always shown before the first message, so a thread never opens with no date
 * at all.
 */
function sessionSeparator(previous: ChatMessage | undefined, current: ChatMessage): string | null {
  const at = new Date(current.created_at);
  if (!previous) {
    return formatSessionStamp(at);
  }
  const gap = at.getTime() - new Date(previous.created_at).getTime();
  const SESSION_GAP_MS = 60 * 60 * 1000;
  if (gap < SESSION_GAP_MS) {
    return null;
  }
  return formatSessionStamp(at);
}

/** "Today 14:32", "Yesterday 09:10", "Mon 3 Mar 18:45". */
function formatSessionStamp(at: Date): string {
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const sameDay = at.toDateString() === now.toDateString();
  if (sameDay) {
    return `Today ${time}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${time}`;
  }
  const sameYear = at.getFullYear() === now.getFullYear();
  const day = at.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day} ${time}`;
}

/**
 * Whether a message is nothing but a few emoji, which iMessage renders large
 * and unbubbled.
 *
 * "Fewer than five" is the rule asked for, and the count is of GRAPHEMES rather
 * than code points: 👨‍👩‍👧 is one emoji to a reader and five code points to
 * JavaScript, so counting the latter would bubble a single family emoji.
 * Intl.Segmenter does the clustering where it exists; where it does not, the
 * fallback is deliberately conservative and leaves the message bubbled rather
 * than guessing.
 */
function isEmojiOnly(body: string): boolean {
  const text = body.trim();
  if (!text) {
    return false;
  }
  // Anything that is not an emoji, a modifier, a joiner or a space disqualifies
  // it immediately — this is the cheap check that rejects almost every message.
  if (/[^\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]/u.test(text)) {
    return false;
  }
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new (Intl as unknown as { Segmenter: new (l?: string, o?: object) => { segment: (s: string) => Iterable<unknown> } }).Segmenter(
          undefined,
          { granularity: "grapheme" },
        )
      : null;
  if (!segmenter) {
    return false;
  }
  let count = 0;
  for (const _ of segmenter.segment(text.replace(/\s+/g, ""))) {
    count += 1;
    if (count >= 5) {
      return false;
    }
  }
  return count > 0;
}

/** The per-message time revealed by swiping the thread left. */
function formatMessageStamp(at: string): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * The first URL in a draft, or null.
 *
 * Deliberately conservative. It matches an explicit http(s):// prefix, or a
 * bare `host.tld/...` with a recognisable dot — not every string containing a
 * dot, because "see you at 3.30" and "that costs 1.50" are not links and a card
 * appearing under them would be absurd. A sender whose link is not detected can
 * still send it as text; a false positive makes us fetch a URL that somebody
 * did not share, which is the worse error.
 */
/**
 * Whether a message's text is nothing but this link, as a person would judge
 * it: case, scheme, "www." and a trailing slash do not count.
 */
function isSameLink(text: string, url: string): boolean {
  const bare = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  return bare(text) !== "" && bare(text) === bare(url);
}

function firstURL(text: string): string | null {
  const match = text.match(
    /(?:https?:\/\/[^\s<>"']+)|(?:\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s<>"']*)?)/i,
  );
  if (!match) {
    return null;
  }
  const candidate = match[0].replace(/[.,;:!?)\]]+$/, "");
  if (!candidate) {
    return null;
  }
  return /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
}

export function formatSfluvAmount(base?: string | null): string {
  if (!base) return "";
  const value = Number(base) / 1_000_000;
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function createStyles(palette: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      backgroundColor: palette.background,
    },
    headerIdentity: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
    headerText: { flex: 1 },
    headerTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    headerSubtitle: { fontSize: 12, color: palette.textMuted, marginTop: 1 },

    body: { flex: 1 },
    listContent: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 3 },

    messageRow: { flexDirection: "row", marginVertical: 2, alignItems: "flex-end" },
    // Holds the bubbles of a run in line with the one that has the picture.
    senderAvatarSpacer: { width: AVATAR_SIZE, marginRight: 6 },
    messageRowMine: { justifyContent: "flex-end" },
    messageColumn: { maxWidth: "84%" },
    messageColumnWithAvatar: { maxWidth: "76%" },
    senderName: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primaryStrong,
      marginBottom: 2,
      marginLeft: 10,
    },

    bubble: { borderRadius: radii.lg, paddingHorizontal: 13, paddingVertical: 9 },
    bubbleMine: { backgroundColor: palette.primary, borderBottomRightRadius: 6 },
    bubbleTheirs: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderBottomLeftRadius: 6,
    },
    // A stack rather than one bubble: text and cards are separate objects now,
    // so a sentence containing a link keeps its bubble and the card sits under
    // it instead of the text being clamped beneath an image.
    messageStack: { gap: 4, alignItems: "stretch" },
    // iMessage's treatment for a message that is only a few emoji: large, and
    // no bubble, because the emoji IS the message rather than something said
    // inside one.
    emojiOnly: { fontSize: 44, lineHeight: 52, paddingHorizontal: 4 },
    bubbleText: { fontSize: 15, color: palette.text, lineHeight: 20 },
    bubbleTextMine: { fontSize: 15, color: palette.white, lineHeight: 20 },
    caption: { marginTop: 6, color: palette.text },
    attachments: { gap: 6 },

    quote: {
      flexDirection: "row",
      gap: 7,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.sm,
      padding: 7,
      marginBottom: 3,
      maxWidth: 268,
    },
    quoteMine: { backgroundColor: palette.surfaceStrong },
    quoteStripe: { width: 3, borderRadius: 2, backgroundColor: palette.primary },
    quoteName: { fontSize: 11, fontWeight: "700", color: palette.primaryStrong },
    quoteBody: { fontSize: 12, color: palette.textMuted, marginTop: 1 },
    quoteBodyDeleted: { fontStyle: "italic" },

    paymentBubble: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.primarySoft,
      borderRadius: radii.md,
      paddingHorizontal: 11,
      paddingVertical: 10,
      minWidth: 210,
    },
    paymentIcon: {
      width: 30,
      height: 30,
      borderRadius: 15,
      // The mark carries its own colour, so the disc behind it is the app's
      // quiet icon ground rather than the green the dollar sign needed.
      backgroundColor: palette.primaryMuted,
      alignItems: "center",
      justifyContent: "center",
    },
    paymentMark: { width: 20, height: 20 },
    // Larger than a record card's title: on a payment the amount IS the
    // content, so it carries the weight a title would.
    paymentAmount: { fontSize: 19, fontWeight: "800", color: palette.text },
    paymentNote: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
    paymentPending: { fontSize: 11, color: palette.textMuted, marginTop: 3 },

    reactionRow: { flexDirection: "row", gap: 4, marginTop: 3, marginLeft: 8 },
    reactionRowMine: { justifyContent: "flex-end", marginLeft: 0, marginRight: 8 },
    reactionChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
    },
    reactionChipMine: { borderColor: palette.primary, backgroundColor: palette.primaryMuted },
    reactionEmoji: { fontSize: 13 },
    reactionCount: { fontSize: 11, color: palette.textMuted, fontWeight: "600" },

    // Its own row: full width, centred, and outside the message row's flex
    // layout. See the note on `rows`.
    daySeparatorRow: { paddingVertical: spacing.sm },
    daySeparator: {
      textAlign: "center",
      fontSize: 11,
      fontWeight: "700",
      color: palette.textMuted,
      paddingVertical: spacing.sm,
      // No scaleY here, deliberately. An inverted FlatList applies the inverse
      // transform to each CELL, so anything inside renderItem is already the
      // right way up — adding one would flip the date upside down. Only
      // ListEmptyComponent misses that treatment, which is why `empty` below
      // carries the flip and this does not.
    },
    deletedBubble: {
      borderRadius: radii.lg,
      paddingHorizontal: 13,
      paddingVertical: 9,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      borderStyle: "dashed",
    },
    deletedText: { fontSize: 14, color: palette.textMuted, fontStyle: "italic" },
    deliveryState: {
      fontSize: 10,
      color: palette.textMuted,
      textAlign: "right",
      marginRight: 10,
      marginTop: 3,
    },
    editedMark: { fontSize: 10, color: palette.textMuted, marginTop: 3, marginLeft: 10 },
    editedMarkMine: { textAlign: "right", marginRight: 10, marginLeft: 0 },
    messageStamp: {
      fontSize: 10,
      color: palette.textMuted,
      alignSelf: "center",
      width: STAMP_COLUMN_WIDTH,
      textAlign: "right",
      fontVariant: ["tabular-nums"],
      // Parked off the right edge so it costs no width at rest; the row's
      // translateX is what brings it into view.
      position: "absolute",
      right: -STAMP_COLUMN_WIDTH,
    },
    selectedRow: {
      backgroundColor: palette.primaryMuted,
      borderRadius: radii.md,
      borderWidth: 2,
      borderColor: palette.primaryStrong,
      padding: 3,
      margin: -5,
    },
    unselectedRow: { opacity: 0.45 },
    selectCheck: {
      position: "absolute",
      top: -8,
      zIndex: 2,
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 2,
      borderColor: palette.primaryStrong,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    selectCheckMine: { left: -8 },
    selectCheckTheirs: { right: -8 },
    selectCheckOn: { backgroundColor: palette.primaryStrong },
    selectionBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.md,
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
    },
    selectionCount: { fontSize: 14, fontWeight: "600", color: palette.text },
    selectionDelete: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: palette.danger,
      borderRadius: radii.pill,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    selectionDeleteText: { color: palette.white, fontWeight: "700", fontSize: 14 },
    selectionDeleteDisabled: { opacity: 0.4 },
    editBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    editBannerText: { flex: 1, fontSize: 12, color: palette.primaryStrong, fontWeight: "600" },
    systemLine: { alignItems: "center", paddingVertical: spacing.sm },
    systemText: { fontSize: 12, color: palette.textMuted, textAlign: "center" },

    typingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      // Matches listContent's horizontal padding: outside the list now, it has
      // to line its bubble up with the message bubbles itself.
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    typingBubble: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.lg,
      borderBottomLeftRadius: 6,
      paddingHorizontal: 13,
      paddingVertical: 11,
    },
    typingWho: { fontSize: 12, color: palette.textMuted, flex: 1 },

    empty: { alignItems: "center", paddingVertical: spacing.xxl, gap: spacing.sm, transform: [{ scaleY: -1 }] },
    emptyText: { fontSize: 14, color: palette.textMuted },
    loadingOlder: { paddingVertical: spacing.md, alignItems: "center" },

    blockedBar: {
      padding: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: palette.border,
      alignItems: "center",
    },
    blockedText: { fontSize: 13, color: palette.textMuted, textAlign: "center" },

    sheetBackdrop: {
      flex: 1,
      backgroundColor: palette.overlay,
      justifyContent: "center",
      padding: spacing.lg,
    },
    actionCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.xl,
      paddingVertical: spacing.sm,
      overflow: "hidden",
    },
    quickReactions: {
      flexDirection: "row",
      justifyContent: "space-around",
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
      marginBottom: 4,
    },
    quickReaction: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
    },
    quickReactionEmoji: { fontSize: 22 },

    pickerCard: { backgroundColor: palette.surface, borderRadius: radii.xl, padding: spacing.md },
    pickerTitle: { fontSize: 15, fontWeight: "700", color: palette.text, marginBottom: spacing.sm },
    pickerGrid: { flexDirection: "row", flexWrap: "wrap" },
    pickerCell: { width: "16.6%", alignItems: "center", paddingVertical: 9 },
    pickerEmoji: { fontSize: 24 },

    viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)" },
  });
}
