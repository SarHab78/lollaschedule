import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";
import { MANUAL_COOKIE, MANUAL_TTL } from "@/lib/manual";
import {
  findOwnedSlug,
  publishShare,
  resolveShareOwner,
  sanitizeShareIds,
  SLUG_RE,
} from "@/lib/sharelink";

// POST { ids: string[], slug?: string } → { ok, slug } — publish the caller's
// current picks to their LIVE share link, creating it on first call. Called by
// ScheduleClient when you copy the link and (debounced) whenever your schedule
// changes afterwards, so `/share/<slug>` never goes stale.
//
// Hardened the same way as /api/friends/save and /pick/save:
//  * sameOrigin  — CSRF: a cross-site page can't publish on your behalf.
//  * rateLimit   — abuse ceiling, set well above what honest editing produces.
//  * sanitize    — ids must name real lineup sets; count is capped.
//  * ownership   — the owner comes from the session/device cookie, NEVER the
//    body, and publishShare re-checks the stored record before reusing a slug.

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Auto-sync is debounced client-side, so honest use is a handful of writes per
  // session. 120 per 10 min leaves plenty of headroom for heavy tinkering while
  // still capping a scripted flood. (Creating a NEW link is capped far tighter
  // below — that's the expensive operation.)
  if (!(await rateLimit("sharesave", clientIp(req), 120, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { ids?: unknown; slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const ids = sanitizeShareIds(body?.ids);
  if (ids.length === 0) {
    // Nothing valid to publish. Refuse rather than silently emptying a link
    // friends are already holding.
    return NextResponse.json({ error: "no_valid_sets" }, { status: 400 });
  }
  const claimedSlug = typeof body?.slug === "string" && SLUG_RE.test(body.slug) ? body.slug : undefined;

  const { owner, newCookieId } = await resolveShareOwner(req);

  // Updating a link you already own is cheap. CREATING one mints a year-long KV
  // record, and a caller with no cookie gets a fresh identity — and so a fresh
  // record — on every single request. Without a separate ceiling, the limit
  // above would let one host park thousands of records a day in KV. Honest use
  // creates a link roughly once, so 8 per 10 min is generous.
  const existingSlug = await findOwnedSlug(owner, claimedSlug);
  if (!existingSlug && !(await rateLimit("sharenew", clientIp(req), 8, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const published = await publishShare(owner, ids, existingSlug).catch((e) => {
    console.log("[share] publish failed:", e instanceof Error ? e.message : e);
    return null;
  });

  if (!published) {
    // KV is unavailable/failed — tell the client honestly so it keeps using the
    // stateless `?s=` link instead of handing out a URL that would 404.
    return NextResponse.json({ error: "storage_unavailable" }, { status: 503 });
  }

  const res = NextResponse.json({ ok: true, slug: published.slug, updatedAt: published.updatedAt });
  if (newCookieId) {
    // Persist the device identity we just minted, or the next request would read
    // as a different owner and mint a second link.
    res.cookies.set(MANUAL_COOKIE, newCookieId, {
      httpOnly: true,
      secure: req.headers.get("x-forwarded-proto") === "https",
      path: "/",
      maxAge: MANUAL_TTL,
      sameSite: "lax",
    });
  }
  return res;
}
