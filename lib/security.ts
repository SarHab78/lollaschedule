import { NextRequest } from "next/server";
import { kvIncr } from "./kv";

// Shared request-security helpers: client IP extraction, a CSRF origin check,
// and a KV-backed fixed-window rate limiter. Used to harden the unauthenticated
// state-changing routes (send-code, verify, save-picks) against abuse.

// Best-effort client IP from proxy headers. Vercel sets `x-forwarded-for` (the
// left-most entry is the real client). Never trust this for authz — it's only
// a rate-limit bucket and can be spoofed; it just raises the cost of abuse.
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// CSRF defense for state-changing POSTs. A same-origin browser fetch always
// sends an `Origin` header matching our host; a cross-site forgery sends the
// attacker's origin (or, for simple form posts, one we can compare). We reject a
// mismatching Origin. A *missing* Origin is allowed (non-browser clients like
// curl/health checks send none) — SameSite=Lax cookies remain the backstop
// there, and the sensitive routes don't act on ambient cookies anyway.
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

// Fixed-window rate limit keyed by an arbitrary id (usually IP). Returns true if
// the request is allowed. Fails OPEN on a KV error (kvIncr returns 0) so a Redis
// blip never hard-locks legitimate users out — the per-email/OTP limits and
// SameSite cookies are the second layer.
export async function rateLimit(
  bucket: string,
  id: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const n = await kvIncr(`rl:${bucket}:${id}`, windowSec);
  return n <= max; // n === 0 (KV error) also passes → fail-open by design
}
