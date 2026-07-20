import { NextRequest, NextResponse } from "next/server";
import { saveFriends, StoredFriend } from "@/lib/friends";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";

// Persist the visitor's friends list (see lib/friends.ts for keying). Called by
// ScheduleClient whenever friends change, so signed-in users get their compare
// list on every device. Hardened like /pick/save: same-origin, rate-limited,
// and every field length-capped so a crafted request can't bloat KV.
const MAX_FRIENDS = 50;
const MAX_NAME_LEN = 80;
const MAX_IDS = 300;
const SET_ID = /^set-\d+$/;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const SLUG = /^[A-Za-z0-9_-]{12}$/; // live-link slug (see lib/sharelink.ts)

function sanitize(input: unknown): StoredFriend[] | null {
  if (!Array.isArray(input)) return null;
  const out: StoredFriend[] = [];
  for (const raw of input.slice(0, MAX_FRIENDS)) {
    const f = raw as Record<string, unknown>;
    const ids = Array.isArray(f?.ids)
      ? Array.from(
          new Set(
            (f.ids as unknown[]).filter(
              (x): x is string => typeof x === "string" && SET_ID.test(x),
            ),
          ),
        ).slice(0, MAX_IDS)
      : [];
    if (ids.length === 0) continue; // an empty friend carries no schedule — drop it
    const name =
      typeof f?.name === "string" && f.name.trim() ? f.name.trim().slice(0, MAX_NAME_LEN) : "Friend";
    const color = typeof f?.color === "string" && HEX.test(f.color) ? f.color : undefined;
    const enabled = typeof f?.enabled === "boolean" ? f.enabled : undefined;
    // A live-link friend also stores the slug so their picks can be refreshed.
    const slug = typeof f?.slug === "string" && SLUG.test(f.slug) ? f.slug : undefined;
    out.push({ name, ids, color, enabled, slug });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await rateLimit("friendsave", clientIp(req), 60, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    ({ friends: body } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const friends = sanitize(body);
  if (friends === null) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  // An empty array is valid — it clears the stored list (removed last friend).
  const synced = await saveFriends(friends);
  return NextResponse.json({ ok: true, synced });
}
