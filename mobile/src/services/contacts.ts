import AsyncStorage from "@react-native-async-storage/async-storage";
import { ethers } from "ethers";

export type SavedContact = {
  name: string;
  address: string;
};

const CONTACTS_KEY = "sfluv.contacts.v1";

export async function listContacts(): Promise<SavedContact[]> {
  const raw = await AsyncStorage.getItem(CONTACTS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as SavedContact[];
    return parsed.filter(
      (item) => typeof item?.name === "string" && ethers.utils.isAddress(item?.address ?? ""),
    );
  } catch {
    return [];
  }
}

export async function saveContact(nameRaw: string, addressRaw: string): Promise<SavedContact[]> {
  const name = nameRaw.trim();
  if (!name) {
    throw new Error("Contact name is required");
  }
  if (!ethers.utils.isAddress(addressRaw)) {
    throw new Error("Contact address is invalid");
  }

  const normalizedAddress = ethers.utils.getAddress(addressRaw);
  const existing = await listContacts();

  const withoutCurrent = existing.filter(
    (item) => item.address.toLowerCase() !== normalizedAddress.toLowerCase(),
  );
  const next = [...withoutCurrent, { name, address: normalizedAddress }].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  await AsyncStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
  return next;
}
