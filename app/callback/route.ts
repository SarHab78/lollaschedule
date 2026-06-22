import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/spotify";

// Spotify redirects here with ?code=... — we exchange it for tokens.
export async function GET(req: NextRequest) {
  // Build redirect targets from the real Host header — Next's req.url reports
  // `localhost` in dev, which would break the cookie origin (must stay 127.0.0.1).
  const origin = `http://${req.headers.get("host") ?? "127.0.0.1:3000"}`;
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(error)}`, origin));
  }
  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", origin));
  }

  const verifier = req.cookies.get("spotify_verifier")?.value;
  if (!verifier) {
    return NextResponse.redirect(new URL("/?error=missing_verifier", origin));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, verifier);
    const res = NextResponse.redirect(new URL("/dashboard", origin));

    res.cookies.set("spotify_access_token", tokens.access_token, {
      httpOnly: true,
      secure: false,
      path: "/",
      maxAge: tokens.expires_in,
      sameSite: "lax",
    });
    if (tokens.refresh_token) {
      res.cookies.set("spotify_refresh_token", tokens.refresh_token, {
        httpOnly: true,
        secure: false,
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
        sameSite: "lax",
      });
    }
    res.cookies.delete("spotify_verifier");
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "token_exchange_failed";
    return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(msg)}`, origin));
  }
}
