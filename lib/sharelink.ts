import crypto from "crypto";
import { NextRequest } from "next/server";
import { getSessionEmail } from "./session";
import { kvGet, kvSet, kvDel } from "./kv";
import { getLineup } from "./lineup";
import { MANUAL_COOKIE } from "./manual";

// LIVE share links.
//
// The original share link was stateless — the picks were encoded straight into
// `?s=<bitset>` (lib/setcode.ts), so the link froze the moment you copied it.
// This module adds the durable half: a short unguessable slug in KV that maps to
// the owner's CURRENT picks, so `/share/<slug>` always renders the latest plan
// and a link you sent last week keeps up as you tweak your schedule.
//
// Stateless `?s=` links still work everywhere and remain the fallback whenever
// KV is unavailable — a degraded share is a stale share, never a broken one.
//
// Threat model / invariants (every one of these is load-bearing):
//  * The owner is derived SERVER-SIDE from the signed session cookie or the
//    per-device cookie. A request body can never name its own owner, so nobody
//    can overwrite someone else's link by guessing a slug.
//  * Slugs are 72 bits of CSPRNG (12 base64url chars) — not enumerable. The link
//    is unlisted-public by design: holding it is what grants read access.
//  * Set ids are validated against the real lineup, not just shape-matched, and
//    capped, so a crafted request can't stuff arbitrary data into KV.
//  * Records carry only set ids + a timestamp. No name, no email, nothing that
//    identifies the owner to a viewer.

export const SHARE_TTL = 60 * 60 * 24 * 365; // 1 year, refreshed on every write
export const MAX_SHARE_IDS = 300; // a 4-day festival can't legitimately exceed this
export const MAX_RESOLVE_SLUGS = 50; // per /api/share/resolve call

// 9 random bytes → exactly 12 base64url chars, no padding.
const SLUG_BYTES = 9;
export const SLUG_RE = /^[A-Za-z0-9_-]{12}$/;
// The device cookie is minted by us as a UUID; anything else was hand-crafted by
// the client, so we refuse to key KV on it (and mint a fresh one instead).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShareRecord = {
  owner: string;
  ids: string[];
  updatedAt: number; // epoch ms
};

const recordKey = (slug: string) => `share:${slug}`;
const ownerKey = (owner: string) => `sharelink:${owner}`;

/**
 * Who is publishing. Signed-in accounts key by email so their link follows them
 * across devices; everyone else keys by the app's per-device cookie (the same
 * one lib/manual.ts and lib/friends.ts already use as an anonymous identity).
 *
 * `newCookieId` is set when the visitor had no usable device cookie — the route
 * handler must write it onto the response, otherwise the next request looks like
 * a different person and would mint a second link.
 */
export type ShareOwner = { owner: string; newCookieId?: string };

export async function resolveShareOwner(req: NextRequest): Promise<ShareOwner> {
  const email = await getSessionEmail();
  if (email) return { owner: `user:${email}` };

  const existing = req.cookies.get(MANUAL_COOKIE)?.value;
  if (existing && UUID_RE.test(existing)) return { owner: `dev:${existing}` };

  // Same id in both places — the owner we key KV on MUST be the id we hand back
  // in the cookie, or the next request resolves to a different owner.
  const id = crypto.randomUUID();
  return { owner: `dev:${id}`, newCookieId: id };
}

/**
 * A slug nobody is using. At 72 bits a collision is already vanishingly
 * unlikely, but a collision would silently hand one person's link to another —
 * a bad enough outcome that one extra read on creation is worth it.
 */
async function mintUnusedSlug(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const slug = crypto.randomBytes(SLUG_BYTES).toString("base64url");
    if (!(await kvGet<ShareRecord>(recordKey(slug)))) return slug;
  }
  // Five collisions in a row means KV is misbehaving, not bad luck.
  throw new Error("could not mint an unused share slug");
}

/**
 * Keep only ids that name a real set in the 2026 lineup, de-duped and capped.
 * Validating against the lineup (rather than just `^set-\d+$`) means a forged
 * request can't park junk in KV or make the share page render nothing.
 */
export function sanitizeShareIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set(getLineup().sets.map((s) => s.id));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string" || !valid.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= MAX_SHARE_IDS) break;
  }
  return out;
}

/** Read a live share record by slug. Returns null for unknown/revoked/expired. */
export async function readShare(slug: string): Promise<ShareRecord | null> {
  if (!SLUG_RE.test(slug)) return null;
  const rec = await kvGet<ShareRecord>(recordKey(slug));
  if (!rec || !Array.isArray(rec.ids)) return null;
  return rec;
}

