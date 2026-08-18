import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import type { AppImproverNotification, AppImproverNotificationFeed } from "../types/app";

type Props = {
  notifications?: AppImproverNotificationFeed | null;
  hapticsEnabled?: boolean;
  onRefresh?: () => void;
  onMarkSeen?: () => Promise<void>;
};

/**
 * The notification bell, as a component both panels can mount.
 *
 * It began as markup inside the improver screen, which was fine while workflow
 * payouts were the only notification. Tax notices are not role-scoped — anyone
 * who earns past the reporting threshold gets one — so a volunteer who has never
 * touched a workflow now needs somewhere to see them.
 *
 * Unknown notification types render from title and body with a neutral icon.
 * That is deliberate: the feed is derived server-side and new kinds are added
 * without a client release, so a shipped app must never drop one it does not
 * recognise.
 */
export function NotificationBell({ notifications, hapticsEnabled, onRefresh, onMarkSeen }: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [visible, setVisible] = useState(false);

  const unseenCount = notifications?.unseenCount ?? 0;
  const items = notifications?.notifications ?? [];

  const open = useCallback(() => {
    triggerClickHaptic(hapticsEnabled === true);
    setVisible(true);
    onRefresh?.();
    // Opening the bell is what "seeing" means: the badge clears, but entries
    // stay listed until the condition behind them resolves.
    if (unseenCount > 0) {
      void onMarkSeen?.();
    }
  }, [hapticsEnabled, onMarkSeen, onRefresh, unseenCount]);

  return (
    <>
      <Pressable style={styles.bellButton} onPress={open} hitSlop={6}>
        <Ionicons
          name={unseenCount > 0 ? "notifications" : "notifications-outline"}
          size={18}
          color={palette.primaryStrong}
        />
        {unseenCount > 0 ? (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{unseenCount > 99 ? "99+" : unseenCount}</Text>
          </View>
        ) : null}
      </Pressable>

      <Modal
        visible={visible}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Notifications</Text>
              <Pressable onPress={() => setVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={20} color={palette.primaryStrong} />
              </Pressable>
            </View>

            {items.length === 0 ? (
              <Text style={styles.empty}>Nothing needs your attention.</Text>
            ) : (
              <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
                {items.map((item) => (
                  <NotificationRow key={item.key} notification={item} palette={palette} styles={styles} />
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function iconForNotification(notification: AppImproverNotification): keyof typeof Ionicons.glyphMap {
  if (notification.payoutError?.trim()) {
    return "alert-circle-outline";
  }
  if (notification.type.startsWith("w9_")) {
    return "document-text-outline";
  }
  if (notification.type.startsWith("workflow_payout")) {
    return "cash-outline";
  }
  // Anything unrecognised gets a neutral icon rather than borrowing a meaning
  // from a type it is not.
  return "information-circle-outline";
}

function NotificationRow({
  notification,
  palette,
  styles,
}: {
  notification: AppImproverNotification;
  palette: ReturnType<typeof useAppTheme>["palette"];
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={[styles.row, notification.seen ? undefined : styles.rowUnseen]}>
      <Ionicons name={iconForNotification(notification)} size={18} color={palette.primaryStrong} />
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{notification.title}</Text>
        <Text style={styles.rowBody}>{notification.body}</Text>
      </View>
    </View>
  );
}

function createStyles(palette: ReturnType<typeof useAppTheme>["palette"]) {
  return StyleSheet.create({
    bellButton: { padding: 8, borderRadius: 999 },
    bellBadge: {
      position: "absolute",
      top: 2,
      right: 2,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: palette.primaryStrong,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 3,
    },
    bellBadgeText: { color: palette.white, fontSize: 10, fontWeight: "700" },
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
    },
    sheet: {
      width: "100%",
      maxHeight: "70%",
      backgroundColor: palette.surface,
      borderRadius: 18,
      padding: 16,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    sheetTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    empty: { paddingVertical: 24, textAlign: "center", color: palette.textMuted },
    list: { gap: 8, paddingBottom: 8 },
    row: {
      flexDirection: "row",
      gap: 10,
      padding: 12,
      borderRadius: 12,
      backgroundColor: palette.background,
    },
    rowUnseen: { borderWidth: 1, borderColor: palette.primaryStrong },
    rowCopy: { flex: 1, gap: 2 },
    rowTitle: { fontSize: 14, fontWeight: "700", color: palette.text },
    rowBody: { fontSize: 13, color: palette.textMuted, lineHeight: 18 },
  });
}
