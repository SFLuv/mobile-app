import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Image,
  Linking,
  Modal,
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
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";

type Props = {
  backendClient?: AppBackendClient | null;
  tokenSymbol: string;
  hapticsEnabled?: boolean;
  /** Deep link target: opens straight into an event detail when it changes. */
  requestedEventId?: string | null;
  requestedEventNonce?: number;
  /** Sends the user to the reward QR scanner on the receive pane. */
  onOpenRewardScanner?: () => void;
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

function formatQrLiveAt(event: AppVolunteerEvent): string | null {
  const liveAt = parseDate(event.qr.liveAt);
  if (!liveAt) {
    return null;
  }
  return formatLocal(liveAt, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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
  backendClient,
  tokenSymbol,
  hapticsEnabled,
  requestedEventId,
  requestedEventNonce,
  onOpenRewardScanner,
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
  const [openSpotsOnly, setOpenSpotsOnly] = useState(false);
  const [organizerPickerOpen, setOrganizerPickerOpen] = useState(false);

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

  const haptics = useCallback(() => {
    triggerClickHaptic(hapticsEnabled === true);
  }, [hapticsEnabled]);

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const query = useMemo(
    () => ({
      search,
      organizer: organizerFilter === ORGANIZER_FILTER_ALL ? undefined : organizerFilter,
      when: (feed === "past" ? "past" : feed === "mine" ? "all" : "upcoming") as AppVolunteerEventWindow,
      openSignups: openSpotsOnly || undefined,
      count: VOLUNTEER_EVENT_PAGE_SIZE,
    }),
    [feed, openSpotsOnly, organizerFilter, search],
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

  const openEvent = useCallback(
    async (event: AppVolunteerEvent | { id: string }) => {
      const known = "title" in event ? event : events.find((entry) => entry.id === event.id) ?? null;
      // Paint whatever the list already knows immediately, then refine.
      setSelectedEvent(known);
      setCoverIndex(0);
      setDetailError(null);
      if (!backendClient) {
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
    [applyEventUpdate, backendClient, events],
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

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setSelectedEvent(null);
    setDetailError(null);
    setDetailLoading(false);
    setSignupSheetOpen(false);
  }, []);

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

  if (selectedEvent || detailLoading || detailError) {
    return (
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
        onBack={closeDetail}
        onExternalSignup={openExternalSignup}
        onOpenSignupSheet={() => {
          haptics();
          // Show what the account already is, not a hopeful default — a user
          // who is on the list should see the toggle already on.
          setSignupOptIn(volunteerListOptIn ?? true);
          setSignupSheetOpen(true);
        }}
        alreadyOnVolunteerList={volunteerListOptIn === true}
        onCancelSignup={cancelSignup}
        onOpenRewardScanner={onOpenRewardScanner}
        signupSheetOpen={signupSheetOpen}
        signupOptIn={signupOptIn}
        onSignupOptInChange={setSignupOptIn}
        onConfirmSignup={confirmInternalSignup}
        onCloseSignupSheet={() => setSignupSheetOpen(false)}
      />
    );
  }

  return (
    <>
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
        <View style={styles.introCard}>
          <Text style={styles.introTitle}>Volunteer with SFLuv</Text>
          <Text style={styles.introBody}>
            Find events near you, sign up, and earn {tokenSymbol} for showing up.
          </Text>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={palette.textMuted} />
          <TextInput
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

        <View style={styles.segmentRow}>
          {FEED_OPTIONS.map((option) => {
            const active = feed === option.value;
            return (
              <Pressable
                key={option.value}
                style={[styles.segment, active ? styles.segmentActive : undefined]}
                onPress={() => {
                  if (active) {
                    return;
                  }
                  haptics();
                  setFeed(option.value);
                }}
              >
                <Text style={[styles.segmentText, active ? styles.segmentTextActive : undefined]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
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
            style={[styles.filterChip, openSpotsOnly ? styles.filterChipActive : undefined]}
            onPress={() => {
              haptics();
              setOpenSpotsOnly((current) => !current);
            }}
          >
            <Ionicons
              name={openSpotsOnly ? "checkmark-circle" : "ellipse-outline"}
              size={14}
              color={openSpotsOnly ? palette.primaryStrong : palette.textMuted}
            />
            <Text style={[styles.filterChipText, openSpotsOnly ? styles.filterChipTextActive : undefined]}>
              Open spots
            </Text>
          </Pressable>
        </View>

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
              {feed === "mine" ? "No sign ups yet" : search ? "No matching events" : "No events scheduled"}
            </Text>
            <Text style={styles.stateBody}>
              {feed === "mine"
                ? "Events you sign up for will show up here."
                : search
                  ? "Try a different search or clear your filters."
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
    </>
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
  if (organizer.logoUrl) {
    return <Image source={{ uri: organizer.logoUrl }} style={[styles.organizerLogo, dimension]} resizeMode="cover" />;
  }
  return (
    <View style={[styles.organizerLogoFallback, dimension]}>
      <Ionicons name={organizer.type === "sfluv" ? "heart" : "business"} size={size * 0.5} color={palette.primaryStrong} />
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
        <View style={[styles.eventCardCover, styles.coverPlaceholder]}>
          <View style={styles.coverPlaceholderGlow} />
          <Ionicons name="leaf" size={30} color={palette.primaryStrong} />
        </View>
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

        <Text style={[styles.eventTitle, cancelled ? styles.eventTitleCancelled : undefined]} numberOfLines={2}>
          {event.title}
        </Text>

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
          <View style={styles.rewardChip}>
            <Ionicons name="gift-outline" size={12} color={palette.primaryStrong} />
            <Text style={styles.rewardChipText}>
              {event.rewardAmountSfluv} {tokenSymbol}
            </Text>
          </View>
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
  onBack,
  onExternalSignup,
  onOpenSignupSheet,
  onCancelSignup,
  onOpenRewardScanner,
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
  onBack: () => void;
  onExternalSignup: (event: AppVolunteerEvent) => void;
  onOpenSignupSheet: () => void;
  onCancelSignup: () => void;
  onOpenRewardScanner?: () => void;
  signupSheetOpen: boolean;
  signupOptIn: boolean;
  alreadyOnVolunteerList: boolean;
  onSignupOptInChange: (value: boolean) => void;
  onConfirmSignup: () => void;
  onCloseSignupSheet: () => void;
}) {
  const coverWidth = Math.max(0, width - spacing.lg * 2);
  const signedUp = event?.viewer?.signedUp === true;
  const closedLabel = event ? signupClosedLabel(event) : null;
  const qrLiveAt = event ? formatQrLiveAt(event) : null;

  return (
    <>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.backRow} onPress={onBack}>
          <Ionicons name="chevron-back" size={18} color={palette.primaryStrong} />
          <Text style={styles.backText}>All events</Text>
        </Pressable>

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
            {event.coverPhotos.length > 0 ? (
              <View>
                <ScrollView
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(scrollEvent) => {
                    const offset = scrollEvent.nativeEvent.contentOffset.x;
                    onCoverIndexChange(coverWidth > 0 ? Math.round(offset / coverWidth) : 0);
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

            <View style={styles.detailCard}>
              <View style={styles.organizerRow}>
                <OrganizerAvatar styles={styles} palette={palette} organizer={event.organizer} size={34} />
                <View style={styles.organizerCopy}>
                  <Text style={styles.organizerNameStrong} numberOfLines={1}>
                    {event.organizer.name}
                  </Text>
                  <Text style={styles.organizerRole}>
                    {event.organizer.type === "sfluv" ? "SFLuv event" : "Affiliate organization"}
                  </Text>
                </View>
                {loading ? <ThemedActivityIndicator size="small" color={palette.primaryStrong} /> : null}
              </View>

              <Text style={styles.detailTitle}>{event.title}</Text>

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

              <DetailRow
                styles={styles}
                palette={palette}
                icon="calendar-outline"
                label="When"
                value={`${formatEventDay(event)}${
                  formatEventTimeRange(event) ? `\n${formatEventTimeRange(event)}` : ""
                }`}
              />

              {event.recurrence ? (
                <DetailRow
                  styles={styles}
                  palette={palette}
                  icon="repeat"
                  label="Repeats"
                  value={event.recurrence.summary}
                />
              ) : null}

              <DetailRow
                styles={styles}
                palette={palette}
                icon="gift-outline"
                label="Reward"
                value={`${event.rewardAmountSfluv} ${tokenSymbol} for attending`}
              />

              {spotsLabel(event) ? (
                <DetailRow
                  styles={styles}
                  palette={palette}
                  icon="people-outline"
                  label="Spots"
                  value={
                    typeof event.signupCount === "number" && typeof event.maxParticipants === "number"
                      ? `${event.signupCount} of ${event.maxParticipants} signed up`
                      : (spotsLabel(event) as string)
                  }
                />
              ) : null}

              {event.location && locationLines(event.location).length > 0 ? (
                <DetailRow
                  styles={styles}
                  palette={palette}
                  icon="location-outline"
                  label="Where"
                  value={locationLines(event.location).join("\n")}
                />
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
            </View>

            {event.description ? (
              <View style={styles.detailCard}>
                <Text style={styles.sectionLabel}>About this event</Text>
                <Text style={styles.detailDescription}>{event.description}</Text>
              </View>
            ) : null}

            {event.status === "cancelled" ? null : (
            <View style={styles.detailCard}>
              <Text style={styles.sectionLabel}>Reward QR code</Text>
              {event.qr.live ? (
                <>
                  <View style={styles.qrLiveRow}>
                    <View style={styles.qrLiveDot} />
                    <Text style={styles.qrLiveText}>QR codes are live for this event.</Text>
                  </View>
                  <Text style={styles.detailHint}>
                    Scan the organizer's QR code at the event to receive your {tokenSymbol}.
                  </Text>
                  {onOpenRewardScanner ? (
                    <Pressable style={styles.secondaryButton} onPress={onOpenRewardScanner}>
                      <Ionicons name="qr-code-outline" size={16} color={palette.primaryStrong} />
                      <Text style={styles.secondaryButtonText}>Open reward scanner</Text>
                    </Pressable>
                  ) : null}
                </>
              ) : (
                <Text style={styles.detailHint}>
                  {qrLiveAt
                    ? `Reward QR codes go live ${qrLiveAt}, one day before the event starts.`
                    : "Reward QR codes go live one day before the event starts."}
                </Text>
              )}
            </View>
            )}

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
      </ScrollView>

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

function DetailRow({
  styles,
  palette,
  icon,
  label,
  value,
}: {
  styles: StyleSet;
  palette: Palette;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Ionicons name={icon} size={16} color={palette.textMuted} style={styles.detailRowIcon} />
      <View style={styles.detailRowCopy}>
        <Text style={styles.detailRowLabel}>{label}</Text>
        <Text style={styles.detailRowValue}>{value}</Text>
      </View>
    </View>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>, isDark: boolean) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
      paddingBottom: 140,
    },
    introCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: 4,
      ...shadows.soft,
    },
    introTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: palette.text,
    },
    introBody: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 18,
    },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: palette.surface,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
    },
    searchInput: {
      flex: 1,
      fontSize: 14,
      color: palette.text,
      padding: 0,
    },
    segmentRow: {
      flexDirection: "row",
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 3,
      gap: 3,
    },
    segment: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
      borderRadius: radii.pill,
    },
    segmentActive: {
      backgroundColor: palette.surface,
      ...shadows.soft,
    },
    segmentText: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.textMuted,
    },
    segmentTextActive: {
      color: palette.primaryStrong,
    },
    filterRow: {
      flexDirection: "row",
      gap: spacing.sm,
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
    coverPlaceholderGlow: {
      position: "absolute",
      top: "-55%",
      right: "-18%",
      width: "70%",
      aspectRatio: 1,
      borderRadius: 999,
      backgroundColor: palette.primary,
      opacity: isDark ? 0.16 : 0.2,
    },
    eventCardBody: {
      padding: spacing.md,
      gap: 6,
    },
    organizerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    organizerCopy: {
      flex: 1,
      gap: 1,
    },
    organizerLogo: {
      backgroundColor: palette.surfaceMuted,
    },
    organizerLogoFallback: {
      backgroundColor: palette.primarySoft,
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
    organizerRole: {
      fontSize: 11,
      color: palette.textMuted,
    },
    goingChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radii.pill,
      backgroundColor: isDark ? "rgba(87, 200, 150, 0.16)" : "rgba(23, 130, 87, 0.12)",
    },
    goingChipText: {
      fontSize: 10,
      fontWeight: "700",
      color: palette.success,
    },
    // The next three heights are fixed rather than intrinsic so every card in
    // the list is exactly the same size regardless of title length, a missing
    // location, or how many chips an event happens to have.
    eventTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: palette.text,
      lineHeight: 21,
      height: 42,
    },
    metaBlock: {
      height: 38,
      gap: 3,
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
      backgroundColor: isDark ? "rgba(255, 138, 128, 0.16)" : "rgba(207, 77, 67, 0.12)",
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
      backgroundColor: isDark ? "rgba(255, 138, 128, 0.14)" : "rgba(207, 77, 67, 0.10)",
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
    backRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      alignSelf: "flex-start",
      paddingVertical: 4,
      paddingRight: spacing.md,
    },
    backText: {
      fontSize: 14,
      fontWeight: "600",
      color: palette.primaryStrong,
    },
    detailCover: {
      aspectRatio: 16 / 9,
      borderRadius: radii.lg,
      backgroundColor: palette.surfaceMuted,
    },
    coverDots: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 5,
      marginTop: spacing.sm,
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
      gap: spacing.sm,
      ...shadows.soft,
    },
    detailTitle: {
      fontSize: 20,
      fontWeight: "700",
      color: palette.text,
      lineHeight: 26,
    },
    signedUpBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      borderRadius: radii.sm,
      backgroundColor: isDark ? "rgba(87, 200, 150, 0.14)" : "rgba(23, 130, 87, 0.10)",
    },
    signedUpBannerText: {
      flex: 1,
      fontSize: 12,
      fontWeight: "600",
      color: palette.success,
    },
    detailRow: {
      flexDirection: "row",
      gap: spacing.sm,
      alignItems: "flex-start",
    },
    detailRowIcon: {
      marginTop: 2,
    },
    detailRowCopy: {
      flex: 1,
      gap: 1,
    },
    detailRowLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    detailRowValue: {
      fontSize: 13,
      color: palette.text,
      lineHeight: 19,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: palette.textMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    detailDescription: {
      fontSize: 14,
      color: palette.text,
      lineHeight: 21,
    },
    detailHint: {
      fontSize: 12,
      color: palette.textMuted,
      lineHeight: 18,
    },
    qrLiveRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    qrLiveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: palette.success,
    },
    qrLiveText: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.success,
    },
    signupBar: {
      gap: spacing.sm,
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
