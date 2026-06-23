import { normalizeName, TasteProfile } from "./taste";
import { Fit } from "./predict";

// Three tiers. There is no "wildcard": any artist you don't directly listen to
// is a Discovery, ranked among the others by an AI taste-fit score.
export type Tier = "must-see" | "worth-it" | "discovery";

export type ScoredArtist = {
  artist: string;
  score: number; // 0..100, optimizer ranking — banded so direct > discovery
  fit: number; // 0..100, AI taste-fit (discoveries only; 0 for direct artists)
  tier: Tier;
  directAffinity: number; // 0..1, you actually play them
  reason: string;
};

// Score bands keep the optimizer preferring artists you actually listen to over
// AI guesses, while still ranking discoveries by fit. Gaps between bands exceed
// the emphasis bump (≤4) so a window nudge can never cross a tier boundary.
//   must-see  90..100
//   worth-it  60..80  (+bump → ≤84)
//   discovery  1..50  (+bump → ≤54, but discoveries rarely have emphasis)
export function scoreArtist(
  artistName: string,
  taste: TasteProfile,
  predicted?: Fit,
): ScoredArtist {
  const key = normalizeName(artistName);
  const direct = taste.affinityByName.get(key) ?? 0; // window-independent → tier
  const emphasis = taste.emphasisByName.get(key) ?? 0; // selected window → nudge
  const fit = predicted ? Math.max(0, Math.min(100, predicted.fit)) : 0;
  const bump = Math.round(4 * emphasis);

  let tier: Tier;
  let score: number;
  let reason: string;

  if (direct >= 0.5) {
    tier = "must-see";
    score = Math.min(100, 90 + Math.round(10 * Math.min(1, direct)) + bump);
    reason = "One of your top artists";
  } else if (direct >= 0.15) {
    tier = "worth-it";
    score = Math.min(84, 60 + Math.round((20 * (direct - 0.15)) / 0.35) + bump);
    reason = "You listen to them";
  } else {
    tier = "discovery";
    score = Math.min(54, 1 + Math.round(49 * (fit / 100)) + bump);
    reason = predicted?.reason || "A fresh pick to fill out your day";
  }

  return { artist: artistName, score, fit, tier, directAffinity: direct, reason };
}
