import { cookies } from "next/headers";
import { getSessionEmail } from "./session";
import { kvGet, kvSet } from "./kv";

// Where a manual-entry visitor's picks live. Signed-in accounts key by email
// (cross-device); anonymous visitors key by a random cookie id (per-device).
// Both persist for a year in KV so nobody re-picks every visit.

export const MANUAL_TTL = 60 * 60 * 24 * 365; // 1 year
export const MANUAL_COOKIE = "manual_id";

export type ManualStore =
  | { kind: "account"; email: string; key: string }
  | { kind: "cookie"; cookieId: string; key: string }
  | { kind: "none" };

export const accountKey = (email: string) => `manual:user:${email}`;
export const cookieKey = (id: string) => `manual:${id}`;

// Resolve the storage key for the current visitor. On the first signed-in use,
// lazily carry any anonymous cookie picks into the account so nothing is lost
// when someone picks first and signs in after.
export async function resolveManualStore(): Promise<ManualStore> {
  const email = await getSessionEmail();
  const cookieId = (await cookies()).get(MANUAL_COOKIE)?.value;

  if (email) {
    const key = accountKey(email);
    if (cookieId) {
      const existing = await kvGet<string[]>(key);
      if (!existing || existing.length === 0) {
        const cookiePicks = await kvGet<string[]>(cookieKey(cookieId));
        if (cookiePicks && cookiePicks.length) {
          await kvSet(key, cookiePicks, MANUAL_TTL);
          console.log(`[manual] migrated ${cookiePicks.length} cookie picks → ${email}`);
        }
      }
    }
    return { kind: "account", email, key };
  }

  if (cookieId) return { kind: "cookie", cookieId, key: cookieKey(cookieId) };
  return { kind: "none" };
}

// The current visitor's saved picks (empty if none / not identified).
export async function loadManualPicks(): Promise<string[]> {
  const store = await resolveManualStore();
  if (store.kind === "none") return [];
  return (await kvGet<string[]>(store.key)) ?? [];
}
