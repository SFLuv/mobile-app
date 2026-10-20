import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppBackendClient } from "../services/appBackend";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import {
  Avatar,
  BadgeLine,
  BulletinPhotoView,
  CATEGORY_ICONS,
  Pill,
  ProfileSetupSheet,
  ReportSheet,
  formatAgo,
  formatDistance,
  formatPrice,
} from "../components/BulletinParts";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { triggerClickHaptic } from "../utils/haptics";
import { sortLocationsByProximity } from "../utils/location";
import { AppLocation, AppVolunteerEvent } from "../types/app";
import {
  BULLETIN_CATEGORY_LABELS,
  BulletinCategory,
  BulletinPost,
  BulletinRequestError,
} from "../types/bulletin";

const OPTIONAL_IMAGE_PICKER: any = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("expo-image-picker");
  } catch {
    return null;
  }
})();

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const RADIUS_OPTIONS = [0.5, 1, 2, 5];

type Filter = BulletinCategory | "all" | "mine";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "free", label: "Free" },
  { value: "for_sale", label: "For sale" },
  { value: "notice", label: "Notices" },
  { value: "mine", label: "Your posts" },
];

type View_ = { kind: "feed" } | { kind: "detail"; postId: number } | { kind: "compose" };

type Props = {
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  locations: AppLocation[];
  hapticsEnabled: boolean;
  onMessageAboutPost: (post: BulletinPost) => Promise<void>;
  onOpenEvent: (eventId: string) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
};

type DraftPhoto = { uri: string; mimeType?: string | null; fileName?: string | null };

type Draft = {
  category: BulletinCategory | null;
  title: string;
  body: string;
  price: string;
  acceptsSfluv: boolean;
  acceptsCash: boolean;
  meetup: AppLocation | null;
  event: AppVolunteerEvent | null;
  photos: DraftPhoto[];
};

const emptyDraft = (): Draft => ({
  category: null,
  title: "",
  body: "",
  price: "",
  acceptsSfluv: true,
  acceptsCash: false,
  meetup: null,
  event: null,
  photos: [],
});

