import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

const STORAGE_KEY = "sfluv-wallet:notification-inbox";
const MAX_ITEMS = 50;

/**
 * Where a notification points. Used both to route a tap and to recognise that
 * the user has already gone there under their own steam, at which point the
 * notification has served its purpose and should disappear.
 */
export type NotificationTarget =
  | { kind: "volunteer-event"; eventId: string }
  | { kind: "volunteer" }
  | { kind: "improver" }
  | { kind: "activity" }
  | { kind: "none" };

export type InboxNotification = {
  id: string;
  title: string;
  body: string;
  receivedAt: number;
  target: NotificationTarget;
  /** Tray identifier, when this arrived as a real push we can dismiss. */
  presentedId?: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Derives the destination from a push payload. Unknown types still produce an
 * inbox entry — they just have nowhere to send the user — so a new server-side
 * notification kind is never silently dropped.
 */
export function targetFromData(data: Record<string, unknown> | undefined): NotificationTarget {
  const type = asString(data?.type);
  const eventId = asString(data?.event_id);

  if (type.startsWith("volunteer_event_")) {
    return eventId ? { kind: "volunteer-event", eventId } : { kind: "volunteer" };
  }
  if (type.startsWith("workflow_") || type.startsWith("improver_")) {
    return { kind: "improver" };
  }
  if (type === "transaction" || type === "wallet_activity" || type === "reward") {
    return { kind: "activity" };
  }
  return { kind: "none" };
}

export function targetsMatch(left: NotificationTarget, right: NotificationTarget): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "volunteer-event" && right.kind === "volunteer-event") {
    return left.eventId === right.eventId;
  }
  return true;
}

function contentToItem(
  id: string,
  content: Notifications.NotificationContent,
  receivedAt: number,
  presentedId?: string,
): InboxNotification {
  const data = (content.data ?? {}) as Record<string, unknown>;
  return {
    id,
    title: asString(content.title) || "SFLuv",
    body: asString(content.body),
    receivedAt,
    target: targetFromData(data),
    presentedId,
  };
}

export function itemFromNotification(notification: Notifications.Notification): InboxNotification {
  const identifier = notification.request.identifier;
  const receivedAt = notification.date ? Number(notification.date) : Date.now();
  return contentToItem(identifier, notification.request.content, receivedAt, identifier);
}

export async function loadStoredInbox(): Promise<InboxNotification[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as InboxNotification[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function persistInbox(items: InboxNotification[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // A notification list is not worth surfacing a storage failure for.
  }
}

/**
 * Notifications delivered while the app was closed never reach a listener, so
 * the tray is read directly and merged in. Anything already known keeps its
 * stored copy.
 */
export async function readPresentedNotifications(): Promise<InboxNotification[]> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    return presented.map((notification) => itemFromNotification(notification));
  } catch {
    return [];
  }
}

export function mergeInbox(
  existing: InboxNotification[],
  incoming: InboxNotification[],
): InboxNotification[] {
  const byId = new Map<string, InboxNotification>();
  for (const item of [...incoming, ...existing]) {
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((left, right) => right.receivedAt - left.receivedAt)
    .slice(0, MAX_ITEMS);
}

/** Clears the matching entry from the OS tray so both surfaces agree. */
export async function dismissFromTray(item: InboxNotification): Promise<void> {
  if (!item.presentedId) {
    return;
  }
  try {
    await Notifications.dismissNotificationAsync(item.presentedId);
  } catch {
    // Already gone, or the platform declined — nothing to recover here.
  }
}
