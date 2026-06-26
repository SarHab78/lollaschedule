import {
  getTopArtists,
  getTopTracks,
  getRecentlyPlayed,
  getSavedTracks,
  getFollowedArtists,
} from "./spotify";

// A normalized fingerprint of the user's listening, built from Spotify top
// artists + top tracks across time ranges. This is what we score the lineup on.
export type TasteProfile = {
  // lowercased artist name -> affinity 0..1 (how much you play them, across ALL
  // windows — this drives tier/color so a favorite stays a favorite everywhere)
  affinityByName: Map<string, number>;
  // lowercased artist name -> emphasis 0..1 from the SELECTED window only; a
  // ranking nudge for conflicts/ordering that never changes an artist's tier
  emphasisByName: Map<string, number>;
  // genre -> weight 0..1 (your genre fingerprint)
  genreWeights: Map<string, number>;
  // lowercased artist name -> which signals detected them (debug/provenance:
  // "top-artist", "top-track", "recent", "saved", "followed"). Lets us answer
  // "why did artist X score what they did / did we pick them up at all?"
  sourcesByName: Map<string, Set<string>>;
};

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

// Spotify exposes three fixed listening windows (no arbitrary ranges).
export type TimeWindow = "short_term" | "medium_term" | "long_term";

export const WINDOW_LABEL: Record<TimeWindow, string> = {
  short_term: "Last 4 weeks",
  medium_term: "Last 6 months",
  long_term: "All time",
};

export type TasteOptions = {
  window: TimeWindow;
  useTopArtists: boolean;
  useTopTracks: boolean;
  useRecent: boolean;
  useSaved: boolean;
};

export const DEFAULT_TASTE_OPTIONS: TasteOptions = {
  window: "long_term", // "All time" — favorites are window-independent anyway; this is the default emphasis
  useTopArtists: true,
  useTopTracks: true,
  useRecent: true,
  useSaved: true,
};

const ALL_WINDOWS: TimeWindow[] = ["short_term", "medium_term", "long_term"];

// Building a profile pulls a LOT of Spotify calls (3 windows of artists+tracks,
// recent, followed, and up to 5000 saved tracks ≈ 100 requests). Your library
// doesn't change minute-to-minute, so cache the result per token+window for a
// few minutes — reloads then cost zero API calls and can't trip the rate limit.
const profileCache = new Map<string, { at: number; profile: TasteProfile }>();
const PROFILE_TTL_MS = 10 * 60 * 1000;

