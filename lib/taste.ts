import {
  getTopArtists,
  getTopTracks,
  getRecentlyPlayed,
  getSavedTracks,
  TopArtist,
} from "./spotify";

// A normalized fingerprint of the user's listening, built from Spotify top
// artists + top tracks across time ranges. This is what we score the lineup on.
export type TasteProfile = {
  // lowercased artist name -> affinity 0..1 (how much you play them)
  affinityByName: Map<string, number>;
  // genre -> weight 0..1 (your genre fingerprint)
  genreWeights: Map<string, number>;
};

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

// Long-term listening matters more than a recent month for festival planning,
// but we blend both so current obsessions still count.
const TERM_WEIGHT: Record<string, number> = {
  long_term: 1.0,
  medium_term: 0.7,
  short_term: 0.5,
};

export async function buildTasteProfile(token: string): Promise<TasteProfile> {
  const [longA, medA, longT, medT, recent, saved] = await Promise.all([
    getTopArtists(token, "long_term"),
    getTopArtists(token, "medium_term"),
    getTopTracks(token, "long_term"),
    getTopTracks(token, "medium_term"),
    getRecentlyPlayed(token).catch(() => []), // optional signals — degrade gracefully
    getSavedTracks(token).catch(() => []),
  ]);

  const affinity = new Map<string, number>();
  const genres = new Map<string, number>();

  const addArtist = (a: TopArtist, rank: number, termWeight: number) => {
    // rank 0 (top) -> 1.0, rank 49 -> ~0.02
    const rankScore = (50 - rank) / 50;
    const w = rankScore * termWeight;
    const key = normalizeName(a.name);
    affinity.set(key, Math.max(affinity.get(key) ?? 0, w));
    for (const g of a.genres ?? []) {
      genres.set(g, (genres.get(g) ?? 0) + w);
    }
  };

  longA.forEach((a, i) => addArtist(a, i, TERM_WEIGHT.long_term));
  medA.forEach((a, i) => addArtist(a, i, TERM_WEIGHT.medium_term));

  // Top tracks broaden artist affinity (collaborators, deeper cuts) at a discount.
  const addTrackArtists = (names: string[], rank: number, termWeight: number) => {
    const w = ((50 - rank) / 50) * termWeight * 0.6;
    for (const n of names) {
      const key = normalizeName(n);
      affinity.set(key, Math.max(affinity.get(key) ?? 0, w));
    }
  };
  longT.forEach((t, i) => addTrackArtists(t.artists.map((x) => x.name), i, TERM_WEIGHT.long_term));
  medT.forEach((t, i) => addTrackArtists(t.artists.map((x) => x.name), i, TERM_WEIGHT.medium_term));

  // Recency: artists you've played lately are current obsessions — boost them
  // by how often they show up in your recent plays (capped). Saved tracks add a
  // smaller, steady signal. These nudge affinity up but never override it.
  const bump = (names: string[], perHit: number, cap: number) => {
    const counts = new Map<string, number>();
    for (const n of names) {
      const key = normalizeName(n);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, c] of counts) {
      const boost = Math.min(cap, perHit * c);
      affinity.set(key, Math.min(1, (affinity.get(key) ?? 0) + boost));
    }
  };
  bump(recent.flatMap((t) => t.artists.map((a) => a.name)), 0.12, 0.4); // recently played
  bump(saved.flatMap((t) => t.artists.map((a) => a.name)), 0.05, 0.2); // saved library

  // Normalize genre weights to 0..1.
  const maxGenre = Math.max(1, ...genres.values());
  const genreWeights = new Map([...genres].map(([g, v]) => [g, v / maxGenre]));

  return { affinityByName: affinity, genreWeights };
}
