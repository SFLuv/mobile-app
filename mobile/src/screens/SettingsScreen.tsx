import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AppContact, AppOwnedLocation, AppUser, PonderSubscription, VerifiedEmail } from "../types/app";
import { palette, radii, spacing } from "../theme";

type Props = {
  user: AppUser | null;
  contacts: AppContact[];
  locations: AppOwnedLocation[];
  verifiedEmails: VerifiedEmail[];
  notificationSubscription?: PonderSubscription;
  activeWalletAddress?: string;
  syncNotice?: string | null;
  onOpenMerchantApplication: () => void;
  onAddContact: (name: string, address: string) => Promise<void>;
  onToggleFavorite: (contact: AppContact) => Promise<void>;
  onDeleteContact: (contactID: number) => Promise<void>;
  onEnableNotification: (email: string, address: string) => Promise<void>;
  onDisableNotification: (id: number) => Promise<void>;
  onLogout: () => void;
};

function merchantStatus(locations: AppOwnedLocation[]): string {
  if (locations.length === 0) {
    return "No application";
  }
  if (locations.some((location) => location.approval === true)) {
    return "Approved";
  }
  if (locations.some((location) => location.approval === null || typeof location.approval === "undefined")) {
    return "Pending";
  }
  return "Not approved";
}

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