export function BulletinScreen({
  backendClient,
  tokenSymbol,
  locations,
  hapticsEnabled,
  onMessageAboutPost,
  onOpenEvent,
  onToast,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { width } = useWindowDimensions();
  const { location, loading: locating, permissionGranted } = useCurrentLocation(true);

  const [view, setView] = useState<View_>({ kind: "feed" });
  const [filter, setFilter] = useState<Filter>("all");
  const [radius, setRadius] = useState(1);
  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileSheet, setProfileSheet] = useState<null | (() => void)>(null);
  const loadId = useRef(0);

  // ── Feed ──────────────────────────────────────────────────────────────────

  const loadFeed = useCallback(
    async (mode: "replace" | "more" | "refresh") => {
      if (!backendClient) return;
      if (filter !== "mine" && !location) return;
      const id = ++loadId.current;
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        if (filter === "mine") {
          const mine = await backendClient.getMyBulletinPosts();
          if (id !== loadId.current) return;
          setPosts(mine);
          setCursor(null);
          return;
        }
        const page = await backendClient.getBulletinFeed({
          lat: location!.lat,
          lng: location!.lng,
          radiusMiles: radius,
          category: filter === "all" ? null : filter,
          cursor: mode === "more" ? cursor : null,
        });
        if (id !== loadId.current) return;
        setPosts((current) => (mode === "more" ? [...current, ...page.posts] : page.posts));
        setCursor(page.next_cursor);
      } catch (e) {
        if (id === loadId.current) {
          setError(e instanceof BulletinRequestError ? e.message : "Couldn't load the Bulletin.");
        }
      } finally {
        if (id === loadId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [backendClient, cursor, filter, location, radius],
  );

  useEffect(() => {
    void loadFeed("replace");
    // Reload when the inputs change, not when loadFeed's identity does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendClient, filter, radius, location?.lat, location?.lng]);

  /** Runs an action that needs a public name, asking for one first if needed. */
  const withProfile = useCallback(
    async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (e) {
        if (e instanceof BulletinRequestError && e.code === "profile_required") {
          setProfileSheet(() => () => {
            void action().catch((err) => onToast(err?.message || "Something went wrong.", "error"));
          });
          return;
        }
        onToast(e instanceof Error ? e.message : "Something went wrong.", "error");
      }
    },
    [onToast],
  );

  // ── Rendering ────────────────────────────────────────────────────────────

  const tileWidth = (width - spacing.md * 2 - spacing.sm) / 2;

  const renderTile = ({ item }: { item: BulletinPost }) => {
    const price = formatPrice(item, tokenSymbol);
    return (
      <Pressable
        style={[styles.tile, { width: tileWidth }]}
        onPress={() => {
          triggerClickHaptic(hapticsEnabled);
          setView({ kind: "detail", postId: item.id });
        }}
        accessibilityRole="button"
        accessibilityLabel={item.title}
      >
        <BulletinPhotoView
          client={backendClient}
          photoId={item.photos[0]?.id}
          fallbackIcon={CATEGORY_ICONS[item.category]}
          style={[styles.tilePhoto, { width: tileWidth, height: tileWidth * 0.78 }]}
        />
        <Text style={styles.tileTitle} numberOfLines={2}>
          {item.title}
        </Text>
        {item.category === "notice" ? (
          <View style={styles.tilePillRow}>
            <Pill label={item.linked_event ? "Event" : "Notice"} />
          </View>
        ) : (
          <Text style={[styles.tilePrice, item.category === "free" && { color: palette.success }]}>{price}</Text>
        )}
        <Text style={styles.tileMeta} numberOfLines={1}>
          {[filter === "mine" ? statusLabel(item) : formatDistance(item.distance_miles), formatAgo(item.created_at)]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {item.author.badges.includes("merchant") && filter !== "mine" ? (
          <View style={styles.tilePillRow}>
            <Pill label="Merchant" tone="primary" />
          </View>
        ) : null}
      </Pressable>
    );
  };

  const header = (
    <View>
      <View style={styles.headerRow}>
        <Pressable
          style={styles.radiusButton}
          onPress={() => {
            const next = RADIUS_OPTIONS[(RADIUS_OPTIONS.indexOf(radius) + 1) % RADIUS_OPTIONS.length];
            setRadius(next);
          }}
          accessibilityLabel={`Showing posts within ${radius} miles. Tap to change.`}
          disabled={filter === "mine"}
        >
          <Ionicons name="location-outline" size={16} color={palette.textMuted} />
          <Text style={styles.radiusText}>{filter === "mine" ? "Your posts" : `Within ${radius} mi`}</Text>
          {filter !== "mine" ? <Ionicons name="chevron-down" size={14} color={palette.textMuted} /> : null}
        </Pressable>
        <Pressable
          style={styles.newPostButton}
          onPress={() => {
            triggerClickHaptic(hapticsEnabled);
            setView({ kind: "compose" });
          }}
          accessibilityRole="button"
          accessibilityLabel="New post"
        >
          <Ionicons name="add" size={18} color={palette.white} />
          <Text style={styles.newPostText}>Post</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.chip, filter === f.value && styles.chipActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.chipText, filter === f.value && styles.chipTextActive]}>{f.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );

  const feedEmpty = () => {
    if (loading || locating) {
      return (
        <View style={styles.centerState}>
          <ThemedActivityIndicator />
        </View>
      );
    }
    if (filter !== "mine" && !location) {
      return (
        <View style={styles.centerState}>
          <Ionicons name="location-outline" size={32} color={palette.textMuted} />
          <Text style={styles.emptyTitle}>{permissionGranted ? "Finding your location..." : "Location is off"}</Text>
          <Text style={styles.emptyBody}>
            The Bulletin shows posts near you. Turn on location for SFLuv in Settings to see them.
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.centerState}>
        <Ionicons name="newspaper-outline" size={32} color={palette.textMuted} />
        <Text style={styles.emptyTitle}>{filter === "mine" ? "You haven't posted yet" : "Nothing nearby yet"}</Text>
        <Text style={styles.emptyBody}>Give something away, sell something, or share a neighborhood notice.</Text>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <FlatList
        data={posts}
        keyExtractor={(item) => String(item.id)}
        numColumns={2}
        columnWrapperStyle={styles.columns}
        renderItem={renderTile}
        ListHeaderComponent={header}
        ListEmptyComponent={feedEmpty}
        contentContainerStyle={styles.feedContent}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (cursor && !loading) void loadFeed("more");
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadFeed("refresh")} tintColor={palette.primary} />}
      />

      <PostDetailModal
        postId={view.kind === "detail" ? view.postId : null}
        backendClient={backendClient}
        tokenSymbol={tokenSymbol}
        near={location}
        onClose={() => setView({ kind: "feed" })}
        onChanged={() => void loadFeed("replace")}
        onMessage={(post) =>
          withProfile(async () => {
            await onMessageAboutPost(post);
            setView({ kind: "feed" });
          })
        }
        onOpenEvent={onOpenEvent}
        onToast={onToast}
      />

      <ComposeModal
        visible={view.kind === "compose"}
        backendClient={backendClient}
        tokenSymbol={tokenSymbol}
        location={location}
        locations={locations}
        hapticsEnabled={hapticsEnabled}
        onClose={() => setView({ kind: "feed" })}
        onPosted={(post) => {
          setView({ kind: "detail", postId: post.id });
          void loadFeed("replace");
          onToast("Posted", "success");
        }}
        withProfile={withProfile}
        onToast={onToast}
      />

      <ProfileSetupSheet
        visible={Boolean(profileSheet)}
        client={backendClient}
        onClose={() => setProfileSheet(null)}
        onSaved={() => {
          const retry = profileSheet;
          setProfileSheet(null);
          retry?.();
        }}
      />
    </View>
  );
}

function statusLabel(post: BulletinPost): string {
  switch (post.status) {
    case "sold":
      return "Sold";
    case "claimed":
      return "Claimed";
    case "hidden":
      return "Under review";
    default:
      return new Date(post.expires_at).getTime() < Date.now() ? "Expired" : "Active";
  }
}

// ── Post detail ──────────────────────────────────────────────────────────────

function PostDetailModal({
  postId,
  backendClient,
  tokenSymbol,
  near,
  onClose,
  onChanged,
  onMessage,
  onOpenEvent,
  onToast,
}: {
  postId: number | null;
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  near: { lat: number; lng: number } | null;
  onClose: () => void;
  onChanged: () => void;
  onMessage: (post: BulletinPost) => Promise<void>;
  onOpenEvent: (eventId: string) => void;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { width } = useWindowDimensions();
  const [post, setPost] = useState<BulletinPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ type: "post" | "user"; id: string; label: string } | null>(null);

  useEffect(() => {
    if (!postId || !backendClient) {
      setPost(null);
      return;
    }
    setLoading(true);
    void backendClient
      .getBulletinPost(postId, near)
      .then(setPost)
      .catch((e) => {
        onToast(e instanceof BulletinRequestError ? e.message : "Couldn't load this post.", "error");
        onClose();
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, backendClient]);

  const act = async (fn: () => Promise<BulletinPost | void>, success: string) => {
    setBusy(true);
    try {
      const next = await fn();
      if (next) setPost(next);
      onToast(success, "success");
      onChanged();
    } catch (e) {
      onToast(e instanceof BulletinRequestError ? e.message : "Something went wrong.", "error");
    } finally {
      setBusy(false);
    }
  };

  const openMenu = () => {
    if (!post || !backendClient) return;
    if (post.is_mine) {
      Alert.alert("Your post", undefined, [
        {
          text: "Delete post",
          style: "destructive",
          onPress: () =>
            void act(async () => {
              await backendClient.deleteBulletinPost(post.id);
              onClose();
            }, "Post deleted"),
        },
        { text: "Cancel", style: "cancel" },
      ]);
      return;
    }
    Alert.alert(post.author.public_name, undefined, [
      { text: "Report post", onPress: () => setReport({ type: "post", id: String(post.id), label: "this post" }) },
      { text: `Report ${post.author.public_name}`, onPress: () => setReport({ type: "user", id: post.author.user_id, label: post.author.public_name }) },
      {
        text: `Block ${post.author.public_name}`,
        style: "destructive",
        onPress: () =>
          void act(async () => {
            await backendClient.blockUser(post.author.user_id);
            onClose();
          }, "Blocked. You won't see their posts or messages."),
      },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const price = post ? formatPrice(post, tokenSymbol) : "";
  const expired = post ? new Date(post.expires_at).getTime() < Date.now() : false;

  return (
    <Modal visible={postId !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modalScreen}>
        <View style={styles.modalHeader}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back">
            <Ionicons name="chevron-down" size={24} color={palette.text} />
          </Pressable>
          {post ? (
            <Pressable onPress={openMenu} hitSlop={10} accessibilityLabel="More options">
              <Ionicons name="ellipsis-horizontal" size={22} color={palette.text} />
            </Pressable>
          ) : null}
        </View>
        {loading || !post ? (
          <View style={styles.centerState}>
            <ThemedActivityIndicator />
          </View>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.detailContent}>
              {post.photos.length > 0 ? (
                <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.detailPhotos}>
                  {post.photos.map((photo) => (
                    <BulletinPhotoView
                      key={photo.id}
                      client={backendClient}
                      photoId={photo.id}
                      style={{ width: width - spacing.md * 2, height: (width - spacing.md * 2) * 0.75, borderRadius: radii.md }}
                    />
                  ))}
                </ScrollView>
              ) : null}
              <View style={styles.detailCategoryRow}>
                <Ionicons name={CATEGORY_ICONS[post.category]} size={14} color={palette.textMuted} />
                <Text style={styles.detailCategory}>{BULLETIN_CATEGORY_LABELS[post.category]}</Text>
                {post.status === "hidden" ? <Pill label="Under review" tone="warning" /> : null}
                {post.status === "sold" ? <Pill label="Sold" /> : null}
                {post.status === "claimed" ? <Pill label="Claimed" /> : null}
                {expired && post.status === "active" ? <Pill label="Expired" /> : null}
              </View>
              <Text style={styles.detailTitle}>{post.title}</Text>
              {price ? <Text style={[styles.detailPrice, post.category === "free" && { color: palette.success }]}>{price}</Text> : null}
              {post.category === "for_sale" ? (
                <View style={styles.pillRow}>
                  {post.accepts_sfluv ? <Pill label={`${tokenSymbol} accepted`} tone="primary" /> : null}
                  {post.accepts_cash ? <Pill label="Cash OK" /> : null}
                </View>
              ) : null}
              {post.body ? <Text style={styles.detailBody}>{post.body}</Text> : null}

              {post.linked_event ? (
                <Pressable style={styles.eventCard} onPress={() => onOpenEvent(post.linked_event!.id)}>
                  <View style={styles.eventIcon}>
                    <Ionicons name="calendar-outline" size={20} color={palette.primaryStrong} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>{post.linked_event.title}</Text>
                    <Text style={styles.eventMeta}>{formatEventTime(post.linked_event.start_at)} · Open in Participate</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                </Pressable>
              ) : null}

              <View style={styles.sellerRow}>
                <Avatar name={post.author.public_name} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sellerName}>{post.author.public_name}</Text>
                  <BadgeLine user={post.author} />
                </View>
              </View>
              <View style={styles.metaLine}>
                <Ionicons name="location-outline" size={14} color={palette.textMuted} />
                <Text style={styles.metaText}>
                  {[post.distance_miles != null ? `About ${formatDistance(post.distance_miles)} away` : "", post.area_label]
                    .filter(Boolean)
                    .join(" · ") || "Location hidden"}
                </Text>
              </View>
              {post.meetup_location ? (
                <View style={styles.hintCard}>
                  <Ionicons name="storefront-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.hintText}>Meet at {post.meetup_location.name}</Text>
                </View>
              ) : post.category !== "notice" && !post.is_mine ? (
                <View style={styles.hintCard}>
                  <Ionicons name="shield-checkmark-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.hintText}>Meet somewhere public, like an SFLuv partner merchant.</Text>
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.detailFooter}>
              {post.is_mine ? (
                <View style={styles.ownerActions}>
                  {post.category !== "notice" && post.status === "active" ? (
                    <Pressable
                      style={[styles.secondaryButton, busy && { opacity: 0.6 }]}
                      disabled={busy}
                      onPress={() =>
                        void act(
                          () => backendClient!.updateBulletinPost(post.id, { status: post.category === "free" ? "claimed" : "sold" }),
                          post.category === "free" ? "Marked claimed" : "Marked sold",
                        )
                      }
                    >
                      <Text style={styles.secondaryButtonText}>{post.category === "free" ? "Mark claimed" : "Mark sold"}</Text>
                    </Pressable>
                  ) : null}
                  {!post.linked_event && (expired || post.status === "sold" || post.status === "claimed") ? (
                    <Pressable
                      style={[styles.secondaryButton, busy && { opacity: 0.6 }]}
                      disabled={busy}
                      onPress={() => void act(() => backendClient!.updateBulletinPost(post.id, { renew: true }), "Renewed for 30 days")}
                    >
                      <Text style={styles.secondaryButtonText}>Renew</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : post.category === "notice" && post.linked_event ? (
                <Pressable style={styles.primaryButton} onPress={() => onOpenEvent(post.linked_event!.id)}>
                  <Text style={styles.primaryButtonText}>See the event</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[styles.primaryButton, busy && { opacity: 0.6 }]}
                  disabled={busy || post.status !== "active"}
                  onPress={() => {
                    setBusy(true);
                    void onMessage(post).finally(() => setBusy(false));
                  }}
                >
                  <Text style={styles.primaryButtonText}>{post.status === "active" ? "Message" : "No longer available"}</Text>
                </Pressable>
              )}
            </View>
          </>
        )}
        <ReportSheet
          target={report}
          client={backendClient}
          onClose={() => setReport(null)}
          onReported={() => {
            setReport(null);
            onToast("Thanks. We'll take a look.", "success");
            onChanged();
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

function formatEventTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Compose (three steps) ─────────────────────────────────────────────────────

function ComposeModal({
  visible,
  backendClient,
  tokenSymbol,
  location,
  locations,
  hapticsEnabled,
  onClose,
  onPosted,
  withProfile,
  onToast,
}: {
  visible: boolean;
  backendClient: AppBackendClient | null;
  tokenSymbol: string;
  location: { lat: number; lng: number } | null;
  locations: AppLocation[];
  hapticsEnabled: boolean;
  onClose: () => void;
  onPosted: (post: BulletinPost) => void;
  withProfile: (action: () => Promise<void>) => Promise<void>;
  onToast: (message: string, tone?: "info" | "success" | "error") => void;
}) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [picker, setPicker] = useState<null | "meetup" | "event">(null);
  const [events, setEvents] = useState<AppVolunteerEvent[] | null>(null);

  useEffect(() => {
    if (visible) {
      setStep(1);
      setDraft(emptyDraft());
      setError(null);
    }
  }, [visible]);

  useEffect(() => {
    if (picker !== "event" || events || !backendClient) return;
    void backendClient
      .getVolunteerEvents({ when: "upcoming", count: 30 })
      .then((page) => setEvents(page.events))
      .catch(() => setEvents([]));
  }, [backendClient, events, picker]);

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const pickPhotos = async () => {
    if (!OPTIONAL_IMAGE_PICKER?.launchImageLibraryAsync) {
      setError("Photo uploads aren't available on this build.");
      return;
    }
    const remaining = MAX_PHOTOS - draft.photos.length;
    if (remaining <= 0) return;
    try {
      const result = await OPTIONAL_IMAGE_PICKER.launchImageLibraryAsync({
        mediaTypes: OPTIONAL_IMAGE_PICKER.MediaTypeOptions?.Images ?? OPTIONAL_IMAGE_PICKER.MediaType?.images ?? ["images"],
        allowsMultipleSelection: remaining > 1,
        selectionLimit: remaining,
        quality: 0.45,
      });
      if (result?.canceled) return;
      const assets: any[] = Array.isArray(result?.assets) ? result.assets : [];
      const tooBig = assets.some((a) => typeof a?.fileSize === "number" && a.fileSize > MAX_PHOTO_BYTES);
      const ok = assets
        .filter((a) => typeof a?.uri === "string" && !(typeof a?.fileSize === "number" && a.fileSize > MAX_PHOTO_BYTES))
        .map((a) => ({ uri: a.uri, mimeType: a.mimeType, fileName: a.fileName }));
      update({ photos: [...draft.photos, ...ok].slice(0, MAX_PHOTOS) });
      setError(tooBig ? "One photo was too large and was skipped." : null);
    } catch {
      setError("Couldn't open your photos.");
    }
  };

  const validateStep2 = (): string | null => {
    const title = draft.title.trim();
    if (title.length < 3) return "Add a title (at least 3 characters).";
    if (draft.category === "for_sale") {
      const price = Number(draft.price);
      if (!draft.price.trim() || !Number.isFinite(price) || price <= 0) return "Add a price.";
      if (!/^\d+(\.\d{1,2})?$/.test(draft.price.trim())) return "Prices can have at most two decimal places.";
      if (!draft.acceptsSfluv && !draft.acceptsCash) return `Choose ${tokenSymbol}, cash, or both.`;
    }
    return null;
  };

  const submit = () =>
    withProfile(async () => {
      if (!backendClient || !draft.category) return;
      if (!location) {
        setError("Your location is needed to post. Turn on location for SFLuv.");
        return;
      }
      setPosting(true);
      setError(null);
      try {
        const created = await backendClient.createBulletinPost({
          category: draft.category,
          title: draft.title.trim(),
          body: draft.body.trim(),
          price_sfluv: draft.category === "for_sale" ? draft.price.trim() : null,
          accepts_sfluv: draft.category === "for_sale" && draft.acceptsSfluv,
          accepts_cash: draft.category === "for_sale" && draft.acceptsCash,
          lat: location.lat,
          lng: location.lng,
          meetup_location_id: draft.category !== "notice" ? draft.meetup?.id ?? null : null,
          linked_event_id: draft.category === "notice" ? draft.event?.id ?? null : null,
        });
        let failed = 0;
        for (const photo of draft.photos) {
          try {
            await backendClient.uploadBulletinPhoto(created.id, photo);
          } catch {
            failed += 1;
          }
        }
        if (failed > 0) {
          onToast(`${failed} photo${failed === 1 ? "" : "s"} didn't upload. You can try again from your post.`, "error");
        }
        triggerClickHaptic(hapticsEnabled, "medium");
        onPosted(created);
      } catch (e) {
        if (e instanceof BulletinRequestError && e.code === "profile_required") throw e;
        setError(e instanceof BulletinRequestError ? e.message : "Couldn't post. Try again.");
      } finally {
        setPosting(false);
      }
    });

  const nearbyMerchants = useMemo(() => sortLocationsByProximity(locations, location).slice(0, 25), [locations, location]);

  const categories: Array<{ value: BulletinCategory; title: string; hint: string }> = [
    { value: "free", title: "Free", hint: "Give something away" },
    { value: "for_sale", title: "For sale", hint: `Sell for ${tokenSymbol} or cash` },
    { value: "notice", title: "Neighborhood notice", hint: "News, invites, and heads-ups" },
  ];

  const headerTitle = step === 1 ? "New post" : step === 2 ? BULLETIN_CATEGORY_LABELS[draft.category!] : "Preview";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Pressable
              onPress={() => (step === 1 ? onClose() : setStep((step - 1) as 1 | 2))}
              hitSlop={10}
              accessibilityLabel={step === 1 ? "Cancel" : "Back"}
            >
              <Ionicons name={step === 1 ? "close" : "arrow-back"} size={22} color={palette.text} />
            </Pressable>
            <Text style={styles.modalTitle}>{headerTitle}</Text>
            <Text style={styles.stepText}>{step} of 3</Text>
          </View>

          <ScrollView contentContainerStyle={styles.composeContent} keyboardShouldPersistTaps="handled">
            {step === 1 ? (
              <>
                <Text style={styles.composeLead}>What are you posting?</Text>
                {categories.map((c) => (
                  <Pressable
                    key={c.value}
                    style={[styles.categoryOption, draft.category === c.value && styles.categoryOptionActive]}
                    onPress={() => {
                      triggerClickHaptic(hapticsEnabled);
                      update({ category: c.value });
                      setStep(2);
                    }}
                  >
                    <Ionicons name={CATEGORY_ICONS[c.value]} size={22} color={palette.textMuted} />
                    <View>
                      <Text style={styles.categoryTitle}>{c.title}</Text>
                      <Text style={styles.categoryHint}>{c.hint}</Text>
                    </View>
                  </Pressable>
                ))}
                <Text style={styles.rulesText}>
                  Not allowed: weapons, drugs, alcohol, animals for sale, housing, jobs, or paid services. Volunteer events
                  are welcome as notices; link them so neighbors can sign up in Participate.
                </Text>
              </>
            ) : null}

            {step === 2 && draft.category ? (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                  {draft.photos.map((photo, index) => (
                    <View key={photo.uri + index}>
                      <Image source={{ uri: photo.uri }} style={styles.photoThumb} />
                      <Pressable
                        style={styles.photoRemove}
                        onPress={() => update({ photos: draft.photos.filter((_, i) => i !== index) })}
                        accessibilityLabel="Remove photo"
                      >
                        <Ionicons name="close" size={14} color={palette.white} />
                      </Pressable>
                    </View>
                  ))}
                  {draft.photos.length < MAX_PHOTOS ? (
                    <Pressable style={styles.photoAdd} onPress={() => void pickPhotos()} accessibilityLabel="Add photos">
                      <Ionicons name="camera-outline" size={22} color={palette.textMuted} />
                      <Text style={styles.photoAddText}>Add</Text>
                    </Pressable>
                  ) : null}
                </ScrollView>

                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  style={styles.input}
                  value={draft.title}
                  onChangeText={(title) => update({ title })}
                  maxLength={80}
                  placeholder={draft.category === "notice" ? "Going to the cleanup today, come with?" : "Commuter bike, 7-speed"}
                  placeholderTextColor={palette.textMuted}
                />
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={draft.body}
                  onChangeText={(body) => update({ body })}
                  maxLength={2000}
                  multiline
                  placeholder="Add details neighbors would want to know"
                  placeholderTextColor={palette.textMuted}
                />

                {draft.category === "for_sale" ? (
                  <>
                    <Text style={styles.fieldLabel}>Price ({tokenSymbol})</Text>
                    <TextInput
                      style={styles.input}
                      value={draft.price}
                      onChangeText={(price) => update({ price: price.replace(/[^0-9.]/g, "") })}
                      keyboardType="decimal-pad"
                      placeholder="40"
                      placeholderTextColor={palette.textMuted}
                    />
                    <Text style={styles.fieldLabel}>Accept</Text>
                    <Pressable style={styles.checkRow} onPress={() => update({ acceptsSfluv: !draft.acceptsSfluv })}>
                      <Ionicons name={draft.acceptsSfluv ? "checkbox" : "square-outline"} size={20} color={palette.primary} />
                      <Text style={styles.checkText}>{tokenSymbol}</Text>
                    </Pressable>
                    <Pressable style={styles.checkRow} onPress={() => update({ acceptsCash: !draft.acceptsCash })}>
                      <Ionicons name={draft.acceptsCash ? "checkbox" : "square-outline"} size={20} color={palette.primary} />
                      <Text style={styles.checkText}>Cash OK</Text>
                    </Pressable>
                  </>
                ) : null}

                {draft.category !== "notice" ? (
                  <>
                    <Text style={styles.fieldLabel}>Meetup spot (optional)</Text>
                    <Pressable style={styles.pickerRow} onPress={() => setPicker("meetup")}>
                      <Ionicons name="storefront-outline" size={18} color={palette.textMuted} />
                      <Text style={[styles.pickerText, !draft.meetup && { color: palette.textMuted }]}>
                        {draft.meetup ? draft.meetup.name : "Suggest a partner merchant"}
                      </Text>
                      {draft.meetup ? (
                        <Pressable onPress={() => update({ meetup: null })} hitSlop={8} accessibilityLabel="Clear meetup spot">
                          <Ionicons name="close-circle" size={18} color={palette.textMuted} />
                        </Pressable>
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                      )}
                    </Pressable>
                  </>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Link a volunteer event (optional)</Text>
                    <Pressable style={styles.pickerRow} onPress={() => setPicker("event")}>
                      <Ionicons name="calendar-outline" size={18} color={palette.textMuted} />
                      <Text style={[styles.pickerText, !draft.event && { color: palette.textMuted }]}>
                        {draft.event ? draft.event.title : "Choose from Participate"}
                      </Text>
                      {draft.event ? (
                        <Pressable onPress={() => update({ event: null })} hitSlop={8} accessibilityLabel="Remove event">
                          <Ionicons name="close-circle" size={18} color={palette.textMuted} />
                        </Pressable>
                      ) : (
                        <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                      )}
                    </Pressable>
                    <Text style={styles.fieldHint}>Neighbors can open it in Participate and sign up there. The notice ends when the event does.</Text>
                  </>
                )}
              </>
            ) : null}

            {step === 3 && draft.category ? (
              <>
                {draft.photos[0] ? (
                  <Image source={{ uri: draft.photos[0].uri }} style={styles.previewPhoto} />
                ) : (
                  <View style={[styles.previewPhoto, styles.previewPhotoEmpty]}>
                    <Ionicons name={CATEGORY_ICONS[draft.category]} size={30} color={palette.textMuted} />
                  </View>
                )}
                <Text style={styles.detailTitle}>{draft.title.trim()}</Text>
                {draft.category === "for_sale" ? (
                  <>
                    <Text style={styles.detailPrice}>
                      {draft.price} {tokenSymbol}
                    </Text>
                    <View style={styles.pillRow}>
                      {draft.acceptsSfluv ? <Pill label={`${tokenSymbol} accepted`} tone="primary" /> : null}
                      {draft.acceptsCash ? <Pill label="Cash OK" /> : null}
                    </View>
                  </>
                ) : draft.category === "free" ? (
                  <Text style={[styles.detailPrice, { color: palette.success }]}>Free</Text>
                ) : null}
                {draft.body.trim() ? <Text style={styles.detailBody}>{draft.body.trim()}</Text> : null}
                {draft.event ? <Text style={styles.fieldHint}>Linked event: {draft.event.title}</Text> : null}
                {draft.meetup ? <Text style={styles.fieldHint}>Meet at {draft.meetup.name}</Text> : null}
                <View style={styles.hintCard}>
                  <Ionicons name="location-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.hintText}>Neighbors see roughly how far away you are and your neighborhood, never your exact location.</Text>
                </View>
                <View style={styles.hintCard}>
                  <Ionicons name="time-outline" size={16} color={palette.textMuted} />
                  <Text style={styles.hintText}>
                    {draft.event ? "Comes down when the event ends." : "Stays up for 30 days. You can renew it or mark it done anytime."}
                  </Text>
                </View>
              </>
            ) : null}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </ScrollView>

          {step > 1 ? (
            <View style={styles.detailFooter}>
              <Pressable
                style={[styles.primaryButton, posting && { opacity: 0.6 }]}
                disabled={posting}
                onPress={() => {
                  if (step === 2) {
                    const problem = validateStep2();
                    if (problem) {
                      setError(problem);
                      return;
                    }
                    setError(null);
                    setStep(3);
                    return;
                  }
                  void submit();
                }}
              >
                <Text style={styles.primaryButtonText}>{step === 2 ? "Next" : posting ? "Posting..." : "Post"}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <Modal visible={picker !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPicker(null)}>
          <View style={styles.modalScreen}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setPicker(null)} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={palette.text} />
              </Pressable>
              <Text style={styles.modalTitle}>{picker === "meetup" ? "Meetup spot" : "Volunteer events"}</Text>
              <View style={{ width: 22 }} />
            </View>
            {picker === "meetup" ? (
              <FlatList
                data={nearbyMerchants}
                keyExtractor={(m) => String(m.id)}
                contentContainerStyle={{ padding: spacing.md }}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.listRow}
                    onPress={() => {
                      update({ meetup: item });
                      setPicker(null);
                    }}
                  >
                    <Text style={styles.listRowTitle}>{item.name}</Text>
                    <Text style={styles.listRowMeta}>{item.street}</Text>
                  </Pressable>
                )}
              />
            ) : events === null ? (
              <View style={styles.centerState}>
                <ThemedActivityIndicator />
              </View>
            ) : (
              <FlatList
                data={events}
                keyExtractor={(e) => e.id}
                contentContainerStyle={{ padding: spacing.md }}
                ListEmptyComponent={<Text style={styles.emptyBody}>No upcoming events right now.</Text>}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.listRow}
                    onPress={() => {
                      update({ event: item });
                      setPicker(null);
                    }}
                  >
                    <Text style={styles.listRowTitle}>{item.title}</Text>
                    <Text style={styles.listRowMeta}>{new Date(item.startAt).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
                  </Pressable>
                )}
              />
            )}
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(palette: Palette) {
  const shadows = getShadows(palette);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: palette.background },
    feedContent: { paddingHorizontal: spacing.md, paddingBottom: 120 },
    columns: { gap: spacing.sm, marginBottom: spacing.md },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: spacing.sm },
    radiusButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
    radiusText: { color: palette.textMuted, fontSize: 14 },
    newPostButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      backgroundColor: palette.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radii.pill,
    },
    newPostText: { color: palette.white, fontWeight: "700", fontSize: 14 },
    chips: { gap: 8, paddingVertical: spacing.sm },
    chip: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.pill,
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: palette.surface,
    },
    chipActive: { backgroundColor: palette.primaryMuted, borderColor: palette.primary },
    chipText: { color: palette.textMuted, fontSize: 13 },
    chipTextActive: { color: palette.primaryStrong, fontWeight: "600" },
    tile: { backgroundColor: palette.surface, borderRadius: radii.md, overflow: "hidden", paddingBottom: spacing.sm, ...shadows.soft },
    tilePhoto: { borderTopLeftRadius: radii.md, borderTopRightRadius: radii.md },
    tileTitle: { fontSize: 14, color: palette.text, marginTop: 6, paddingHorizontal: spacing.sm },
    tilePrice: { fontSize: 14, fontWeight: "700", color: palette.text, paddingHorizontal: spacing.sm, marginTop: 2 },
    tileMeta: { fontSize: 12, color: palette.textMuted, paddingHorizontal: spacing.sm, marginTop: 2 },
    tilePillRow: { flexDirection: "row", paddingHorizontal: spacing.sm, marginTop: 4 },
    centerState: { alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: 8, flexGrow: 1 },
    emptyTitle: { fontSize: 16, fontWeight: "600", color: palette.text, textAlign: "center" },
    emptyBody: { fontSize: 14, color: palette.textMuted, textAlign: "center", lineHeight: 20 },
    errorText: { color: palette.danger, fontSize: 13, marginVertical: spacing.sm },
    modalScreen: { flex: 1, backgroundColor: palette.background },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.md,
      paddingTop: spacing.lg,
      paddingBottom: spacing.sm,
    },
    modalTitle: { fontSize: 16, fontWeight: "700", color: palette.text },
    stepText: { fontSize: 12, color: palette.textMuted },
    detailContent: { padding: spacing.md, paddingBottom: 120 },
    detailPhotos: { marginBottom: spacing.md },
    detailCategoryRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
    detailCategory: { color: palette.textMuted, fontSize: 13 },
    detailTitle: { fontSize: 20, fontWeight: "700", color: palette.text },
    detailPrice: { fontSize: 18, color: palette.text, marginTop: 4 },
    pillRow: { flexDirection: "row", gap: 6, marginTop: spacing.sm },
    detailBody: { fontSize: 15, color: palette.text, lineHeight: 22, marginTop: spacing.md },
    eventCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: 12,
      marginTop: spacing.md,
      backgroundColor: palette.surface,
    },
    eventIcon: { width: 40, height: 40, borderRadius: radii.sm, backgroundColor: palette.primaryMuted, alignItems: "center", justifyContent: "center" },
    eventTitle: { fontSize: 14, fontWeight: "600", color: palette.text },
    eventMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
    sellerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: spacing.lg,
      paddingTop: spacing.md,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    sellerName: { fontSize: 15, fontWeight: "600", color: palette.text },
    metaLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
    metaText: { fontSize: 13, color: palette.textMuted },
    hintCard: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.sm,
      padding: 10,
      marginTop: spacing.sm,
    },
    hintText: { flex: 1, fontSize: 13, color: palette.textMuted, lineHeight: 18 },
    detailFooter: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: spacing.md,
      paddingBottom: spacing.xl,
      backgroundColor: palette.background,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    ownerActions: { flexDirection: "row", gap: spacing.sm },
    primaryButton: { backgroundColor: palette.primary, borderRadius: radii.pill, paddingVertical: 13, alignItems: "center" },
    primaryButtonText: { color: palette.white, fontWeight: "700", fontSize: 15 },
    secondaryButton: {
      flex: 1,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      borderRadius: radii.pill,
      paddingVertical: 12,
      alignItems: "center",
    },
    secondaryButtonText: { color: palette.text, fontWeight: "600", fontSize: 15 },
    composeContent: { padding: spacing.md, paddingBottom: 140 },
    composeLead: { fontSize: 15, color: palette.textMuted, marginBottom: spacing.md },
    categoryOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: 14,
      marginBottom: spacing.sm,
      backgroundColor: palette.surface,
    },
    categoryOptionActive: { borderColor: palette.primary, backgroundColor: palette.primaryMuted },
    categoryTitle: { fontSize: 15, fontWeight: "600", color: palette.text },
    categoryHint: { fontSize: 13, color: palette.textMuted, marginTop: 2 },
    rulesText: { fontSize: 12, color: palette.textMuted, lineHeight: 18, marginTop: spacing.md },
    photoStrip: { gap: 8, paddingBottom: spacing.sm },
    photoThumb: { width: 72, height: 72, borderRadius: radii.sm },
    photoRemove: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "rgba(0,0,0,0.55)",
      alignItems: "center",
      justifyContent: "center",
    },
    photoAdd: {
      width: 72,
      height: 72,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderStyle: "dashed",
      borderColor: palette.borderStrong,
      alignItems: "center",
      justifyContent: "center",
    },
    photoAddText: { fontSize: 11, color: palette.textMuted },
    fieldLabel: { fontSize: 13, color: palette.textMuted, marginTop: spacing.md, marginBottom: 6 },
    fieldHint: { fontSize: 12, color: palette.textMuted, marginTop: 6, lineHeight: 17 },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
      color: palette.text,
      backgroundColor: palette.surface,
    },
    textArea: { minHeight: 90, textAlignVertical: "top" },
    checkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
    checkText: { fontSize: 15, color: palette.text },
    pickerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      padding: 12,
      backgroundColor: palette.surface,
    },
    pickerText: { flex: 1, fontSize: 15, color: palette.text },
    previewPhoto: { width: "100%", aspectRatio: 4 / 3, borderRadius: radii.md, marginBottom: spacing.md },
    previewPhotoEmpty: { backgroundColor: palette.surfaceStrong, alignItems: "center", justifyContent: "center" },
    listRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: palette.border },
    listRowTitle: { fontSize: 15, color: palette.text },
    listRowMeta: { fontSize: 12, color: palette.textMuted, marginTop: 2 },
  });
}
