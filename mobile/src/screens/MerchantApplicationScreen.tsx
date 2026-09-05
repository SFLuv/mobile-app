import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import {
  MerchantApplicationDraft,
  MerchantPlaceCandidate,
  MerchantPlaceSelection,
} from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { autocompleteMerchantPlaces, resolveMerchantPlace } from "../services/googlePlaces";
import { formatPhone, isValidEmail, isValidPhone, normalizeEmail } from "../lib/contactFormat";

/**
 * The Location Approval Form, on a phone.
 *
 * Deliberately the same three sections as the web app — Public Information,
 * Contact, Payment System — asking the same questions in the same order, with
 * the same answers required, and posting the same payload. The two are one form
 * on two surfaces: an application filed here reaches the review queue
 * indistinguishable from one filed in a browser, and an admin reading it should
 * not be able to tell.
 *
 * The location box behaves as the web one does: predictions as you type rather
 * than a Search button, one box that takes a business or a street address with
 * the result's own types deciding which, a confirmed choice that can be cleared,
 * and a way through for a merchant who knows Google has nothing to find.
 *
 * Only one thing is left out. The web form takes an optional logo through a
 * crop-and-upload step and optional opening hours through a week of time
 * pickers; both are written by their own endpoints after the listing exists,
 * both are optional, and neither is worth a first mobile pass. A merchant who
 * wants either sets it from Locations on the web.
 */