export function SettingsScreen({
  user,
  contacts,
  locations,
  verifiedEmails,
  notificationSubscription,
  activeWalletAddress,
  syncNotice,
  onOpenMerchantApplication,
  onAddContact,
  onToggleFavorite,
  onDeleteContact,
  onEnableNotification,
  onDisableNotification,
  onLogout,
}: Props) {
  const [contactName, setContactName] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [selectedEmail, setSelectedEmail] = useState("");
  const verifiedOnly = useMemo(
    () => verifiedEmails.filter((entry) => entry.status === "verified"),
    [verifiedEmails],
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Profile, contacts, merchant status, and wallet notifications.</Text>

      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{user?.name || "SFLUV User"}</Text>
        <Text style={styles.meta}>User ID: {user?.id || "Not loaded"}</Text>
        <Text style={styles.meta}>Merchant status: {merchantStatus(locations)}</Text>
        {user?.contactEmail ? <Text style={styles.meta}>Email: {user.contactEmail}</Text> : null}
      </View>

      <View style={styles.card}>
        <View style={styles.rowHeader}>
          <Text style={styles.sectionTitle}>Merchant Application</Text>
          <Pressable onPress={onOpenMerchantApplication}>
            <Text style={styles.link}>Open</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>
          Apply to become a merchant and track the approval state of your submitted locations.
        </Text>
        {locations.length > 0 ? (
          locations.map((location) => (
            <View key={location.id} style={styles.subCard}>
              <Text style={styles.subCardTitle}>{location.name}</Text>
              <Text style={styles.meta}>
                {location.approval === true
                  ? "Approved"
                  : location.approval === false
                    ? "Not approved"
                    : "Pending"}
              </Text>
            </View>
          ))
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Verified Emails</Text>
        {verifiedEmails.length === 0 ? (
          <Text style={styles.body}>No verified emails were found for this account yet.</Text>
        ) : (
          verifiedEmails.map((email) => (
            <View key={email.id} style={styles.subCard}>
              <Text style={styles.subCardTitle}>{email.email}</Text>
              <Text style={styles.meta}>Status: {email.status}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Wallet Email Alerts</Text>
        <Text style={styles.body}>
          This mirrors the current web notification flow. Native push can be added later without changing this screen shape.
        </Text>
        {notificationSubscription ? (
          <View style={styles.subCard}>
            <Text style={styles.subCardTitle}>{notificationSubscription.email}</Text>
            <Text style={styles.meta}>{shortAddress(notificationSubscription.address)}</Text>
            <Pressable
              style={styles.inlineButton}
              onPress={() => void onDisableNotification(notificationSubscription.id)}
            >
              <Text style={styles.inlineButtonText}>Disable</Text>
            </Pressable>
          </View>
        ) : verifiedOnly.length > 0 && activeWalletAddress ? (
          <>
            <TextInput
              style={styles.input}
              value={selectedEmail}
              onChangeText={setSelectedEmail}
              placeholder={verifiedOnly[0].email}
              autoCapitalize="none"
            />
            <Pressable
              style={styles.primaryButton}
              onPress={() => void onEnableNotification(selectedEmail.trim() || verifiedOnly[0].email, activeWalletAddress)}
            >
              <Text style={styles.primaryButtonText}>Enable email alerts</Text>
            </Pressable>
          </>
        ) : (
          <Text style={styles.body}>Verify an email on the web app first to enable alerts.</Text>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Contacts</Text>
        <View style={styles.inputGroup}>
          <TextInput
            style={styles.input}
            value={contactName}
            onChangeText={setContactName}
            placeholder="Contact name"
          />
          <TextInput
            style={styles.input}
            value={contactAddress}
            onChangeText={setContactAddress}
            placeholder="0x address"
            autoCapitalize="none"
          />
          <Pressable
            style={styles.primaryButton}
            onPress={async () => {
              await onAddContact(contactName, contactAddress);
              setContactName("");
              setContactAddress("");
            }}
          >
            <Text style={styles.primaryButtonText}>Add contact</Text>
          </Pressable>
        </View>

        {contacts.length === 0 ? (
          <Text style={styles.body}>No contacts saved yet.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.subCard}>
              <View style={styles.subCardBody}>
                <Text style={styles.subCardTitle}>{contact.name}</Text>
                <Text style={styles.meta}>{shortAddress(contact.address)}</Text>
              </View>
              <View style={styles.inlineActions}>
                <Pressable style={styles.inlineButton} onPress={() => void onToggleFavorite(contact)}>
                  <Text style={styles.inlineButtonText}>{contact.isFavorite ? "Unfavorite" : "Favorite"}</Text>
                </Pressable>
                <Pressable style={styles.inlineButtonDanger} onPress={() => void onDeleteContact(contact.id)}>
                  <Text style={styles.inlineButtonDangerText}>Delete</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable style={styles.logoutButton} onPress={onLogout}>
        <Text style={styles.logoutButtonText}>Logout</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  card: {
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  noticeCard: {
    backgroundColor: "#fff4e5",
    borderWidth: 1,
    borderColor: "#f0c36d",
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  noticeTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 16,
  },
  sectionTitle: {
    color: palette.text,
    fontWeight: "800",
    fontSize: 18,
  },
  meta: {
    color: palette.textMuted,
    lineHeight: 20,
  },
  body: {
    color: palette.textMuted,
    lineHeight: 21,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  link: {
    color: palette.primary,
    fontWeight: "700",
  },
  subCard: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    padding: 12,
    gap: 8,
  },
  subCardBody: {
    gap: 4,
  },
  subCardTitle: {
    color: palette.text,
    fontWeight: "800",
  },
  inputGroup: {
    gap: 10,
  },
  input: {
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: radii.md,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: palette.text,
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
  inlineActions: {
    flexDirection: "row",
    gap: 8,
  },
  inlineButton: {
    backgroundColor: palette.surfaceStrong,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inlineButtonText: {
    color: palette.text,
    fontWeight: "700",
    fontSize: 12,
  },
  inlineButtonDanger: {
    backgroundColor: palette.primaryMuted,
    borderRadius: radii.sm,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  inlineButtonDangerText: {
    color: palette.danger,
    fontWeight: "700",
    fontSize: 12,
  },
  logoutButton: {
    backgroundColor: palette.text,
    borderRadius: radii.md,
    paddingVertical: 15,
    alignItems: "center",
  },
  logoutButtonText: {
    color: palette.white,
    fontWeight: "800",
  },
});
