import { useEffect, useState } from "react";
import * as Location from "expo-location";
import { UserLocation } from "../utils/location";

type UseCurrentLocationResult = {
  location: UserLocation | null;
  loading: boolean;
  permissionGranted: boolean;
};

export function useCurrentLocation(enabled: boolean): UseCurrentLocationResult {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [permissionGranted, setPermissionGranted] = useState(false);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading((current) => (location ? current : true));
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== Location.PermissionStatus.GRANTED) {
          permission = await Location.requestForegroundPermissionsAsync();
        }

        if (cancelled) {
          return;
        }

        const granted = permission.status === Location.PermissionStatus.GRANTED;
        setPermissionGranted(granted);
        if (!granted) {
          return;
        }

        const lastKnown = await Location.getLastKnownPositionAsync();
        if (!cancelled && lastKnown?.coords) {
          setLocation({
            lat: lastKnown.coords.latitude,
            lng: lastKnown.coords.longitude,
          });
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (cancelled) {
          return;
        }

        setLocation({
          lat: current.coords.latitude,
          lng: current.coords.longitude,
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Unable to get current location", error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    location,
    loading,
    permissionGranted,
  };
}
