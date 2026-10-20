/**
 * The notification screen's data.
 *
 * Mirrors backend/structs/app_internal_notification.go. Two things in here are
 * worth knowing before reading the screen that uses it.
 *
 * First, one shape covers two kinds of notification. An ordinary one (a
 * payment arrived, a reminder) is a past event and is done once it has been
 * looked at. An internal alert is a condition — a balance is low, somebody is
 * waiting on a decision — and is done when it has been dealt with. The second
 * kind carries `internal`; the first does not.
 *
 * Second, "active" and "history" are server-side distinctions, not a filter
 * applied here. The server decides what is still asking for something, because
 * it is the only thing that knows whether a condition still holds.
 */

export type AppNotificationField = {
  label: string;
  value: string;
};

export type AppAlertActionStyle = "default" | "primary" | "danger";

export type AppAlertAction = {
  id: string;
  label: string;
  style?: AppAlertActionStyle;
  /**
   * Present on a link button the device opens itself rather than posting back
   * — the reply-by-email mailto. Mutually exclusive with running an action.
   */
  url?: string;
  /** When set, confirm before running. */
  confirm?: string;
};

export type AppInternalNotification = {
  id: number;
  set: string;
  setLabel: string;
  alertKey: string;
  fields: AppNotificationField[];
  urgent: boolean;
  /**
   * Empty where nothing can be done from a phone. A low gas balance is fixed
   * by sending money to an account, and a button that only hid the alert would
   * make an unsolved problem look handled — so there is no button at all.
   */
  actions: AppAlertAction[];
  resolved: boolean;
  resolvedAt: number | null;
  /** The history line: "Approved by Dana", "Down for 4 minutes. Acknowledged". */
  outcome: string;
};

export type AppNotificationItem = {
  id: number;
  kind: string;
  title: string;
  body: string;
  createdAt: number;
  data: Record<string, string>;
  seen: boolean;
  /** Set on an internal organization alert, absent on an ordinary push. */
  internal: AppInternalNotification | null;
};

export type AppNotificationFeed = {
  active: AppNotificationItem[];
  history: AppNotificationItem[];
  /** Continues the history. Null at the end of it. */
  nextCursor: string | null;
  /** Everything outstanding, which is not the same as everything unread. */
  unseenCount: number;
  /** Which alert sets this user receives, for the screen's empty state. */
  sets: string[];
};

export type AppAlertActionResult = {
  ok: boolean;
  /**
   * An expected, ordinary "no" rather than a failure: acknowledging an outage
   * that is still happening, approving something somebody else just approved.
   * The message is written to be shown as-is.
   */
  refused: boolean;
  message: string;
  feed: AppNotificationFeed | null;
};
