import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ethers } from "ethers";
import { AppContact } from "../types/app";
import { Palette, getShadows, radii, spacing, useAppTheme } from "../theme";

type Props = {
  contacts: AppContact[];
  syncNotice?: string | null;
  onAddContact: (name: string, address: string) => Promise<void>;
  onUpdateContact: (contact: AppContact) => Promise<void>;
  onToggleFavorite: (contact: AppContact) => Promise<void>;
  onDeleteContact: (contactID: number) => Promise<void>;
};

function shortAddress(address: string): string {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function validateContactInput(name: string, address: string): string | null {
  if (!name.trim()) {
    return "Enter a contact name.";
  }
  if (!ethers.utils.isAddress(address.trim())) {
    return "Enter a valid wallet address.";
  }
  return null;
}

export function ContactsScreen({
  contacts,
  syncNotice,
  onAddContact,
  onUpdateContact,
  onToggleFavorite,
  onDeleteContact,
}: Props) {
  const { palette, shadows } = useAppTheme();
  const styles = useMemo(() => createStyles(palette, shadows), [palette, shadows]);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState("");
  const [editingID, setEditingID] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingAddress, setEditingAddress] = useState("");
  const [busyID, setBusyID] = useState<number | "new" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sortedContacts = useMemo(() => {
    return [...contacts].sort((left, right) => {
      if (left.isFavorite !== right.isFavorite) {
        return left.isFavorite ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  }, [contacts]);

  const beginEdit = (contact: AppContact) => {
    setEditingID(contact.id);
    setEditingName(contact.name);
    setEditingAddress(contact.address);
    setErrorMessage(null);
  };

  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <Text style={styles.title}>Contacts</Text>
        <Text style={styles.subtitle}>Save the people and wallets you send to often, then rename or clean them up here.</Text>
      </View>

      {syncNotice ? (
        <View style={styles.noticeCard}>
          <Text style={styles.noticeTitle}>App Sync</Text>
          <Text style={styles.body}>{syncNotice}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Add contact</Text>
        <View style={styles.formStack}>
          <TextInput
            style={styles.input}
            value={draftName}
            onChangeText={setDraftName}
            placeholder="Contact name"
            placeholderTextColor={palette.textMuted}
          />
          <TextInput
            style={styles.input}
            value={draftAddress}
            onChangeText={setDraftAddress}
            placeholder="0x address"
            placeholderTextColor={palette.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
          <Pressable
            style={[styles.primaryButton, busyID === "new" ? styles.buttonDisabled : undefined]}
            disabled={busyID === "new"}
            onPress={async () => {
              const validationError = validateContactInput(draftName, draftAddress);
              if (validationError) {
                setErrorMessage(validationError);
                return;
              }

              setBusyID("new");
              setErrorMessage(null);
              try {
                await onAddContact(draftName.trim(), ethers.utils.getAddress(draftAddress.trim()));
                setDraftName("");
                setDraftAddress("");
              } catch (error) {
                setErrorMessage((error as Error).message || "Unable to add contact.");
              } finally {
                setBusyID(null);
              }
            }}
          >
            {busyID === "new" ? (
              <ActivityIndicator size="small" color={palette.white} />
            ) : (
              <Text style={styles.primaryButtonText}>Save contact</Text>
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Saved contacts</Text>
          <Text style={styles.meta}>{sortedContacts.length}</Text>
        </View>

        {sortedContacts.length === 0 ? (
          <Text style={styles.body}>No contacts saved yet.</Text>
        ) : (
          sortedContacts.map((contact) => {
            const editing = editingID === contact.id;
            const busy = busyID === contact.id;

            return (
              <View key={contact.id} style={styles.contactCard}>
                <View style={styles.contactHeader}>
                  <View style={styles.contactTitleWrap}>
                    <Text style={styles.contactName}>{contact.name}</Text>
                    <Text style={styles.meta}>{shortAddress(contact.address)}</Text>
                  </View>
                  <Pressable
                    style={[styles.favoriteChip, contact.isFavorite ? styles.favoriteChipActive : undefined]}
                    onPress={async () => {
                      setBusyID(contact.id);
                      setErrorMessage(null);
                      try {
                        await onToggleFavorite(contact);
                      } catch (error) {
                        setErrorMessage((error as Error).message || "Unable to update favorite.");
                      } finally {
                        setBusyID(null);
                      }
                    }}
                  >
                    <Ionicons
                      name={contact.isFavorite ? "star" : "star-outline"}
                      size={14}
                      color={contact.isFavorite ? palette.primaryStrong : palette.textMuted}
                    />
                    <Text style={[styles.favoriteChipText, contact.isFavorite ? styles.favoriteChipTextActive : undefined]}>
                      {contact.isFavorite ? "Favorite" : "Mark favorite"}
                    </Text>
                  </Pressable>
                </View>

                {editing ? (
                  <View style={styles.formStack}>
                    <TextInput
                      style={styles.input}
                      value={editingName}
                      onChangeText={setEditingName}
                      placeholder="Contact name"
                      placeholderTextColor={palette.textMuted}
                    />
                    <TextInput
                      style={styles.input}
                      value={editingAddress}
                      onChangeText={setEditingAddress}
                      placeholder="0x address"
                      placeholderTextColor={palette.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <View style={styles.inlineActions}>
                      <Pressable
                        style={[styles.inlineButton, busy ? styles.buttonDisabled : undefined]}
                        disabled={busy}
                        onPress={async () => {
                          const validationError = validateContactInput(editingName, editingAddress);
                          if (validationError) {
                            setErrorMessage(validationError);
                            return;
                          }

                          setBusyID(contact.id);
                          setErrorMessage(null);
                          try {
                            await onUpdateContact({
                              ...contact,
                              name: editingName.trim(),
                              address: ethers.utils.getAddress(editingAddress.trim()),
                            });
                            setEditingID(null);
                            setEditingName("");
                            setEditingAddress("");
                          } catch (error) {
                            setErrorMessage((error as Error).message || "Unable to save contact.");
                          } finally {
                            setBusyID(null);
                          }
                        }}
                      >
                        <Text style={styles.inlineButtonText}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={styles.inlineButtonMuted}
                        onPress={() => {
                          setEditingID(null);
                          setEditingName("");
                          setEditingAddress("");
                          setErrorMessage(null);
                        }}
                      >
                        <Text style={styles.inlineButtonMutedText}>Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View style={styles.inlineActions}>
                    <Pressable style={styles.inlineButton} onPress={() => beginEdit(contact)}>
                      <Text style={styles.inlineButtonText}>Edit</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.inlineButtonDanger, busy ? styles.buttonDisabled : undefined]}
                      disabled={busy}
                      onPress={async () => {
                        setBusyID(contact.id);
                        setErrorMessage(null);
                        try {
                          await onDeleteContact(contact.id);
                          if (editingID === contact.id) {
                            setEditingID(null);
                          }
                        } catch (error) {
                          setErrorMessage((error as Error).message || "Unable to delete contact.");
                        } finally {
                          setBusyID(null);
                        }
                      }}
                    >
                      <Text style={styles.inlineButtonDangerText}>Delete</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
}

function createStyles(palette: Palette, shadows: ReturnType<typeof getShadows>) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.md,
      paddingBottom: 120,
    },
    heroCard: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.lg,
      gap: spacing.xs,
      ...shadows.soft,
    },
    title: {
      color: palette.text,
      fontSize: 28,
      fontWeight: "900",
      letterSpacing: -0.4,
    },
    subtitle: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    noticeCard: {
      backgroundColor: palette.primarySoft,
      borderWidth: 1,
      borderColor: palette.primary,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    noticeTitle: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 16,
    },
    card: {
      backgroundColor: palette.surface,
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: palette.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.soft,
    },
    sectionTitle: {
      color: palette.text,
      fontSize: 18,
      fontWeight: "900",
    },
    listHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    formStack: {
      gap: spacing.sm,
    },
    input: {
      backgroundColor: palette.surfaceStrong,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radii.md,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: palette.text,
    },
    primaryButton: {
      minHeight: 48,
      backgroundColor: palette.primary,
      borderRadius: radii.md,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonText: {
      color: palette.white,
      fontWeight: "800",
    },
    contactCard: {
      backgroundColor: palette.surfaceMuted,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 14,
      gap: spacing.sm,
    },
    contactHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    contactTitleWrap: {
      flex: 1,
      gap: 4,
    },
    contactName: {
      color: palette.text,
      fontWeight: "900",
      fontSize: 16,
    },
    favoriteChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    favoriteChipActive: {
      borderColor: palette.primary,
      backgroundColor: palette.primarySoft,
    },
    favoriteChipText: {
      color: palette.textMuted,
      fontWeight: "700",
      fontSize: 12,
    },
    favoriteChipTextActive: {
      color: palette.primaryStrong,
    },
    inlineActions: {
      flexDirection: "row",
      gap: 8,
    },
    inlineButton: {
      flex: 1,
      backgroundColor: palette.surfaceStrong,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonText: {
      color: palette.text,
      fontWeight: "800",
      fontSize: 12,
    },
    inlineButtonMuted: {
      flex: 1,
      backgroundColor: palette.surface,
      borderRadius: radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonMutedText: {
      color: palette.textMuted,
      fontWeight: "800",
      fontSize: 12,
    },
    inlineButtonDanger: {
      flex: 1,
      backgroundColor: palette.primaryMuted,
      borderRadius: radii.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      alignItems: "center",
    },
    inlineButtonDangerText: {
      color: palette.danger,
      fontWeight: "800",
      fontSize: 12,
    },
    body: {
      color: palette.textMuted,
      lineHeight: 21,
    },
    meta: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    errorText: {
      color: palette.danger,
      lineHeight: 20,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
}
