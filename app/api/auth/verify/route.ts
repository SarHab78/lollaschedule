import { NextRequest, NextResponse } from "next/server";
import { normalizeEmail, verifyCode } from "@/lib/otp";
import { makeSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// POST { email, code } → verifies the code and, on success, sets the signed
// session cookie. From then on the visitor's picks key off their email.
export async function POST(req: NextRequest) {
  if (!process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
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
