import React, { useCallback, useMemo, useRef, useState } from "react";
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
 * the list has two parts with different rules:
 *
 *   Needs attention — things still asking for something. Ordinary
 *   notifications leave as soon as they have been looked at. Internal alerts
 *   leave when they are dealt with, which for some of them means pressing a
 *   button here and for others means the condition going away on its own.
 *
 *   Earlier — everything settled, newest first, loading more as you reach the
 *   bottom.
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
  onClose: () => void;
};

type Row =
  | { kind: "header"; key: string; title: string; subtitle: string }
  | { kind: "item"; key: string; item: AppNotificationItem }
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
      // A link button is handled by the device. Nothing is posted back and the
      // alert stays where it is — replying to somebody is not the same as
      // being finished with their request.
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
    [onAction],
  );

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const active = feed?.active ?? [];
    const history = feed?.history ?? [];

    out.push({
      kind: "header",
      key: "header:active",
      title: "Needs attention",
      subtitle:
        active.length === 0
          ? "Nothing right now."
          : active.length === 1
            ? "One thing"
            : `${active.length} things`,
    });
    if (active.length === 0) {
      out.push({ kind: "empty", key: "empty:active", message: "You are all caught up." });
    }
    for (const item of active) {
      out.push({ kind: "item", key: `active:${item.id}`, item });
    }

    out.push({
      kind: "header",
      key: "header:history",
      title: "Earlier",
      subtitle: history.length === 0 ? "Nothing yet." : "Everything already dealt with",
    });
    if (history.length === 0) {
      out.push({
        kind: "empty",
        key: "empty:history",
        message: "Notifications move here once they have been read or handled.",
      });
    }
    for (const item of history) {
      out.push({ kind: "item", key: `history:${item.id}`, item });
    }

    if (feed?.nextCursor) {
      out.push({ kind: "footer", key: "footer:more" });
    }
    return out;
  }, [feed]);

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
      if (row.kind === "header") {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{row.title}</Text>
            <Text style={styles.sectionSubtitle}>{row.subtitle}</Text>
          </View>
        );
      }
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
      const settled = resolved || (internal === null && item.seen);
      const support = supportRequestDetails(item);
      const routable = internal === null && !item.seen;
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
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Pressable style={styles.backButton} onPress={onClose} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={palette.primaryStrong} />
        </Pressable>
        <View style={styles.topBarCopy}>
          <Text style={styles.topBarTitle}>Notifications</Text>
          {feed && feed.sets.length > 0 ? (
            <Text style={styles.topBarSubtitle}>
              You receive {feed.sets.length === 1 ? "one alert set" : `${feed.sets.length} alert sets`}
            </Text>
          ) : null}
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
    </View>
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
    topBarCopy: {
      flex: 1,
    },
    topBarTitle: {
      fontSize: 22,
      fontWeight: "700",
      color: palette.text,
    },
    topBarSubtitle: {
      fontSize: 12,
      color: palette.textMuted,
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
    sectionHeader: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: palette.textMuted,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: palette.textMuted,
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
