import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Where to put the person back after a language change.
 *
 * Changing language redraws every screen (App keys its screens on the
 * language), and switching to or from a right-to-left language restarts the
 * app, so without this they would land on the Wallet tab. The point is kept in
 * memory for the instant redraw and in storage for the restart, and expires
 * after a couple of minutes so an old one is never applied to a normal launch.
 */
export type ReturnPoint = {
  tab: string;
  section?: string;
  /** How far down the screen was scrolled, to put the card they used back in view. */
  scrollY?: number;
  /** Saved for a direction restart: the app stays covered until it is back here. */
  restart?: boolean;
  at: number;
};

const KEY = "sfluv-wallet:language-return-point";
const MAX_AGE_MS = 2 * 60 * 1000;
let memory: ReturnPoint | null = null;

const fresh = (point: ReturnPoint | null): ReturnPoint | null =>
  point && Date.now() - point.at < MAX_AGE_MS ? point : null;

export function rememberReturnPoint(point: Omit<ReturnPoint, "at">): void {
  memory = { ...point, at: Date.now() };
  void AsyncStorage.setItem(KEY, JSON.stringify(memory)).catch(() => undefined);
}

/** The restart about to happen comes back to this point (see direction.ts). */
export function markReturnPointForRestart(): void {
  if (!fresh(memory)) {
    return;
  }
  memory = { ...memory!, restart: true };
  void AsyncStorage.setItem(KEY, JSON.stringify(memory)).catch(() => undefined);
}

/** The point for this session's redraw, if any (synchronous, for initial state). */
export function peekReturnPoint(): ReturnPoint | null {
  return fresh(memory);
}

/** The point saved before a restart, if any. */
export async function loadReturnPoint(): Promise<ReturnPoint | null> {
  if (fresh(memory)) {
    return memory;
  }
  try {
    const raw = await AsyncStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as ReturnPoint) : null;
  } catch {
    memory = null;
  }
  return fresh(memory);
}

/** Once applied, so a later launch or redraw does not jump to it again. */
export function clearReturnPoint(): void {
  memory = null;
  void AsyncStorage.removeItem(KEY).catch(() => undefined);
}
