import { ArtistMeta } from "./enrich";
import { normalizeName, TasteProfile } from "./taste";

export type Tier = "must-see" | "worth-it" | "discovery" | "wildcard";

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
  const key = normalizeName(artistName);
  const direct = taste.affinityByName.get(key) ?? 0; // window-independent → tier
  const emphasis = taste.emphasisByName.get(key) ?? 0; // selected window → nudge only
  const genre = genreMatch(meta, taste);
  const pop = (meta?.popularity ?? 0) / 100;
  const base = W_DIRECT * direct + W_GENRE * genre; // 0..100, real enjoyment

  // We schedule the whole day, so even with no match we still pick *something*
  // for each slot. Rank those fillers by genre fit + popularity so they're the
  // most promising unfamiliar acts (a worthwhile discovery), not random ones —
  // and so the score is never a flat, meaningless 0.
  const discoveryPotential = 12 * genre + 6 * pop; // 0..18

  // Tier (below) uses only `direct`/`genre` so colors are window-independent;
  // emphasis just adds up to 8 points to break conflict ties toward the window.
  const score = Math.max(1, Math.round(Math.max(base, discoveryPotential) + 8 * emphasis));

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
  } else {
    // Filler we picked to keep your day full — the best unfamiliar option here.
    tier = "wildcard";
    reason =
      genre >= 0.2
        ? "Wildcard — leans toward your taste, worth a look"
        : pop >= 0.6
          ? "Wildcard — a popular act to fill the slot"
          : "Wildcard — picked to keep your day full";
  }

  return { artist: artistName, score, tier, directAffinity: direct, genreMatch: genre, reason };
}
