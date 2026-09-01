import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Notifications from "expo-notifications";
import {
  InboxNotification,
  NotificationTarget,
  dismissFromTray,
  itemFromNotification,
  loadStoredInbox,
  mergeInbox,
  persistInbox,
  readPresentedNotifications,
  targetsMatch,
} from "../services/notificationInbox";

type Options = {
  /** Invoked when a notification should take the user somewhere. */
  onNavigate: (target: NotificationTarget) => void;
};

/**
 * Keeps an in-app mirror of the user's push notifications.
 *
 * Notifications arrive by three routes — delivered while the app is open, tapped
 * from the tray, or sitting in the tray from while the app was closed — so all
 * three are captured. Anything the user acts on is cleared from the tray as well
 * as from here, so the two never disagree.
 */
export function useNotificationInbox({ onNavigate }: Options) {
  const [items, setItems] = useState<InboxNotification[]>([]);
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;

  const applyItems = useCallback((next: InboxNotification[]) => {
    setItems(next);
    void persistInbox(next);
  }, []);

  const ingest = useCallback(
    (incoming: InboxNotification[]) => {
      if (incoming.length === 0) {
        return;
      }
      setItems((current) => {
        const next = mergeInbox(current, incoming);
        void persistInbox(next);
        return next;
      });
    },
    [],
  );

  // Stored history first, then whatever is still sitting in the tray.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await loadStoredInbox();
      const presented = await readPresentedNotifications();
      if (!cancelled) {
        setItems(mergeInbox(stored, presented));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-read the tray on foreground: notifications delivered while the app was
  // backgrounded never reach a listener.
  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returned = previous !== "active" && nextState === "active";
      previous = nextState;
      if (returned) {
        void readPresentedNotifications().then(ingest);
      }
    });
    return () => subscription.remove();
  }, [ingest]);

  // Delivered while the app is open.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      ingest([itemFromNotification(notification)]);
    });
    return () => subscription.remove();
  }, [ingest]);

  const resolve = useCallback(
    (predicate: (item: InboxNotification) => boolean) => {
      setItems((current) => {
        const matched = current.filter(predicate);
        if (matched.length === 0) {
          return current;
        }
        matched.forEach((item) => {
          void dismissFromTray(item);
        });
        const next = current.filter((item) => !predicate(item));
        void persistInbox(next);
        return next;
      });
    },
    [],
  );

  /** Dismissing one entry without going anywhere. */
  const dismiss = useCallback(
    (item: InboxNotification) => {
      resolve((candidate) => candidate.id === item.id);
    },
    [resolve],
  );

  /** Tapping an entry: go where it points, then retire it. */
  const open = useCallback(
    (item: InboxNotification) => {
      navigateRef.current(item.target);
      resolve((candidate) => candidate.id === item.id);
    },
    [resolve],
  );

  /**
   * The user reached the destination on their own, so the notification has been
   * handled just as surely as if they had tapped it.
   */
  const resolveTarget = useCallback(
    (target: NotificationTarget) => {
      if (target.kind === "none") {
        return;
      }
      resolve((item) => targetsMatch(item.target, target));
    },
    [resolve],
  );

  const clearAll = useCallback(() => {
    items.forEach((item) => {
      void dismissFromTray(item);
    });
    applyItems([]);
  }, [applyItems, items]);

  return { items, open, dismiss, resolveTarget, clearAll };
}
