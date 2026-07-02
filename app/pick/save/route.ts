import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { kvSet } from "@/lib/kv";

// Stash the manually-picked artists in KV under a random id, and drop that id in
// a cookie. /schedule reads it back. Keeps the (potentially long) name list out
// of the cookie entirely. 24h TTL.
export async function POST(req: NextRequest) {
  let names: unknown;
  try {
    ({ names } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json({ error: "no_names" }, { status: 400 });
  }
  const clean = names.filter((n): n is string => typeof n === "string" && n.trim().length > 0).slice(0, 300);

  const id = crypto.randomUUID();
  await kvSet(`manual:${id}`, clean, 60 * 60 * 24);

  const res = NextResponse.json({ ok: true });
  res.cookies.set("manual_id", id, {
    httpOnly: true,
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 24,
    sameSite: "lax",
  });
  return res;
}
