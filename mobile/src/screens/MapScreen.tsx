import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE, Region } from "react-native-maps";
import { useCurrentLocation } from "../hooks/useCurrentLocation";
import { AppLocation } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { formatDistanceLabel, locationDistanceMeters, sortLocationsByProximity, UserLocation } from "../utils/location";

type MapViewMode = "map" | "list";

type Props = {
  locations: AppLocation[];
  onPayLocation?: (location: AppLocation) => void;
  viewMode: MapViewMode;
  onChangeViewMode: (viewMode: MapViewMode) => void;
};

type DisplayLocation = {
  location: AppLocation;
  latitude: number;
  longitude: number;
};

const INITIAL_REGION: Region = {
  latitude: 37.7749,
  longitude: -122.4194,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#18222a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#b2bcc5" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#18222a" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#33414c" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#202d36" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#26333d" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#31414c" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#24313a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f3a4a" }] },
];

function distanceMeters(
  left: { lat: number; lng: number },
  right: { lat: number; lng: number },
): number {
  const avgLatRadians = ((left.lat + right.lat) / 2) * (Math.PI / 180);
  const latMeters = (left.lat - right.lat) * 111_320;
  const lngMeters = (left.lng - right.lng) * 111_320 * Math.cos(avgLatRadians);
  return Math.hypot(latMeters, lngMeters);
}

function spreadLocationsForDisplay(locations: AppLocation[]): DisplayLocation[] {
  if (locations.length <= 1) {
    return locations.map((location) => ({
      location,
      latitude: location.lat,
      longitude: location.lng,
    }));
  }

  const proximityMeters = 40;
  const baseOffsetMeters = 18;
  const placed = new Set<number>();
  const output: DisplayLocation[] = [];

  for (let index = 0; index < locations.length; index++) {
    if (placed.has(index)) {
      continue;
    }

    const seed = locations[index];
    const group = [seed];
    placed.add(index);

    for (let otherIndex = index + 1; otherIndex < locations.length; otherIndex++) {
      if (placed.has(otherIndex)) {
        continue;
      }

      const candidate = locations[otherIndex];
      if (distanceMeters({ lat: seed.lat, lng: seed.lng }, { lat: candidate.lat, lng: candidate.lng }) <= proximityMeters) {
        group.push(candidate);
        placed.add(otherIndex);
      }
    }

    if (group.length === 1) {
      output.push({
        location: seed,
        latitude: seed.lat,
        longitude: seed.lng,
      });
      continue;
    }

    const centerLat = group.reduce((sum, location) => sum + location.lat, 0) / group.length;
    const centerLng = group.reduce((sum, location) => sum + location.lng, 0) / group.length;
    const latPerMeter = 1 / 111_320;
    const lngPerMeter = 1 / (111_320 * Math.cos(centerLat * (Math.PI / 180)));
    const radiusMeters = baseOffsetMeters + (group.length - 1) * 4;

    for (let groupPosition = 0; groupPosition < group.length; groupPosition++) {
      const angle = (2 * Math.PI * groupPosition) / group.length;
      output.push({
        location: group[groupPosition],
        latitude: centerLat + Math.sin(angle) * radiusMeters * latPerMeter,
        longitude: centerLng + Math.cos(angle) * radiusMeters * lngPerMeter,
      });
    }
  }

  return output.sort((left, right) => left.location.id - right.location.id);
}

