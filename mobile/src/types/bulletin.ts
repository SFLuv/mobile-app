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

  reply_to_id?: number;
  reply_to?: MessageQuote;
  attachments?: MessageAttachment[];
  reactions?: MessageReaction[];
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

  post: ConversationPostChip | null;
  last_message: ChatMessage | null;
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

export interface MessagesPage {
  messages: ChatMessage[];
  has_more: boolean;
}

export interface UserSearchResult {
  users: PublicUser[];
  merchants: Array<{ location_id: number; name: string; owner_user_id: string }>;
}

export type ReportReason = "prohibited_item" | "scam" | "harassment" | "spam" | "unsafe" | "other";

export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: "prohibited_item", label: "Not allowed on the Bulletin" },
  { value: "scam", label: "Scam or fraud" },
  { value: "harassment", label: "Harassment" },
  { value: "spam", label: "Spam" },
  { value: "unsafe", label: "Feels unsafe" },
  { value: "other", label: "Something else" },
];

export const BULLETIN_CATEGORY_LABELS: Record<BulletinCategory, string> = {
  free: "Free",
  for_sale: "For sale",
  notice: "Neighborhood notice",
};

export const BULLETIN_BADGE_LABELS: Record<BulletinBadge, string> = {
  merchant: "Merchant",
  improver: "Improver",
  verified_volunteer: "Verified volunteer",
};

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
