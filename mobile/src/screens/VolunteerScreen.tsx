import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SegmentedTabs } from "../components/SegmentedTabs";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import {
  AppBackendClient,
  AppVolunteerSignupError,
  VOLUNTEER_EVENT_PAGE_SIZE,
} from "../services/appBackend";
import {
  AppVolunteerEvent,
  AppVolunteerEventWindow,
  AppVolunteerLocation,
  AppVolunteerOrganizerFacet,
  AppVolunteerSignupResult,
  AppW9Status,
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { W9EscrowCard } from "../components/W9EscrowCard";
import { triggerClickHaptic } from "../utils/haptics";
import { ICON_FACE, ICON_TEXT_COLOR, ICON_TEXT_NUDGE_EM, merchantInitials } from "../utils/merchantIcon";

/**
 * SFLuv's own mark, bundled rather than fetched.
 *
 * The same asset the QR code centres on, so the brand is identical wherever it
 * appears in the app.
 */
const SFLUV_MARK = require("../../assets/qr-logo.png");

type Props = {
  w9Status?: AppW9Status | null;
  w9Busy?: boolean;
  onStartW9?: () => void;
  backendClient?: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled?: boolean;
  /** Deep link target: opens straight into an event detail when it changes. */
  requestedEventId?: string | null;
  requestedEventNonce?: number;
  /** The account's current volunteer-list state; undefined until the backend says. */
  volunteerListOptIn?: boolean;
  onVolunteerListOptInChange?: (optedIn: boolean) => void;
  onToast?: (message: string, tone: "info" | "success" | "error") => void;
};

type VolunteerFeed = "upcoming" | "past" | "mine";

type FeedOption = {
  value: VolunteerFeed;
  label: string;
};

const FEED_OPTIONS: FeedOption[] = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "mine", label: "My events" },
];

const SEARCH_DEBOUNCE_MS = 350;
const ORGANIZER_FILTER_ALL = "all";

function organizerFilterKey(organizer: AppVolunteerOrganizerFacet): string {
  if (organizer.type === "affiliate" && typeof organizer.organizationId === "number") {
    return `org:${organizer.organizationId}`;
  }
  return organizer.type;
}

