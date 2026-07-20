import { NextRequest, NextResponse } from "next/server";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";
import { resolveShareOwner, revokeShare, SLUG_RE } from "@/lib/sharelink";

// POST { slug } → { ok } — stop sharing. Deletes the record so the live link
// goes dead everywhere it was ever pasted.
//
// This is the escape hatch a live link needs and a static one doesn't: without
// it, a URL you sent once would keep publishing your current plan forever.
// revokeShare() verifies the caller owns the slug before deleting, so a guessed
// slug can't be used to take down someone else's link.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!(await rateLimit("sharerevoke", clientIp(req), 30, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { slug?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const slug = typeof body?.slug === "string" && SLUG_RE.test(body.slug) ? body.slug : null;
  if (!slug) return NextResponse.json({ error: "bad_slug" }, { status: 400 });

  const { owner } = await resolveShareOwner(req);
  const removed = await revokeShare(owner, slug);

  // Deliberately the same 200 either way: telling a caller "that slug exists but
  // isn't yours" would turn this endpoint into a slug-existence oracle.
  return NextResponse.json({ ok: true, removed });
}
