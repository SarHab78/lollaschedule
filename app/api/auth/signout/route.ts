import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

// POST → clear the session cookie. Manual picks stay in KV under the account key
// (keyed by email), so signing back in restores them.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
