import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { palette, radii, spacing } from "../theme";

type Props = {
  locations: AppLocation[];
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
    const groupIndexes = [index];
    placed.add(index);

    for (let otherIndex = index + 1; otherIndex < locations.length; otherIndex++) {
      if (placed.has(otherIndex)) {
        continue;
      }

      const candidate = locations[otherIndex];
      if (distanceMeters({ lat: seed.lat, lng: seed.lng }, { lat: candidate.lat, lng: candidate.lng }) <= proximityMeters) {
        group.push(candidate);
        groupIndexes.push(otherIndex);
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

export function MapScreen({ locations }: Props) {
  const [query, setQuery] = useState("");
  const [selectedType, setSelectedType] = useState("All");
  const [selectedLocation, setSelectedLocation] = useState<AppLocation | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const locationTypes = useMemo(() => {
    const unique = new Set<string>();
    for (const location of locations) {
      unique.add(location.type || "other");
    }
    return ["All", ...Array.from(unique).sort((left, right) => left.localeCompare(right))];
  }, [locations]);

  const filteredLocations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return locations.filter((location) => {
      const matchesType = selectedType === "All" || location.type === selectedType;
      const haystack = `${location.name} ${location.description} ${location.city}`.toLowerCase();
      const matchesQuery = normalized === "" || haystack.includes(normalized);
      return matchesType && matchesQuery;
    });
  }, [locations, query, selectedType]);

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
        <Text style={styles.subtitle}>Places that accept SFLUV.</Text>

        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search merchants"
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {locationTypes.map((type) => {
            const active = type === selectedType;
            return (
              <Pressable
                key={type}
                style={[styles.filterChip, active ? styles.filterChipActive : undefined]}
                onPress={() => setSelectedType(type)}
              >
                <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : undefined]}>
                  {type}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

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
          >
            {displayLocations.map((entry) => (
              <Marker
                key={entry.location.id}
                coordinate={{ latitude: entry.latitude, longitude: entry.longitude }}
                title={entry.location.name}
                description={entry.location.description}
                pinColor={palette.primary}
                tracksViewChanges={false}
                onPress={() => setSelectedLocation(entry.location)}
              />
            ))}
          </MapView>
        </View>

        <View style={styles.listWrap}>
          {filteredLocations.map((location) => (
            <Pressable key={location.id} style={styles.card} onPress={() => setSelectedLocation(location)}>
              <Text style={styles.cardTitle}>{location.name}</Text>
              <Text style={styles.cardType}>{location.type}</Text>
              <Text style={styles.cardAddress}>
                {location.street}, {location.city}
              </Text>
            </Pressable>
          ))}
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
              {selectedLocation.phone ? <Text style={styles.modalMeta}>Phone: {selectedLocation.phone}</Text> : null}
              {selectedLocation.email ? <Text style={styles.modalMeta}>Email: {selectedLocation.email}</Text> : null}
              {selectedLocation.website ? <Text style={styles.modalMeta}>Website: {selectedLocation.website}</Text> : null}
              {selectedLocation.openingHours.length > 0 ? (
                <View style={styles.hoursCard}>
                  {selectedLocation.openingHours.map((hours) => (
                    <Text key={hours} style={styles.hoursText}>
                      {hours}
                    </Text>
                  ))}
                </View>
              ) : null}

              <View style={styles.modalActions}>
                <Pressable style={styles.secondaryButton} onPress={() => setSelectedLocation(null)}>
                  <Text style={styles.secondaryButtonText}>Close</Text>
                </Pressable>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => {
                    const url = selectedLocation.mapsPage ||
                      `https://www.google.com/maps/place/?q=place_id:${selectedLocation.googleId}`;
                    void Linking.openURL(url);
                  }}
                >
                  <Text style={styles.primaryButtonText}>Directions</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
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
  filterRow: {
    gap: 8,
    paddingRight: 20,
  },
  filterChip: {
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  filterChipActive: {
    backgroundColor: palette.primary,
    borderColor: palette.primary,
  },
  filterChipText: {
    color: palette.text,
    fontWeight: "700",
  },
  filterChipTextActive: {
    color: palette.white,
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
    shadowColor: palette.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  cardTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 16,
  },
  cardType: {
    color: palette.primary,
    marginTop: 4,
    textTransform: "capitalize",
  },
  cardAddress: {
    color: palette.textMuted,
    marginTop: 6,
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
