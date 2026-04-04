import React, { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import MapView, { Marker, Region } from "react-native-maps";
import { AppLocation } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  locations: AppLocation[];
  onPayLocation?: (location: AppLocation) => void;
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

function regionForLocations(locations: AppLocation[]): Region {
  if (locations.length === 0) {
    return INITIAL_REGION;
  }

  if (locations.length === 1) {
    return {
      latitude: locations[0].lat,
      longitude: locations[0].lng,
      latitudeDelta: 0.008,
      longitudeDelta: 0.008,
    };
  }

  let minLat = locations[0].lat;
  let maxLat = locations[0].lat;
  let minLng = locations[0].lng;
  let maxLng = locations[0].lng;

  for (const location of locations) {
    minLat = Math.min(minLat, location.lat);
    maxLat = Math.max(maxLat, location.lat);
    minLng = Math.min(minLng, location.lng);
    maxLng = Math.max(maxLng, location.lng);
  }

  const latitudeDelta = Math.max((maxLat - minLat) * 1.9, 0.008);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.9, 0.008);

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

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

function compareLocations(left: AppLocation, right: AppLocation): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

export function MapScreen({ locations, onPayLocation }: Props) {
  const { palette, shadows, isDark } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [query, setQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<AppLocation | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "list">("map");
  const mapRef = useRef<MapView | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const filteredLocations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const matching = locations.filter((location) => {
      const haystack = `${location.name} ${location.description} ${location.city} ${location.street}`.toLowerCase();
      const matchesQuery = normalized === "" || haystack.includes(normalized);
      return matchesQuery;
    });

    return matching.sort(compareLocations);
  }, [locations, query]);

  const displayLocations = useMemo(() => spreadLocationsForDisplay(filteredLocations), [filteredLocations]);
  const mapRegion = useMemo(
    () =>
      regionForLocations(
        displayLocations.map((entry) => ({
          ...entry.location,
          lat: entry.latitude,
          lng: entry.longitude,
        })),
      ),
    [displayLocations],
  );

  useEffect(() => {
    if (!mapRef.current || !mapReady || displayLocations.length === 0) {
      return;
    }

    if (displayLocations.length === 1) {
      mapRef.current.animateToRegion(mapRegion, 250);
      return;
    }

    mapRef.current.fitToCoordinates(
      displayLocations.map((entry) => ({
        latitude: entry.latitude,
        longitude: entry.longitude,
      })),
      {
        edgePadding: { top: 64, right: 64, bottom: 64, left: 64 },
        animated: true,
      },
    );
  }, [displayLocations, mapReady, mapRegion]);

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Merchant Map</Text>
        <Text style={styles.subtitle}>Browse approved merchants and jump straight into a payment.</Text>

        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search merchants"
          placeholderTextColor={palette.textMuted}
        />

        <View style={styles.viewModeRow}>
          <Pressable
            style={[styles.viewModeButton, viewMode === "map" ? styles.viewModeButtonActive : undefined]}
            onPress={() => setViewMode("map")}
          >
            <Ionicons name="map-outline" size={16} color={viewMode === "map" ? palette.primaryStrong : palette.textMuted} />
            <Text style={[styles.viewModeButtonText, viewMode === "map" ? styles.viewModeButtonTextActive : undefined]}>
              Map
            </Text>
          </Pressable>
          <Pressable
            style={[styles.viewModeButton, viewMode === "list" ? styles.viewModeButtonActive : undefined]}
            onPress={() => setViewMode("list")}
          >
            <Ionicons name="list-outline" size={16} color={viewMode === "list" ? palette.primaryStrong : palette.textMuted} />
            <Text style={[styles.viewModeButtonText, viewMode === "list" ? styles.viewModeButtonTextActive : undefined]}>
              List
            </Text>
          </Pressable>
        </View>

        {viewMode === "map" ? (
          <View style={styles.mapWrap}>
            <MapView
              ref={(instance) => {
                mapRef.current = instance;
              }}
              style={styles.map}
              initialRegion={mapRegion}
              onMapReady={() => setMapReady(true)}
              toolbarEnabled={false}
              moveOnMarkerPress={false}
              customMapStyle={isDark ? DARK_MAP_STYLE : undefined}
            >
              {displayLocations.map((entry) => (
                <Marker
                  key={entry.location.id}
                  coordinate={{ latitude: entry.latitude, longitude: entry.longitude }}
                  title={entry.location.name}
                  description={entry.location.description}
                  pinColor={entry.location.payToAddress ? palette.primary : palette.textMuted}
                  tracksViewChanges={false}
                  onPress={() => setSelectedLocation(entry.location)}
                />
              ))}
            </MapView>
          </View>
        ) : null}

        <View style={styles.resultsHeader}>
          <Text style={styles.resultsTitle}>
            {filteredLocations.length} merchant{filteredLocations.length === 1 ? "" : "s"}
          </Text>
          {viewMode === "map" ? <Text style={styles.resultsMeta}>Switch to List for a faster browse view.</Text> : null}
        </View>

        <View style={styles.listWrap}>
          {filteredLocations.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>No merchants match that search.</Text>
              <Text style={styles.emptyText}>Try clearing the search and browsing the full list.</Text>
            </View>
          ) : (
            filteredLocations.map((location) => (
              <View key={location.id} style={styles.card}>
                <Pressable onPress={() => setSelectedLocation(location)}>
                  <Text style={styles.cardTitle}>{location.name}</Text>
                  <Text style={styles.cardSubtitle}>{formatLocationSubtitle(location)}</Text>
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
                    <Pressable style={styles.cardSecondaryButton} onPress={() => setSelectedLocation(location)}>
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
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={selectedLocation !== null} animationType="slide" onRequestClose={() => setSelectedLocation(null)}>
        <ScrollView contentContainerStyle={styles.modalContainer}>
          {selectedLocation ? (
            <>
              <Text style={styles.modalTitle}>{selectedLocation.name}</Text>
              <Text style={styles.modalSubtitle}>{selectedLocation.type}</Text>
              <Text style={styles.modalBody}>{selectedLocation.description}</Text>
              <Text style={styles.modalMeta}>
                {selectedLocation.street}, {selectedLocation.city}, {selectedLocation.state} {selectedLocation.zip}
              </Text>
              {selectedLocation.phone ? (
                <Pressable onPress={() => void Linking.openURL(`tel:${selectedLocation.phone}`)}>
                  <Text style={styles.modalLink}>Call {selectedLocation.phone}</Text>
                </Pressable>
              ) : null}
              {selectedLocation.email ? (
                <Pressable onPress={() => void Linking.openURL(`mailto:${selectedLocation.email}`)}>
                  <Text style={styles.modalLink}>Email {selectedLocation.email}</Text>
                </Pressable>
              ) : null}
              {selectedLocation.website ? (
                <Pressable onPress={() => void Linking.openURL(normalizeWebsite(selectedLocation.website))}>
                  <Text style={styles.modalLink}>Open website</Text>
                </Pressable>
              ) : null}
              {!selectedLocation.payToAddress ? (
                <Text style={styles.modalMetaMuted}>Payment is not available for this merchant right now.</Text>
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

              <Pressable
                style={[styles.payMerchantButton, !selectedLocation.payToAddress ? styles.payMerchantButtonDisabled : undefined]}
                disabled={!selectedLocation.payToAddress}
                onPress={() => {
                  onPayLocation?.(selectedLocation);
                  setSelectedLocation(null);
                }}
              >
                <Text style={styles.payMerchantButtonText}>Pay merchant</Text>
              </Pressable>

              <View style={styles.modalActions}>
                <Pressable style={styles.secondaryButton} onPress={() => setSelectedLocation(null)}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    const url = `https://maps.apple.com/?ll=${selectedLocation.lat},${selectedLocation.lng}&q=${encodeURIComponent(selectedLocation.name)}`;
                    void Linking.openURL(url);
                  }}
                >
                  <Text style={styles.primaryButtonText}>Apple Maps</Text>
                </Pressable>
              </View>

              <View style={styles.modalActions}>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => {
                    const url =
                      selectedLocation.mapsPage ||
                      `https://www.google.com/maps/place/?q=place_id:${selectedLocation.googleId}`;
                    void Linking.openURL(url);
                  }}
                >
                  <Text style={styles.secondaryButtonText}>Google Maps</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
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
    title: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "800",
    },
    subtitle: {
      color: palette.textMuted,
      lineHeight: 20,
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
    viewModeRow: {
      flexDirection: "row",
      gap: spacing.sm,
    },
    viewModeButton: {
      flex: 1,
      minHeight: 46,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "row",
      gap: 8,
    },
    viewModeButtonActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    viewModeButtonText: {
      color: palette.textMuted,
      fontWeight: "800",
    },
    viewModeButtonTextActive: {
      color: palette.primaryStrong,
    },
    resultsHeader: {
      gap: 4,
    },
    resultsTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "800",
    },
    resultsMeta: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: "700",
    },
    mapWrap: {
      borderRadius: radii.lg,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: palette.border,
      height: 280,
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
    modalContainer: {
      padding: spacing.lg,
      gap: spacing.md,
      backgroundColor: palette.background,
      flexGrow: 1,
    },
    modalTitle: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "900",
    },
    modalSubtitle: {
      color: palette.primary,
      fontWeight: "700",
      textTransform: "capitalize",
    },
    modalBody: {
      color: palette.text,
      lineHeight: 22,
    },
    modalMeta: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    modalLink: {
      color: palette.primaryStrong,
      fontWeight: "800",
    },
    modalMetaMuted: {
      color: palette.textMuted,
      lineHeight: 21,
      fontStyle: "italic",
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
    payMerchantButton: {
      borderRadius: radii.md,
      backgroundColor: palette.primary,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: spacing.sm,
    },
    payMerchantButtonDisabled: {
      backgroundColor: palette.border,
    },
    payMerchantButtonText: {
      color: palette.white,
      fontWeight: "800",
      fontSize: 16,
    },
    modalActions: {
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: "auto",
    },
    secondaryButton: {
      flex: 1,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.borderStrong,
      backgroundColor: palette.surface,
      paddingVertical: 14,
      alignItems: "center",
    },
    secondaryButtonText: {
      color: palette.text,
      fontWeight: "700",
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
