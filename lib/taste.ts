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
  window: "medium_term",
  useTopArtists: true,
  useTopTracks: true,
  useRecent: true,
  useSaved: true,
};

const ALL_WINDOWS: TimeWindow[] = ["short_term", "medium_term", "long_term"];

export async function buildTasteProfile(
  token: string,
  opts: TasteOptions = DEFAULT_TASTE_OPTIONS,
): Promise<TasteProfile> {
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

  const affinity = new Map<string, number>(); // window-independent → drives tier/color
  const emphasis = new Map<string, number>(); // selected window only → ranking nudge
  const genres = new Map<string, number>();

  ALL_WINDOWS.forEach((win, wi) => {
    const selected = win === opts.window;
    artistsByWin[wi].forEach((a, rank) => {
      const rs = (50 - rank) / 50; // rank 0 -> 1.0, rank 49 -> ~0.02
      const key = normalizeName(a.name);
      affinity.set(key, Math.max(affinity.get(key) ?? 0, rs));
      for (const g of a.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + rs);
      if (selected) emphasis.set(key, Math.max(emphasis.get(key) ?? 0, rs));
    });
    tracksByWin[wi].forEach((t, rank) => {
      const rs = ((50 - rank) / 50) * 0.6;
      for (const n of t.artists.map((x) => x.name)) {
        const key = normalizeName(n);
        affinity.set(key, Math.max(affinity.get(key) ?? 0, rs));
        if (selected) emphasis.set(key, Math.max(emphasis.get(key) ?? 0, rs));
      }
    });
  });

  // Recently played / saved boost current obsessions (capped). Recent plays are
  // inherently a recency signal, so they also feed emphasis.
  const bump = (names: string[], perHit: number, cap: number, alsoEmphasis: boolean) => {
    const counts = new Map<string, number>();
    for (const n of names) {
      const key = normalizeName(n);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, c] of counts) {
      const b = Math.min(cap, perHit * c);
      affinity.set(key, Math.min(1, (affinity.get(key) ?? 0) + b));
      if (alsoEmphasis) emphasis.set(key, Math.min(1, (emphasis.get(key) ?? 0) + b));
    }
  };
  bump(recent.flatMap((t) => t.artists.map((a) => a.name)), 0.12, 0.4, true);
  bump(saved.flatMap((t) => t.artists.map((a) => a.name)), 0.05, 0.2, false);

  // Followed artists: a strong, uncapped "I like this" signal — floor their
  // affinity at worth-it level so they never collapse to a wildcard.
  followed.forEach((a) => {
    const key = normalizeName(a.name);
    affinity.set(key, Math.max(affinity.get(key) ?? 0, 0.5));
    for (const g of a.genres ?? []) genres.set(g, (genres.get(g) ?? 0) + 0.5);
  });

  // Diagnostic: does Spotify still return genres on the user's top artists?
  const artistsWithGenres = artistsByWin.flat().filter((a) => (a.genres ?? []).length > 0).length;
  console.log(
    `[taste] genre check — ${genres.size} distinct genres from top artists; ` +
      `${artistsWithGenres} top artists have genres; ${followed.length} followed artists`,
  );

  const maxGenre = Math.max(1, ...genres.values());
  const genreWeights = new Map([...genres].map(([g, v]) => [g, v / maxGenre]));

  return { affinityByName: affinity, emphasisByName: emphasis, genreWeights };
}
