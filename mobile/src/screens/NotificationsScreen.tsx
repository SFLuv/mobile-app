import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert as RNAlert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { SupportRequestModal } from "../components/SupportRequestModal";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { SwipeBack } from "../components/SwipeBack";
import type { AppAlertAction, AppNotificationFeed, AppNotificationItem } from "../types/notifications";
import { supportRequestDetails } from "../utils/supportRequests";

/**
 * The notification screen.
 *
 * It used to be a modal over whatever you were doing, holding the last fifty
 * pushes from AsyncStorage on this one device. Three things were wrong with
 * that: history did not survive a reinstall and did not exist on a second
 * phone, a modal cannot be scrolled through comfortably or linked to, and
 * everything in it had the same single affordance — a dismiss cross — whether
 * it was a receipt for a payment or a merchant waiting on approval.
 *
 * So it is a screen, the history comes from the server a page at a time, and
 * it has two tabs rather than two stacked sections:
 *
 *   New — things still asking for something. Ordinary notifications leave as
 *   soon as they have been looked at. Internal alerts leave when they are
 *   dealt with, which for some of them means pressing a button here and for
 *   others means the condition going away on its own.
 *
 *   History — everything settled, newest first, loading more as you reach the
 *   bottom.
 *
 * Tabs rather than sections because the two answer different questions, and
 * stacking them meant scrolling past an empty "nothing right now" to reach the
 * list somebody actually opened the screen for. It opens on History when there
 * is nothing new, for that reason.
 *
 * The one rule worth stating because it is easy to get backwards: being on
 * this screen marks ordinary notifications seen, and does not touch alerts.
 * Reading that a balance is low is not the same as fixing it.
 */

type Props = {
  feed: AppNotificationFeed | null;
  loading: boolean;
  loadingMore: boolean;
  /** Set when the last load failed, so the screen can say so and keep its content. */
  error: string | null;
  onRefresh: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  /** Runs one of an alert's buttons. Resolves to the sentence to show, if any. */
  onAction: (notificationId: number, action: string) => Promise<string | null>;
  /** Taps on an ordinary notification route by its payload, as a push would. */
  onOpen: (item: AppNotificationItem) => void;
  /**
   * Opens a chat with whoever submitted a support request, behind the "Message"
   * button on a support alert.
   *
   * Absent when messaging is off for this account, in which case the button's
   * instruction falls through to the "update the app" branch — which is wrong
   * wording for that case, but the server only puts the button on an alert when
   * the SENDER has chat, so a staff member without it is the rarer mismatch and
   * the message still points somewhere sensible.
   */
  onOpenSupportChat?: (requestId: number) => Promise<void>;
  onClose: () => void;
};

type Row =
  // `fresh`: listed under New, so still a way to get where it points even
  // after opening the screen has marked it seen.
  | { kind: "item"; key: string; item: AppNotificationItem; fresh: boolean }
  | { kind: "empty"; key: string; message: string }
  | { kind: "footer"; key: string };

function relativeTime(at: number): string {
  if (!at) {
    return "";
  }
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString();
}

