import crypto from "crypto";

export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API = "https://api.spotify.com/v1";

// Read-only scopes — everything we need to analyze listening history.
export const SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-library-read",
].join(" ");

export function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set in .env.local");
  return id;
}

export function redirectUri(): string {
  return process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3000/callback";
}

// --- PKCE helpers -----------------------------------------------------------

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(64));
}

export function codeChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

// --- Token exchange ---------------------------------------------------------

export type SpotifyTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export async function exchangeCodeForTokens(
  code: string,
  verifier: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    client_id: clientId(),
    code_verifier: verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

// --- Authenticated API calls ------------------------------------------------

export async function spotifyGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${SPOTIFY_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Spotify GET ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

export type TopArtist = {
  id: string;
  name: string;
  genres: string[];
  popularity: number;
  images: { url: string; width: number; height: number }[];
};

export async function getTopArtists(
  accessToken: string,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
): Promise<TopArtist[]> {
  const data = await spotifyGet<{ items: TopArtist[] }>(
    `/me/top/artists?time_range=${timeRange}&limit=50`,
    accessToken,
  );
  return data.items;
}

export type TopTrack = {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
};

export async function getTopTracks(
  accessToken: string,
  timeRange: "short_term" | "medium_term" | "long_term" = "medium_term",
): Promise<TopTrack[]> {
  const data = await spotifyGet<{ items: TopTrack[] }>(
    `/me/top/tracks?time_range=${timeRange}&limit=50`,
    accessToken,
  );
  return data.items;
}

// Recently played — a strong signal of current obsessions for recency weighting.
export async function getRecentlyPlayed(accessToken: string): Promise<TopTrack[]> {
  const data = await spotifyGet<{ items: { track: TopTrack }[] }>(
    `/me/player/recently-played?limit=50`,
    accessToken,
  );
  return data.items.map((i) => i.track).filter(Boolean);
}

// Saved/liked tracks — a broad signal of artists you care about.
export async function getSavedTracks(accessToken: string): Promise<TopTrack[]> {
  const data = await spotifyGet<{ items: { track: TopTrack }[] }>(
    `/me/tracks?limit=50`,
    accessToken,
  );
  return data.items.map((i) => i.track).filter(Boolean);
}

// Search for an artist by name — used to enrich lineup acts with genres/images.
export async function searchArtist(
  name: string,
  accessToken: string,
): Promise<TopArtist | null> {
  const q = encodeURIComponent(name);
  const data = await spotifyGet<{ artists: { items: TopArtist[] } }>(
    `/search?type=artist&limit=1&q=${q}`,
    accessToken,
  );
  return data.artists.items[0] ?? null;
}
