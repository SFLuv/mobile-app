import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { MerchantPinDisplay, MerchantPinKeypad, MerchantPinSlider } from "../components/MerchantPinEntry";
import { ThemedActivityIndicator } from "../components/ThemedActivityIndicator";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";
import type { AppMerchantModeLocation } from "../types/app";

type Props = {
  /** Shops this device may be put to work at. Empty means none is approved yet. */
  locations: AppMerchantModeLocation[];
  /**
   * False until both answers this screen needs are in. An empty list before the
   * fetch answers is not "nothing is approved", and asking someone to choose a
   * PIN when they already have one is a dead end they cannot type their way out
   * of.
   */
  ready: boolean;
  /** Whether this merchant has ever set a PIN — on this device or any other. */
  passcodeSet: boolean;
  /**
   * True once any of this merchant's locations is approved. With an empty
   * `locations` list that is the difference between "still being reviewed" and
   * "approved, but nowhere for the money to land" — two waits with two
   * different people to chase.
   */
  hasApprovedLocation: boolean;
  busy: boolean;
  onCreatePin: (pin: string) => Promise<void>;
  onConfirmPin: (pin: string) => Promise<void>;
  onSelectLocation: (locationID: number) => Promise<void>;
  onRefresh: () => void | Promise<void>;
  onLogout: () => void;
};

/**
 * What a merchant account meets on a device that is not yet a till.
 *
 * A merchant account has no consumer app to fall back to, so this is the first
 * screen rather than an option inside settings: PIN, then which counter this
 * device is. It also has to answer the case where there is nothing to sync to —
 * a merchant whose location has not been approved yet — because "always in
 * merchant mode" would otherwise leave them staring at a screen with no valid
 * state.
 */
