import React, { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { MerchantApplicationDraft, MerchantPlaceCandidate } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import { getMerchantPlaceDetails, searchMerchantPlaces } from "../services/googlePlaces";

/**
 * The Location Approval Form, on a phone.
 *
 * Deliberately the same three sections as the web app — Public Information,
 * Contact, Payment System — asking the same questions in the same order and
 * posting the same payload. The two are one form on two surfaces: an
 * application filed here reaches the review queue indistinguishable from one
 * filed in a browser, and an admin reading it should not be able to tell.
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
  place: null,
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Props = {
  onClose: () => void;
  onSubmit: (draft: MerchantApplicationDraft) => Promise<void>;
};

export function MerchantApplicationScreen({ onClose, onSubmit }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);

  const [stepIndex, setStepIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MerchantPlaceCandidate[]>([]);
  const [draft, setDraft] = useState<MerchantApplicationDraft>(DRAFT_TEMPLATE);
  // The write-ins behind an "Other" answer. Resolved into the draft on submit,
  // the same flattening the web form does, so the stored value is the answer
  // itself rather than the word "Other".
  const [posOther, setPosOther] = useState("");
  const [referralOther, setReferralOther] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEPS[stepIndex];

  // Google names and categorises a place wherever it has one, and the backend
  // overwrites both from its own server-side lookup. The merchant is asked only
  // for what Google could not answer.
  const googleOwnsName = Boolean(draft.place?.name);
  const googleOwnsType = Boolean(draft.place?.type);

  const updateDraft = (patch: Partial<MerchantApplicationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    try {
      setSearching(true);
      setError(null);
      setResults(await searchMerchantPlaces(query));
    } catch (searchError) {
      setError((searchError as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const choosePlace = async (googleID: string) => {
    try {
      setSearching(true);
      setError(null);
      const details = await getMerchantPlaceDetails(googleID);
      setDraft((current) => ({
        ...current,
        place: details,
        locationName: current.locationName || details.name,
        businessType: current.businessType || details.type,
        // Google's number only fills a gap: a merchant may publish a different
        // customer-facing one, and the backend treats theirs as authoritative.
        publicPhone: current.publicPhone || details.phone,
      }));
      setResults([]);
      setQuery(details.name || details.street);
    } catch (detailsError) {
      setError((detailsError as Error).message);
    } finally {
      setSearching(false);
    }
  };

  /** The first thing wrong with a step, or null. */
  const stepProblem = (key: StepKey): string | null => {
    if (key === "public") {
      if (!draft.place) return "Find your location and pick it from the list.";
      if (!draft.locationName.trim()) return "Enter your location name.";
      if (!draft.businessType.trim()) return "Enter your business type.";
      if (!draft.description.trim()) return "Enter a location description.";
      return null;
    }
    if (key === "contact") {
      if (!draft.contactName.trim()) return "Enter a contact name.";
      if (!draft.contactPhone.trim()) return "Enter a contact phone.";
      if (!EMAIL_PATTERN.test(draft.contactEmail.trim())) return "Enter a valid contact email.";
      if (!draft.referralSource) return "Tell us how you heard about SFLuv.";
      if (draft.referralSource === OTHER && !referralOther.trim()) {
        return "Tell us how you heard about SFLuv.";
      }
      return null;
    }
    if (!draft.posSystem) return "Pick your POS type.";
    if (draft.posSystem === OTHER && !posOther.trim()) return "Tell us which system you use.";
    if (draft.acceptsTips === null) return "Tell us whether this location accepts tips.";
    if (draft.hasStaffTablet === null) return "Tell us whether staff have a tablet or phone.";
    return null;
  };

  const goNext = () => {
    const problem = stepProblem(step.key);
    if (problem) {
      setError(problem);
      return;
    }
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
                <View
                  style={[styles.railLine, (done || current) && styles.railLineActive]}
                />
              )}
              <View
                style={[styles.railDot, (done || current) && styles.railDotActive]}
              >
                <Text
                  style={[styles.railDotText, (done || current) && styles.railDotTextActive]}
                >
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
          <Text style={styles.label}>
            {draft.place ? "Location Address" : "Find your location"}
          </Text>
          <View style={styles.searchRow}>
            <TextInput
              style={styles.input}
              value={query}
              onChangeText={setQuery}
              placeholder="Your business name"
              placeholderTextColor={palette.textMuted}
              onSubmitEditing={() => void runSearch()}
              returnKeyType="search"
              autoCorrect={false}
            />
            <Pressable style={styles.searchButton} onPress={() => void runSearch()}>
              <Text style={styles.searchButtonText}>Search</Text>
            </Pressable>
          </View>
          {searching && <ThemedActivityIndicator />}
          {results.map((candidate) => (
            <Pressable
              key={candidate.googleId}
              style={styles.result}
              onPress={() => void choosePlace(candidate.googleId)}
            >
              <Text style={styles.resultName}>{candidate.name}</Text>
              <Text style={styles.resultAddress}>{candidate.addressLine}</Text>
            </Pressable>
          ))}
          {draft.place && (
            <View style={styles.selected}>
              <Text style={styles.selectedName}>{draft.place.name}</Text>
              <Text style={styles.selectedAddress}>
                {[draft.place.street, draft.place.city, draft.place.state]
                  .filter(Boolean)
                  .join(", ")}
              </Text>
            </View>
          )}

          {/* The rest appears only once there is a place, matching the web
              app's first step: on the Google path the name, the category and
              the phone are answered by the place, so showing them first is a
              column of empty boxes about to fill themselves in. */}
          {draft.place && (
            <>
              <Text style={styles.label}>Location Name</Text>
              <TextInput
                style={[styles.input, googleOwnsName && styles.inputReadOnly]}
                value={draft.locationName}
                onChangeText={(value) => updateDraft({ locationName: value })}
                editable={!googleOwnsName}
                placeholder="Your business name"
                placeholderTextColor={palette.textMuted}
              />

              <Text style={styles.label}>Business Type</Text>
              <TextInput
                style={[styles.input, googleOwnsType && styles.inputReadOnly]}
                value={draft.businessType}
                onChangeText={(value) => updateDraft({ businessType: value })}
                editable={!googleOwnsType}
                placeholder="Cafe, bookshop, barber"
                placeholderTextColor={palette.textMuted}
              />

              <Text style={styles.label}>Location Description</Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                value={draft.description}
                onChangeText={(value) => updateDraft({ description: value })}
                placeholder="What you sell"
                placeholderTextColor={palette.textMuted}
                multiline
              />

              <Text style={styles.label}>Public Phone (optional)</Text>
              <Text style={styles.hint}>
                Shown on the map. Need not match your contact phone.
              </Text>
              <TextInput
                style={styles.input}
                value={draft.publicPhone}
                onChangeText={(value) => updateDraft({ publicPhone: value })}
                placeholder="Number for customers"
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
            placeholder="Number to reach you on"
            placeholderTextColor={palette.textMuted}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Contact Email</Text>
          <TextInput
            style={styles.input}
            value={draft.contactEmail}
            onChangeText={(value) => updateDraft({ contactEmail: value })}
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
              onChangeText={setReferralOther}
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
              onChangeText={setPosOther}
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
    inputReadOnly: { opacity: 0.6 },
    multiline: { minHeight: 88, textAlignVertical: "top" },
    searchRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
    searchButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radii.sm,
      backgroundColor: palette.primary,
    },
    searchButtonText: { color: palette.surface, fontWeight: "700" },
    result: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
      paddingVertical: spacing.sm,
    },
    resultName: { color: palette.text, fontWeight: "700" },
    resultAddress: { color: palette.textMuted, fontSize: 12 },
    selected: {
      borderRadius: radii.sm,
      padding: spacing.sm,
      backgroundColor: palette.background,
      borderWidth: 1,
      borderColor: palette.primary,
    },
    selectedName: { color: palette.text, fontWeight: "700" },
    selectedAddress: { color: palette.textMuted, fontSize: 12 },
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
