import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, verifyCode } from "@/lib/otp";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";
import { clientIp, rateLimit, sameOrigin } from "@/lib/security";
import { adoptShareOnSignIn } from "@/lib/sharelink";
import { MANUAL_COOKIE } from "@/lib/manual";

// POST { email, code } → verifies the code and, on success, sets the signed
// session cookie. From then on the visitor's picks key off their email.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  // Per-code attempts are capped in verifyCode; this per-IP cap stops an
  // attacker from spreading guesses across many emails from one host. 30/10 min.
  if (!(await rateLimit("authverify", clientIp(req), 30, 600))) {
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { email: rawEmail, code } = (body as { email?: unknown; code?: unknown }) ?? {};
  const email = normalizeEmail(rawEmail);
  if (!email || typeof code !== "string") {
    return NextResponse.json({ error: "bad_input" }, { status: 400 });
  }

  const result = await verifyCode(email, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // Carry any live share link created anonymously on this device over to the
  // account, so a link already handed out to friends keeps working (and keeps
  // updating) after signing in. Mirrors the pick migration in lib/manual.ts.
  const deviceId = req.cookies.get(MANUAL_COOKIE)?.value;
  if (deviceId) await adoptShareOnSignIn(email, deviceId);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, makeSessionToken(email), {
    httpOnly: true,
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: SESSION_MAX_AGE,
    sameSite: "lax",
  });
  return res;
}
