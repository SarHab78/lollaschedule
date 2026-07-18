import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { sameOrigin } from "@/lib/security";

// POST → clear the session cookie. Manual picks stay in KV under the account key
// (keyed by email), so signing back in restores them. Origin-checked so a
// cross-site page can't force-sign-out a visitor.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
