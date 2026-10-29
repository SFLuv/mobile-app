import { useSyncExternalStore } from "react";

import type { AppContact } from "../types/app";

/**
 * Pictures you gave your contacts, for every surface that draws a person.
 *
 * A contact's picture is yours, not theirs: the one you chose for "PJ" in
 * Contacts. Like the phone's own Contacts, it wins over the picture they set on
 * their profile — anywhere that person appears (the Contacts list, the inbox, a
 * chat's header, a sender's bubble, a banner), not only on their contact card.
 *
 * The shell publishes its contact list here; ChatAvatar reads it by user id.
 * Only contacts whose address belongs to an account (`userId`) can be matched to
 * a chat, and only ones with a picture (`hasAvatar`) are listed.
 *
 * `version` is part of the image URL. The picture's URL is otherwise the same
 * before and after a change, and the image cache would keep showing the old
 * one. It starts from the launch time so a cache kept across launches cannot
 * serve a picture replaced in an earlier session either.
 */

let byUserId = new Map<string, number>();
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

export function publishContactPictures(contacts: AppContact[]): void {
  const next = new Map<string, number>();
  for (const contact of contacts) {
    if (contact.userId && contact.hasAvatar && !next.has(contact.userId)) {
      next.set(contact.userId, contact.id);
    }
  }
  const same = next.size === byUserId.size && [...next].every(([userId, id]) => byUserId.get(userId) === id);
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
  return useSyncExternalStore(subscribe, () => (userId ? byUserId.get(userId) ?? null : null));
}

export function useContactPictureVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
