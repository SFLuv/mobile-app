import { AppLocationDayHours } from "../types/app";

/** Storage order: index 0 is Monday, matching location_hours.weekday. */
export const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * The merchants' timezone, not the device's.
 *
 * These are San Francisco businesses, so "today" means today where the shop is.
 * Matches the web's lib/opening-hours.ts and the timezone the nightly hours sync
 * runs on — keep the three in step.
 */
const MERCHANT_TIME_ZONE = "America/Los_Angeles";

/** Today as a Monday-first index, or -1 if it cannot be determined. */
export function currentWeekdayIndex(now: Date = new Date()): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: MERCHANT_TIME_ZONE,
      weekday: "long",
    }).format(now);
    return WEEKDAY_NAMES.indexOf(name);
  } catch {
    // Hermes without full ICU should highlight nothing rather than confidently
    // bold the wrong day.
    return -1;
  }
}

/**
 * Whether a stored hours line is today's.
 *
 * Matches on the "Monday: " prefix rather than position, because a location
 * missing a day would shift every later entry and silently bold the wrong one.
 */
export function isTodayHoursLine(line: string, index: number, today = currentWeekdayIndex()): boolean {
  if (today < 0) {
    return false;
  }
  const prefix = line.split(":")[0]?.trim().toLowerCase();
  const labelled = WEEKDAY_NAMES.findIndex((name) => name.toLowerCase() === prefix);
  if (labelled >= 0) {
    return labelled === today;
  }
  return index === today;
}

/**
 * Whether a merchant is open right now.
 *
 * Three answers, not two. "unknown" is the honest result for a listing whose
 * hours were never recorded, and it must stay distinct from "closed": greying
 * out every merchant Google never published hours for tells customers those
 * shops are shut, which is a claim we cannot make.
 *
 * Mirrors the web's lib/opening-hours.ts — keep the two in step.
 */
export type OpenState = "open" | "closed" | "unknown";

/** Minutes since midnight in the merchant's timezone, or -1 if undeterminable. */
export function currentMerchantMinutes(now: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: MERCHANT_TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
      return -1;
    }
    // Some locales render midnight as hour 24 under hour12: false.
    return (hour % 24) * 60 + minute;
  } catch {
    return -1;
  }
}

/**
 * Resolve a merchant's current open state from their structured week.
 *
 * A stretch whose close is before its open runs past midnight, which is
 * ordinary for bars and late kitchens — so yesterday's late shift is checked as
 * well as today's. That is why this cannot be a plain "is now between open and
 * close" test.
 */
export function getOpenState(hours: AppLocationDayHours[] | undefined, now: Date = new Date()): OpenState {
  if (!hours || hours.length === 0) {
    return "unknown";
  }

  const today = currentWeekdayIndex(now);
  const minutes = currentMerchantMinutes(now);
  if (today < 0 || minutes < 0) {
    return "unknown";
  }

  const todayHours = hours.find((day) => day.weekday === today);
  const yesterdayHours = hours.find((day) => day.weekday === (today + 6) % 7);

  for (const interval of todayHours?.intervals ?? []) {
    const open = interval.openMinute;
    const close = interval.closeMinute;
    if (close > open ? minutes >= open && minutes < close : minutes >= open) {
      return "open";
    }
  }

  // A stretch that started yesterday and has not closed yet.
  for (const interval of yesterdayHours?.intervals ?? []) {
    if (interval.closeMinute < interval.openMinute && minutes < interval.closeMinute) {
      return "open";
    }
  }

  // Only claim "closed" for a day we know something about. An empty, un-flagged
  // day means the hours were never recorded.
  if (todayHours?.isClosed || (todayHours?.intervals?.length ?? 0) > 0) {
    return "closed";
  }

  return "unknown";
}
