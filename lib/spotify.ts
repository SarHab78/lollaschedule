import crypto from "crypto";

export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
export const SPOTIFY_API = "https://api.spotify.com/v1";

// Read-only scopes — everything we need to analyze listening history.
export const SCOPES = [
  "user-top-read",
  "user-read-recently-played",
  "user-library-read",
  "user-follow-read", // artists you follow (not capped at top-50)
].join(" ");

export function clientId(): string {
  const id = process.env.SPOTIFY_CLIENT_ID;
  if (!id) throw new Error("SPOTIFY_CLIENT_ID is not set in .env.local");
  return id;
}

// The redirect URI must EXACTLY match one registered in the Spotify dashboard.
// We derive it from the incoming request so the same code works on 127.0.0.1
// locally AND on the deployed host (e.g. https://lollaschedule.vercel.app) —
// Vercel sets `x-forwarded-proto: https`. Falls back to the env var, then loopback.
export function originFromRequest(req: { headers: Headers }): string {
  const host = req.headers.get("host");
  if (!host) return "http://127.0.0.1:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("127.") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export function redirectUri(req?: { headers: Headers }): string {
  if (req) return `${originFromRequest(req)}/callback`;
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
  redirect: string,
): Promise<SpotifyTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect, // MUST match the redirect_uri used at /login exactly
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
  // Spotify rate-limits per app over a rolling window and returns 429 with a
  // Retry-After header. Honor it (capped) and retry a few times so a burst of
  // requests (e.g. paging thousands of saved tracks) self-heals instead of
  // throwing a "Too many requests" error up to the page.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SPOTIFY_API}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    // Retry 429 a couple times, but cap the wait hard so an interactive page
    // never hangs ~50s waiting out Spotify — fail fast and let the UI recover.
    if (res.status === 429 && attempt < 2) {
      const retryAfter = Math.min(4, Number(res.headers.get("retry-after") ?? "1") || 1);
      await new Promise((r) => setTimeout(r, (retryAfter + 0.2) * 1000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Spotify GET ${path} failed (${res.status}): ${await res.text()}`);
    }
    return res.json();
  }
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

// Saved/liked tracks — a broad signal of artists you care about. Paginated up
// to `max` so artists beyond your first 50 likes still get detected.
export async function getSavedTracks(
  accessToken: string,
  max = 1500, // ~30 requests; deep enough for taste, 3x lighter on the shared quota
): Promise<TopTrack[]> {
  // First page tells us the library total, then fetch the rest concurrently
  // (bounded) rather than 40 slow sequential round-trips.
  const first = await spotifyGet<{ items: { track: TopTrack }[]; total: number }>(
    `/me/tracks?limit=50&offset=0`,
    accessToken,
  );
  const out: TopTrack[] = first.items.map((i) => i.track).filter(Boolean);
  const total = Math.min(max, first.total);

  const offsets: number[] = [];
  for (let o = 50; o < total; o += 50) offsets.push(o);

  const CONCURRENCY = 3; // gentle: avoid tripping Spotify's rolling rate limit
  let idx = 0;
  async function worker() {
    while (idx < offsets.length) {
      const o = offsets[idx++];
      const data = await spotifyGet<{ items: { track: TopTrack }[] }>(
        `/me/tracks?limit=50&offset=${o}`,
        accessToken,
      );
      out.push(...data.items.map((i) => i.track).filter(Boolean));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// Artists you explicitly follow — a strong "I like this" signal that is NOT
// limited to your top 50. Paginated via the cursor. Needs `user-follow-read`.
export async function getFollowedArtists(accessToken: string): Promise<TopArtist[]> {
  const out: TopArtist[] = [];
  let after: string | undefined;
  for (let i = 0; i < 10; i++) {
    const url = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ""}`;
    const data = await spotifyGet<{
      artists: { items: TopArtist[]; next: string | null; cursors: { after: string | null } };
    }>(url, accessToken);
    out.push(...data.artists.items);
    after = data.artists.cursors?.after ?? undefined;
    if (!after || !data.artists.next) break;
  }
  return out;
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
