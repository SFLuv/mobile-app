import * as Crypto from "expo-crypto";

import { mobileConfig } from "../config";
import {
  MerchantAddressDraft,
  MerchantPlaceCandidate,
  MerchantPlaceDetails,
  MerchantPlaceSelection,
} from "../types/app";

const SEARCH_CENTER = { lat: 37.7749, lng: -122.4194 };
const SEARCH_RADIUS_METERS = 16_000;

/**
 * Places types that describe a postal address rather than a business.
 *
 * Google returns the street address itself as the display name for these, so
 * accepting one as a business silently names the merchant after their address.
 * The same set gates the category: `types[0]` on an address result is
 * `street_address`, which is how "street_address" ended up filled in as a
 * business type — a Google taxonomy string presented to a merchant as though it
 * were an answer they gave.
 *
 * Mirrors ADDRESS_ONLY_TYPES in the web finder and addressOnlyPlaceTypes in
 * backend/handlers/google_places.go.
 */
const ADDRESS_ONLY_TYPES = new Set([
  "street_address", "street_number", "route", "intersection", "premise",
  "subpremise", "plus_code", "postal_code", "postal_code_prefix",
  "postal_code_suffix", "geocode", "locality", "sublocality",
  "sublocality_level_1", "sublocality_level_2", "neighborhood",
  "administrative_area_level_1", "administrative_area_level_2",
  "administrative_area_level_3", "country", "political", "floor", "room",
  "post_box",
]);

export const isBusinessPlace = (types: string[] | undefined): boolean => {
  if (!types?.length) return false;
  return types.some((type) => !ADDRESS_ONLY_TYPES.has(type));
};

/**
 * A readable category from Google's taxonomy: `book_store` becomes
 * `Book Store`.
 *
 * The web finder gets this for free from `primaryTypeDisplayName`, which the
 * legacy Details endpoint this app uses does not return. Address-only types are
 * skipped rather than prettified — there is no such thing as a business whose
 * category is "Street Address".
 */
const businessTypeLabel = (types: string[] | undefined): string => {
  const category = types?.find((type) => !ADDRESS_ONLY_TYPES.has(type) && type !== "point_of_interest" && type !== "establishment");
  if (!category) return "";
  return category
    .split("_")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
};

/**
 * One token spans a whole type-then-pick sequence and is replaced after each
 * selection; that is how Places bills a session rather than per keystroke.
 */
let sessionToken: string | null = null;

const currentSessionToken = (): string => {
  if (!sessionToken) {
    sessionToken =
      typeof Crypto.randomUUID === "function"
        ? Crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
  }
  return sessionToken;
};

/** Called once a place has been resolved, which is what ends the session. */
export const endPlacesSession = (): void => {
  sessionToken = null;
};

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

type AutocompleteResponse = {
  predictions?: Array<{
    place_id?: string;
    description?: string;
    structured_formatting?: { main_text?: string; secondary_text?: string };
    types?: string[];
  }>;
  status?: string;
};

/**
 * Prediction-as-you-type, which is what the web finder does and what this app
 * asked a merchant to press a button for.
 *
 * No type restriction: one box that takes a business or a street address,
 * because a merchant does not know in advance which of the two Google holds for
 * them. Which one they picked is decided on selection, from the place's own
 * types.
 */
export async function autocompleteMerchantPlaces(
  query: string,
): Promise<MerchantPlaceCandidate[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const key = getApiKey();
  const url =
    "https://maps.googleapis.com/maps/api/place/autocomplete/json" +
    `?input=${encodeQuery(trimmed)}` +
    `&location=${SEARCH_CENTER.lat},${SEARCH_CENTER.lng}` +
    `&radius=${SEARCH_RADIUS_METERS}` +
    `&sessiontoken=${encodeURIComponent(currentSessionToken())}` +
    `&key=${encodeURIComponent(key)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Could not reach Google to search. Check your connection and try again.");
  }
  const body = (await response.json()) as AutocompleteResponse;
  // ZERO_RESULTS is an empty list, not a failure worth showing anybody.
  if (body.status && body.status !== "OK" && body.status !== "ZERO_RESULTS") {
    throw new Error("Could not reach Google to search. Check your connection and try again.");
  }

  return (body.predictions || []).slice(0, 8).map((prediction) => ({
    googleId: prediction.place_id || "",
    name: prediction.structured_formatting?.main_text || prediction.description || "",
    addressLine: prediction.structured_formatting?.secondary_text || "",
    rating: 0,
    lat: 0,
    lng: 0,
    types: prediction.types || [],
  }));
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

/**
 * The place, plus the two things about it that decide which path it is on.
 *
 * `types` and the formatted address are not part of a location record, so they
 * are carried alongside one rather than bolted onto it — the caller needs them
 * to choose between a business and an address, and nothing downstream stores
 * them.
 */
type PlaceLookup = {
  details: MerchantPlaceDetails;
  types: string[];
  formattedAddress: string;
};

async function lookupPlace(placeID: string): Promise<PlaceLookup> {
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
    types: result.types || [],
    formattedAddress: result.formatted_address || "",
    details: {
      id: 0,
      googleId: result.place_id,
      name: result.name || "Unknown business",
      description: "",
      // Never types[0]. On an address result that is "street_address", which is
      // how a Google taxonomy string came to be shown to merchants as their own
      // business type. Empty is the honest answer for a place with no category,
      // and the form asks for one when it is empty.
      type: businessTypeLabel(result.types),
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
      // A Google listing carries no SFLuv map icon, and its weekday_text is the
      // display form rather than the structured week — both are filled in by our
      // own backend once the location exists.
      iconUrl: "",
      rating: typeof result.rating === "number" ? result.rating : 0,
      mapsPage: result.url || "",
      openingHours: result.opening_hours?.weekday_text || [],
      hours: [],
    },
  };
}

export async function getMerchantPlaceDetails(placeID: string): Promise<MerchantPlaceDetails> {
  return (await lookupPlace(placeID)).details;
}

/**
 * Resolves a chosen prediction into one of the two things it can be.
 *
 * The result's own types decide the path, not a mode the merchant had to pick
 * beforehand — the same rule the web finder follows. A business carries its
 * name, category, hours and phone; a postal address carries none of those and
 * Google returns the street as its display name, so the name is dropped rather
 * than inherited. A listing on the map called "1234 Main St" is the exact
 * failure this is built to prevent.
 */
export async function resolveMerchantPlace(placeID: string): Promise<MerchantPlaceSelection> {
  const { details, types, formattedAddress } = await lookupPlace(placeID);
  // A completed selection ends the billing session.
  endPlacesSession();

  if (isBusinessPlace(types)) {
    return { source: "google_place", place: details };
  }

  if (!details.street) {
    throw new Error("Google returned no street address for that result. Try a more specific one.");
  }

  const address: MerchantAddressDraft = {
    street: details.street,
    city: details.city,
    state: details.state,
    zip: details.zip,
    lat: details.lat,
    lng: details.lng,
    formattedAddress,
  };
  return { source: "manual", address };
}