export async function buildTasteProfile(
  token: string,
  opts: TasteOptions = DEFAULT_TASTE_OPTIONS,
): Promise<TasteProfile> {
  const cacheKey = `${token.slice(-16)}:${opts.window}`;
  const hit = profileCache.get(cacheKey);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) {
    console.log(`[taste] cache hit for window ${opts.window} — skipping Spotify fetch`);
    return hit.profile;
  }

  // Favorites are favorites regardless of the chosen window: we always read
  // EVERY window for "do you know/love them" (affinity), and use the SELECTED
  // window only as an emphasis signal — it nudges ranking, never demotes.
  const [artistsByWin, tracksByWin, recent, saved, followed] = await Promise.all([
    opts.useTopArtists
      ? Promise.all(ALL_WINDOWS.map((w) => getTopArtists(token, w)))
      : Promise.resolve(ALL_WINDOWS.map(() => [] as Awaited<ReturnType<typeof getTopArtists>>)),
    opts.useTopTracks
      ? Promise.all(ALL_WINDOWS.map((w) => getTopTracks(token, w)))
      : Promise.resolve(ALL_WINDOWS.map(() => [] as Awaited<ReturnType<typeof getTopTracks>>)),
    opts.useRecent ? getRecentlyPlayed(token).catch(() => []) : Promise.resolve([]),
    opts.useSaved ? getSavedTracks(token).catch(() => []) : Promise.resolve([]),
    getFollowedArtists(token).catch(() => []), // needs user-follow-read; [] until re-auth
  ]);

  // Raw-signal diagnostics: how much we pulled from each source, and a substring
  // scan so we can see if a specific artist (e.g. "claire") is in the data AT ALL
  // and under exactly what spelling — catches name mismatches and empty signals.
  console.log(
    `[taste] raw signals — topArtists ${artistsByWin.map((w) => w.length).join("/")}, ` +
      `topTracks ${tracksByWin.map((w) => w.length).join("/")}, recent ${recent.length}, ` +
      `saved ${saved.length}, followed ${followed.length} (per-window = short/med/long)`,
  );
  const WATCH = (process.env.WATCH_ARTIST ?? "claire").toLowerCase();
  if (WATCH) {
    const hits = new Set<string>();
    artistsByWin.flat().forEach((a) => { if (a.name.toLowerCase().includes(WATCH)) hits.add(`top-artist: "${a.name}"`); });
    tracksByWin.flat().forEach((t) => t.artists.forEach((a) => { if (a.name.toLowerCase().includes(WATCH)) hits.add(`top-track: "${a.name}"`); }));
    recent.forEach((t) => t.artists.forEach((a) => { if (a.name.toLowerCase().includes(WATCH)) hits.add(`recent: "${a.name}"`); }));
    saved.forEach((t) => t.artists.forEach((a) => { if (a.name.toLowerCase().includes(WATCH)) hits.add(`saved: "${a.name}"`); }));
    followed.forEach((a) => { if (a.name.toLowerCase().includes(WATCH)) hits.add(`followed: "${a.name}"`); });
    console.log(`[taste] WATCH "${WATCH}" → ${hits.size ? [...hits].join(", ") : "NOT FOUND in any signal"}`);
  }

  const affinity = new Map<string, number>(); // window-independent → drives tier/color
  const emphasis = new Map<string, number>(); // selected window only → ranking nudge
  const genres = new Map<string, number>();
  const sources = new Map<string, Set<string>>();
  const note = (key: string, src: string) => {
    (sources.get(key) ?? sources.set(key, new Set()).get(key)!).add(src);
  };

  ALL_WINDOWS.forEach((win, wi) => {
    const selected = win === opts.window;
    artistsByWin[wi].forEach((a, rank) => {
      const rs = (50 - rank) / 50; // rank 0 -> 1.0, rank 49 -> ~0.02
      const key = normalizeName(a.name);
      affinity.set(key, Math.max(affinity.get(key) ?? 0, rs));
      note(key, `top-artist#${rank + 1}/${win}`);
      for (const g of a.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + rs);
      if (selected) emphasis.set(key, Math.max(emphasis.get(key) ?? 0, rs));
    });
    tracksByWin[wi].forEach((t, rank) => {
      const rs = ((50 - rank) / 50) * 0.6;
      for (const n of t.artists.map((x) => x.name)) {
        const key = normalizeName(n);
        affinity.set(key, Math.max(affinity.get(key) ?? 0, rs));
        note(key, `top-track#${rank + 1}/${win}`);
        if (selected) emphasis.set(key, Math.max(emphasis.get(key) ?? 0, rs));
      }
    });
  });

  // Recently played / saved boost current obsessions (capped). Recent plays are
  // inherently a recency signal, so they also feed emphasis.
  const bump = (names: string[], perHit: number, cap: number, alsoEmphasis: boolean, src: string) => {
    const counts = new Map<string, number>();
    for (const n of names) {
      const key = normalizeName(n);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, c] of counts) {
      const b = Math.min(cap, perHit * c);
      affinity.set(key, Math.min(1, (affinity.get(key) ?? 0) + b));
      note(key, `${src}×${c}`);
      if (alsoEmphasis) emphasis.set(key, Math.min(1, (emphasis.get(key) ?? 0) + b));
    }
  };
  bump(recent.flatMap((t) => t.artists.map((a) => a.name)), 0.12, 0.4, true, "recent");

  // Liked/saved songs are a deliberate "I like this" act — floor any artist
  // whose song you've saved at worth-it (so they never read as a wildcard),
  // scaling up with how many of their songs you've liked.
  const savedCounts = new Map<string, number>();
  for (const n of saved.flatMap((t) => t.artists.map((a) => a.name))) {
    const key = normalizeName(n);
    savedCounts.set(key, (savedCounts.get(key) ?? 0) + 1);
  }
  for (const [key, c] of savedCounts) {
    // 1 liked song == following them (0.2, worth-it); more likes scale up.
    const floor = Math.min(0.45, 0.2 + 0.05 * (c - 1)); // 1→.20, 2→.25 … cap .45
    affinity.set(key, Math.max(affinity.get(key) ?? 0, floor));
    note(key, `saved×${c}`);
  }

  // Followed artists: a lightweight "I like them" signal (you can follow after
  // one song) — floor at worth-it, NOT must-see. A follow alone shouldn't make
  // someone a top highlighted pick; that's reserved for actual heavy listening.
  followed.forEach((a) => {
    const key = normalizeName(a.name);
    affinity.set(key, Math.max(affinity.get(key) ?? 0, 0.2));
    note(key, "followed");
    for (const g of a.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + 0.2);
  });

  // Diagnostic: does Spotify still return genres on the user's top artists?
  const artistsWithGenres = artistsByWin.flat().filter((a) => (a.genres ?? []).length > 0).length;
  console.log(
    `[taste] genre check — ${genres.size} distinct genres from top artists; ` +
      `${artistsWithGenres} top artists have genres; ${followed.length} followed artists`,
  );

  const maxGenre = Math.max(1, ...genres.values());
  const genreWeights = new Map([...genres].map(([g, v]) => [g, v / maxGenre]));

  const profile: TasteProfile = {
    affinityByName: affinity,
    emphasisByName: emphasis,
    genreWeights,
    sourcesByName: sources,
  };
  profileCache.set(cacheKey, { at: Date.now(), profile });
  return profile;
}