function parseDate(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Event timestamps carry their own UTC offset, and every surface renders them in
 * the *viewer's* local time — so a volunteer reading this on a phone set to a
 * different zone sees the hour their phone would show them.
 */
function formatLocal(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleString("en-US", options);
}

function formatEventDay(event: AppVolunteerEvent): string {
  const start = parseDate(event.startAt);
  if (!start) {
    return "Date to be announced";
  }
  return formatLocal(start, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatEventTimeRange(event: AppVolunteerEvent): string {
  const start = parseDate(event.startAt);
  const end = parseDate(event.endAt);
  if (!start) {
    return "";
  }
  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const startLabel = formatLocal(start, timeOptions);
  if (!end || end.getTime() <= start.getTime()) {
    return startLabel;
  }

  const dayKey: Intl.DateTimeFormatOptions = { year: "numeric", month: "numeric", day: "numeric" };
  const sameDay = formatLocal(start, dayKey) === formatLocal(end, dayKey);

  if (sameDay) {
    return `${startLabel} - ${formatLocal(end, timeOptions)}`;
  }

  return `${startLabel} - ${formatLocal(end, { month: "short", day: "numeric", ...timeOptions })}`;
}

/** Name, street, "City, ST ZIP" — skipping whatever the location does not carry. */
function locationLines(location: AppVolunteerLocation): string[] {
  const cityState = [location.city, location.state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, location.zip].filter(Boolean).join(" ");
  return [location.name, location.street, cityStateZip]
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line));
}

function hasCoordinates(location: AppVolunteerLocation): boolean {
  return typeof location.lat === "number" && typeof location.lng === "number";
}

async function openDirections(location: AppVolunteerLocation): Promise<void> {
  const { lat, lng } = location;
  const label = encodeURIComponent(location.name || "Volunteer event");
  const nativeUrl =
    Platform.OS === "android"
      ? `geo:${lat},${lng}?q=${lat},${lng}(${label})`
      : `comgooglemaps://?q=${label}&center=${lat},${lng}`;

  try {
    if (await Linking.canOpenURL(nativeUrl)) {
      await Linking.openURL(nativeUrl);
      return;
    }
  } catch {
    // Fall through to the browser URL.
  }

  await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
}

/**
 * Two independently pending things: the signup itself and the email list.
 * Authenticated signups confirm on the spot, so `status` should always be
 * "confirmed" here — but it carries "pending_confirmation" on the anonymous web
 * path, so it is handled rather than assumed. Either way the spot is held; never
 * word it so the spot looks at risk.
 */
function signupSuccessMessage(result: AppVolunteerSignupResult): string {
  if (result.status === "pending_confirmation") {
    return "Your spot is held. Check your email to confirm it.";
  }
  // Only mention the email list when it needs something from the user. An
  // already-active subscription is not news worth crowding the confirmation
  // with — the same reason PJ had the line dropped from the web flow.
  if (result.volunteerList === "pending_confirmation") {
    return "You are signed up. Check your email to join the volunteer list.";
  }
  return "You are signed up. See you there!";
}

/** "12 / 40 Remaining", or "Full" once there is nothing left to claim. */
function remainingSpotsLabel(event: AppVolunteerEvent): string | null {
  if (typeof event.spotsRemaining === "number" && typeof event.maxParticipants === "number") {
    return event.spotsRemaining > 0
      ? `${event.spotsRemaining} / ${event.maxParticipants} Remaining`
      : "Full";
  }
  // External and no-signup events publish a cap but not a live count.
  if (typeof event.maxParticipants === "number") {
    return `${event.maxParticipants} spots`;
  }
  return null;
}

function spotsLabel(event: AppVolunteerEvent): string | null {
  if (typeof event.spotsRemaining === "number" && typeof event.maxParticipants === "number") {
    return event.spotsRemaining > 0
      ? `${event.spotsRemaining} of ${event.maxParticipants} spots left`
      : "Full";
  }
  if (typeof event.maxParticipants === "number") {
    return `${event.maxParticipants} spots`;
  }
  return null;
}

function signupClosedLabel(event: AppVolunteerEvent): string | null {
  switch (event.signup.closedReason) {
    case "full":
      return "This event is full";
    case "ended":
      return "This event has ended";
    case "cancelled":
      return "This event was cancelled";
    case "not_open_yet":
      return "Sign ups have not opened yet";
    default:
      return null;
  }
}

export function VolunteerScreen({
  w9Status,
  w9Busy,
  onStartW9,
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  requestedEventId,
  requestedEventNonce,
  volunteerListOptIn,
  onVolunteerListOptInChange,
  onToast,
}: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows, isDark), [palette, shadows, isDark]);
  const { width } = useWindowDimensions();

  const [feed, setFeed] = useState<VolunteerFeed>("upcoming");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [organizerFilter, setOrganizerFilter] = useState<string>(ORGANIZER_FILTER_ALL);
  // Full events are hidden by default; ticking this brings them back. Stored as
  // "show full" rather than "open spots" so the checked state is the additive one.
  const [showFull, setShowFull] = useState(false);
  const [organizerPickerOpen, setOrganizerPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterContentHeight, setFilterContentHeight] = useState(0);
  /** Set when the list was reached by tapping an organizer, so we can walk back. */
  const [organizerReturnEventId, setOrganizerReturnEventId] = useState<string | null>(null);

  const [events, setEvents] = useState<AppVolunteerEvent[]>([]);
  const [organizers, setOrganizers] = useState<AppVolunteerOrganizerFacet[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedEvent, setSelectedEvent] = useState<AppVolunteerEvent | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [signupSheetOpen, setSignupSheetOpen] = useState(false);
  const [signupOptIn, setSignupOptIn] = useState(true);
  const [signupBusy, setSignupBusy] = useState(false);
  const [coverIndex, setCoverIndex] = useState(0);

  // Guards against a slower earlier query overwriting a newer one when the user
  // types quickly or flips filters mid-flight.
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailSlide = useRef(new Animated.Value(0)).current;
  const searchReveal = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);
  const listSlide = useRef(new Animated.Value(0)).current;

  const haptics = useCallback(() => {
    triggerClickHaptic(hapticsEnabled === true);
  }, [hapticsEnabled]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const filterHeight = searchReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, (filterContentHeight > 0 ? filterContentHeight : 148) + spacing.sm],
  });

  const toggleSearch = useCallback(() => {
    haptics();
    const next = !searchOpen;
    setSearchOpen(next);
    Animated.timing(searchReveal, {
      toValue: next ? 1 : 0,
      duration: next ? 220 : 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    if (next) {
      // Small delay so focus lands once the field actually has height.
      setTimeout(() => searchInputRef.current?.focus(), 120);
    } else {
      searchInputRef.current?.blur();
      // Collapsing clears the term: a filter you cannot see is a filter you
      // will not remember you set.
      setSearchInput("");
    }
  }, [haptics, searchOpen, searchReveal]);

  const query = useMemo(
    () => ({
      search,
      organizer: organizerFilter === ORGANIZER_FILTER_ALL ? undefined : organizerFilter,
      when: (feed === "past" ? "past" : feed === "mine" ? "all" : "upcoming") as AppVolunteerEventWindow,
      openSignups: showFull ? undefined : true,
      count: VOLUNTEER_EVENT_PAGE_SIZE,
    }),
    [feed, organizerFilter, search, showFull],
  );

  const fetchPage = useCallback(
    async (targetPage: number) => {
      if (!backendClient) {
        throw new Error("Backend not configured.");
      }
      const request = { ...query, page: targetPage };
      return feed === "mine"
        ? backendClient.getMyVolunteerEvents(request)
        : backendClient.getVolunteerEvents(request);
    },
    [backendClient, feed, query],
  );

  const loadFirstPage = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!backendClient) {
        setLoading(false);
        setListError("Sign in again to browse volunteer events.");
        return;
      }
      const requestId = listRequestRef.current + 1;
      listRequestRef.current = requestId;
      if (!options?.silent) {
        setLoading(true);
      }
      setListError(null);
      try {
        const result = await fetchPage(0);
        if (listRequestRef.current !== requestId) {
          return;
        }
        setEvents(result.events);
        setPage(result.page);
        setHasMore(result.hasMore);
      } catch (error) {
        if (listRequestRef.current !== requestId) {
          return;
        }
        setEvents([]);
        setHasMore(false);
        setListError((error as Error)?.message || "Unable to load volunteer events.");
      } finally {
        if (listRequestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [backendClient, fetchPage],
  );

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // Facets come from their own route, so a list page never pays for the
  // full-corpus aggregate. A failure here only costs the organizer filter.
  useEffect(() => {
    if (!backendClient) {
      return;
    }
    let cancelled = false;
    void backendClient
      .getVolunteerEventOrganizers()
      .then((facets) => {
        if (!cancelled) {
          setOrganizers(facets);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOrganizers([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendClient]);

  const loadMore = useCallback(async () => {
    if (!backendClient || loadingMore || !hasMore) {
      return;
    }
    const requestId = listRequestRef.current;
    setLoadingMore(true);
    try {
      const result = await fetchPage(page + 1);
      if (listRequestRef.current !== requestId) {
        return;
      }
      setEvents((current) => {
        const seen = new Set(current.map((event) => event.id));
        return [...current, ...result.events.filter((event) => !seen.has(event.id))];
      });
      setPage(result.page);
      setHasMore(result.hasMore);
    } catch (error) {
      onToast?.((error as Error)?.message || "Unable to load more events.", "error");
    } finally {
      setLoadingMore(false);
    }
  }, [backendClient, fetchPage, hasMore, loadingMore, onToast, page]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const refreshSelectedEventRef = useRef<() => void>(() => {});

  // Spots get taken and events get cancelled while the app is away. Re-sync on
  // the way back in, silently — a spinner on a screen the user is already
  // looking at is worse than briefly stale text that corrects itself.
  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      const returned = previousState !== "active" && nextState === "active";
      previousState = nextState;
      if (!returned) {
        return;
      }
      void loadFirstPage({ silent: true });
      refreshSelectedEventRef.current();
    });
    return () => subscription.remove();
  }, [loadFirstPage]);

  const applyEventUpdate = useCallback((next: AppVolunteerEvent) => {
    setSelectedEvent((current) => (current && current.id === next.id ? next : current));
    setEvents((current) => current.map((event) => (event.id === next.id ? next : event)));
  }, []);

  /**
   * Pushes the detail in from the right, the way a native stack would. The
   * motion is the affordance: it tells the user this screen sits on top of the
   * list and can be swiped back off it.
   */
  const pushInDetail = useCallback(() => {
    detailSlide.setValue(width);
    Animated.spring(detailSlide, {
      toValue: 0,
      useNativeDriver: true,
      friction: 12,
      tension: 88,
    }).start();
  }, [detailSlide, width]);

  const openEvent = useCallback(
    async (event: AppVolunteerEvent | { id: string }, options?: { animate?: boolean }) => {
      const known = "title" in event ? event : events.find((entry) => entry.id === event.id) ?? null;
      if (options?.animate !== false) {
        pushInDetail();
      } else {
        // Arriving by a back gesture: appear in place rather than flying in.
        detailSlide.setValue(0);
      }
      // Paint whatever the list already knows immediately, then refine.
      setSelectedEvent(known);
      setCoverIndex(0);
      setDetailError(null);
      if (!backendClient) {
        // With nothing already known there is no pane to show, and rendering
        // neither one reads as a broken screen rather than a failed load.
        if (!known) {
          setDetailError("Sign in again to open this event.");
        }
        return;
      }
      const requestId = detailRequestRef.current + 1;
      detailRequestRef.current = requestId;
      setDetailLoading(true);
      try {
        const full = await backendClient.getVolunteerEvent(event.id);
        if (detailRequestRef.current !== requestId) {
          return;
        }
        setSelectedEvent(full);
        applyEventUpdate(full);
      } catch (error) {
        if (detailRequestRef.current !== requestId) {
          return;
        }
        if (!known) {
          setDetailError((error as Error)?.message || "Unable to load this event.");
        }
      } finally {
        if (detailRequestRef.current === requestId) {
          setDetailLoading(false);
        }
      }
    },
    [applyEventUpdate, backendClient, detailSlide, events, pushInDetail],
  );

  // Refreshes an open event without the paint-known-then-refine path openEvent
  // uses, which would briefly downgrade a full detail to its list summary.
  useEffect(() => {
    refreshSelectedEventRef.current = () => {
      const openId = selectedEvent?.id;
      if (!backendClient || !openId) {
        return;
      }
      void backendClient
        .getVolunteerEvent(openId)
        .then((full) => {
          applyEventUpdate(full);
          setSelectedEvent((current) => (current?.id === full.id ? full : current));
        })
        .catch(() => {
          // Keep showing what we have rather than blanking a visible screen.
        });
    };
  }, [applyEventUpdate, backendClient, selectedEvent?.id]);

  useEffect(() => {
    if (!requestedEventId) {
      return;
    }
    void openEvent({ id: requestedEventId });
    // openEvent is intentionally omitted: the nonce is the trigger, not identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedEventId, requestedEventNonce]);

  const detailVisible = Boolean(selectedEvent) || detailLoading || Boolean(detailError);
  useEffect(() => {
    if (!detailVisible) {
      detailSlide.setValue(0);
    }
  }, [detailSlide, detailVisible]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedEvent(null);
    setDetailError(null);
    setDetailLoading(false);
    setSignupSheetOpen(false);
    // The list is not mounted right now, so this cannot flicker.
    listSlide.setValue(0);
  }, [listSlide]);

  /**
   * Jumping from an event to "everything by this organizer". The event we came
   * from is remembered so the same back-swipe that leaves a detail also walks
   * back out of the filtered list to where the journey started.
   */
  const openOrganizerEvents = useCallback(
    (event: AppVolunteerEvent) => {
      haptics();
      setOrganizerFilter(organizerFilterKey(event.organizer));
      setOrganizerReturnEventId(event.id);
      closeDetail();
      listSlide.setValue(width);
      Animated.spring(listSlide, {
        toValue: 0,
        useNativeDriver: true,
        friction: 12,
        tension: 88,
      }).start();
    },
    [closeDetail, haptics, listSlide, width],
  );

  const returnToOriginEvent = useCallback(() => {
    const originId = organizerReturnEventId;
    setOrganizerReturnEventId(null);
    setOrganizerFilter(ORGANIZER_FILTER_ALL);

    /*
     * The gesture that calls this has just animated the list to translateX =
     * width — entirely off screen — on the assumption that the detail is about
     * to cover it.
     *
     * When there IS an origin event, leave it there. openEvent always renders
     * the detail pane (a known event, a spinner, or an error), and the list
     * unmounts the moment it does. Snapping the list back to 0 here instead
     * put it on screen for the frame or two before that happened, which is the
     * flicker of the outgoing page.
     *
     * When there is not, nothing is going to cover it, so it has to come back
     * itself or the screen is simply blank with no way out.
     */
    if (!originId) {
      listSlide.setValue(0);
      detailSlide.setValue(0);
      return;
    }

    void openEvent({ id: originId }, { animate: false });
  }, [detailSlide, listSlide, openEvent, organizerReturnEventId]);

  const listPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          Boolean(organizerReturnEventId) &&
          gesture.x0 <= 28 &&
          gesture.dx > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          listSlide.setValue(Math.max(0, Math.min(gesture.dx, width)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > width * 0.32 || gesture.vx > 0.5) {
            Animated.timing(listSlide, { toValue: width, duration: 160, useNativeDriver: true }).start(
              () => {
                returnToOriginEvent();
              },
            );
            return;
          }
          Animated.spring(listSlide, { toValue: 0, useNativeDriver: true, friction: 10, tension: 90 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(listSlide, { toValue: 0, useNativeDriver: true, friction: 10 }).start();
        },
      }),
    [listSlide, organizerReturnEventId, returnToOriginEvent, width],
  );

  /** Back button dismissal mirrors the swipe, so both exits look the same. */
  const dismissDetail = useCallback(() => {
    Animated.timing(detailSlide, {
      toValue: width,
      duration: 190,
      useNativeDriver: true,
    }).start(() => {
      closeDetail();
    });
  }, [closeDetail, detailSlide, width]);

  // Edge swipe back to the list, matching the wallet panes: drag follows the
  // finger, and a decisive swipe (or a fast flick) completes the dismissal.
  /*
   * True while a finger is down inside the cover carousel.
   *
   * The carousel is a horizontal ScrollView inside the pane that owns the
   * back-swipe. A parent PanResponder can take the responder away from a
   * scrolling child mid-gesture, so swiping right to go back a photo — near
   * the left edge, which is where the previous photo lives — was being read as
   * a back-swipe and dismissing the whole screen. A ref rather than state: it
   * is read inside the responder callbacks and must never lag a render behind
   * the finger.
   */
  const coverSwipeRef = useRef(false);
  const setCoverSwiping = useCallback((active: boolean) => {
    coverSwipeRef.current = active;
  }, []);

  const detailPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          !coverSwipeRef.current &&
          gesture.x0 <= 28 &&
          gesture.dx > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => {
          detailSlide.setValue(Math.max(0, Math.min(gesture.dx, width)));
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > width * 0.32 || gesture.vx > 0.5) {
            Animated.timing(detailSlide, {
              toValue: width,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              closeDetail();
            });
            return;
          }
          Animated.spring(detailSlide, {
            toValue: 0,
            useNativeDriver: true,
            friction: 10,
            tension: 90,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(detailSlide, { toValue: 0, useNativeDriver: true, friction: 10 }).start();
        },
      }),
    [closeDetail, detailSlide, width],
  );

  const openExternalSignup = useCallback(
    async (event: AppVolunteerEvent) => {
      const url = event.signup.url?.trim();
      if (!url) {
        onToast?.("This event has no sign up link yet.", "error");
        return;
      }
      haptics();
      try {
        await Linking.openURL(url);
      } catch {
        onToast?.("Unable to open the sign up link.", "error");
      }
    },
    [haptics, onToast],
  );

  const confirmInternalSignup = useCallback(async () => {
    if (!backendClient || !selectedEvent) {
      return;
    }
    setSignupBusy(true);
    try {
      const result = await backendClient.signUpForVolunteerEvent(selectedEvent.id, {
        volunteerListOptIn: signupOptIn,
      });
      // A verified account email joins the list immediately, so push the new
      // state up rather than leaving the account stale until the next profile
      // load. Only "active" counts — a pending confirmation is not membership.
      const nextOptIn =
        result.volunteerList === "active"
          ? true
          : result.volunteerList === "none"
            ? false
            : (result.volunteerListOptIn ?? (signupOptIn ? volunteerListOptIn : volunteerListOptIn));
      if (typeof nextOptIn === "boolean" && nextOptIn !== volunteerListOptIn) {
        onVolunteerListOptInChange?.(nextOptIn);
      }
      const next: AppVolunteerEvent = {
        ...selectedEvent,
        spotsRemaining:
          typeof result.spotsRemaining === "number" ? result.spotsRemaining : selectedEvent.spotsRemaining,
        signupCount:
          typeof selectedEvent.signupCount === "number" ? selectedEvent.signupCount + 1 : selectedEvent.signupCount,
        viewer: { signedUp: true, signupId: result.signupId, redeemed: selectedEvent.viewer?.redeemed === true },
      };
      applyEventUpdate(next);
      setSelectedEvent(next);
      setSignupSheetOpen(false);
      onToast?.(signupSuccessMessage(result), "success");
    } catch (error) {
      if (error instanceof AppVolunteerSignupError && error.reason === "already_signed_up") {
        // Treat as success: the server and the client just disagreed about state.
        const next: AppVolunteerEvent = {
          ...selectedEvent,
          viewer: { signedUp: true, signupId: selectedEvent.viewer?.signupId ?? null, redeemed: false },
        };
        applyEventUpdate(next);
        setSelectedEvent(next);
        setSignupSheetOpen(false);
        onToast?.(error.message, "info");
      } else {
        onToast?.((error as Error)?.message || "Unable to sign you up right now.", "error");
        // A "full" rejection means our copy of the event is stale.
        void openEvent({ id: selectedEvent.id });
      }
    } finally {
      setSignupBusy(false);
    }
  }, [
    applyEventUpdate,
    backendClient,
    onToast,
    onVolunteerListOptInChange,
    openEvent,
    selectedEvent,
    signupOptIn,
    volunteerListOptIn,
  ]);

  const cancelSignup = useCallback(async () => {
    if (!backendClient || !selectedEvent) {
      return;
    }
    setSignupBusy(true);
    try {
      await backendClient.cancelVolunteerEventSignup(selectedEvent.id);
      const next: AppVolunteerEvent = {
        ...selectedEvent,
        spotsRemaining:
          typeof selectedEvent.spotsRemaining === "number" ? selectedEvent.spotsRemaining + 1 : selectedEvent.spotsRemaining,
        signupCount:
          typeof selectedEvent.signupCount === "number"
            ? Math.max(0, selectedEvent.signupCount - 1)
            : selectedEvent.signupCount,
        viewer: { signedUp: false, signupId: null, redeemed: selectedEvent.viewer?.redeemed === true },
      };
      applyEventUpdate(next);
      setSelectedEvent(next);
      onToast?.("Your spot was released.", "info");
    } catch (error) {
      onToast?.((error as Error)?.message || "Unable to cancel your spot.", "error");
    } finally {
      setSignupBusy(false);
    }
  }, [applyEventUpdate, backendClient, onToast, selectedEvent]);

  const organizerFilterLabel = useMemo(() => {
    if (organizerFilter === ORGANIZER_FILTER_ALL) {
      return "All organizers";
    }
    const match = organizers.find((organizer) => organizerFilterKey(organizer) === organizerFilter);
    return match?.name || "All organizers";
  }, [organizerFilter, organizers]);

  /*
   * The detail is an overlay, not a replacement.
   *
   * Rendering one pane OR the other meant the space the detail vacated as it
   * slid away showed the screen background rather than the list, and the list
   * then appeared all at once when the animation's callback finally swapped
   * them — a blank beat followed by a pop, in both directions. Keeping the
   * list mounted underneath means the detail slides off it and reveals it
   * progressively, which is what a back-swipe is supposed to look like. It
   * also keeps the list's scroll position across a visit to an event.
   */
  const detailPane = detailVisible ? (
    <Animated.View
      style={[styles.detailOverlay, { transform: [{ translateX: detailSlide }] }]}
      {...detailPanResponder.panHandlers}
    >
      <EventDetail
        styles={styles}
        palette={palette}
        isDark={isDark}
        width={width}
        event={selectedEvent}
        loading={detailLoading}
        error={detailError}
        tokenSymbol={tokenSymbol}
        coverIndex={coverIndex}
        signupBusy={signupBusy}
        onCoverIndexChange={setCoverIndex}
        onCoverSwiping={setCoverSwiping}
        onBack={dismissDetail}
        onExternalSignup={openExternalSignup}
        onOpenSignupSheet={() => {
          haptics();
          // Show what the account already is, not a hopeful default — a user
          // who is on the list should see the toggle already on.
          setSignupOptIn(volunteerListOptIn ?? true);
          setSignupSheetOpen(true);
        }}
        alreadyOnVolunteerList={volunteerListOptIn === true}
        onOpenOrganizer={openOrganizerEvents}
        onCancelSignup={cancelSignup}
        signupSheetOpen={signupSheetOpen}
        signupOptIn={signupOptIn}
        onSignupOptInChange={setSignupOptIn}
        onConfirmSignup={confirmInternalSignup}
        onCloseSignupSheet={() => setSignupSheetOpen(false)}
      />
    </Animated.View>
  ) : null;

  return (
    <View style={styles.screen}>
      <Animated.View
        style={[styles.detailPane, { transform: [{ translateX: listSlide }] }]}
        {...listPanResponder.panHandlers}
      >
      <ScrollView
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            key={`${isDark ? "dark" : "light"}:${palette.primaryStrong}`}
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={palette.primaryStrong}
            colors={[palette.primaryStrong]}
            progressBackgroundColor={isDark ? palette.backgroundMuted : palette.surfaceStrong}
          />
        }
      >
        {/* Held rewards go first: this is why a reward has not arrived. */}
        {onStartW9 ? (
          <W9EscrowCard status={w9Status ?? null} busy={w9Busy} onStart={onStartW9} />
        ) : null}

        <View style={styles.filterHeaderRow}>
          <SegmentedTabs
            style={styles.segmentRowFill}
            segments={FEED_OPTIONS}
            value={feed}
            onChange={setFeed}
            hapticsEnabled={hapticsEnabled}
          />
          <Pressable
            style={[styles.searchToggle, searchOpen || search ? styles.searchToggleActive : undefined]}
            onPress={toggleSearch}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={searchOpen ? "Hide search" : "Search events"}
          >
            <Ionicons
              name={searchOpen ? "close" : "search"}
              size={18}
              color={searchOpen || search ? palette.primaryStrong : palette.textMuted}
            />
          </Pressable>
        </View>
        <Animated.View
          style={[styles.filterCollapsible, { height: filterHeight, opacity: searchReveal }]}
          pointerEvents={searchOpen ? "auto" : "none"}
        >
          {/* Search and both filters live together behind the search icon:
              all three narrow the list, and none is wanted on a plain browse. */}
          <View
            style={styles.filterCard}
            onLayout={(event) => setFilterContentHeight(event.nativeEvent.layout.height)}
          >
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={16} color={palette.textMuted} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                value={searchInput}
                onChangeText={setSearchInput}
                placeholder="Search events or organizers"
                placeholderTextColor={palette.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchInput ? (
                <Pressable onPress={() => setSearchInput("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={palette.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <View style={styles.filterRow}>
            <Pressable
              style={[styles.filterChip, organizerFilter !== ORGANIZER_FILTER_ALL ? styles.filterChipActive : undefined]}
              onPress={() => {
                haptics();
                setOrganizerPickerOpen(true);
              }}
            >
              <Ionicons
                name="business-outline"
                size={14}
                color={organizerFilter !== ORGANIZER_FILTER_ALL ? palette.primaryStrong : palette.textMuted}
              />
              <Text
                style={[
                  styles.filterChipText,
                  organizerFilter !== ORGANIZER_FILTER_ALL ? styles.filterChipTextActive : undefined,
                ]}
                numberOfLines={1}
              >
                {organizerFilterLabel}
              </Text>
              <Ionicons name="chevron-down" size={13} color={palette.textMuted} />
            </Pressable>

            <Pressable
              style={[styles.filterChip, showFull ? styles.filterChipActive : undefined]}
              onPress={() => {
                haptics();
                setShowFull((current) => !current);
              }}
            >
              <Ionicons
                name={showFull ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={showFull ? palette.primaryStrong : palette.textMuted}
              />
              <Text style={[styles.filterChipText, showFull ? styles.filterChipTextActive : undefined]}>
                Show full
              </Text>
            </Pressable>
          </View>
          </View>
        </Animated.View>

        {loading ? (
          <View style={styles.stateCard}>
            <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
            <Text style={styles.stateTitle}>Loading events</Text>
          </View>
        ) : listError ? (
          <View style={styles.stateCard}>
            <Ionicons name="alert-circle-outline" size={22} color={palette.danger} />
            <Text style={styles.stateTitle}>Could not load events</Text>
            <Text style={styles.stateBody}>{listError}</Text>
            <Pressable style={styles.retryButton} onPress={() => void loadFirstPage()}>
              <Text style={styles.retryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : events.length === 0 ? (
          <View style={styles.stateCard}>
            <Ionicons name="calendar-outline" size={22} color={palette.textMuted} />
            <Text style={styles.stateTitle}>
              {feed === "mine"
                ? "No sign ups yet"
                : search
                  ? "No matching events"
                  : feed === "past"
                    ? "No previous events"
                    : "No events scheduled"}
            </Text>
            <Text style={styles.stateBody}>
              {feed === "mine"
                ? "Events you sign up for will show up here."
                : search
                  ? "Try a different search or clear your filters."
                  : feed === "past"
                    ? "Events that have already happened will show up here."
                    : "New volunteer events are posted regularly. Check back soon."}
            </Text>
          </View>
        ) : (
          events.map((event) => (
            <EventCard
              key={event.id}
              styles={styles}
              palette={palette}
              event={event}
              tokenSymbol={tokenSymbol}
              onPress={() => {
                haptics();
                void openEvent(event);
              }}
            />
          ))
        )}

        {events.length > 0 && hasMore ? (
          <Pressable
            style={[styles.loadMoreButton, loadingMore ? styles.loadMoreButtonDisabled : undefined]}
            disabled={loadingMore}
            onPress={() => void loadMore()}
          >
            {loadingMore ? <ThemedActivityIndicator size="small" color={palette.white} /> : null}
            <Text style={styles.loadMoreText}>{loadingMore ? "Loading..." : "Load more events"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal
        visible={organizerPickerOpen}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setOrganizerPickerOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setOrganizerPickerOpen(false)}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Organizer</Text>
              <Pressable style={styles.sheetClose} onPress={() => setOrganizerPickerOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={18} color={palette.primaryStrong} />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} showsVerticalScrollIndicator={false}>
              <Pressable
                style={[
                  styles.sheetOption,
                  organizerFilter === ORGANIZER_FILTER_ALL ? styles.sheetOptionActive : undefined,
                ]}
                onPress={() => {
                  setOrganizerFilter(ORGANIZER_FILTER_ALL);
                  setOrganizerReturnEventId(null);
                  setOrganizerPickerOpen(false);
                }}
              >
                <Text style={styles.sheetOptionText}>All organizers</Text>
                {organizerFilter === ORGANIZER_FILTER_ALL ? (
                  <Ionicons name="checkmark" size={16} color={palette.primaryStrong} />
                ) : null}
              </Pressable>

              {organizers.map((organizer) => {
                const key = organizerFilterKey(organizer);
                const active = organizerFilter === key;
                return (
                  <Pressable
                    key={key}
                    style={[styles.sheetOption, active ? styles.sheetOptionActive : undefined]}
                    onPress={() => {
                      setOrganizerFilter(key);
                      setOrganizerReturnEventId(null);
                      setOrganizerPickerOpen(false);
                    }}
                  >
                    <OrganizerAvatar styles={styles} palette={palette} organizer={organizer} size={26} />
                    <Text style={styles.sheetOptionText} numberOfLines={1}>
                      {organizer.name}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={16} color={palette.primaryStrong} /> : null}
                  </Pressable>
                );
              })}

              {organizers.length === 0 ? (
                <Text style={styles.sheetEmpty}>No organizers to filter by yet.</Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      </Animated.View>

      {detailPane}
    </View>
  );
}

type StyleSet = ReturnType<typeof createStyles>;

function OrganizerAvatar({
  styles,
  palette,
  organizer,
  size,
}: {
  styles: StyleSet;
  palette: Palette;
  organizer: { name: string; logoUrl?: string | null; type: string };
  size: number;
}) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  // A remote logo that fails to load renders as an empty circle with no way
  // back, so a failure drops through to the generated mark below.
  const [remoteFailed, setRemoteFailed] = useState(false);
  const remoteLogo = (organizer.logoUrl ?? "").trim();

  useEffect(() => {
    setRemoteFailed(false);
  }, [remoteLogo]);

  /*
   * SFLuv's own events are drawn from the bundled mark rather than the URL the
   * API sends. That URL points at the web app's favicon, which is fine for an
   * email but is one network hop and one deployment away from being a blank
   * circle in the app — and our own brand is the last thing that should be
   * missing.
   */
  if (organizer.type === "sfluv") {
    return <Image source={SFLUV_MARK} style={[styles.organizerLogoBrand, dimension]} resizeMode="contain" />;
  }

  if (remoteLogo !== "" && !remoteFailed) {
    return (
      <Image
        source={{ uri: remoteLogo }}
        style={[styles.organizerLogo, dimension]}
        resizeMode="cover"
        onError={() => setRemoteFailed(true)}
      />
    );
  }

  /*
   * Everyone else gets the same generated mark a merchant without a logo gets:
   * their initials, bold and black on white. Most organizations will never
   * upload anything, and a row of identical building glyphs tells you nothing
   * about which organization you are looking at.
   */
  const initials = merchantInitials(organizer.name);
  return (
    <View style={[styles.organizerLogoGenerated, dimension]}>
      <Text
        style={{
          color: ICON_TEXT_COLOR,
          fontWeight: "800",
          fontSize: Math.max(8, Math.round(size * (initials.length > 1 ? 0.4 : 0.5))),
          marginTop: Math.round(size * 0.4) * ICON_TEXT_NUDGE_EM,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

/**
 * Branded stand-in for an event with no photo, matching the treatment @WEB
 * landed on: a 135°-ish brand wash with the SFLuv heart mark at half the box
 * height. The gradient is approximated with two offset translucent shapes —
 * a real multi-stop gradient would mean adding a native dependency for one
 * decorative box, and a dev-client rebuild with it.
 */
function EventCoverPlaceholder({ styles, palette }: { styles: StyleSet; palette: Palette }) {
  const [boxHeight, setBoxHeight] = useState(0);
  return (
    <View
      style={[styles.eventCardCover, styles.coverPlaceholder]}
      onLayout={(event) => setBoxHeight(event.nativeEvent.layout.height)}
    >
      <View style={styles.coverPlaceholderWash} />
      <View style={styles.coverPlaceholderMuted} />
      {boxHeight > 0 ? (
        <Ionicons name="heart" size={boxHeight * 0.5} color={palette.primaryStrong} style={styles.coverPlaceholderMark} />
      ) : null}
    </View>
  );
}

function EventCard({
  styles,
  palette,
  event,
  tokenSymbol,
  onPress,
}: {
  styles: StyleSet;
  palette: Palette;
  event: AppVolunteerEvent;
  tokenSymbol: string;
  onPress: () => void;
}) {
  const cover = event.coverPhotos[0];
  const spots = spotsLabel(event);
  const signedUp = event.viewer?.signedUp === true;
  const cancelled = event.status === "cancelled";
  const locationSummary = event.location ? locationLines(event.location)[0] : undefined;

  return (
    <Pressable style={styles.eventCard} onPress={onPress}>
      {/* First photo only on the card; the rest are a carousel on the detail
          screen. A missing photo gets a branded filler at the identical box
          size, so a card without one is never a different height. */}
      {cover ? (
        <Image source={{ uri: cover.url }} style={styles.eventCardCover} resizeMode="cover" />
      ) : (
        <EventCoverPlaceholder styles={styles} palette={palette} />
      )}

      <View style={styles.eventCardBody}>
        <View style={styles.organizerRow}>
          <OrganizerAvatar styles={styles} palette={palette} organizer={event.organizer} size={22} />
          <Text style={styles.organizerName} numberOfLines={1}>
            {event.organizer.name}
          </Text>
          {cancelled ? (
            <View style={styles.cancelledChip}>
              <Ionicons name="close-circle" size={11} color={palette.danger} />
              <Text style={styles.cancelledChipText}>Cancelled</Text>
            </View>
          ) : signedUp ? (
            <View style={styles.goingChip}>
              <Ionicons name="checkmark" size={11} color={palette.success} />
              <Text style={styles.goingChipText}>Going</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.eventTitleBox}>
          <Text style={[styles.eventTitle, cancelled ? styles.eventTitleCancelled : undefined]} numberOfLines={2}>
            {event.title}
          </Text>
        </View>

        {/* Fixed-height block: an event without a location must not make its
            card shorter than the one above it. */}
        <View style={styles.metaBlock}>
          <View style={styles.metaRow}>
            <Ionicons name="calendar-outline" size={13} color={palette.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>
              {formatEventDay(event)}
              {formatEventTimeRange(event) ? ` - ${formatEventTimeRange(event)}` : ""}
            </Text>
          </View>

          {locationSummary ? (
            <View style={styles.metaRow}>
              <Ionicons name="location-outline" size={13} color={palette.textMuted} />
              <Text style={styles.metaText} numberOfLines={1}>
                {locationSummary}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.chipRow}>
          {event.rewardAmountSfluv > 0 ? (
            <View style={styles.rewardChip}>
              <Ionicons name="gift-outline" size={12} color={palette.primaryStrong} />
              <Text style={styles.rewardChipText}>
                {event.rewardAmountSfluv} {tokenSymbol}
              </Text>
            </View>
          ) : null}
          {event.recurrence ? (
            <View style={styles.metaChip}>
              <Ionicons name="repeat" size={12} color={palette.textMuted} />
              <Text style={styles.metaChipText} numberOfLines={1}>
                {event.recurrence.summary}
              </Text>
            </View>
          ) : null}
          {spots ? (
            <View style={styles.metaChip}>
              <Ionicons name="people-outline" size={12} color={palette.textMuted} />
              <Text style={styles.metaChipText}>{spots}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function EventDetail({
  styles,
  palette,
  isDark,
  width,
  event,
  loading,
  error,
  tokenSymbol,
  coverIndex,
  signupBusy,
  onCoverIndexChange,
  onCoverSwiping,
  onBack,
  onExternalSignup,
  onOpenSignupSheet,
  onOpenOrganizer,
  onCancelSignup,
  signupSheetOpen,
  signupOptIn,
  alreadyOnVolunteerList,
  onSignupOptInChange,
  onConfirmSignup,
  onCloseSignupSheet,
}: {
  styles: StyleSet;
  palette: Palette;
  isDark: boolean;
  width: number;
  event: AppVolunteerEvent | null;
  loading: boolean;
  error: string | null;
  tokenSymbol: string;
  coverIndex: number;
  signupBusy: boolean;
  onCoverIndexChange: (index: number) => void;
  /** Tells the pane's back-swipe to stand down while the carousel is in use. */
  onCoverSwiping: (active: boolean) => void;
  onBack: () => void;
  onExternalSignup: (event: AppVolunteerEvent) => void;
  onOpenSignupSheet: () => void;
  onOpenOrganizer: (event: AppVolunteerEvent) => void;
  onCancelSignup: () => void;
  signupSheetOpen: boolean;
  signupOptIn: boolean;
  alreadyOnVolunteerList: boolean;
  onSignupOptInChange: (value: boolean) => void;
  onConfirmSignup: () => void;
  onCloseSignupSheet: () => void;
}) {
  // The carousel now sits inside the detail card, so it has to clear the card's
  // own padding as well as the page gutters or it overflows its container.
  const coverWidth = Math.max(0, width - spacing.lg * 2 - spacing.md * 2);
  const signedUp = event?.viewer?.signedUp === true;
  const closedLabel = event ? signupClosedLabel(event) : null;
  const remainingLabel = event ? remainingSpotsLabel(event) : null;
  const isFull = remainingLabel === "Full";

  return (
    <>
      <View style={styles.detailPage}>
        <View style={styles.detailTitleRow}>
          <Pressable style={styles.backButton} onPress={onBack} hitSlop={10} accessibilityLabel="All events">
            <Ionicons name="chevron-back" size={22} color={palette.primaryStrong} />
          </Pressable>
          {event ? (
            <Text style={styles.detailTitle} numberOfLines={2}>
              {event.title}
            </Text>
          ) : null}
        </View>

        {!event ? (
          <View style={styles.stateCard}>
            {loading ? (
              <>
                <ThemedActivityIndicator size="small" color={palette.primaryStrong} />
                <Text style={styles.stateTitle}>Loading event</Text>
              </>
            ) : (
              <>
                <Ionicons name="alert-circle-outline" size={22} color={palette.danger} />
                <Text style={styles.stateTitle}>Event unavailable</Text>
                <Text style={styles.stateBody}>{error || "This event is no longer available."}</Text>
              </>
            )}
          </View>
        ) : (
          <>
            <View style={[styles.detailCard, styles.detailCardFill]}>
              {event.coverPhotos.length > 0 ? (
                <View
                  onTouchStart={() => onCoverSwiping(true)}
                  onTouchEnd={() => onCoverSwiping(false)}
                  onTouchCancel={() => onCoverSwiping(false)}
                >
                  <ScrollView
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    onMomentumScrollEnd={(scrollEvent) => {
                      const offset = scrollEvent.nativeEvent.contentOffset.x;
                      onCoverIndexChange(coverWidth > 0 ? Math.round(offset / coverWidth) : 0);
                      // Momentum can outlive the finger; only clear once the
                      // carousel has actually come to rest.
                      onCoverSwiping(false);
                    }}
                  >
                    {event.coverPhotos.map((photo, index) => (
                      <Image
                        key={`${photo.url}:${index}`}
                        source={{ uri: photo.url }}
                        style={[styles.detailCover, { width: coverWidth }]}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                  {event.coverPhotos.length > 1 ? (
                    <View style={styles.coverDots}>
                      {event.coverPhotos.map((photo, index) => (
                        <View
                          key={`dot:${photo.url}:${index}`}
                          style={[styles.coverDot, index === coverIndex ? styles.coverDotActive : undefined]}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={[styles.organizerRow, styles.detailOrganizerRow]}>
                {/* Tapping the organizer filters the list to just their events. */}
                <Pressable
                  style={styles.organizerLink}
                  onPress={() => onOpenOrganizer(event)}
                  accessibilityRole="button"
                  accessibilityLabel={`See all events from ${event.organizer.name}`}
                >
                  <OrganizerAvatar styles={styles} palette={palette} organizer={event.organizer} size={34} />
                  <Text style={[styles.organizerNameStrong, styles.detailOrganizerName]} numberOfLines={1}>
                    {event.organizer.name}
                  </Text>
                </Pressable>
                {loading ? <ThemedActivityIndicator size="small" color={palette.primaryStrong} /> : null}
                {event.rewardAmountSfluv > 0 ? (
                  <View style={styles.rewardBubble}>
                    <Text style={styles.rewardBubbleText}>
                      {event.rewardAmountSfluv} {tokenSymbol}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.noRewardBubble}>
                    <Text style={styles.noRewardBubbleText}>No Reward</Text>
                  </View>
                )}
              </View>

              {/* Date and remaining spots share a row, unlabelled — the shapes of
                  the values say what they are without a caption. */}
              <View style={styles.detailFactRow}>
                <View style={styles.detailFactCopy}>
                  <Text style={styles.detailWhen}>{formatEventDay(event)}</Text>
                  {formatEventTimeRange(event) ? (
                    <Text style={styles.detailWhenTime}>{formatEventTimeRange(event)}</Text>
                  ) : null}
                </View>
                {remainingLabel ? (
                  <Text style={[styles.detailSpots, isFull ? styles.detailSpotsFull : undefined]}>
                    {remainingLabel}
                  </Text>
                ) : null}
              </View>

              {event.status === "cancelled" ? (
                <View style={styles.cancelledBanner}>
                  <Ionicons name="close-circle" size={16} color={palette.danger} />
                  <Text style={styles.cancelledBannerText}>
                    This event was cancelled.
                    {signedUp ? " Your sign up is no longer active." : ""}
                  </Text>
                </View>
              ) : null}

              {signedUp && event.status !== "cancelled" ? (
                <View style={styles.signedUpBanner}>
                  <Ionicons name="checkmark-circle" size={16} color={palette.success} />
                  <Text style={styles.signedUpBannerText}>You are signed up for this event.</Text>
                </View>
              ) : null}

              {event.recurrence ? (
                <View style={styles.detailLine}>
                  <Ionicons name="repeat" size={15} color={palette.textMuted} />
                  <Text style={styles.detailLineText}>{event.recurrence.summary}</Text>
                </View>
              ) : null}

              {event.location && locationLines(event.location).length > 0 ? (
                <View style={styles.detailLine}>
                  <Ionicons name="location-outline" size={15} color={palette.textMuted} style={styles.detailLineIcon} />
                  <Text style={styles.detailLineText}>{locationLines(event.location).join("\n")}</Text>
                </View>
              ) : null}

              {event.location && hasCoordinates(event.location) ? (
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const target = event.location;
                    if (target) {
                      void openDirections(target);
                    }
                  }}
                >
                  <Ionicons name="navigate-outline" size={16} color={palette.primaryStrong} />
                  <Text style={styles.secondaryButtonText}>Directions</Text>
                </Pressable>
              ) : null}
              {event.description ? (
                <View style={styles.detailDescriptionBox}>
                  <Text style={styles.detailDescriptionLabel}>Description</Text>
                  <ScrollView
                    style={styles.detailDescriptionScroll}
                    contentContainerStyle={styles.detailDescriptionContent}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                  >
                    <Text style={styles.detailDescription}>{event.description}</Text>
                  </ScrollView>
                </View>
              ) : (
                <View style={styles.detailDescriptionScroll} />
              )}

            </View>

            <View style={styles.signupBar}>
              {event.status === "cancelled" ? (
                <View style={styles.signupClosedCard}>
                  <Ionicons name="close-circle-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.signupNote}>This event was cancelled.</Text>
                </View>
              ) : event.signup.mode === "none" ? (
                <Text style={styles.signupNote}>No sign up needed. Just show up.</Text>
              ) : signedUp ? (
                <Pressable
                  style={[styles.secondaryButton, signupBusy ? styles.buttonDisabled : undefined]}
                  disabled={signupBusy}
                  onPress={onCancelSignup}
                >
                  {signupBusy ? <ThemedActivityIndicator size="small" color={palette.primaryStrong} /> : null}
                  <Text style={styles.secondaryButtonText}>Cancel my spot</Text>
                </Pressable>
              ) : !event.signup.open ? (
                <View style={styles.signupClosedCard}>
                  <Ionicons name="lock-closed-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.signupNote}>{closedLabel || "Sign ups are closed."}</Text>
                </View>
              ) : event.signup.mode === "external" ? (
                <Pressable style={styles.primaryButton} onPress={() => onExternalSignup(event)}>
                  <Text style={styles.primaryButtonText}>Sign up</Text>
                  <Ionicons name="open-outline" size={16} color={palette.white} />
                </Pressable>
              ) : (
                <Pressable style={styles.primaryButton} onPress={onOpenSignupSheet}>
                  <Text style={styles.primaryButtonText}>Sign up</Text>
                  <Ionicons name="arrow-forward" size={16} color={palette.white} />
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>

      <Modal
        visible={signupSheetOpen}
        transparent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={onCloseSignupSheet}
      >
        <Pressable style={styles.modalOverlay} onPress={signupBusy ? undefined : onCloseSignupSheet}>
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Sign up</Text>
              <Pressable style={styles.sheetClose} onPress={onCloseSignupSheet} hitSlop={8} disabled={signupBusy}>
                <Ionicons name="close" size={18} color={palette.primaryStrong} />
              </Pressable>
            </View>

            <Text style={styles.sheetBody}>
              {event ? `You are signing up for "${event.title}".` : "You are signing up for this event."} We will use
              the name and email on your SFLuv account.
            </Text>

            <View style={styles.optInRow}>
              <View style={styles.optInCopy}>
                <Text style={styles.optInLabel}>Email me about other volunteer events</Text>
                <Text style={styles.optInBody}>
                  {alreadyOnVolunteerList
                    ? "You are on the SFLuv volunteer email list. Turn this off to leave it."
                    : "Adds you to the SFLuv volunteer email list. You can opt out any time."}
                </Text>
              </View>
              <Switch
                value={signupOptIn}
                onValueChange={onSignupOptInChange}
                disabled={signupBusy}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={isDark ? palette.surface : palette.white}
              />
            </View>

            <Pressable
              style={[styles.primaryButton, signupBusy ? styles.buttonDisabled : undefined]}
              disabled={signupBusy}
              onPress={onConfirmSignup}
            >
              {signupBusy ? <ThemedActivityIndicator size="small" color={palette.white} /> : null}
              <Text style={styles.primaryButtonText}>{signupBusy ? "Signing up..." : "Confirm sign up"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      gap: spacing.md,
      paddingBottom: 140,
    },
    // Header controls follow the improver panel's conventions so the two panels
    // read as the same app: a card wrapper, filled-primary segments, and the
    // same pill search field.
    filterCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      ...shadows.soft,
    },
    filterHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    segmentLabel: {
      flexShrink: 1,
    },
    segmentRowFill: {
      flex: 1,
    },
    searchToggle: {
      width: 40,
      height: 40,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceStrong,
    },
    searchToggleActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    filterCollapsible: {
      overflow: "hidden",
      justifyContent: "flex-start",
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: palette.text,
      padding: 0,
    },
    filterRow: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    filterCardSpacing: {
      gap: spacing.md,
    },
    filterChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      flexShrink: 1,
    },
    filterChipActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    filterChipText: {
      fontSize: 12,
      fontWeight: "600",
      color: palette.textMuted,
      flexShrink: 1,
    },
    filterChipTextActive: {
      color: palette.primaryStrong,
    },
    stateCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      alignItems: "center",
      gap: spacing.sm,
      ...shadows.soft,
    },
    stateTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: palette.text,
      textAlign: "center",
    },
    stateBody: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      lineHeight: 18,
    },
    retryButton: {
      marginTop: 4,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    retryButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.primaryStrong,
    },
    eventCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      overflow: "hidden",
      ...shadows.soft,
    },
    eventCardCover: {
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: palette.surfaceMuted,
    },
    // Branded filler for events with no photo. Layered translucent shapes stand
    // in for a gradient, which would otherwise mean pulling a library in for
    // one decorative box.
    coverPlaceholder: {
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
      overflow: "hidden",
    },
    // Coral at the top-left falling away to muted at the bottom-right, which is
    // the direction @WEB's 135deg gradient runs.
    coverPlaceholderWash: {
      position: "absolute",
      top: "-70%",
      left: "-30%",
      width: "110%",
      aspectRatio: 1,
      borderRadius: 999,
      backgroundColor: palette.primary,
      opacity: isDark ? 0.28 : 0.42,
    },
    coverPlaceholderMuted: {
      position: "absolute",
      bottom: "-80%",
      right: "-35%",
      width: "115%",
      aspectRatio: 1,
      borderRadius: 999,
      backgroundColor: palette.backgroundMuted,
      opacity: isDark ? 0.5 : 0.75,
    },
    coverPlaceholderMark: {
      opacity: 0.6,
    },
    eventCardBody: {
      padding: spacing.md,
      gap: 2,
    },
    organizerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    organizerLogo: {
      backgroundColor: palette.surfaceMuted,
    },
    // SFLuv's own mark sits on its brand tint; contain rather than cover so the
    // logo is never cropped by the circle.
    organizerLogoBrand: {
      backgroundColor: palette.primarySoft,
    },
    // Matches the generated merchant icon: white face, bold black initials.
    organizerLogoGenerated: {
      backgroundColor: ICON_FACE,
      alignItems: "center",
      justifyContent: "center",
    },
    organizerName: {
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
      color: palette.textMuted,
    },
    organizerNameStrong: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.text,
    },
    goingChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: isDark ? "rgba(78, 195, 140, 0.16)" : "rgba(19, 115, 51, 0.10)",
    },
    goingChipText: {
      fontSize: 10,
      fontWeight: "700",
      color: palette.success,
    },
    // The next three heights are fixed rather than intrinsic so every card in
    // the list is exactly the same size regardless of title length, a missing
    // location, or how many chips an event happens to have.
    eventTitleBox: {
      height: 42,
      justifyContent: "center",
    },
    eventTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: palette.text,
      lineHeight: 21,
    },
    metaBlock: {
      height: 34,
      gap: 2,
      justifyContent: "center",
      overflow: "hidden",
    },
    eventTitleCancelled: {
      textDecorationLine: "line-through",
      color: palette.textMuted,
    },
    cancelledChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: isDark ? "rgba(255, 138, 128, 0.16)" : "rgba(176, 0, 32, 0.08)",
    },
    cancelledChipText: {
      fontSize: 10,
      fontWeight: "700",
      color: palette.danger,
    },
    cancelledBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      borderRadius: radii.sm,
      backgroundColor: isDark ? "rgba(255, 138, 128, 0.14)" : "rgba(176, 0, 32, 0.07)",
    },
    cancelledBannerText: {
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
      color: palette.danger,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    metaText: {
      flex: 1,
      fontSize: 12,
      color: palette.textMuted,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "nowrap",
      alignItems: "center",
      gap: 6,
      marginTop: 4,
      height: 26,
      overflow: "hidden",
    },
    rewardChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    rewardChipText: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.primaryStrong,
    },
    metaChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      flexShrink: 1,
    },
    metaChipText: {
      fontSize: 11,
      fontWeight: "600",
      color: palette.textMuted,
      flexShrink: 1,
    },
    loadMoreButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: palette.primaryStrong,
      borderRadius: radii.pill,
      paddingVertical: 14,
    },
    loadMoreButtonDisabled: {
      opacity: 0.7,
    },
    loadMoreText: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.white,
    },
    // Fixed height rather than an aspect ratio: the page must fit one screen,
    // so the photo takes a known slice and the description flexes around it.
    detailCover: {
      aspectRatio: 4 / 3,
      maxHeight: 260,
      borderRadius: radii.md,
      backgroundColor: palette.surfaceMuted,
    },
    coverDots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 5,
      marginTop: 6,
    },
    coverDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: palette.border,
    },
    coverDotActive: {
      backgroundColor: palette.primaryStrong,
    },
    detailCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: 12,
      ...shadows.soft,
    },
    // The root both panes live in: the list fills it, the detail overlays it.
    screen: {
      flex: 1,
    },
    detailPane: {
      flex: 1,
    },
    // Sits on top of the list and covers it completely: the list stays mounted
    // underneath so the detail's slide reveals it rather than a blank frame.
    detailOverlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: palette.background,
    },
    // The detail page deliberately does not scroll: everything through the sign
    // up button has to be reachable without hunting for it, so the description
    // absorbs the slack and scrolls inside the card instead.
    detailPage: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: 2,
      paddingBottom: 128,
      gap: 10,
    },
    detailDescriptionLabel: {
      fontSize: 11,
      fontWeight: "800",
      color: palette.primaryStrong,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 6,
    },
    detailDescriptionBox: {
      flexShrink: 1,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    detailDescriptionScroll: {
      flexGrow: 0,
      flexShrink: 1,
    },
    detailDescriptionContent: {
      paddingBottom: 2,
    },
    detailTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    backButton: {
      width: 30,
      height: 30,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -6,
    },
    detailTitle: {
      flex: 1,
      fontSize: 20,
      fontWeight: "700",
      color: palette.text,
      lineHeight: 26,
    },
    detailOrganizerName: {
      flex: 1,
    },
    detailOrganizerRow: {
      paddingBottom: 10,
      borderBottomWidth: 1,
      borderBottomColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)",
    },
    detailCardFill: {
      flexShrink: 1,
    },
    organizerLink: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    rewardBubble: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
      backgroundColor: palette.primary,
    },
    rewardBubbleText: {
      fontSize: 12,
      fontWeight: "800",
      color: palette.white,
    },
    noRewardBubble: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radii.pill,
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
    },
    noRewardBubbleText: {
      fontSize: 12,
      fontWeight: "800",
      color: palette.textMuted,
    },
    detailFactRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: spacing.sm,
      paddingVertical: 4,
    },
    detailFactCopy: {
      flex: 1,
      gap: 1,
    },
    detailWhen: {
      fontSize: 15,
      fontWeight: "700",
      color: palette.text,
    },
    detailWhenTime: {
      fontSize: 13,
      color: palette.textMuted,
    },
    detailSpots: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.textMuted,
    },
    detailSpotsFull: {
      color: palette.danger,
    },
    detailLine: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    detailLineIcon: {
      marginTop: 2,
    },
    detailLineText: {
      flex: 1,
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 19,
    },
    signedUpBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      borderRadius: radii.sm,
      backgroundColor: isDark ? "rgba(78, 195, 140, 0.14)" : "rgba(19, 115, 51, 0.08)",
    },
    signedUpBannerText: {
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
      color: palette.success,
    },
    detailDescription: {
      fontSize: 14,
      color: palette.text,
      lineHeight: 21,
    },
    signupBar: {
      gap: spacing.sm,
      marginTop: "auto",
    },
    signupNote: {
      flex: 1,
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
    },
    signupClosedCard: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingVertical: 14,
      paddingHorizontal: spacing.md,
    },
    primaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: palette.primaryStrong,
      borderRadius: radii.pill,
      paddingVertical: 15,
    },
    primaryButtonText: {
      fontSize: 15,
      fontWeight: "700",
      color: palette.white,
    },
    secondaryButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      backgroundColor: palette.primarySoft,
      borderRadius: radii.pill,
      paddingVertical: 13,
    },
    secondaryButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: palette.primaryStrong,
    },
    buttonDisabled: {
      opacity: 0.7,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: palette.overlay,
      alignItems: "center",
      justifyContent: "center",
      padding: spacing.lg,
    },
    sheetCard: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.card,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: palette.text,
    },
    sheetClose: {
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    sheetScroll: {
      maxHeight: 320,
    },
    sheetBody: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 19,
    },
    sheetOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 12,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.sm,
    },
    sheetOptionActive: {
      backgroundColor: palette.primarySoft,
    },
    sheetOptionText: {
      flex: 1,
      fontSize: 14,
      fontWeight: "600",
      color: palette.text,
    },
    sheetEmpty: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: "center",
      paddingVertical: spacing.md,
    },
    optInRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.sm,
      padding: spacing.sm,
    },
    optInCopy: {
      flex: 1,
      gap: 2,
    },
    optInLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.text,
    },
    optInBody: {
      fontSize: 11,
      color: palette.textMuted,
      lineHeight: 16,
    },
  });
}
