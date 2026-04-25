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

type Props = {
  onClose: () => void;
  onSubmit: (draft: MerchantApplicationDraft) => Promise<void>;
};

const DRAFT_TEMPLATE: MerchantApplicationDraft = {
  place: null,
  description: "",
  businessPhone: "",
  businessEmail: "",
  primaryContactEmail: "",
  primaryContactFirstName: "",
  primaryContactLastName: "",
  primaryContactPhone: "",
  posSystem: "",
  soleProprietorship: "",
  tippingPolicy: "",
  tippingDivision: "",
  tableCoverage: "",
  serviceStations: "",
  tabletModel: "",
  messagingService: "",
  reference: "",
};

export function MerchantApplicationScreen({ onClose, onSubmit }: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MerchantPlaceCandidate[]>([]);
  const [draft, setDraft] = useState<MerchantApplicationDraft>(DRAFT_TEMPLATE);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSummary = useMemo(() => {
    if (!draft.place) {
      return "Search for your business first";
    }
    return `${draft.place.name} • ${draft.place.street}, ${draft.place.city}`;
  }, [draft.place]);

  const updateDraft = (patch: Partial<MerchantApplicationDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const runSearch = async () => {
    try {
      setSearching(true);
      setError(null);
      const matches = await searchMerchantPlaces(query);
      setResults(matches);
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
        businessPhone: current.businessPhone || details.phone,
      }));
      setResults([]);
      setQuery(details.name);
    } catch (detailsError) {
      setError((detailsError as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const submit = async () => {
    try {
      setSubmitting(true);
      setError(null);
      await onSubmit(draft);
      setDraft(DRAFT_TEMPLATE);
      setQuery("");
      setResults([]);
      onClose();
    } catch (submitError) {
      setError((submitError as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onClose}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Merchant Application</Text>
        <View style={styles.backSpacer} />
      </View>

      <Text style={styles.subtitle}>
        This mirrors the existing web merchant form, but arranged for a mobile submission flow.
      </Text>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>1. Find Your Business</Text>
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Business name or address"
        />
        <Pressable style={styles.primaryButton} onPress={() => void runSearch()}>
          <Text style={styles.primaryButtonText}>Search Google Places</Text>
        </Pressable>
        <Text style={styles.selectedText}>{selectedSummary}</Text>
        {searching ? <ThemedActivityIndicator color={palette.primaryStrong} /> : null}
        {results.map((result) => (
          <Pressable key={result.googleId} style={styles.resultCard} onPress={() => void choosePlace(result.googleId)}>
            <Text style={styles.resultTitle}>{result.name}</Text>
            <Text style={styles.resultMeta}>{result.addressLine}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>2. Business Details</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={draft.description}
          onChangeText={(value) => updateDraft({ description: value })}
          placeholder="Business description"
          multiline
        />
        <TextInput
          style={styles.input}
          value={draft.businessPhone}
          onChangeText={(value) => updateDraft({ businessPhone: value })}
          placeholder="Business phone"
        />
        <TextInput
          style={styles.input}
          value={draft.businessEmail}
          onChangeText={(value) => updateDraft({ businessEmail: value })}
          placeholder="Business email"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>3. Primary Contact</Text>
        <TextInput
          style={styles.input}
          value={draft.primaryContactFirstName}
          onChangeText={(value) => updateDraft({ primaryContactFirstName: value })}
          placeholder="First name"
        />
        <TextInput
          style={styles.input}
          value={draft.primaryContactLastName}
          onChangeText={(value) => updateDraft({ primaryContactLastName: value })}
          placeholder="Last name"
        />
        <TextInput
          style={styles.input}
          value={draft.primaryContactPhone}
          onChangeText={(value) => updateDraft({ primaryContactPhone: value })}
          placeholder="Phone"
        />
        <TextInput
          style={styles.input}
          value={draft.primaryContactEmail}
          onChangeText={(value) => updateDraft({ primaryContactEmail: value })}
          placeholder="Email"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>4. Operations</Text>
        <TextInput
          style={styles.input}
          value={draft.posSystem}
          onChangeText={(value) => updateDraft({ posSystem: value })}
          placeholder="POS system"
        />
        <TextInput
          style={styles.input}
          value={draft.soleProprietorship}
          onChangeText={(value) => updateDraft({ soleProprietorship: value })}
          placeholder="Sole proprietorship"
        />
        <TextInput
          style={styles.input}
          value={draft.tippingPolicy}
          onChangeText={(value) => updateDraft({ tippingPolicy: value })}
          placeholder="Tipping policy"
        />
        <TextInput
          style={styles.input}
          value={draft.tippingDivision}
          onChangeText={(value) => updateDraft({ tippingDivision: value })}
          placeholder="Tip division"
        />
        <TextInput
          style={styles.input}
          value={draft.tableCoverage}
          onChangeText={(value) => updateDraft({ tableCoverage: value })}
          placeholder="Table coverage"
        />
        <TextInput
          style={styles.input}
          value={draft.serviceStations}
          onChangeText={(value) => updateDraft({ serviceStations: value })}
          placeholder="Number of service stations"
          keyboardType="number-pad"
        />
        <TextInput
          style={styles.input}
          value={draft.tabletModel}
          onChangeText={(value) => updateDraft({ tabletModel: value })}
          placeholder="Tablet model"
        />
        <TextInput
          style={styles.input}
          value={draft.messagingService}
          onChangeText={(value) => updateDraft({ messagingService: value })}
          placeholder="Messaging service"
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          value={draft.reference}
          onChangeText={(value) => updateDraft({ reference: value })}
          placeholder="Reference or notes"
          multiline
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.primaryButton, submitting ? styles.disabled : undefined]}
        onPress={() => void submit()}
        disabled={submitting}
      >
        <Text style={styles.primaryButtonText}>{submitting ? "Submitting..." : "Submit Application"}</Text>
      </Pressable>
    </ScrollView>
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
    back: {
      color: palette.primary,
      fontWeight: "700",
    },
    backSpacer: {
      width: 32,
    },
    title: {
      color: palette.text,
      fontSize: 24,
      fontWeight: "900",
    },
    subtitle: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    card: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.soft,
    },
    sectionTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 18,
    },
    input: {
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: palette.text,
    },
    textArea: {
      minHeight: 100,
      textAlignVertical: "top",
    },
    primaryButton: {
      backgroundColor: palette.primary,
      borderRadius: radii.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    primaryButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    selectedText: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    resultCard: {
      backgroundColor: palette.surfaceMuted,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      padding: 12,
    },
    resultTitle: {
      color: palette.text,
      fontWeight: "800",
    },
    resultMeta: {
      color: palette.textMuted,
      marginTop: 4,
    },
    error: {
      color: palette.danger,
      lineHeight: 20,
    },
    disabled: {
      opacity: 0.7,
    },
  });
}