function formatLocationSubtitle(location: AppLocation): string {
  const pieces = [location.type, location.city].map((value) => value.trim()).filter(Boolean);
  return pieces.join(" • ");
}

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function googleMapsUrl(location: AppLocation): string {
  if (location.mapsPage.trim()) {
    return location.mapsPage.trim();
  }

  if (location.googleId.trim()) {
    return `https://www.google.com/maps/place/?q=place_id:${location.googleId}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}

async function openGoogleMaps(location: AppLocation): Promise<void> {
  const lat = location.lat;
  const lng = location.lng;
  const label = encodeURIComponent(location.name);
  const googleAppUrl =
    Platform.OS === "android"
      ? `geo:${lat},${lng}?q=${lat},${lng}(${label})`
      : `comgooglemaps://?q=${label}&center=${lat},${lng}`;
  const fallbackUrl = googleMapsUrl(location);

  try {
    const canOpenApp = await Linking.canOpenURL(googleAppUrl);
    if (canOpenApp) {
      await Linking.openURL(googleAppUrl);
      return;
    }
  } catch {
    // Fall back to the browser URL below.
  }

  await Linking.openURL(fallbackUrl);
}

function regionForPoints(points: Array<{ latitude: number; longitude: number }>): Region {
  if (points.length === 0) {
    return INITIAL_REGION;
  }

  if (points.length === 1) {
    return {
      latitude: points[0].latitude,
      longitude: points[0].longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    };
  }

  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;

  for (const point of points) {
    minLat = Math.min(minLat, point.latitude);
    maxLat = Math.max(maxLat, point.latitude);
    minLng = Math.min(minLng, point.longitude);
    maxLng = Math.max(maxLng, point.longitude);
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.7, 0.01),
    longitudeDelta: Math.max((maxLng - minLng) * 1.7, 0.01),
  };
}

function coordinatesForDisplay(displayLocations: DisplayLocation[], userLocation: UserLocation | null) {
  const points = displayLocations.map((entry) => ({
    latitude: entry.latitude,
    longitude: entry.longitude,
  }));

  if (userLocation) {
    points.push({
      latitude: userLocation.lat,
      longitude: userLocation.lng,
    });
  }

  return points;
}

