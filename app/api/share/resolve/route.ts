import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";
import { MAX_RESOLVE_SLUGS, readShare, SLUG_RE } from "@/lib/sharelink";

// POST { slugs: string[] } → { results: { [slug]: { ids, updatedAt } | null } }
//
// Makes the friends panel two-way: friends are stored by SLUG, and ScheduleClient
// re-resolves them on load, so a friend editing their plan shows up in your
// compare view instead of staying frozen at the moment you pasted their link.
//
// Read-only, and it discloses nothing a visitor couldn't already get by opening
// `/share/<slug>` in a browser — you must already hold the slug. Batched so one
// page load is one request rather than N.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Tighter than the write limits: this is the one endpoint where a caller could
  // try slugs in bulk, so cap the guesses-per-window hard. (At 72 bits of slug
  // entropy, brute force is hopeless anyway — this is belt and braces.)
  if (!(await rateLimit("shareresolve", clientIp(req), 60, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { slugs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!Array.isArray(body?.slugs)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const slugs = Array.from(
    new Set(body.slugs.filter((s): s is string => typeof s === "string" && SLUG_RE.test(s))),
  ).slice(0, MAX_RESOLVE_SLUGS);

  const results: Record<string, { ids: string[]; updatedAt: number } | null> = {};
  await Promise.all(
    slugs.map(async (slug) => {
      const rec = await readShare(slug);
      // Never echo `owner` back — a viewer has no business learning whose link
      // this is, and the record is the only place that identity appears.
      results[slug] = rec ? { ids: rec.ids, updatedAt: rec.updatedAt } : null;
    }),
  );

  return NextResponse.json({ results });
}
