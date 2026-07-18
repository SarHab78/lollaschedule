import { cookies } from "next/headers";
import { getSessionEmail } from "./session";
import { kvGet, kvSet } from "./kv";
import { MANUAL_COOKIE, MANUAL_TTL } from "./manual";

// Server-side persistence for a visitor's saved friends (the schedules they've
// pasted in to compare against). Mirrors lib/manual.ts: signed-in accounts key
// by email so friends follow them across devices; anonymous visitors key by the
// same per-device manual_id cookie the pick flow already sets. Both live for a
// year in KV. localStorage in ScheduleClient is a fast local cache on top of
// this — this is the durable, cross-device source of truth.

export type StoredFriend = {
  name: string;
  ids: string[];
  color?: string;
  enabled?: boolean;
};

const accountKey = (email: string) => `friends:user:${email}`;
const cookieKey = (id: string) => `friends:${id}`;

// Storage key for the current visitor, or null when we can't identify them
// (a Spotify-only session with no email + no manual cookie) — then friends
// stay client-local only.
async function friendsKey(): Promise<string | null> {
  const email = await getSessionEmail();
  if (email) return accountKey(email);
  const cookieId = (await cookies()).get(MANUAL_COOKIE)?.value;
  return cookieId ? cookieKey(cookieId) : null;
}

export async function loadFriends(): Promise<StoredFriend[]> {
  const key = await friendsKey();
  if (!key) return [];
  return (await kvGet<StoredFriend[]>(key)) ?? [];
}

// Persist the full friends list. Returns false when there's no durable identity
// to key on (caller can fall back to local-only); the write is best-effort.
export async function saveFriends(friends: StoredFriend[]): Promise<boolean> {
  const key = await friendsKey();
  if (!key) return false;
  await kvSet(key, friends, MANUAL_TTL);
  return true;
}