export function NotificationsScreen({
  feed,
  loading,
  loadingMore,
  error,
  onRefresh,
  onLoadMore,
  onAction,
  onOpen,
  onClose,
  onOpenSupportChat,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string>("");
  // The support request open in the detail sheet, by notification id. Looked
  // up in the feed on every render, so archiving it from the sheet shows the
  // settled version rather than a stale copy with buttons that no longer work.
  const [openSupportId, setOpenSupportId] = useState<number | null>(null);
  // Guards against onEndReached firing repeatedly while a page is in flight,
  // which FlatList will happily do on a fast scroll.
  const loadingMoreRef = useRef(false);

  /**
   * Which tab is showing.
   *
   * Opens on History when there is nothing new, because the alternative is an
   * empty screen with the thing somebody came to read one tap away. Chosen once
   * per visit rather than on every feed change: a notification arriving while
   * the screen is open should light the other tab, not move somebody off the
   * one they are reading.
   */
  const [activeTab, setActiveTab] = useState<"new" | "history">(() =>
    (feed?.active.length ?? 0) > 0 ? "new" : "history",
  );
  const chosenRef = useRef(feed != null);
  useEffect(() => {
    // The first feed can arrive after mount, in which case the initial guess
    // above was made with nothing to go on.
    if (chosenRef.current || !feed) return;
    chosenRef.current = true;
    setActiveTab(feed.active.length > 0 ? "new" : "history");
  }, [feed]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !feed?.nextCursor) {
      return;
    }
    loadingMoreRef.current = true;
    try {
      await onLoadMore();
    } finally {
      loadingMoreRef.current = false;
    }
  }, [feed?.nextCursor, onLoadMore]);

  const runAction = useCallback(
    async (item: AppNotificationItem, action: AppAlertAction) => {
      // An "sfluv:" URL is an instruction to the app rather than something for
      // the device to open. The server has no way to call back into a screen —
      // a notification action returns a sentence for the history row, not a
      // destination — so a button that has to END somewhere carries one of
      // these instead. See supportReplyChatLink in notification_actions.go.
      if (action.url?.startsWith("sfluv:")) {
        const instruction = action.url.slice("sfluv:".length);
        const supportReply = instruction.match(/^support-reply\/(\d+)$/);
        if (supportReply && onOpenSupportChat) {
          await onOpenSupportChat(Number(supportReply[1]));
          return;
        }
        // An instruction this build does not know: a newer server added one.
        // Saying so beats a button that silently does nothing.
        RNAlert.alert("Update SFLuv", "This needs a newer version of the app.");
        return;
      }

      // Any other link button is handled by the device. Nothing is posted back
      // and the alert stays where it is — replying to somebody is not the same
      // as being finished with their request.
      if (action.url) {
        try {
          await Linking.openURL(action.url);
        } catch {
          RNAlert.alert("Nothing to open that with", "This device has no app set up for that link.");
        }
        return;
      }

      const run = async () => {
        const key = `${item.id}:${action.id}`;
        setBusyAction(key);
        try {
          const message = await onAction(item.internal!.id, action.id);
          if (message) {
            RNAlert.alert(action.label, message);
          }
        } finally {
          setBusyAction("");
        }
      };

      if (action.confirm) {
        RNAlert.alert(action.label, action.confirm, [
          { text: "Cancel", style: "cancel" },
          { text: action.label, style: action.style === "danger" ? "destructive" : "default", onPress: () => void run() },
        ]);
        return;
      }
      await run();
    },
    [onAction, onOpenSupportChat],
  );

  /**
   * What New and History show while this visit lasts.
   *
   * Opening the screen marks ordinary notifications seen, and the server then
   * files them under history, so New used to empty the moment it was looked
   * at. Everything that was new during this visit stays under New until the
   * screen closes (it unmounts, so the set starts fresh next time). Internal
   * alerts are not held: they leave New by being dealt with, and an alert that
   * has just been handled should go.
   */
  const heldNewIdsRef = useRef(new Set<number>());
  const { active, history } = useMemo(() => {
    const held = heldNewIdsRef.current;
    const liveActive = feed?.active ?? [];
    for (const item of liveActive) {
      if (item.internal === null) {
        held.add(item.id);
      }
    }
    const liveIds = new Set(liveActive.map((item) => item.id));
    const allHistory = feed?.history ?? [];
    const kept = allHistory.filter((item) => held.has(item.id) && !liveIds.has(item.id));
    return {
      active: [...liveActive, ...kept],
      history: allHistory.filter((item) => !held.has(item.id)),
    };
  }, [feed]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];

    // No section headers any more: the tab is the heading, and repeating it
    // inside the list was the duplicate title this screen already had too much
    // of.
    if (activeTab === "new") {
      if (active.length === 0) {
        out.push({ kind: "empty", key: "empty:active", message: "You are all caught up." });
      }
      for (const item of active) {
        out.push({ kind: "item", key: `active:${item.id}`, item, fresh: true });
      }
      return out;
    }

    if (history.length === 0) {
      out.push({
        kind: "empty",
        key: "empty:history",
        message: "Notifications move here once they have been read or handled.",
      });
    }
    for (const item of history) {
      out.push({ kind: "item", key: `history:${item.id}`, item, fresh: false });
    }
    if (feed?.nextCursor) {
      out.push({ kind: "footer", key: "footer:more" });
    }
    return out;
  }, [active, history, feed?.nextCursor, activeTab]);

  const openSupportItem = useMemo(() => {
    if (openSupportId === null || !feed) {
      return null;
    }
    return [...feed.active, ...feed.history].find((item) => item.id === openSupportId) ?? null;
  }, [feed, openSupportId]);
  const openSupport = useMemo(
    () => (openSupportItem ? supportRequestDetails(openSupportItem) : null),
    [openSupportItem],
  );

  const renderRow = useCallback(
    ({ item: row }: { item: Row }) => {
      if (row.kind === "empty") {
        return <Text style={styles.emptyText}>{row.message}</Text>;
      }
      if (row.kind === "footer") {
        return (
          <View style={styles.footer}>
            {loadingMore ? <ActivityIndicator color={palette.textMuted} /> : null}
          </View>
        );
      }

      const { item } = row;
      const internal = item.internal;
      const resolved = internal?.resolved ?? false;
      const settled = resolved || (internal === null && item.seen && !row.fresh);
      const support = supportRequestDetails(item);
      // Held under New for this visit, a notification stays tappable after
      // the screen has marked it seen; otherwise it reappeared as a dead copy
      // of itself after coming back from where it led.
      const routable = internal === null && (!item.seen || row.fresh);
      // A support request opens its own sheet: the card is a summary, and the
      // reply needs the full message, the address and the ticket number.
      const opensDetail = Boolean(support);

      return (
        <View
          style={[
            styles.card,
            internal?.urgent && !resolved ? styles.cardUrgent : null,
            settled ? styles.cardSettled : null,
          ]}
        >
          <Pressable
            // An ordinary notification is a destination; an alert is read in
            // place. Tapping an alert used to navigate somewhere unrelated,
            // which is how a merchant approval ended up opening the wallet.
            disabled={!routable && !opensDetail}
            onPress={() => (opensDetail ? setOpenSupportId(item.id) : onOpen(item))}
            accessibilityRole={routable || opensDetail ? "button" : undefined}
            accessibilityLabel={item.body ? `${item.title}. ${item.body}` : item.title}
          >
            <View style={styles.cardHead}>
              <View style={styles.cardHeadCopy}>
                {internal ? (
                  <View style={styles.setRow}>
                    <Ionicons
                      name={internal.urgent && !resolved ? "alert-circle" : "notifications-outline"}
                      size={12}
                      color={internal.urgent && !resolved ? palette.danger : palette.textMuted}
                    />
                    <Text style={styles.setLabel}>{internal.setLabel || internal.set}</Text>
                  </View>
                ) : null}
                <Text style={styles.cardTitle}>{support ? support.subject : item.title}</Text>
                {support ? (
                  <Text style={styles.supportMeta} numberOfLines={1}>
                    {[support.name || support.email, support.reference].filter(Boolean).join(" · ")}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.cardTime}>{relativeTime(item.createdAt)}</Text>
            </View>

            {item.body ? (
              <Text style={styles.cardBody} numberOfLines={support ? 3 : undefined}>
                {item.body}
              </Text>
            ) : null}

            {!support && internal && internal.fields.length > 0 ? (
              <View style={styles.fields}>
                {internal.fields.map((field) => (
                  <View key={`${field.label}:${field.value}`} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{field.label}</Text>
                    <Text style={styles.fieldValue} selectable>
                      {field.value}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* The record of how it ended. This is the reason resolved alerts
                are kept rather than deleted: "who approved this" is the
                question the history gets asked. */}
            {resolved && internal?.outcome ? (
              <View style={styles.outcome}>
                <Ionicons name="checkmark-circle-outline" size={13} color={palette.textMuted} />
                <Text style={styles.outcomeText}>{internal.outcome}</Text>
              </View>
            ) : null}

            {routable || opensDetail ? (
              <View style={styles.openHint}>
                <Text style={styles.openHintText}>{opensDetail ? "Tap for details" : "Tap to open"}</Text>
                <Ionicons name="chevron-forward" size={13} color={palette.textMuted} />
              </View>
            ) : null}
          </Pressable>

          {internal && internal.actions.length > 0 ? (
            <View style={styles.actions}>
              {internal.actions.map((action) => {
                const busy = busyAction === `${item.id}:${action.id}`;
                return (
                  <Pressable
                    key={action.id}
                    style={[
                      styles.actionButton,
                      action.style === "primary" ? styles.actionPrimary : null,
                      action.style === "danger" ? styles.actionDanger : null,
                      busy ? styles.actionBusy : null,
                    ]}
                    disabled={Boolean(busyAction)}
                    onPress={() => void runAction(item, action)}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                  >
                    {busy ? (
                      <ActivityIndicator
                        size="small"
                        color={action.style === "default" ? palette.text : "#ffffff"}
                      />
                    ) : (
                      <Text
                        style={[
                          styles.actionLabel,
                          action.style === "primary" || action.style === "danger"
                            ? styles.actionLabelOnFill
                            : null,
                        ]}
                      >
                        {action.label}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      );
    },
    [busyAction, loadingMore, onOpen, palette, runAction, styles],
  );

  return (
    <SwipeBack onBack={onClose} style={styles.screen}>
      {/* No title here. The app header above already says "Notifications",
          and printing it twice was the screen telling you where you are in a
          place you can already see. The tabs take that space instead, inline
          with the back button. */}
      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={palette.primaryStrong} />
        </Pressable>
        <View style={styles.tabRow}>
          {(["new", "history"] as const).map((key) => {
            const selected = activeTab === key;
            const count = key === "new" ? active.length : 0;
            return (
              <Pressable
                key={key}
                style={[styles.tabButton, selected && styles.tabButtonActive]}
                onPress={() => setActiveTab(key)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={key === "new" ? "New notifications" : "Notification history"}
              >
                <Text
                  style={[styles.tabLabel, selected && styles.tabLabelActive]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={1.2}
                >
                  {key === "new" ? "New" : "History"}
                </Text>
                {count > 0 ? (
                  <View style={styles.tabCount}>
                    <Text style={styles.tabCountText}>{count > 9 ? "9+" : count}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* An error is shown above the content rather than instead of it. A
          failed refresh should not empty a screen that was already full — the
          notifications on it are still the last thing we knew. */}
      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color={palette.danger} />
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={() => void refresh()} accessibilityRole="button">
            <Text style={styles.errorRetry}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && !feed ? (
        <View style={styles.loading}>
          <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.textMuted} />
          }
          onEndReached={() => void loadMore()}
          // Half a screen of runway. Closer and the spinner is the first thing
          // you see at the bottom; further and it fetches pages nobody scrolls
          // to.
          onEndReachedThreshold={0.5}
        />
      )}

      <SupportRequestModal
        visible={Boolean(openSupportItem && openSupport)}
        request={openSupport}
        actions={openSupportItem?.internal?.resolved ? [] : openSupportItem?.internal?.actions ?? []}
        busyActionId={
          openSupportItem && busyAction.startsWith(`${openSupportItem.id}:`)
            ? busyAction.slice(`${openSupportItem.id}:`.length)
            : ""
        }
        onAction={(action) => {
          if (openSupportItem) {
            void runAction(openSupportItem, action);
          }
        }}
        onClose={() => setOpenSupportId(null)}
      />
    </SwipeBack>
  );
}

const createStyles = (palette: Palette, shadows: ReturnType<typeof getShadows>) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: palette.background,
    },
    topBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      // The back button used to sit flush against the app header above it,
      // which on a device with a tall status area reads as crowding the top of
      // the screen rather than as a row of its own.
      paddingTop: spacing.sm,
      paddingBottom: spacing.md,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.surfaceMuted,
    },
    tabRow: {
      flex: 1,
      flexDirection: "row",
      gap: spacing.xs,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.md,
      padding: 3,
    },
    tabButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 8,
      borderRadius: radii.sm,
    },
    tabButtonActive: {
      backgroundColor: palette.surface,
      ...shadows.soft,
    },
    tabLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.textMuted,
      includeFontPadding: false,
    },
    tabLabelActive: {
      color: palette.text,
    },
    tabCount: {
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryStrong,
    },
    tabCountText: {
      fontSize: 10,
      fontWeight: "800",
      color: palette.white,
      includeFontPadding: false,
    },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceMuted,
    },
    errorText: {
      flex: 1,
      fontSize: 12,
      color: palette.textMuted,
    },
    errorRetry: {
      fontSize: 12,
      fontWeight: "700",
      color: palette.primaryStrong,
    },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    listContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl * 2,
    },
    emptyText: {
      fontSize: 13,
      color: palette.textMuted,
      paddingVertical: spacing.md,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      padding: spacing.md,
      marginBottom: spacing.sm,
      ...shadows.card,
    },
    cardUrgent: {
      borderLeftWidth: 3,
      borderLeftColor: palette.danger,
    },
    // Settled rows are quieter but still legible. Greying them out entirely
    // would make the history unreadable, which is most of this screen.
    cardSettled: {
      opacity: 0.72,
      ...({ shadowOpacity: 0 } as object),
    },
    cardHead: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    cardHeadCopy: {
      flex: 1,
    },
    setRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginBottom: 2,
    },
    setLabel: {
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: palette.textMuted,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: palette.text,
    },
    supportMeta: {
      fontSize: 12,
      color: palette.textMuted,
      marginTop: 2,
    },
    cardTime: {
      fontSize: 11,
      color: palette.textMuted,
    },
    cardBody: {
      fontSize: 13,
      lineHeight: 19,
      color: palette.textMuted,
      marginTop: 4,
    },
    fields: {
      marginTop: spacing.sm,
      gap: 4,
    },
    fieldRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    fieldLabel: {
      width: 96,
      fontSize: 12,
      color: palette.textMuted,
    },
    fieldValue: {
      flex: 1,
      fontSize: 12,
      color: palette.text,
    },
    outcome: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      marginTop: spacing.sm,
    },
    outcomeText: {
      fontSize: 12,
      fontStyle: "italic",
      color: palette.textMuted,
    },
    openHint: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      marginTop: spacing.sm,
    },
    openHintText: {
      fontSize: 12,
      color: palette.textMuted,
    },
    actions: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    actionButton: {
      minWidth: 96,
      paddingVertical: 9,
      paddingHorizontal: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    actionPrimary: {
      backgroundColor: palette.primaryStrong,
      borderColor: palette.primaryStrong,
    },
    actionDanger: {
      backgroundColor: palette.danger,
      borderColor: palette.danger,
    },
    actionBusy: {
      opacity: 0.8,
    },
    actionLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
    },
    actionLabelOnFill: {
      color: "#ffffff",
    },
    footer: {
      paddingVertical: spacing.lg,
      alignItems: "center",
    },
  });
