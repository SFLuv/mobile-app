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

export type MessageKind = "text" | "payment" | "system";

export interface ChatMessage {
  id: number;
  conversation_id: number;
  sender_id: string;
  is_mine: boolean;
  kind: MessageKind;
  body: string;
  tx_hash?: string | null;
  amount_sfluv_base?: string | null;
  payment_verified: boolean;
  created_at: string;
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
  other_user: PublicUser;
  post: ConversationPostChip | null;
  last_message: ChatMessage | null;
  unread_count: number;
  last_message_at: string;
  pay_address?: string;
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
