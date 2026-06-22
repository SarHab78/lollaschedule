import { NextRequest, NextResponse } from "next/server";
import {
  SPOTIFY_AUTH_URL,
  SCOPES,
  clientId,
  redirectUri,
  generateCodeVerifier,
  codeChallenge,
} from "@/lib/spotify";

// Kicks off the Authorization Code + PKCE flow.
export async function GET(req: NextRequest) {
  const redirect = redirectUri(req); // host-derived: works locally + on Vercel

  // Fail readably instead of a raw 500 if config is missing (e.g. the
  // SPOTIFY_CLIENT_ID env var isn't set on the deployment).
  let id: string;
  try {
    id = clientId();
  } catch {
    return NextResponse.redirect(new URL("/?error=missing_client_id", redirect));
  }

  const verifier = generateCodeVerifier();
  const challenge = codeChallenge(verifier);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: id,
    scope: SCOPES,
    redirect_uri: redirect,
    code_challenge_method: "S256",
    code_challenge: challenge,
  });

  const res = NextResponse.redirect(`${SPOTIFY_AUTH_URL}?${params}`);

  // Stash the verifier in an httpOnly cookie so /callback can complete PKCE.
  res.cookies.set("spotify_verifier", verifier, {
    httpOnly: true,
    secure: redirect.startsWith("https"), // secure on prod https, off on loopback http
    path: "/",
    maxAge: 600,
    sameSite: "lax",
  });

  return res;
}
