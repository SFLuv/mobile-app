import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  RealtimeClient,
  TYPING_HEARTBEAT_MS,
  TYPING_TIMEOUT_MS,
  type RealtimeEvent,
  type RealtimeStatus,
} from "../services/realtime";

/**
 * Holds one socket for the whole app and hands its events to whoever is
 * listening.
 *
 * One client, not one per screen: a socket per screen would mean four
 * connections while the chat tab is open, and each would have to be
 * authenticated and reconnected separately. The shell owns it, screens
 * subscribe.
 */
export function useRealtime({
  baseURL,
  getToken,
  enabled,
}: {
  baseURL: string;
  getToken: () => Promise<string | null>;
  /**
   * False while nobody is signed in, or before the backend is known. The socket
   * is torn down rather than paused: there is nothing to receive and the token
   * would be the previous session's.
   */
  enabled: boolean;
}) {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  // The listener set has to outlive any one render, and the client has to be
  // built once for the life of the session rather than on every token change —
  // so the token getter is held in a ref the client reads through.
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  const client = useMemo(
    () => new RealtimeClient(baseURL, () => tokenRef.current()),
    [baseURL],
  );

  useEffect(() => {
    if (!enabled) {
      client.stop();
      setStatus("idle");
      return;
    }
    const unsubscribe = client.onStatus(setStatus);
    client.start();
    return () => {
      unsubscribe();
      client.stop();
    };
  }, [client, enabled]);

  const subscribe = useCallback((listener: (event: RealtimeEvent) => void) => client.subscribe(listener), [client]);
  const sendTyping = useCallback(
    (conversationId: number, typing: boolean) => client.sendTyping(conversationId, typing),
    [client],
  );

  return { status, subscribe, sendTyping, connected: status === "open" };
}

/**
 * Who is currently typing in one conversation.
 *
 * ── Why the bubbles expire on a timer ───────────────────────────────────────
 *
 * A "stopped typing" event may never arrive: the other person's app can be
 * backgrounded, lose signal, or be killed mid-word, and none of those send
 * anything. So a bubble is not removed when told to stop — it is removed when it
 * has not been refreshed recently. The sender re-sends "still typing" every few
 * seconds while they type, which is what keeps it alive.
 *
 * The consequence is that a bubble can linger for up to the timeout after
 * somebody really has stopped. That is the right direction for the error to
 * fall: a bubble that persists a moment too long reads as somebody thinking,
 * while one that vanishes between keystrokes reads as broken.
 */
export function useTypingIndicators(
  conversationId: number | null,
  subscribe: (listener: (event: RealtimeEvent) => void) => () => void,
) {
  const [typing, setTyping] = useState<Array<{ userId: string; userName: string }>>([]);
  const expiries = useRef(new Map<string, number>());

  useEffect(() => {
    setTyping([]);
    expiries.current.clear();
    if (!conversationId) {
      return;
    }

    const unsubscribe = subscribe((event) => {
      if (event.kind !== "typing" || event.conversation_id !== conversationId) {
        return;
      }
      const data = event.data as
        | { user_id?: string; user_name?: string; typing?: boolean }
        | undefined;
      const userId = data?.user_id;
      if (!userId) {
        return;
      }
      if (data?.typing) {
        expiries.current.set(userId, Date.now() + TYPING_TIMEOUT_MS);
        setTyping((current) =>
          current.some((entry) => entry.userId === userId)
            ? current
            : [...current, { userId, userName: data?.user_name || "Someone" }],
        );
      } else {
        expiries.current.delete(userId);
        setTyping((current) => current.filter((entry) => entry.userId !== userId));
      }
    });

    // Sweeps expired bubbles. Runs at half the timeout so one is never more
    // than a couple of seconds stale.
    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [userId, expiresAt] of expiries.current.entries()) {
        if (expiresAt <= now) {
          expiries.current.delete(userId);
          changed = true;
        }
      }
      if (changed) {
        setTyping((current) => current.filter((entry) => expiries.current.has(entry.userId)));
      }
    }, TYPING_TIMEOUT_MS / 2);

    return () => {
      unsubscribe();
      clearInterval(sweep);
    };
  }, [conversationId, subscribe]);

  return typing;
}

/**
 * Reports that the person is typing, without sending a frame per keystroke.
 *
 * Returns a function to call on every change to the composer. The first call
 * sends immediately — a bubble that appears a beat late is worse than useless —
 * and subsequent calls are throttled to the heartbeat, which is also what keeps
 * the other end's bubble from expiring. A pause longer than the heartbeat sends
 * a stop, so the bubble goes away promptly when somebody puts the phone down
 * mid-sentence rather than waiting out the full timeout.
 */
export function useTypingReporter(
  conversationId: number | null,
  sendTyping: (conversationId: number, typing: boolean) => void,
) {
  const lastSent = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStop = useCallback(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current);
      stopTimer.current = null;
    }
  }, []);

  const report = useCallback(
    (hasText: boolean) => {
      if (!conversationId) {
        return;
      }
      clearStop();
      if (!hasText) {
        lastSent.current = 0;
        sendTyping(conversationId, false);
        return;
      }
      const now = Date.now();
      if (now - lastSent.current > TYPING_HEARTBEAT_MS) {
        lastSent.current = now;
        sendTyping(conversationId, true);
      }
      stopTimer.current = setTimeout(() => {
        lastSent.current = 0;
        sendTyping(conversationId, false);
      }, TYPING_HEARTBEAT_MS + 500);
    },
    [clearStop, conversationId, sendTyping],
  );

  // Leaving a thread, or the screen, must retract the bubble: otherwise the
  // other person sees somebody typing in a conversation nobody has open.
  useEffect(
    () => () => {
      clearStop();
      if (conversationId) {
        sendTyping(conversationId, false);
      }
    },
    [clearStop, conversationId, sendTyping],
  );

  return report;
}
