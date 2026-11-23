import { t } from "../i18n";

// Types for the neighborhood Bulletin and Messages. Field names mirror the
// backend's JSON so responses can be used as they arrive.

export type BulletinCategory = "free" | "for_sale" | "notice";

export type BulletinStatus = "active" | "sold" | "claimed" | "removed" | "hidden";

export type BulletinBadge = "merchant" | "improver" | "verified_volunteer";

export interface PublicUser {
  user_id: string;
  public_name: string;
  handle?: string | null;
  badges: BulletinBadge[];
  good_trades: number;
  /**
   * Search results only: this person is in your contacts, and `public_name`
   * above is the name you saved rather than the one they chose. Lets the row
   * say "in your contacts" so a saved contact is distinguishable from a
   * stranger with a similar name.
   */
  saved_contact?: boolean;
}

export interface UserProfile {
  user_id: string;
  public_name: string;
  handle: string | null;
  discoverable: boolean;
  suspended_until?: string | null;
  suggested_public_name?: string;
  exists: boolean;
}

export interface BulletinPhoto {
  id: number;
  position: number;
}

export interface BulletinPost {
  id: number;
  author: PublicUser;
  category: BulletinCategory;
  title: string;
  body: string;
  price_sfluv: string | null;
  accepts_sfluv: boolean;
  accepts_cash: boolean;
  distance_miles?: number | null;
  area_label: string;
  meetup_location: { id: number; name: string } | null;
  linked_event: { id: string; title: string; start_at: number; end_at: number } | null;
  status: BulletinStatus;
  expires_at: string;
  created_at: string;
  photos: BulletinPhoto[];
  is_mine: boolean;
}

export interface BulletinFeedPage {
  posts: BulletinPost[];
  next_cursor: string | null;
}

export interface BulletinPostInput {
  category: BulletinCategory;
  title: string;
  body: string;
  price_sfluv?: string | null;
  accepts_sfluv: boolean;
  accepts_cash: boolean;
  lat: number;
  lng: number;
  meetup_location_id?: number | null;
  linked_event_id?: string | null;
}

export interface BulletinPostPatch {
  title?: string;
  body?: string;
  price_sfluv?: string;
  accepts_sfluv?: boolean;
  accepts_cash?: boolean;
  meetup_location_id?: number;
  clear_meetup?: boolean;
  status?: "active" | "sold" | "claimed";
  renew?: boolean;
}

export type MessageKind = "text" | "payment" | "system" | "attachment";

export type ConversationKind = "direct" | "group";

export type ConversationRole = "owner" | "admin" | "member";

export type AttachmentKind =
  | "image"
  | "file"
  | "link"
  | "transaction"
  | "merchant"
  | "event"
  | "support";

/**
 * One card under a message.
 *
 * A single shape for all seven kinds, matching the server's single table. Which
 * fields are meaningful follows from `kind`; the server never sets one a kind
 * does not use, so an absent field means "not applicable" rather than "unknown".
 */
export interface MessageAttachment {
  id: number;
  kind: AttachmentKind;
  position: number;

  // image, file
  content_type?: string;
  file_name?: string;
  size_bytes?: number;
  image_width?: number;
  image_height?: number;

  // link — scraped once when sent, then frozen
  link_url?: string;
  link_title?: string;
  link_description?: string;
  link_image_url?: string;
  link_site_name?: string;

  // transaction — resolved from the chain index on read, never the memo
  tx_hash?: string;
  tx_amount_sfluv_base?: string;
  tx_from?: string;
  tx_to?: string;
  tx_at?: number;

  // merchant
  location_id?: number;
  location_name?: string;
  location_address?: string;
  location_lat?: number;
  location_lng?: number;

  // event
  event_id?: string;
  event_title?: string;
  event_start_at?: number;
  event_end_at?: number;

  // support ticket — reference and subject only, never the body or the email
  support_request_id?: number;
  support_reference?: string;
  support_subject?: string;
  support_category?: string;

  /** What this points at is gone, or not indexed yet. Render a dead card. */
  unavailable?: boolean;
}

/** One emoji on a message, already grouped by the server. */
export interface MessageReaction {
  emoji: string;
  count: number;
  /** Whether you are one of them, which makes the chip a toggle. */
  mine: boolean;
  names?: string[];
}

/**
 * The slice of a replied-to message shown above a reply. Absent when the quoted
 * message has since been deleted — the reply survives without its quote.
 */
export interface MessageQuote {
  id: number;
  sender_id: string;
  sender_name?: string;
  kind: MessageKind;
  body: string;
  attachment_kind?: AttachmentKind;
  /** The quoted message was deleted; the reply keeps its block and says so. */
  deleted?: boolean;
}

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: string;
  is_mine: boolean;
  /** Group threads only: a bubble has to say who said it. */
  sender_name?: string;
  kind: MessageKind;
  body: string;
  tx_hash?: string | null;
  amount_sfluv_base?: string | null;
  payment_verified: boolean;
  created_at: string;

  /** When the sender last edited it. Absent means never. */
  edited_at?: string;
  /**
   * The sender removed it for everybody.
   *
   * The body and any attachment detail are already blanked by the server, so
   * there is nothing to hide client-side — the row is a tombstone and renders
   * as "Message was deleted". An ADMIN removal does not appear at all, which is
   * a deliberate difference: a gap that announces itself tells the whole thread
   * something was actioned.
   */
  deleted?: boolean;

  reply_to_id?: number;
  reply_to?: MessageQuote;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
  /**
   * People tagged with @, Telegram style. The body keeps the plain "@Name" the
   * sender saw, for older apps, the web and the push; these say who each one
   * is, so every reader's app can show the name they saved that person as.
   */
  mentions?: MessageMention[];
}

