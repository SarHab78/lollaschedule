import crypto from "crypto";
import { cookies } from "next/headers";

// Lightweight signed-cookie session. The cookie holds the signed-in email so
// manual picks can be keyed to a stable identity across devices. No DB, no
// Auth.js — just an HMAC over a small JSON payload. AUTH_SECRET signs it.

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// Require a real secret (≥16 chars). An empty/short AUTH_SECRET would let anyone
// forge a session token (they'd know the HMAC key), so we treat it as "no auth
// configured" and fail closed rather than sign/verify with a guessable key.
const secret = () => {
  const s = process.env.AUTH_SECRET || "";
  return s.length >= 16 ? s : "";
};

function sign(payloadB64: string): string {
  return crypto.createHmac("sha256", secret()).update(payloadB64).digest("base64url");
}

export function makeSessionToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email, iat: Date.now() })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Verify signature + shape; returns the email or null. Constant-time compare.
export function readSessionToken(token: string | undefined): { email: string } | null {
  if (!token || !secret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    // Enforce the max age from the signed `iat` too — not just the cookie's
    // maxAge — so a token copied out of the cookie jar still expires server-side.
    if (typeof data.iat === "number" && Date.now() - data.iat > SESSION_MAX_AGE * 1000) {
      return null;
    }
    if (typeof data.email === "string" && data.email) return { email: data.email };
  } catch {
    // fall through
  }
  return null;
}

// Read the current session email from the request cookies (server components +
// route handlers). null when signed out.
export async function getSessionEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return readSessionToken(token)?.email ?? null;
}