export function MerchantDeviceSetupScreen({
  locations,
  ready,
  passcodeSet,
  hasApprovedLocation,
  busy,
  onCreatePin,
  onConfirmPin,
  onSelectLocation,
  onRefresh,
  onLogout,
}: Props) {
  const { palette } = useAppTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinVisible, setPinVisible] = useState(false);
  const [field, setField] = useState<"pin" | "confirm">("pin");
  const [pinAccepted, setPinAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A merchant who sets their PIN on a second device arrives here with
  // passcodeSet already true, so which question this screen asks can change
  // under it while it is open.
  useEffect(() => {
    setField("pin");
  }, [passcodeSet]);

  const appendDigit = (digit: string) => {
    const update = field === "confirm" ? setPinConfirm : setPin;
    update((current) => `${current}${digit}`.replace(/\D/g, "").slice(0, 6));
    setError(null);
  };

  const removeDigit = () => {
    const update = field === "confirm" ? setPinConfirm : setPin;
    update((current) => current.slice(0, -1));
    setError(null);
  };

  const pinValid = /^\d{6}$/.test(pin);
  const confirmValid = /^\d{6}$/.test(pinConfirm);

  const submitPin = async () => {
    setError(null);
    try {
      if (passcodeSet) {
        await onConfirmPin(pin);
      } else {
        // Checked here rather than on the server, which has nothing to compare
        // against on a first PIN. A typo at this point locks the owner out of
        // their own till until support resets it, which is why it is asked twice.
        if (pin !== pinConfirm) {
          setError("Those PINs do not match.");
          return;
        }
        await onCreatePin(pin);
      }
      setPin("");
      setPinConfirm("");
      setPinAccepted(true);
    } catch (submitError) {
      setError((submitError as Error)?.message || "That PIN was not accepted.");
    }
  };

  const selectLocation = async (locationID: number) => {
    setError(null);
    try {
      await onSelectLocation(locationID);
    } catch (selectError) {
      setError((selectError as Error)?.message || "Unable to sync this device to that location.");
    }
  };

  // The way out is offered even here. A merchant account has no consumer app to
  // fall back to, so a backend that never answers would otherwise be a device
  // nobody can do anything with, not even sign out of.
  if (!ready) {
    return (
      <View style={styles.centre}>
        <ThemedActivityIndicator size="large" color={palette.primaryStrong} />
        <Text style={styles.body}>Checking your locations...</Text>
        <Pressable onPress={onLogout}>
          <Text style={styles.quietLink}>Sign out</Text>
        </Pressable>
      </View>
    );
  }

  // Nothing to sync to. Said plainly and with something to press, because the
  // alternative — a device that is permanently mid-setup — reads as broken.
  if (locations.length === 0) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="time-outline" size={26} color={palette.primaryStrong} />
          </View>
          <Text style={styles.title}>
            {hasApprovedLocation ? "This location cannot take payments yet" : "Your location is being reviewed"}
          </Text>
          <Text style={styles.body}>
            {hasApprovedLocation
              ? "Your location is approved, but it has no payment wallet, so there is nowhere for a customer's SFLuv to land. SFLuv support has to set that up before this device can be a till."
              : "This device becomes a till as soon as one of your locations is approved and has somewhere for payments to land. Nothing to do here until then."}
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => void onRefresh()}>
            <Text style={styles.primaryButtonText}>Check again</Text>
          </Pressable>
          <Pressable onPress={onLogout}>
            <Text style={styles.quietLink}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (!pinAccepted) {
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={26} color={palette.primaryStrong} />
          </View>
          <Text style={styles.title}>{passcodeSet ? "Enter your Merchant PIN" : "Choose a Merchant PIN"}</Text>
          <Text style={styles.body}>
            {passcodeSet
              ? "The 6 digit PIN for this business. It is asked for again whenever this device moves to another location."
              : "6 digits, shared by everyone who sets up a device for this business. Keep it away from the counter."}
          </Text>

          <Pressable onPress={() => setField("pin")}>
            <Text style={styles.fieldLabel}>{passcodeSet ? "PIN" : "New PIN"}</Text>
            <View style={field === "pin" ? styles.fieldActive : undefined}>
              <MerchantPinDisplay
                value={pin}
                visible={pinVisible}
                onToggleVisible={() => setPinVisible((current) => !current)}
              />
            </View>
          </Pressable>

          {!passcodeSet ? (
            <Pressable onPress={() => setField("confirm")}>
              <Text style={styles.fieldLabel}>Confirm PIN</Text>
              <View style={field === "confirm" ? styles.fieldActive : undefined}>
                <MerchantPinDisplay
                  value={pinConfirm}
                  visible={pinVisible}
                  placeholder="Enter it again"
                  onToggleVisible={() => setPinVisible((current) => !current)}
                />
              </View>
            </Pressable>
          ) : null}

          <MerchantPinKeypad onDigit={appendDigit} onBackspace={removeDigit} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <MerchantPinSlider
            disabled={busy || !pinValid || (!passcodeSet && !confirmValid)}
            loading={Boolean(busy)}
            label={passcodeSet ? "Slide to unlock" : "Slide to save PIN"}
            loadingLabel={passcodeSet ? "Checking" : "Saving"}
            onComplete={() => {
              void submitPin();
            }}
          />
          <Pressable onPress={onLogout}>
            <Text style={styles.quietLink}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name="storefront-outline" size={26} color={palette.primaryStrong} />
        </View>
        <Text style={styles.title}>Which location is this device?</Text>
        <Text style={styles.body}>
          Payments taken here land in this location&apos;s wallet, and the day it shows is this location&apos;s day.
        </Text>
        <View style={styles.optionList}>
          {locations.map((location) => (
            <Pressable
              key={`merchant-setup-location-${location.id}`}
              style={styles.option}
              disabled={busy}
              onPress={() => void selectLocation(location.id)}
            >
              <View style={styles.optionCopy}>
                <Text style={styles.optionTitle}>{location.name || "Merchant location"}</Text>
                {location.street ? <Text style={styles.optionMeta}>{location.street}</Text> : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Pressable>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </ScrollView>
  );
}

function createStyles(palette: Palette) {
  const shadows = getShadows(palette);
  return StyleSheet.create({
    centre: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
    content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.md },
    card: {
      borderRadius: radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.card,
    },
    iconWrap: {
      width: 48,
      height: 48,
      borderRadius: radii.pill,
      backgroundColor: palette.primarySoft,
      alignItems: "center",
      justifyContent: "center",
    },
    title: { color: palette.text, fontSize: 20, fontWeight: "800" },
    body: { color: palette.textMuted, lineHeight: 20 },
    fieldLabel: { color: palette.textMuted, fontSize: 13, fontWeight: "700", marginBottom: spacing.xs },
    fieldActive: {
      borderRadius: radii.lg,
      borderWidth: 2,
      borderColor: palette.primaryStrong,
    },
    optionList: { gap: spacing.xs },
    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      minHeight: 60,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceMuted,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    optionCopy: { flex: 1, gap: 2 },
    optionTitle: { color: palette.text, fontSize: 16, fontWeight: "700" },
    optionMeta: { color: palette.textMuted, fontSize: 13 },
    primaryButton: {
      minHeight: 50,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: palette.primaryStrong,
    },
    primaryButtonText: { color: palette.white, fontWeight: "800" },
    quietLink: { color: palette.textMuted, textAlign: "center", fontWeight: "700", paddingVertical: spacing.xs },
    error: { color: palette.danger, lineHeight: 20, fontWeight: "700" },
  });
}