/**
 * One @-tag in a message: a span of the body, in UTF-16 code units (which is
 * how JavaScript indexes a string), and who it tags.
 */
export interface MessageMention {
  user_id: string;
  offset: number;
  length: number;
}

/** One person in a group, as the other members see them. */
export interface ConversationMember {
  user: PublicUser;
  role: ConversationRole;
  /** Left or was removed. Still listed while their messages are in the thread. */
  left?: boolean;
  /** No longer holds the chat beta, so they cannot read this right now. */
  inactive?: boolean;
}

/** A file shared in a thread, as the info screen lists them. */
export interface ConversationFile extends MessageAttachment {
  message_id: number;
  sender_id: string;
  sender_name?: string;
  created_at: number;
}

export interface ConversationPostChip {
  id: number;
  title: string;
  category: BulletinCategory;
  price_sfluv: string | null;
  accepts_sfluv: boolean;
  accepts_cash: boolean;
  status: BulletinStatus;
  author_id: string;
  photo_id: number | null;
}

export interface Conversation {
  id: number;
  kind: ConversationKind;
  /**
   * The other person, in a direct thread. An empty record in a group: the
   * server sends one rather than null because every build in the field reads
   * `other_user.public_name` unconditionally. Check `kind` first.
   */
  other_user: PublicUser;

  // ── Groups ────────────────────────────────────────────────────────────────
  title?: string;
  /** The group picture, as an attachment id to fetch. Absent means initials. */
  icon_attachment_id?: number;
  owner_id?: string;
  /** Your own role, so the client knows which controls to offer. */
  my_role?: ConversationRole;
  /** Only on the single-conversation endpoint. */
  members?: ConversationMember[];
  member_count?: number;

  /**
   * This member has silenced its pushes.
   *
   * Only the pushes: the thread still appears, still counts as unread, and
   * still shows a badge. Muting is about the phone, not about hiding.
   */
  muted?: boolean;
  /**
   * How far the other members have read, so your own messages can show
   * Delivered or Read. The minimum across them in a group — "read" meaning
   * everybody, not whoever got there first.
   */
  other_last_read_message_id?: number;

  post: ConversationPostChip | null;
  last_message: ChatMessage | null;
  /**
   * The newest reaction, set only when it is more recent than the last message.
   *
   * A reaction is not a message, so it never appears in the transcript as one —
   * the thread renders it attached to the bubble it belongs to. This exists for
   * the inbox, whose single preview line should describe the latest activity
   * even when that activity was somebody tapping an emoji.
   */
  latest_reaction?: {
    emoji: string;
    user_name?: string;
    is_mine: boolean;
    message_excerpt?: string;
    created_at: string;
  };
  unread_count: number;
  last_message_at: string;
  pay_address?: string;
  /**
   * The other person no longer has access to messages — they were taken out of
   * the chat beta. The conversation and its history are untouched and they are
   * still a member of it; what this says is that they cannot read it right now,
   * so sending would be shouting into a room nobody is in. Reversed the moment
   * their access is restored, with nothing to repair.
   */
  other_user_inactive?: boolean;
  blocked_by_me: boolean;
}

/** One unread conversation in the messaging summary, by its newest message from somebody else. */
export interface UnreadItem {
  conversation_id: number;
  last_message_id: number;
  /** Unread messages in it. Absent from a server older than the count. */
  unread_count?: number;
}

export interface MessagesPage {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface UserSearchResult {
  users: PublicUser[];
  merchants: Array<{ location_id: number; name: string; owner_user_id: string }>;
}

export type ReportReason = "prohibited_item" | "scam" | "harassment" | "spam" | "unsafe" | "other";

/** Report reasons for the picker, in the app's language. */
export function reportReasons(): Array<{ value: ReportReason; label: string }> {
  return [
    { value: "prohibited_item", label: t("utils.bulletin.notAllowedOnTheBulletin") },
    { value: "scam", label: t("utils.bulletin.scamOrFraud") },
    { value: "harassment", label: t("utils.bulletin.harassment") },
    { value: "spam", label: t("utils.bulletin.spam") },
    { value: "unsafe", label: t("utils.bulletin.feelsUnsafe") },
    { value: "other", label: t("utils.bulletin.somethingElse") },
  ];
}

const CATEGORY_LABEL_KEYS: Record<BulletinCategory, string> = {
  free: "utils.bulletin.free",
  for_sale: "utils.bulletin.forSale",
  notice: "utils.bulletin.neighborhoodNotice",
};

export function bulletinCategoryLabel(category: BulletinCategory): string {
  return t(CATEGORY_LABEL_KEYS[category]);
}

const BADGE_LABEL_KEYS: Record<BulletinBadge, string> = {
  merchant: "utils.bulletin.merchant",
  improver: "utils.bulletin.improver",
  verified_volunteer: "utils.bulletin.verifiedVolunteer",
};

export function bulletinBadgeLabel(badge: BulletinBadge): string {
  const key = BADGE_LABEL_KEYS[badge];
  return key ? t(key) : "";
}

/** A Bulletin request the server refused, with its readable message and code. */
export class BulletinRequestError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "BulletinRequestError";
    this.code = code;
    this.status = status;
  }
}
