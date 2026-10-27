import type { AppNotificationItem } from "../types/notifications";

/** A website support request, as read off its alert. */
export type SupportRequestDetails = {
  reference: string;
  subject: string;
  name: string;
  email: string;
  category: string;
  message: string;
  receivedAt: number;
};

const TITLE_PREFIX = "Support request: ";

/**
 * Reads a support request out of its notification, or null for anything else.
 *
 * The alert carries the request twice: as display fields ("From", "Reference")
 * and, where the feed includes it, as data. Data wins when present because it
 * is unformatted; the fields are the fallback, and are always there. "From" is
 * written as `Name <email>` when the sender gave a name, or as the bare email.
 */
export function supportRequestDetails(item: AppNotificationItem): SupportRequestDetails | null {
  const internal = item.internal;
  const isSupport = item.kind === "support_request" || Boolean(internal?.alertKey?.startsWith("support:"));
  if (!isSupport) {
    return null;
  }

  const field = (label: string) =>
    internal?.fields.find((entry) => entry.label.toLowerCase() === label.toLowerCase())?.value.trim() ?? "";
  const data = item.data ?? {};

  const { name, email } = parseSender(field("From"));
  const reference =
    data.reference?.trim() ||
    field("Reference") ||
    (internal?.alertKey?.startsWith("support:") ? internal.alertKey.slice("support:".length) : "");
  const title = item.title.trim();
  const subject =
    data.subject?.trim() || (title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length).trim() : title);

  return {
    reference,
    subject: subject && subject !== "(no subject)" ? subject : "No subject",
    name,
    email: data.email?.trim() || email,
    category: data.category?.trim() || "",
    message: data.message?.trim() || item.body.trim(),
    receivedAt: item.createdAt,
  };
}

/** Splits `Name <email>` into its parts; a bare address is all email. */
export function parseSender(from: string): { name: string; email: string } {
  const value = from.trim();
  const bracketed = value.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (bracketed) {
    return { name: bracketed[1].trim(), email: bracketed[2].trim() };
  }
  if (/^[^\s@]+@[^\s@]+$/.test(value)) {
    return { name: "", email: value };
  }
  return { name: value, email: "" };
}

/** "merchant_onboarding" -> "Merchant onboarding". */
export function categoryLabel(category: string): string {
  const words = category.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}
