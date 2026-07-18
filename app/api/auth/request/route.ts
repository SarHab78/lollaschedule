import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, requestCode } from "@/lib/otp";
import { mailerEnabled } from "@/lib/mailer";

// POST { email } → emails a 6-digit sign-in code. Always returns ok for a valid
// email shape (don't leak whether a send was throttled beyond a generic hint).
export async function POST(req: NextRequest) {
  if (!mailerEnabled() || !process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
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
