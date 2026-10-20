import { useEffect, useState } from "react";
import { AppBackendClient } from "../services/appBackend";

// Bulletin photos are only served to signed-in people who can see the post, so
// they are fetched with the session and shown as data URIs (the same approach
// as workflow photos). A small in-memory cache keeps scrolling the feed from
// refetching what is already on screen.
const MAX_CACHED = 80;
const cache = new Map<number, string>();
const inflight = new Map<number, Promise<string | null>>();

function remember(id: number, uri: string) {
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(id, uri);
}

export function useBulletinPhoto(client: AppBackendClient | null | undefined, photoId: number | null | undefined): string | null {
  const [uri, setUri] = useState<string | null>(() => (photoId ? cache.get(photoId) ?? null : null));

  useEffect(() => {
    if (!client || !photoId) {
      setUri(null);
      return;
    }
    const cached = cache.get(photoId);
    if (cached) {
      setUri(cached);
      return;
    }
    let cancelled = false;
    let request = inflight.get(photoId);
    if (!request) {
      request = client.getBulletinPhotoDataUri(photoId).catch(() => null);
      inflight.set(photoId, request);
    }
    void request.then((result) => {
      inflight.delete(photoId);
      if (result) remember(photoId, result);
      if (!cancelled) setUri(result);
    });
    return () => {
      cancelled = true;
    };
  }, [client, photoId]);

  return uri;
}