/**
 * Find the live link this caller already owns, or null if they'd need a new one.
 *
 * `claimedSlug` is the slug the client believes it owns. We honor it ONLY when
 * the stored record's owner matches the caller — that's the ownership check that
 * makes auto-sync safe. A mismatch (or an unknown slug) falls through to the
 * caller's own owner→slug mapping, so a hostile client can at worst reach its
 * own link.
 *
 * Split out from publishShare so the route can tell "update" (cheap, already
 * paid for with an identity) apart from "create" (mints a new year-long KV
 * record) and rate-limit them differently.
 */
export async function findOwnedSlug(owner: string, claimedSlug?: string): Promise<string | null> {
  if (claimedSlug && SLUG_RE.test(claimedSlug)) {
    const existing = await kvGet<ShareRecord>(recordKey(claimedSlug));
    if (existing?.owner === owner) return claimedSlug;
  }

  const mapped = await kvGet<string>(ownerKey(owner));
  if (mapped && SLUG_RE.test(mapped)) {
    const existing = await kvGet<ShareRecord>(recordKey(mapped));
    // Only reuse the mapping if the record still agrees it's ours; otherwise the
    // mapping is stale (revoked, expired) and we start over.
    if (existing?.owner === owner) return mapped;
  }
  return null;
}

/**
 * Write `ids` to `slug`, or to a freshly minted slug when `slug` is null.
 * Callers get the slug back so they can persist it.
 */
export async function publishShare(
  owner: string,
  ids: string[],
  slug: string | null,
): Promise<{ slug: string; updatedAt: number } | null> {
  const isNew = !slug;
  if (!slug) slug = await mintUnusedSlug();

  const updatedAt = Date.now();
  const rec: ShareRecord = { owner, ids, updatedAt };
  await kvSet(recordKey(slug), rec, SHARE_TTL);
  // Refresh the owner→slug mapping on every write so an actively-used link never
  // ages out of KV mid-festival.
  await kvSet(ownerKey(owner), slug, SHARE_TTL);

  // KV writes are best-effort (lib/kv.ts swallows Redis errors), so confirm the
  // record actually landed before telling the client it has a live link. If it
  // didn't, the client keeps using the stateless `?s=` link instead of handing
  // out a URL that 404s.
  const confirmed = await kvGet<ShareRecord>(recordKey(slug));
  if (!confirmed || confirmed.updatedAt !== updatedAt) {
    if (isNew) console.log("[share] publish failed to persist; falling back to static link");
    return null;
  }

  return { slug, updatedAt };
}

/**
 * Stop sharing: delete the record and the owner mapping. Verifies ownership
 * first so a guessed slug can't be used to take down someone else's link.
 * Returns true when a record belonging to the caller was removed.
 */
export async function revokeShare(owner: string, slug: string): Promise<boolean> {
  if (!SLUG_RE.test(slug)) return false;
  const existing = await kvGet<ShareRecord>(recordKey(slug));
  if (!existing || existing.owner !== owner) return false;
  await kvDel(recordKey(slug));
  await kvDel(ownerKey(owner));
  return true;
}

/**
 * Carry an anonymous device link over to an email account on sign-in, so the
 * link someone already handed out keeps working (and stays live) once they have
 * a real account. Mirrors the cookie→account migration in lib/manual.ts. No-op
 * when the account already has its own link.
 */
export async function adoptShareOnSignIn(email: string, deviceCookieId: string): Promise<void> {
  if (!UUID_RE.test(deviceCookieId)) return;
  const accountOwner = `user:${email}`;
  const deviceOwner = `dev:${deviceCookieId}`;

  const alreadyMine = await kvGet<string>(ownerKey(accountOwner));
  if (alreadyMine) return;

  const slug = await kvGet<string>(ownerKey(deviceOwner));
  if (!slug || !SLUG_RE.test(slug)) return;

  const rec = await kvGet<ShareRecord>(recordKey(slug));
  if (!rec || rec.owner !== deviceOwner) return;

  await kvSet(recordKey(slug), { ...rec, owner: accountOwner }, SHARE_TTL);
  await kvSet(ownerKey(accountOwner), slug, SHARE_TTL);
  await kvDel(ownerKey(deviceOwner));
  console.log(`[share] adopted device link ${slug} → ${email}`);
}
