import { useCallback, useSyncExternalStore } from "react";

import type { AppContact } from "../types/app";

/**
 * The name and picture you gave your contacts, for every surface that draws a
 * person.
 *
 * Both are yours, not theirs: what you called "PJ" in Contacts and the photo
 * you chose for him. Like the phone's own Contacts, they win over the name and
 * picture somebody set on their profile — anywhere that person appears (the
 * Contacts list, the inbox, a chat's header, a sender's bubble, chat info), not
 * only on their contact card. Rename or re-picture a contact and every one of
 * those updates, including a chat that is already open.
 *
 * The shell publishes its contact list here; screens read it by user id. Only
 * contacts whose address belongs to an account (`userId`) can be matched to a
 * chat.
 *
 * `version` is part of a contact picture's URL. That URL is otherwise the same
 * before and after a change, and the image cache would keep showing the old
 * picture. It starts from the launch time so a cache kept across launches
 * cannot serve a picture replaced in an earlier session either.
 */

type Override = { contactId: number; name: string; hasAvatar: boolean };

let byUserId = new Map<string, Override>();
let version = Date.now();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameOverride(a: Override | undefined, b: Override): boolean {
  return a !== undefined && a.contactId === b.contactId && a.name === b.name && a.hasAvatar === b.hasAvatar;
}

export function publishContactOverrides(contacts: AppContact[]): void {
  const next = new Map<string, Override>();
  for (const contact of contacts) {
    const name = contact.name.trim();
    if (!contact.userId || next.has(contact.userId)) {
      continue;
    }
    next.set(contact.userId, { contactId: contact.id, name, hasAvatar: contact.hasAvatar === true });
  }
  const same = next.size === byUserId.size && [...next].every(([userId, entry]) => sameOverride(byUserId.get(userId), entry));
  if (!same) {
    byUserId = next;
    emit();
  }
}

/** After a contact's picture is uploaded or removed, so cached copies are not reused. */
export function contactPictureChanged(): void {
  version += 1;
  emit();
}

/** The contact id whose picture stands for this person, if you gave them one. */
export function useContactPictureFor(userId: string | null | undefined): number | null {
  return useSyncExternalStore(subscribe, () => {
    const entry = userId ? byUserId.get(userId) : undefined;
    return entry?.hasAvatar ? entry.contactId : null;
  });
}

export function useContactPictureVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/**
 * `nameFor(userId, theirName)`: what you saved them as, or their own name.
 * The component re-renders whenever a contact is renamed.
 */
export function useContactNames(): (userId: string | null | undefined, fallback: string) => string {
  const current = useSyncExternalStore(subscribe, () => byUserId);
  return useCallback(
    (userId, fallback) => (userId ? current.get(userId)?.name || fallback : fallback),
    [current],
  );
}
