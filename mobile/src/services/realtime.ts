import { AppState, type AppStateStatus } from "react-native";

/**
 * The live connection to the backend, held for as long as the app is in the
 * foreground.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * Four things, all of which used to be a poll or a push:
 *
 *   - Messages appear as they are sent, instead of up to four seconds later.
 *   - Typing bubbles, which have nowhere else to live: there is no endpoint for
 *     "is someone typing", because the answer is stale before a response could
 *     be written.
 *   - In-app banners. A push while the app is open arrives as a system banner
 *     over whatever you are doing, including over the chat the message is in.
 *     Events here let the app draw its own banner, or nothing at all when the
 *     thread is already on screen.
 *   - Access changes. Messaging turning on for an account used to need a
 *     relaunch; now the tab appears.
 *
 * ── Foreground only, deliberately ───────────────────────────────────────────
 *
 * The socket closes when the app backgrounds and reopens when it returns. A
 * backgrounded socket would be a battery and radio cost for events nobody can
 * see, and iOS suspends the process anyway — a socket held across suspension is
 * a socket the OS will kill at a time of its choosing, which is worse than one
 * we closed on purpose. Backgrounded devices are reached by push, which is what
 * push is for. The two paths cover disjoint states and neither is a fallback.
 *
 * ── Never the source of truth ───────────────────────────────────────────────
 *
 * Every event describes something already committed, and every screen that
 * consumes one can also reach the same state with an ordinary fetch. A dropped
 * socket costs live updates until it reconnects; it never costs a message. That
 * is what lets this reconnect with a plain backoff and no replay protocol, and
 * why a screen refetches on reconnect rather than asking for what it missed.
 */

/** Event kinds, matching the constants in the backend's realtime package. */
export type RealtimeEventKind =
  | "ready"
  | "pong"
  | "message.new"
  | "message.reaction"
  | "message.updated"
  | "message.deleted"
  | "typing"
  | "conversation.updated"
  | "conversation.read"
  | "notification"
  | "beta.changed";

export type RealtimeEvent = {
  kind: RealtimeEventKind | string;
  conversation_id?: number;
  data?: unknown;
  sent_at?: string;
};

export type RealtimeStatus = "idle" | "connecting" | "open" | "offline";

type Listener = (event: RealtimeEvent) => void;
type StatusListener = (status: RealtimeStatus) => void;

/**
 * Reconnect backoff.
 *
 * Starts fast because the common cause of a drop is a network blip that has
 * already resolved, and tops out at half a minute so a backend that is properly
 * down is not hammered by every phone that has the app open. Jittered, so a
 * restart does not bring every client back in the same instant.
 */
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

/** How long a typing bubble lives without being refreshed. */
export const TYPING_TIMEOUT_MS = 6_000;

/** How often the client re-sends "still typing" while someone keeps typing. */
export const TYPING_HEARTBEAT_MS = 3_000;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: RealtimeStatus = "idle";
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private wanted = false;
  /** Set while a socket is open but has not yet been told who it belongs to. */
  private authenticated = false;
  private closingDeliberately = false;

  constructor(
    private readonly baseURL: string,
    private readonly getToken: () => Promise<string | null>,
  ) {}

  /** Starts connecting, and keeps the socket up while the app is foregrounded. */
  start(): void {
    if (this.wanted) {
      return;
    }
    this.wanted = true;

    this.appStateSubscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active") {
        // Reset the backoff: returning to the app is a fresh intent to connect,
        // not the continuation of a failing retry loop, and making somebody wait
        // thirty seconds for their messages because the socket failed while the
        // phone was in a pocket would be absurd.
        this.attempt = 0;
        this.connect();
      } else {
        this.disconnect("backgrounded");
      }
    });

    if (AppState.currentState === "active") {
      this.connect();
    }
  }

  /** Tears everything down. Called on sign-out and unmount. */
  stop(): void {
    this.wanted = false;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.clearReconnect();
    this.disconnect("stopped");
    this.setStatus("idle");
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): RealtimeStatus {
    return this.status;
  }

  /**
   * Reports that the person is, or has stopped, typing in a conversation.
   *
   * Dropped silently when there is no socket. A typing bubble is the most
   * disposable thing in the app: the alternative — queueing it to send on
   * reconnect — would show a bubble for something somebody typed a minute ago.
   */
  sendTyping(conversationId: number, typing: boolean): void {
    this.send({ kind: "typing", conversation_id: conversationId, typing });
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.authenticated) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(payload));
    } catch {
      // A send on a socket that is closing throws. The reconnect handles it.
    }
  }

  private setStatus(status: RealtimeStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private socketURL(): string {
    // http -> ws, https -> wss. Written as a replacement on the scheme rather
    // than string concatenation so a base URL with a path or a port survives.
    return this.baseURL.replace(/^http/i, "ws").replace(/\/+$/, "") + "/ws";
  }

  private async connect(): Promise<void> {
    if (!this.wanted || this.socket) {
      return;
    }
    this.clearReconnect();
    this.setStatus("connecting");

    // The token is fetched before the socket opens, so a failure to get one
    // never leaves a connected-but-mute socket. See the backend's Serve for why
    // the credential travels in the first frame rather than a header or the URL.
    let token: string | null = null;
    try {
      token = await this.getToken();
    } catch {
      token = null;
    }
    if (!token) {
      this.scheduleReconnect();
      return;
    }
    if (!this.wanted) {
      return;
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.socketURL());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket = socket;
    this.authenticated = false;
    this.closingDeliberately = false;

    socket.onopen = () => {
      try {
        socket.send(JSON.stringify({ kind: "auth", token }));
      } catch {
        this.disconnect("auth failed");
        this.scheduleReconnect();
      }
    };

    socket.onmessage = (message) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(String(message.data)) as RealtimeEvent;
      } catch {
        return;
      }

      if (event.kind === "ready") {
        // The server's acknowledgement that the token checked out. Only now is
        // the socket useful, and only now is the backoff genuinely reset — a
        // socket that opens and is then closed for bad auth would otherwise
        // look like a success and retry instantly, forever.
        this.authenticated = true;
        this.attempt = 0;
        this.setStatus("open");
      }

      for (const listener of this.listeners) {
        listener(event);
      }
    };

    socket.onerror = () => {
      // Followed by onclose, which is where the reconnect is scheduled. Doing it
      // here as well would schedule two.
    };

    socket.onclose = () => {
      this.socket = null;
      this.authenticated = false;
      if (this.closingDeliberately || !this.wanted) {
        return;
      }
      this.setStatus("offline");
      this.scheduleReconnect();
    };
  }

  private disconnect(_reason: string): void {
    this.clearReconnect();
    const socket = this.socket;
    this.socket = null;
    this.authenticated = false;
    if (!socket) {
      return;
    }
    this.closingDeliberately = true;
    try {
      socket.close();
    } catch {
      // Already gone.
    }
    this.setStatus("offline");
  }

  private scheduleReconnect(): void {
    if (!this.wanted || this.reconnectTimer) {
      return;
    }
    const base = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    // Up to 30% jitter, so a backend restart does not get every client back at
    // the same millisecond.
    const delay = base + Math.random() * base * 0.3;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
