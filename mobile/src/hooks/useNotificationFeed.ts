import { useCallback, useEffect, useRef, useState } from "react";

import type { AppBackendClient } from "../services/appBackend";
import type { AppNotificationFeed, AppNotificationItem } from "../types/notifications";

/**
 * Server-side notification state for the notification screen.
 *
 * The thing this hook is careful about is never emptying a list it has already
 * filled. A failed poll leaves the last feed on screen and raises `error`
 * beside it, because a notification we fetched a minute ago is still the best
 * information we have — blanking the screen to show a spinner would lose
 * content to a transient network failure.
 *
 * History accumulates as pages arrive and is replaced wholesale on a refresh,
 * so the cursor never has to be reconciled against rows that are already held.
 */

const POLL_INTERVAL_MS = 60_000;

type Options = {
  client: AppBackendClient | null;
  /** Null while nobody is signed in; the feed is per-user and clears with it. */
  userId: string | null;
  /** Whether the app is foregrounded, so polling stops when nobody can see it. */
  isActive: () => boolean;
};

export function useNotificationFeed({ client, userId, isActive }: Options) {
  const [feed, setFeed] = useState<AppNotificationFeed | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards a refresh and a page load racing each other: a page that arrives
  // after a refresh has replaced the list would append history belonging to a
  // cursor that no longer means anything.
  const requestIdRef = useRef(0);
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const refresh = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!client || !userId) {
        setFeed(null);
        return;
      }
      if (!options?.silent) {
        setLoading(true);
      }
      const requestId = ++requestIdRef.current;
      try {
        const next = await client.getNotifications();
        if (requestId !== requestIdRef.current) {
          return;
        }
        setFeed(next);
        setError(null);
      } catch (err) {
        if (requestId !== requestIdRef.current) {
          return;
        }
        // The previous feed is deliberately left alone.
        setError((err as Error)?.message || "Could not refresh notifications.");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [client, userId],
  );

  const loadMore = useCallback(async () => {
    if (!client || !userId || !feed?.nextCursor) {
      return;
    }
    const cursor = feed.nextCursor;
    setLoadingMore(true);
    const requestId = requestIdRef.current;
    try {
      const page = await client.getNotifications({ cursor });
      // A refresh landed while this page was in flight. Its rows belong to a
      // list that has since been replaced, so they are dropped rather than
      // appended to the new one.
      if (requestId !== requestIdRef.current) {
        return;
      }
      setFeed((current) => {
        if (!current) {
          return page;
        }
        // Dedup by id. The cursor makes repeats unlikely rather than
        // impossible — a row written at the same microsecond as the cursor
        // row can land on both sides of a page boundary.
        const held = new Set(current.history.map((entry) => entry.id));
        const added = page.history.filter((entry) => !held.has(entry.id));
        return {
          ...current,
          // Active comes back on every page and is the fresher copy.
          active: page.active,
          unseenCount: page.unseenCount,
          history: [...current.history, ...added],
          nextCursor: page.nextCursor,
        };
      });
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || "Could not load more notifications.");
    } finally {
      setLoadingMore(false);
    }
  }, [client, feed?.nextCursor, userId]);

  /**
   * Marks ordinary notifications seen, which is what viewing the screen does.
   *
   * Internal alerts are untouched — the server will not mark them, whatever is
   * asked — so this cannot retire something that still needs doing.
   */
  const markSeen = useCallback(async () => {
    if (!client || !userId) {
      return;
    }
    const unseen = (feed?.active ?? []).filter((item) => item.internal === null && !item.seen);
    if (unseen.length === 0) {
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const next = await client.markNotificationsSeen();
      if (requestId === requestIdRef.current) {
        setFeed(next);
      }
    } catch {
      // Not worth telling anybody about. The rows stay active and the next
      // view tries again, which is the harmless direction to fail in.
    }
  }, [client, feed?.active, userId]);

  const runAction = useCallback(
    async (notificationId: number, action: string): Promise<string | null> => {
      if (!client || !userId) {
        return null;
      }
      try {
        const result = await client.pressNotificationAction(notificationId, action);
        if (result.feed) {
          // The response carries the caller's refreshed feed, so a press never
          // leaves an alert on screen that is already gone. Bumping the request
          // id claims this as the newest state.
          requestIdRef.current += 1;
          setFeed(result.feed);
        }
        // A refusal is shown; a success is visible in the list changing, so
        // only an outcome worth reading is returned.
        if (result.refused) {
          return result.message || "That could not be done right now.";
        }
        return null;
      } catch (err) {
        return (err as Error)?.message || "That did not work.";
      }
    },
    [client, userId],
  );

  // Initial load, and a reload whenever the signed-in user changes.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Foreground-only polling, matching the other pollers in the app: a
  // background timer spends battery and data on a badge nobody can see.
  useEffect(() => {
    if (!client || !userId) {
      return;
    }
    const interval = setInterval(() => {
      if (isActiveRef.current()) {
        void refresh({ silent: true });
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [client, refresh, userId]);

  const unseenCount = feed?.unseenCount ?? 0;

  return {
    feed,
    loading,
    loadingMore,
    error,
    unseenCount,
    refresh,
    loadMore,
    markSeen,
    runAction,
  };
}

/** Routes an ordinary notification by its push payload, as a tap on the real push would. */
export function notificationRouteData(item: AppNotificationItem): Record<string, unknown> {
  return item.data;
}
