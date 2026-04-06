import { AppLocation } from "../types/app";

export type UserLocation = {
  lat: number;
  lng: number;
};

const FEET_PER_METER = 3.28084;
export const NEARBY_MERCHANT_THRESHOLD_FEET = 100;

function compareLocationsByName(left: AppLocation, right: AppLocation): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

export function distanceMeters(left: UserLocation, right: UserLocation): number {
  const avgLatRadians = ((left.lat + right.lat) / 2) * (Math.PI / 180);
  const latMeters = (left.lat - right.lat) * 111_320;
  const lngMeters = (left.lng - right.lng) * 111_320 * Math.cos(avgLatRadians);
  return Math.hypot(latMeters, lngMeters);
}

export function metersToFeet(distance: number): number {
  return distance * FEET_PER_METER;
}

export function formatDistanceLabel(distanceMetersValue: number): string {
  const feet = metersToFeet(distanceMetersValue);
  if (feet < 1_000) {
    return `${Math.max(1, Math.round(feet))} ft away`;
  }

  const miles = feet / 5_280;
  if (miles < 10) {
    return `${miles.toFixed(1)} mi away`;
  }
  return `${Math.round(miles)} mi away`;
}

export function locationDistanceMeters(location: AppLocation, userLocation: UserLocation | null): number | null {
  if (!userLocation) {
    return null;
  }
  return distanceMeters(userLocation, { lat: location.lat, lng: location.lng });
}

export function sortLocationsByProximity(locations: AppLocation[], userLocation: UserLocation | null): AppLocation[] {
  if (!userLocation) {
    return [...locations].sort(compareLocationsByName);
  }

  return [...locations].sort((left, right) => {
    const leftDistance = locationDistanceMeters(left, userLocation) ?? Number.POSITIVE_INFINITY;
    const rightDistance = locationDistanceMeters(right, userLocation) ?? Number.POSITIVE_INFINITY;
    if (leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return compareLocationsByName(left, right);
  });
}

export function findNearestMerchantWithinThreshold(
  locations: AppLocation[],
  userLocation: UserLocation | null,
  thresholdFeet = NEARBY_MERCHANT_THRESHOLD_FEET,
): AppLocation | null {
  if (!userLocation) {
    return null;
  }

  const thresholdMeters = thresholdFeet / FEET_PER_METER;
  const nearest = sortLocationsByProximity(locations, userLocation)[0];
  if (!nearest) {
    return null;
  }

  const distance = locationDistanceMeters(nearest, userLocation);
  if (distance === null || distance > thresholdMeters) {
    return null;
  }
  return nearest;
}