export function MapScreen({ locations, onPayLocation, viewMode, onChangeViewMode }: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [query, setQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<AppLocation | null>(null);
  const merchantSheetAnim = useRef(new Animated.Value(0)).current;

  const openMerchantSheet = (location: AppLocation) => {
    setSelectedLocation(location);
    merchantSheetAnim.setValue(0);
    Animated.timing(merchantSheetAnim, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const closeMerchantSheet = () => {
    Animated.timing(merchantSheetAnim, {
      toValue: 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => setSelectedLocation(null));
  };
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const { location: userLocation } = useCurrentLocation(true);

  const filteredLocations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = locations.filter((location) => {
      const haystack = `${location.name} ${location.description} ${location.city} ${location.street}`.toLowerCase();
      return normalized === "" || haystack.includes(normalized);
    });

    return sortLocationsByProximity(matching, userLocation);
  }, [locations, query, userLocation]);

  const displayLocations = useMemo(() => spreadLocationsForDisplay(filteredLocations), [filteredLocations]);
  const mapCoordinates = useMemo(
    () => coordinatesForDisplay(displayLocations, userLocation),
    [displayLocations, userLocation],
  );
  const mapRegion = useMemo(() => regionForPoints(mapCoordinates), [mapCoordinates]);

  useEffect(() => {
    if (!mapRef.current || !mapReady || mapCoordinates.length === 0 || viewMode !== "map") {
      return;
    }

    if (mapCoordinates.length === 1) {
      mapRef.current.animateToRegion(mapRegion, 250);
      return;
    }

    mapRef.current.fitToCoordinates(mapCoordinates, {
      edgePadding: { top: 72, right: 72, bottom: 72, left: 72 },
      animated: true,
    });
  }, [mapCoordinates, mapReady, mapRegion, viewMode]);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search merchants"
          placeholderTextColor={palette.textMuted}
        />

        <View style={styles.segmentWrap}>
          <Pressable
            style={[styles.segmentButton, viewMode === "map" ? styles.segmentButtonActive : undefined]}
            onPress={() => onChangeViewMode("map")}
          >
            <Text style={[styles.segmentText, viewMode === "map" ? styles.segmentTextActive : undefined]}>Map View</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, viewMode === "list" ? styles.segmentButtonActive : undefined]}
            onPress={() => onChangeViewMode("list")}
          >
            <Text style={[styles.segmentText, viewMode === "list" ? styles.segmentTextActive : undefined]}>List View</Text>
          </Pressable>
        </View>

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle}>
            {filteredLocations.length} merchant{filteredLocations.length === 1 ? "" : "s"}
          </Text>
          <Text style={styles.resultsSubtitle}>
            {userLocation ? "Showing nearest merchants first." : "Enable location to sort by proximity."}
          </Text>
        </View>

        {viewMode === "map" ? (
          <View style={styles.mapWrap}>
            <MapView
              ref={(instance) => {
                mapRef.current = instance;
              }}
              style={styles.map}
              provider={PROVIDER_GOOGLE}
              initialRegion={mapRegion}
              onMapReady={() => setMapReady(true)}
              toolbarEnabled={false}
              moveOnMarkerPress={false}
              customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
              showsUserLocation
            >
              {displayLocations.map((entry) => (
                <Marker
                  key={entry.location.id}
                  coordinate={{ latitude: entry.latitude, longitude: entry.longitude }}
                  title={entry.location.name}
                  description={entry.location.description}
                  pinColor={entry.location.payToAddress ? palette.primary : palette.textMuted}
                  tracksViewChanges={false}
                  onPress={() => openMerchantSheet(entry.location)}
                />
              ))}
            </MapView>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {filteredLocations.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No merchants match that search.</Text>
                <Text style={styles.emptyText}>Try clearing the search and browsing the full list.</Text>
              </View>
            ) : (
              filteredLocations.map((location) => {
                const distance = locationDistanceMeters(location, userLocation);
                return (
                  <View key={location.id} style={styles.card}>
                    <Pressable onPress={() => openMerchantSheet(location)}>
                      <Text style={styles.cardTitle}>{location.name}</Text>
                      <Text style={styles.cardSubtitle}>{formatLocationSubtitle(location)}</Text>
                      {distance !== null ? <Text style={styles.cardDistance}>{formatDistanceLabel(distance)}</Text> : null}
                      <Text style={styles.cardAddress}>
                        {location.street}, {location.city}
                      </Text>
                      {location.description ? (
                        <Text style={styles.cardDescription} numberOfLines={2}>
                          {location.description}
                        </Text>
                      ) : null}
                    </Pressable>

                    <View style={styles.cardFooter}>
                      {!location.payToAddress ? <Text style={styles.cardMetaMuted}>Payment unavailable right now</Text> : null}
                      <View style={styles.cardActionRow}>
                        <Pressable style={styles.cardSecondaryButton} onPress={() => openMerchantSheet(location)}>
                          <Text style={styles.cardSecondaryButtonText}>Details</Text>
                        </Pressable>
                        <Pressable
                          style={[styles.cardPrimaryButton, !location.payToAddress ? styles.cardPrimaryButtonDisabled : undefined]}
                          disabled={!location.payToAddress}
                          onPress={() => onPayLocation?.(location)}
                        >
                          <Text style={styles.cardPrimaryButtonText}>Pay</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={selectedLocation !== null}
        transparent
        presentationStyle="overFullScreen"
        animationType="none"
        onRequestClose={closeMerchantSheet}
      >
        <Animated.View style={[styles.sheetBackdrop, { opacity: merchantSheetAnim }]}>
          <Pressable style={styles.sheetDismissArea} onPress={closeMerchantSheet} />
          <Animated.View
            style={[
              styles.sheetCard,
              {
                transform: [
                  { translateY: merchantSheetAnim.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) },
                ],
              },
            ]}
          >
            {selectedLocation ? (
              <>
                <View style={styles.sheetHeader}>
                  <View style={styles.sheetHeaderCopy}>
                    <Text style={styles.sheetTitle}>{selectedLocation.name}</Text>
                    <Text style={styles.sheetSubtitle}>
                      {selectedLocation.type}
                      {locationDistanceMeters(selectedLocation, userLocation) !== null
                        ? ` · ${formatDistanceLabel(locationDistanceMeters(selectedLocation, userLocation) ?? 0)}`
                        : ""}
                    </Text>
                  </View>
                  <Pressable style={styles.sheetClose} onPress={closeMerchantSheet} hitSlop={8}>
                    <Ionicons name="close" size={18} color={palette.primaryStrong} />
                  </Pressable>
                </View>

                <ScrollView
                  style={styles.sheetScroll}
                  contentContainerStyle={styles.sheetScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedLocation.description ? (
                    <Text style={styles.sheetBody}>{selectedLocation.description}</Text>
                  ) : null}

                  <Text style={styles.sheetMeta}>
                    {selectedLocation.street}, {selectedLocation.city}, {selectedLocation.state}{" "}
                    {selectedLocation.zip}
                  </Text>

                  {selectedLocation.phone ? (
                    <Pressable
                      style={styles.sheetRow}
                      onPress={() => void Linking.openURL(`tel:${selectedLocation.phone}`)}
                    >
                      <Ionicons name="call-outline" size={15} color={palette.textMuted} />
                      <Text style={styles.sheetRowText}>{selectedLocation.phone}</Text>
                    </Pressable>
                  ) : null}

                  {selectedLocation.email ? (
                    <Pressable
                      style={styles.sheetRow}
                      onPress={() => void Linking.openURL(`mailto:${selectedLocation.email}`)}
                    >
                      <Ionicons name="mail-outline" size={15} color={palette.textMuted} />
                      <Text style={styles.sheetRowText}>{selectedLocation.email}</Text>
                    </Pressable>
                  ) : null}

                  {selectedLocation.openingHours.length > 0 ? (
                    <View style={styles.hoursCard}>
                      {selectedLocation.openingHours.map((hours) => (
                        <Text key={hours} style={styles.hoursText}>
                          {hours}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {/* Directions sit with the location details rather than
                      competing with the two actions at the bottom. */}
                  <Pressable
                    style={styles.directionsLink}
                    onPress={() => {
                      void openGoogleMaps(selectedLocation);
                    }}
                  >
                    <Text style={styles.directionsLinkText}>Get directions</Text>
                    <Ionicons name="open-outline" size={14} color={palette.primaryStrong} />
                  </Pressable>

                  {!selectedLocation.payToAddress ? (
                    <Text style={styles.sheetMetaMuted}>
                      Payment is not available for this merchant right now.
                    </Text>
                  ) : null}
                </ScrollView>

                <View style={styles.sheetActions}>
                  {selectedLocation.website ? (
                    <Pressable
                      style={styles.secondaryAction}
                      onPress={() => void Linking.openURL(normalizeWebsite(selectedLocation.website))}
                    >
                      <Ionicons name="globe-outline" size={16} color={palette.primaryStrong} />
                      <Text style={styles.secondaryActionText}>Open website</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={[
                      styles.primaryAction,
                      !selectedLocation.payToAddress ? styles.actionDisabled : undefined,
                    ]}
                    disabled={!selectedLocation.payToAddress}
                    onPress={() => {
                      const target = selectedLocation;
                      closeMerchantSheet();
                      onPayLocation?.(target);
                    }}
                  >
                    <Ionicons name="arrow-up" size={16} color={palette.white} />
                    <Text style={styles.primaryActionText}>Pay merchant</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Animated.View>
        </Animated.View>
      </Modal>
    </View>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    flex: { flex: 1 },
    container: {
      padding: spacing.lg,
      gap: spacing.md,
      paddingBottom: 110,
    },
    input: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: palette.text,
    },
    segmentWrap: {
      flexDirection: "row",
      gap: spacing.sm,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.lg,
      padding: 6,
    },
    segmentButton: {
      flex: 1,
      borderRadius: radii.md,
      paddingVertical: 12,
      alignItems: "center",
    },
    segmentButtonActive: {
      backgroundColor: palette.primary,
    },
    segmentText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 13,
    },
    segmentTextActive: {
      color: palette.white,
    },
    resultsHeader: {
      gap: 4,
    },
    resultsTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
    },
    resultsSubtitle: {
      color: palette.textMuted,
      lineHeight: 18,
    },
    mapWrap: {
      borderRadius: radii.lg,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: palette.border,
      height: 360,
      backgroundColor: palette.surfaceStrong,
    },
    map: {
      width: "100%",
      height: "100%",
    },
    listWrap: {
      gap: 10,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.soft,
    },
    cardTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 16,
    },
    cardSubtitle: {
      color: palette.primary,
      marginTop: 4,
      textTransform: "capitalize",
    },
    cardDistance: {
      color: palette.primaryStrong,
      marginTop: 6,
      fontWeight: "700",
    },
    cardAddress: {
      color: palette.textMuted,
      marginTop: 6,
    },
    cardDescription: {
      color: palette.text,
      lineHeight: 20,
      marginTop: 8,
    },
    cardFooter: {
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    cardMetaMuted: {
      color: palette.textMuted,
      fontSize: 12,
    },
    cardActionRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    cardSecondaryButton: {
      flex: 1,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      backgroundColor: palette.background,
      paddingVertical: 12,
      alignItems: "center",
    },
    cardSecondaryButtonText: {
      color: palette.text,
      fontWeight: "700",
    },
    cardPrimaryButton: {
      flex: 1,
      borderRadius: radii.md,
      backgroundColor: palette.primary,
      paddingVertical: 12,
      alignItems: "center",
    },
    cardPrimaryButtonDisabled: {
      backgroundColor: palette.border,
    },
    cardPrimaryButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    emptyCard: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.xs,
      ...shadows.soft,
    },
    emptyTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 16,
    },
    emptyText: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    sheetBackdrop: {
      flex: 1,
      justifyContent: "flex-end",
      backgroundColor: palette.overlay,
    },
    sheetDismissArea: {
      flex: 1,
    },
    sheetCard: {
      maxHeight: "82%",
      backgroundColor: palette.background,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
      gap: spacing.md,
    },
    sheetHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: spacing.md,
    },
    sheetHeaderCopy: {
      flex: 1,
      gap: 2,
    },
    sheetTitle: {
      fontSize: 20,
      fontWeight: "800",
      color: palette.text,
    },
    sheetSubtitle: {
      fontSize: 13,
      color: palette.textMuted,
    },
    sheetClose: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primarySoft,
    },
    sheetScroll: {
      flexGrow: 0,
    },
    sheetScrollContent: {
      gap: spacing.sm,
      paddingBottom: spacing.xs,
    },
    sheetBody: {
      fontSize: 14,
      color: palette.text,
      lineHeight: 21,
    },
    sheetMeta: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 19,
    },
    sheetMetaMuted: {
      fontSize: 12,
      color: palette.textMuted,
      fontStyle: "italic",
    },
    sheetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingVertical: 2,
    },
    sheetRowText: {
      flex: 1,
      fontSize: 13,
      color: palette.text,
    },
    directionsLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      alignSelf: "flex-start",
      paddingVertical: 4,
    },
    directionsLinkText: {
      fontSize: 14,
      fontWeight: "800",
      color: palette.primaryStrong,
    },
    sheetActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
    },
    secondaryAction: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 14,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
    },
    secondaryActionText: {
      fontSize: 14,
      fontWeight: "800",
      color: palette.primaryStrong,
    },
    primaryAction: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 14,
      borderRadius: radii.pill,
      backgroundColor: palette.primaryStrong,
    },
    primaryActionText: {
      fontSize: 14,
      fontWeight: "800",
      color: palette.white,
    },
    actionDisabled: {
      opacity: 0.45,
    },
    hoursCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: 6,
    },
    hoursText: {
      color: palette.text,
    },
    primaryButton: {
      flex: 1,
      borderRadius: radii.md,
      backgroundColor: palette.primary,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
  });
}
