import { ArtistMeta } from "./enrich";
import { normalizeName, TasteProfile } from "./taste";

export type Tier = "must-see" | "worth-it" | "discovery" | "skip";

export type ScoredArtist = {
  artist: string;
  score: number; // 0..100
  tier: Tier;
  directAffinity: number; // 0..1, you actually play them
  genreMatch: number; // 0..1, matches your genre fingerprint
  reason: string;
};

// How much you'd enjoy a lineup artist =
//   70% do you already play them  +  30% do they match your genres
// Direct affinity dominates (a known love beats a genre guess), while genre
// match surfaces "discovery" acts you don't play yet but fit your taste.
const W_DIRECT = 70;
const W_GENRE = 30;

function genreMatch(meta: ArtistMeta | undefined, taste: TasteProfile): number {
  if (!meta || meta.genres.length === 0) return 0;
  let best = 0;
  let sum = 0;
  for (const g of meta.genres) {
    const w = taste.genreWeights.get(g) ?? 0;
    best = Math.max(best, w);
    sum += w;
  }
  // Reward both a strong single match and broad overlap.
  return Math.min(1, best * 0.7 + (sum / meta.genres.length) * 0.3);
}

export function scoreArtist(
  artistName: string,
  meta: ArtistMeta | undefined,
  taste: TasteProfile,
): ScoredArtist {
  const direct = taste.affinityByName.get(normalizeName(artistName)) ?? 0;
  const genre = genreMatch(meta, taste);
  const score = Math.round(W_DIRECT * direct + W_GENRE * genre);

  let tier: Tier;
  let reason: string;
  if (direct >= 0.5) {
    tier = "must-see";
    reason = "One of your top artists";
  } else if (direct >= 0.15) {
    tier = "worth-it";
    reason = "You listen to them";
  } else if (direct > 0 && genre >= 0.3) {
    tier = "worth-it";
    reason = "On your radar + fits your taste";
  } else if (genre >= 0.45) {
    tier = "discovery";
    reason = "New to you, but right up your alley";
  } else if (score > 0) {
    tier = "discovery";
    reason = "Loose match to your taste";
  } else {
    tier = "skip";
    reason = "Not your usual sound";
  }

  return { artist: artistName, score, tier, directAffinity: direct, genreMatch: genre, reason };
}