const STEPS = [
  { key: "public", title: "Public Information" },
  { key: "contact", title: "Contact" },
  { key: "payment", title: "Payment System" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const OTHER = "Other";

/** Matches the web finder: a request per keystroke is both slow and billable. */
const SEARCH_DEBOUNCE_MS = 220;

const POS_OPTIONS = [
  "Square",
  "Clover",
  "Toast",
  "Shopify",
  "SumUp",
  "Lightspeed",
  "Cash only",
  "No point of sale system",
  OTHER,
];

const REFERRAL_OPTIONS = [
  "A friend or another business",
  "An SFLuv team member",
  "A community or neighbourhood event",
  "Social media",
  "A search engine",
  "Press or a newsletter",
  OTHER,
];

const DRAFT_TEMPLATE: MerchantApplicationDraft = {
  selection: null,
  locationName: "",
  businessType: "",
  description: "",
  publicPhone: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  referralSource: "",
  posSystem: "",
  acceptsTips: null,
  hasStaffTablet: null,
};

/** What the box should read for an already-confirmed selection. */
const queryFor = (selection: MerchantPlaceSelection | null): string => {
  if (!selection) return "";
  if (selection.source === "google_place") return selection.place.name;
  return selection.address.formattedAddress || selection.address.street;
};

type Props = {
  onClose: () => void;
  onSubmit: (draft: MerchantApplicationDraft) => Promise<void>;
};

export function MerchantApplicationScreen({ onClose, onSubmit }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [stepIndex, setStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MerchantPlaceCandidate[]>([]);
  const [draft, setDraft] = useState<MerchantApplicationDraft>(DRAFT_TEMPLATE);
  // The write-ins behind an "Other" answer. Resolved into the draft on submit,
  // the same flattening the web form does, so the stored value is the answer
  // itself rather than the word "Other".
  const [posOther, setPosOther] = useState("");
  const [referralOther, setReferralOther] = useState("");
  // The merchant said up front that Google has nothing to find. Distinct from
  // having picked an address: both ask for the same fields, but only this one
  // reorders them.
  const [manualToggle, setManualToggle] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against a slow response for an earlier query overwriting a later one.
  const requestSeqRef = useRef(0);

  const step = STEPS[stepIndex];
  const selection = draft.selection;

  /**
   * The merchant picked a plain street address rather than a business listing.
   *
   * Google returns the street as such a result's display name, so there is no
   * name, no category, no hours and no phone to carry — everything the Google
   * path gets for free has to be asked for instead.
   */
  const addressOnlySelection = selection?.source === "manual";
  const manualEntry = manualToggle || addressOnlySelection;
  /**
   * Whether to ask for what Google would otherwise answer. A confirmed business
   * suppresses these even with the box ticked: the backend re-fetches the place
   * and overwrites name and category from it, so an editable field there would
   * take a change and silently drop it.
   */
  const showManualFields = manualEntry && selection?.source !== "google_place";
  /**
   * Whether the address box drops below the name and type fields. Only when the
   * merchant said up front there is nothing to find — then they are naming the
   * place themselves and the address is the last detail. Picking an address from
   * the search does not reorder anything: the box is where they were just
   * working, and moving it out from under them mid-task is disorienting.
   */
  const chooserBelow = manualToggle && showManualFields;

  const updateDraft = (patch: Partial<MerchantApplicationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const applySelection = (next: MerchantPlaceSelection | null) => {
    setDraft((current) => ({
      ...current,
      selection: next,
      // A business listing fills in the name, the category and the phone. An
      // address fills in nothing: that path exists precisely because Google has
      // no business record to copy, and inheriting the address as a name is the
      // failure it is built to prevent.
      ...(next?.source === "google_place"
        ? {
            locationName: next.place.name || current.locationName,
            businessType: next.place.type || current.businessType,
            // Google's number only fills a gap: a merchant may publish a
            // different customer-facing one.
            publicPhone: current.publicPhone || next.place.phone,
          }
        : {}),
    }));
    setError(null);
  };

  // Predictions as you type, debounced. Runs only while nothing is confirmed —
  // once a place is chosen the box holds its name, and re-querying it would
  // reopen a list under an answered question.
  useEffect(() => {
    if (selection) {
      setSuggestions([]);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const seq = ++requestSeqRef.current;
    const timer = setTimeout(() => {
      setSearching(true);
      autocompleteMerchantPlaces(trimmed)
        .then((results) => {
          if (seq !== requestSeqRef.current) return;
          setSuggestions(results);
          setSearchError("");
        })
        .catch((searchFailure: Error) => {
          if (seq !== requestSeqRef.current) return;
          setSuggestions([]);
          setSearchError(searchFailure.message);
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, selection]);

  const choosePlace = async (candidate: MerchantPlaceCandidate) => {
    setSuggestions([]);
    setSearching(true);
    setSearchError("");
    try {
      const resolved = await resolveMerchantPlace(candidate.googleId);
      setQuery(queryFor(resolved));
      applySelection(resolved);
    } catch (detailsError) {
      setSearchError((detailsError as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /** Empties the box and the answer behind it, back to a blank first step. */
  const clearSelection = () => {
    setQuery("");
    setSuggestions([]);
    setSearchError("");
    // Name, type and phone came from the place that is being cleared, so they go
    // with it — leaving them would attribute one shop's details to the next one
    // searched for.
    setDraft((current) => ({
      ...current,
      selection: null,
      locationName: "",
      businessType: "",
      publicPhone: "",
    }));
    setError(null);
  };

  /** The first thing wrong with a step, or null. */
  const stepProblem = (key: StepKey): string | null => {
    if (key === "public") {
      if (!selection) return "Find your location and confirm the match before continuing.";
      // Only the manual path is asked for these, so only it is checked. On the
      // Google path they are not on screen, and complaining about a field the
      // merchant cannot see is the worst kind of dead end.
      if (showManualFields) {
        if (!draft.locationName.trim()) return "Location name is required.";
        if (!draft.businessType.trim()) return "Business type is required.";
        // The Shiba failure mode: a listing on the map named "1234 Main St".
        const typed = draft.locationName.trim().toLowerCase();
        const street = addressOnlySelection ? selection.address.street.toLowerCase() : "";
        const line = addressOnlySelection
          ? (selection.address.formattedAddress || "").toLowerCase()
          : "";
        if (typed && (typed === street || typed === line)) {
          return "That is your street address. Enter the name your customers know you by.";
        }
      }
      // The description is optional, as on the web — a shop with nothing to add
      // still belongs on the map.
      if (draft.publicPhone.trim() && !isValidPhone(draft.publicPhone)) {
        return "Enter a valid public phone number.";
      }
      return null;
    }
    if (key === "contact") {
      if (!draft.contactName.trim()) return "Contact name is required.";
      if (!draft.contactPhone.trim()) return "Contact phone is required.";
      if (!isValidPhone(draft.contactPhone)) return "Enter a valid phone number.";
      if (!draft.contactEmail.trim()) return "Contact email is required.";
      if (!isValidEmail(draft.contactEmail)) return "Enter a valid email address.";
      if (!draft.referralSource) return "Tell us how you heard about SFLuv.";
      if (draft.referralSource === OTHER && !referralOther.trim()) {
        return "Tell us how you heard about SFLuv.";
      }
      return null;
    }
    if (!draft.posSystem) return "POS type is required.";
    if (draft.posSystem === OTHER && !posOther.trim()) {
      return "Tell us which point of sale system you use.";
    }
    if (draft.acceptsTips === null) return "Tell us whether this location accepts tips.";
    if (draft.hasStaffTablet === null) {
      return "Tell us whether staff have a tablet or phone available.";
    }
    return null;
  };

  const goNext = () => {
    const problem = stepProblem(step.key);
    if (problem) {
      setError(problem);
      return;
    }
    // Cleared on the way out as well as on the way in: a message raised by step
    // one has nothing to say about step three.
    setError(null);
    setStepIndex((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async () => {
    // Every step, not just the last: a merchant can walk back and empty a field
    // they already passed, and this is the last place that can catch it.
    for (let index = 0; index < STEPS.length; index += 1) {
      const problem = stepProblem(STEPS[index].key);
      if (problem) {
        setStepIndex(index);
        setError(problem);
        return;
      }
    }

    try {
      setSubmitting(true);
      setError(null);
      await onSubmit({
        ...draft,
        contactPhone: formatPhone(draft.contactPhone),
        contactEmail: normalizeEmail(draft.contactEmail),
        publicPhone: draft.publicPhone.trim() ? formatPhone(draft.publicPhone) : "",
        posSystem: draft.posSystem === OTHER ? posOther.trim() : draft.posSystem,
        referralSource:
          draft.referralSource === OTHER ? referralOther.trim() : draft.referralSource,
      });
      setSubmitted(true);
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.confirmation}>
          <Text style={styles.confirmationTitle}>
            Your application has been submitted successfully
          </Text>
          <Pressable style={styles.primaryButton} onPress={onClose}>
            <Text style={styles.primaryButtonText}>Done</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // Defined once and placed in one of two slots below, so the two positions
  // cannot drift apart.
  const locationChooser = (
    <View style={styles.chooser}>
      <Text style={styles.label}>
        {showManualFields ? "Location Address" : "Find your location"}
      </Text>
      <View style={styles.searchWrap}>
        <TextInput
          style={[styles.input, styles.searchInput]}
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            // Typing past a confirmed place clears it: what is in the box and
            // what will be submitted must not disagree.
            if (selection) {
              setDraft((current) => ({ ...current, selection: null }));
              setError(null);
            }
          }}
          placeholder={
            manualEntry ? "Start typing your street address" : "Search for your business or address"
          }
          placeholderTextColor={palette.textMuted}
          autoCorrect={false}
          autoCapitalize="words"
        />
        {searching ? (
          <View style={styles.searchAdornment}>
            <ThemedActivityIndicator />
          </View>
        ) : query.length > 0 ? (
          <Pressable
            style={styles.searchAdornment}
            onPress={clearSelection}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear location"
          >
            <Text style={styles.clearGlyph}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {suggestions.length > 0 && (
        <View style={styles.suggestions}>
          {suggestions.map((candidate) => (
            <Pressable
              key={candidate.googleId}
              style={styles.suggestion}
              onPress={() => void choosePlace(candidate)}
            >
              <Text style={styles.suggestionPrimary} numberOfLines={1}>
                {candidate.name}
              </Text>
              {candidate.addressLine ? (
                <Text style={styles.suggestionSecondary} numberOfLines={1}>
                  {candidate.addressLine}
                </Text>
              ) : null}
            </Pressable>
          ))}
        </View>
      )}

      {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
    </View>
  );

  // One slot, two jobs. With nothing chosen it offers the way out; with
  // something chosen it says which kind it was, because that is the difference
  // between the form filling itself in and the merchant filling it in.
  const selectionStatus = selection ? (
    selection.source === "google_place" ? (
      <Text style={styles.statusFound}>✓ Location found</Text>
    ) : (
      <View style={styles.statusBlock}>
        <Text style={styles.statusAddress}>✓ Address found</Text>
        {/* Amber rather than green, and this sentence, because an address is the
            weaker of the two answers: a business listing would carry the name,
            the category, the hours and the phone. */}
        <Text style={styles.hint}>
          If your business has its own Google listing, search for it by name instead — we can fill in
          far more for you.
        </Text>
      </View>
    )
  ) : (
    <Pressable
      style={styles.checkboxRow}
      onPress={() => {
        setManualToggle((current) => !current);
        setSearchError("");
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: manualToggle }}
    >
      <View style={[styles.checkbox, manualToggle && styles.checkboxChecked]}>
        {manualToggle ? <Text style={styles.checkboxGlyph}>✓</Text> : null}
      </View>
      <Text style={styles.hint}>Can&apos;t find my location</Text>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Pressable onPress={onClose} hitSlop={12}>
          <Text style={styles.back}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>Location Approval Form</Text>
        <View style={styles.backSpacer} />
      </View>

      {/* Numbered circles joined by a rule — the same indicator the web app
          shows on a narrow screen, for the same reason: boxes around single
          digits read as three buttons. */}
      <View style={styles.rail}>
        {STEPS.map((entry, index) => {
          const done = index < stepIndex;
          const current = index === stepIndex;
          return (
            <React.Fragment key={entry.key}>
              {index > 0 && (
                <View style={[styles.railLine, (done || current) && styles.railLineActive]} />
              )}
              <View style={[styles.railDot, (done || current) && styles.railDotActive]}>
                <Text style={[styles.railDotText, (done || current) && styles.railDotTextActive]}>
                  {done ? "✓" : index + 1}
                </Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
      <Text style={styles.stepTitle}>{step.title}</Text>

      {step.key === "public" && (
        <View style={styles.card}>
          {!chooserBelow && locationChooser}

          {/* Never moves and never unmounts. It sits directly under the search
              box while the box is at the top, and becomes the first thing on the
              step the moment the box drops below the name and type fields. */}
          {selectionStatus}

          {showManualFields && (
            <>
              <Text style={styles.label}>Location Name</Text>
              <TextInput
                style={styles.input}
                value={draft.locationName}
                onChangeText={(value) => updateDraft({ locationName: value })}
                placeholder="Your business name"
                placeholderTextColor={palette.textMuted}
              />

              <Text style={styles.label}>Business Type</Text>
              <TextInput
                style={styles.input}
                value={draft.businessType}
                onChangeText={(value) => updateDraft({ businessType: value })}
                placeholder="Cafe, bookshop, barber"
                placeholderTextColor={palette.textMuted}
              />

              {chooserBelow && locationChooser}
            </>
          )}

          {selection && (
            <>
              <Text style={styles.label}>Location Description (optional)</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={draft.description}
                onChangeText={(value) => updateDraft({ description: value })}
                placeholder="What you sell"
                placeholderTextColor={palette.textMuted}
                multiline
              />

              <Text style={styles.label}>Public Phone (optional)</Text>
              <Text style={styles.hint}>Shown on the map. Need not match your contact phone.</Text>
              <TextInput
                style={styles.input}
                value={draft.publicPhone}
                onChangeText={(value) => updateDraft({ publicPhone: value })}
                // Reformatted on blur rather than on every keystroke: rewriting
                // under a moving cursor fights whoever is typing.
                onBlur={() => updateDraft({ publicPhone: formatPhone(draft.publicPhone) })}
                placeholder="(415) 555-1234"
                placeholderTextColor={palette.textMuted}
                keyboardType="phone-pad"
              />
            </>
          )}
        </View>
      )}

      {step.key === "contact" && (
        <View style={styles.card}>
          <Text style={styles.hint}>Internal only. Never shown publicly.</Text>

          <Text style={styles.label}>Contact Name</Text>
          <TextInput
            style={styles.input}
            value={draft.contactName}
            onChangeText={(value) => updateDraft({ contactName: value })}
            placeholder="Who to ask for"
            placeholderTextColor={palette.textMuted}
          />

          <Text style={styles.label}>Contact Phone</Text>
          <TextInput
            style={styles.input}
            value={draft.contactPhone}
            onChangeText={(value) => updateDraft({ contactPhone: value })}
            onBlur={() => updateDraft({ contactPhone: formatPhone(draft.contactPhone) })}
            placeholder="(415) 555-1234"
            placeholderTextColor={palette.textMuted}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Contact Email</Text>
          <TextInput
            style={styles.input}
            value={draft.contactEmail}
            onChangeText={(value) => updateDraft({ contactEmail: value })}
            onBlur={() => updateDraft({ contactEmail: normalizeEmail(draft.contactEmail) })}
            placeholder="you@yourbusiness.com"
            placeholderTextColor={palette.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>How did you hear about SFLuv?</Text>
          <OptionRow
            options={REFERRAL_OPTIONS}
            value={draft.referralSource}
            onSelect={(value) => updateDraft({ referralSource: value })}
            styles={styles}
          />
          {draft.referralSource === OTHER && (
            <TextInput
              style={styles.input}
              value={referralOther}
              onChangeText={(value) => {
                setReferralOther(value);
                setError(null);
              }}
              placeholder="How you heard about SFLuv"
              placeholderTextColor={palette.textMuted}
            />
          )}
        </View>
      )}

      {step.key === "payment" && (
        <View style={styles.card}>
          <Text style={styles.label}>POS Type</Text>
          <OptionRow
            options={POS_OPTIONS}
            value={draft.posSystem}
            onSelect={(value) => updateDraft({ posSystem: value })}
            styles={styles}
          />
          {draft.posSystem === OTHER && (
            <TextInput
              style={styles.input}
              value={posOther}
              onChangeText={(value) => {
                setPosOther(value);
                setError(null);
              }}
              placeholder="Your point of sale system"
              placeholderTextColor={palette.textMuted}
            />
          )}

          <Text style={styles.label}>Do you accept tips?</Text>
          <Text style={styles.hint}>
            Yes gives this location its own tipping wallet at approval.
          </Text>
          <YesNoRow
            value={draft.acceptsTips}
            onSelect={(value) => updateDraft({ acceptsTips: value })}
            styles={styles}
          />

          <Text style={styles.label}>Tablet or phone available to staff?</Text>
          <YesNoRow
            value={draft.hasStaffTablet}
            onSelect={(value) => updateDraft({ hasStaffTablet: value })}
            styles={styles}
          />
        </View>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.actions}>
        <Pressable
          style={[styles.secondaryButton, stepIndex === 0 && styles.buttonDisabled]}
          disabled={stepIndex === 0 || submitting}
          onPress={() => {
            setError(null);
            setStepIndex((current) => Math.max(current - 1, 0));
          }}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
        {stepIndex < STEPS.length - 1 ? (
          <Pressable style={styles.primaryButton} onPress={goNext}>
            <Text style={styles.primaryButtonText}>Continue</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.primaryButton, submitting && styles.buttonDisabled]}
            disabled={submitting}
            onPress={() => void submit()}
          >
            <Text style={styles.primaryButtonText}>
              {submitting ? "Submitting..." : "Submit application"}
            </Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

function OptionRow({
  options,
  value,
  onSelect,
  styles,
}: {
  options: string[];
  value: string;
  onSelect: (value: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.optionWrap}>
      {options.map((option) => (
        <Pressable
          key={option}
          style={[styles.option, value === option && styles.optionActive]}
          onPress={() => onSelect(option)}
        >
          <Text style={[styles.optionText, value === option && styles.optionTextActive]}>
            {option}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function YesNoRow({
  value,
  onSelect,
  styles,
}: {
  value: boolean | null;
  onSelect: (value: boolean) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.optionWrap}>
      {[
        { label: "Yes", answer: true },
        { label: "No", answer: false },
      ].map((entry) => (
        <Pressable
          key={entry.label}
          style={[styles.option, value === entry.answer && styles.optionActive]}
          onPress={() => onSelect(entry.answer)}
        >
          <Text style={[styles.optionText, value === entry.answer && styles.optionTextActive]}>
            {entry.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    container: {
      padding: spacing.lg,
      gap: spacing.md,
      paddingBottom: 100,
      backgroundColor: palette.background,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    back: { color: palette.primary, fontWeight: "700" },
    backSpacer: { width: 44 },
    title: { color: palette.text, fontSize: 18, fontWeight: "800" },
    rail: { flexDirection: "row", alignItems: "center" },
    railLine: {
      flex: 1,
      height: 1,
      marginHorizontal: spacing.xs,
      backgroundColor: palette.border,
    },
    railLineActive: { backgroundColor: palette.primary },
    railDot: {
      height: 28,
      width: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    railDotActive: { backgroundColor: palette.primary, borderColor: palette.primary },
    railDotText: { color: palette.textMuted, fontSize: 12, fontWeight: "700" },
    railDotTextActive: { color: palette.surface },
    stepTitle: { color: palette.text, fontSize: 20, fontWeight: "800" },
    card: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.soft,
    },
    label: { color: palette.text, fontWeight: "700" },
    hint: { color: palette.textMuted, fontSize: 12, lineHeight: 16 },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      color: palette.text,
      backgroundColor: palette.background,
    },
    multiline: { minHeight: 88, textAlignVertical: "top" },
    chooser: { gap: spacing.xs },
    searchWrap: { justifyContent: "center" },
    searchInput: { paddingRight: 40 },
    searchAdornment: {
      position: "absolute",
      right: spacing.sm,
      height: 24,
      width: 24,
      alignItems: "center",
      justifyContent: "center",
    },
    clearGlyph: { color: palette.textMuted, fontSize: 15, fontWeight: "700" },
    suggestions: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.sm,
      backgroundColor: palette.surface,
      overflow: "hidden",
    },
    suggestion: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: palette.border,
    },
    suggestionPrimary: { color: palette.text, fontSize: 14 },
    suggestionSecondary: { color: palette.textMuted, fontSize: 12 },
    searchError: { color: palette.danger, fontSize: 12, lineHeight: 16 },
    statusBlock: { gap: spacing.xs },
    statusFound: { color: palette.success, fontSize: 12, fontWeight: "700" },
    statusAddress: { color: palette.warning, fontSize: 12, fontWeight: "700" },
    checkboxRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
    checkbox: {
      height: 18,
      width: 18,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxChecked: { backgroundColor: palette.primary, borderColor: palette.primary },
    checkboxGlyph: { color: palette.surface, fontSize: 11, fontWeight: "800" },
    optionWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    option: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
    },
    optionActive: { borderColor: palette.primary, backgroundColor: palette.primarySoft },
    optionText: { color: palette.textMuted, fontSize: 13 },
    optionTextActive: { color: palette.text, fontWeight: "700" },
    error: { color: palette.danger, lineHeight: 18 },
    actions: { flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
    primaryButton: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: palette.primary,
    },
    primaryButtonText: { color: palette.surface, fontWeight: "800" },
    secondaryButton: {
      flex: 1,
      alignItems: "center",
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
    },
    secondaryButtonText: { color: palette.text, fontWeight: "700" },
    buttonDisabled: { opacity: 0.5 },
    confirmation: { gap: spacing.md, paddingTop: spacing.xl, alignItems: "center" },
    confirmationTitle: {
      color: palette.text,
      fontSize: 20,
      fontWeight: "800",
      textAlign: "center",
    },
  });
}
