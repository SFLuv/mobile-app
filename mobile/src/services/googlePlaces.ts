import { mobileConfig } from "../config";
import { MerchantPlaceCandidate, MerchantPlaceDetails } from "../types/app";

const SEARCH_CENTER = { lat: 37.7749, lng: -122.4194 };
const SEARCH_RADIUS_METERS = 16_000;

type TextSearchResponse = {
  results?: Array<{
    place_id?: string;
    name?: string;
    formatted_address?: string;
    rating?: number;
    geometry?: { location?: { lat?: number; lng?: number } };
    types?: string[];
  }>;
  status?: string;
};

type PlaceDetailsResponse = {
  result?: {
    place_id?: string;
    name?: string;
    rating?: number;
    formatted_address?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    address_components?: Array<{
      long_name?: string;
      short_name?: string;
      types?: string[];
    }>;
    formatted_phone_number?: string;
    website?: string;
    url?: string;
    types?: string[];
    opening_hours?: { weekday_text?: string[] };
    photos?: Array<{ photo_reference?: string }>;
  };
  status?: string;
};

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

function getApiKey(): string {
  const key = mobileConfig.googleMapsApiKey.trim();
  if (!key) {
    throw new Error("Missing EXPO_PUBLIC_GOOGLE_MAPS_API_KEY.");
  }
  return key;
}

function encodeQuery(query: string): string {
  return encodeURIComponent(query.trim());
}

function photoURL(reference?: string): string {
  if (!reference) {
    return "";
  }
  const key = getApiKey();
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photo_reference=${encodeURIComponent(reference)}&key=${encodeURIComponent(key)}`;
}

function getAddressComponent(
  components: AddressComponent[] | undefined,
  type: string,
): string {
  const match = components?.find((component) => component.types?.includes(type));
  return match?.long_name || "";
}

function buildStreet(
  components: AddressComponent[] | undefined,
): string {
  const streetNumber = getAddressComponent(components, "street_number");
  const route = getAddressComponent(components, "route");
  return [streetNumber, route].filter(Boolean).join(" ").trim();
}

export async function searchMerchantPlaces(query: string): Promise<MerchantPlaceCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) {
    return [];
  }

  const key = getApiKey();
  const url =
    "https://maps.googleapis.com/maps/api/place/textsearch/json" +
    `?query=${encodeQuery(trimmed)}` +
    `&location=${SEARCH_CENTER.lat},${SEARCH_CENTER.lng}` +
    `&radius=${SEARCH_RADIUS_METERS}` +
    `&key=${encodeURIComponent(key)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Unable to search Google Places.");
  }
  const body = (await response.json()) as TextSearchResponse;
  return (body.results || []).slice(0, 8).map((result) => ({
    googleId: result.place_id || "",
    name: result.name || "Unknown business",
    addressLine: result.formatted_address || "",
    rating: typeof result.rating === "number" ? result.rating : 0,
    lat: result.geometry?.location?.lat || 0,
    lng: result.geometry?.location?.lng || 0,
    types: result.types || [],
  }));
}

export async function getMerchantPlaceDetails(placeID: string): Promise<MerchantPlaceDetails> {
  const key = getApiKey();
  const url =
    "https://maps.googleapis.com/maps/api/place/details/json" +
    `?place_id=${encodeURIComponent(placeID)}` +
    "&fields=place_id,name,rating,formatted_address,geometry,address_component,formatted_phone_number,website,url,types,opening_hours,photos" +
    `&key=${encodeURIComponent(key)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Unable to load business details.");
  }
  const body = (await response.json()) as PlaceDetailsResponse;
  const result = body.result;
  if (!result?.place_id || !result.geometry?.location) {
    throw new Error("Place details were incomplete.");
  }

  const components = result.address_components;
  const city =
    getAddressComponent(components, "locality") ||
    getAddressComponent(components, "postal_town") ||
    getAddressComponent(components, "administrative_area_level_2");
  const state = getAddressComponent(components, "administrative_area_level_1");
  const zip = getAddressComponent(components, "postal_code");

  return {
    id: 0,
    googleId: result.place_id,
    name: result.name || "Unknown business",
    description: "",
    type: result.types?.[0] || "other",
    street: buildStreet(components),
    city,
    state,
    zip,
    lat: result.geometry.location.lat || 0,
    lng: result.geometry.location.lng || 0,
    phone: result.formatted_phone_number || "",
    email: "",
    website: result.website || "",
    imageUrl: photoURL(result.photos?.[0]?.photo_reference),
    rating: typeof result.rating === "number" ? result.rating : 0,
    mapsPage: result.url || "",
    openingHours: result.opening_hours?.weekday_text || [],
  };
}
