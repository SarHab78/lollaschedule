import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, requestCode } from "@/lib/otp";
import { mailerEnabled } from "@/lib/mailer";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";

// POST { email } → emails a 6-digit sign-in code. Always returns ok for a valid
// email shape (don't leak whether a send was throttled beyond a generic hint).
//
// This endpoint sends real email from our Gmail sender, so it's the prime abuse
// target: an attacker could bomb arbitrary inboxes, torch our sender reputation,
// or exhaust Gmail's ~500/day cap to DoS sign-in for everyone. Defenses: reject
// cross-origin POSTs (CSRF), cap sends per-IP (any email), and cap sends
// per-email (in requestCode).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!mailerEnabled() || !process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  // Per-IP cap across ALL emails — the per-email limit alone lets an attacker
  // cycle addresses to bomb inboxes / burn the daily quota. 8 sends / 10 min.
  if (!(await rateLimit("authreq", clientIp(req), 8, 600))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const email = normalizeEmail((body as { email?: unknown })?.email);
  if (!email) return NextResponse.json({ error: "bad_email" }, { status: 400 });

  const result = await requestCode(email);
  if (!result.ok) {
    const status = result.error === "rate_limited" ? 429 : 502;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
