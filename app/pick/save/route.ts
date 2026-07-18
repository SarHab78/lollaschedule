import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { kvSet } from "@/lib/kv";
import { getSessionEmail } from "@/lib/session";
import { MANUAL_TTL, MANUAL_COOKIE, accountKey, cookieKey } from "@/lib/manual";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";

// Longest a single pick can be. Artist names are short; this just stops a
// crafted request from writing multi-MB strings to KV (storage/cost abuse).
const MAX_NAME_LEN = 120;
const MAX_NAMES = 300;

// Stash the manually-picked artists in KV. Signed-in visitors save to their
// account key (email → cross-device); anonymous visitors save under a stable
// cookie id (per-device). /schedule reads it back and /pick re-hydrates the
// checkboxes on return. Long-lived so nobody re-picks every time.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Anonymous writes mint a fresh 1-year KV key each time; cap per-IP so a bot
  // can't fill KV with unlimited keys. 40 saves / 10 min is plenty for a person.
  if (!(await rateLimit("picksave", clientIp(req), 40, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let names: unknown;
  try {
    ({ names } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json({ error: "no_names" }, { status: 400 });
  }
  const clean = Array.from(
    new Set(
      names
        .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
        .map((n) => n.trim().slice(0, MAX_NAME_LEN)),
    ),
  ).slice(0, MAX_NAMES);
  if (clean.length === 0) {
    return NextResponse.json({ error: "no_names" }, { status: 400 });
  }

  // Signed in → save to the account (no cookie needed, works on any device).
  const email = await getSessionEmail();
  if (email) {
    await kvSet(accountKey(email), clean, MANUAL_TTL);
    return NextResponse.json({ ok: true });
  }

  // Anonymous → reuse the visitor's existing cookie id if present (re-saving
  // overwrites under the same key); otherwise mint a fresh one.
  const id = req.cookies.get(MANUAL_COOKIE)?.value || crypto.randomUUID();
  await kvSet(cookieKey(id), clean, MANUAL_TTL);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(MANUAL_COOKIE, id, {
    httpOnly: true,
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: MANUAL_TTL,
    sameSite: "lax",
  });
  return res;
}
