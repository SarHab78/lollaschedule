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
  const verifier = generateCodeVerifier();
  const challenge = codeChallenge(verifier);
  const redirect = redirectUri(req); // host-derived: works locally + on Vercel

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
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
