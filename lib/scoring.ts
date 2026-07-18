import { normalizeName, TasteProfile } from "./taste";
import { Fit } from "./predict";

// Two tiers, matching the manual-pick flow: an artist is either one you PICKED
// (must-see) or one you didn't — a Discovery, ranked among the rest by an AI
// taste-fit score. There is no middle "you already listen to" band: in the
// pick flow you either love an artist enough to tap them or you don't. (The old
// three-tier model with a "worth-it" band was a leftover from the retired
// Spotify flow, where light signals like a follow landed in between.)
export type Tier = "must-see" | "discovery";

export type ScoredArtist = {
  artist: string;
  score: number; // 0..100, optimizer ranking — banded so picks > discovery
  fit: number; // 0..100, AI taste-fit (discoveries only; 0 for picked artists)
  tier: Tier;
  directAffinity: number; // 0..1, how strongly you picked / play them
  reason: string;
};

// Score bands keep the optimizer preferring artists you picked over AI guesses,
// while still ranking discoveries by fit. The gap between bands exceeds the
// emphasis bump (≤4) so a window nudge can never cross the tier boundary.
//   must-see   60..100  (your picks; +bump stays ≤100)
//   discovery   1..50   (+bump → ≤54, always below the 60 floor)
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

  // 0.15 is comfortably below a manual pick (always 1.0) and above the AI-fit
  // band, so every artist you tapped is a must-see and everyone else discovers.
  if (direct >= 0.15) {
    tier = "must-see";
    score = Math.min(100, 60 + Math.round(40 * Math.min(1, direct)) + bump);
    reason = "One of the artists you picked";
  } else {
    tier = "discovery";
    score = Math.min(54, 1 + Math.round(49 * (fit / 100)) + bump);
    reason = predicted?.reason || "A fresh pick to fill out your day";
  }

  return { artist: artistName, score, fit, tier, directAffinity: direct, reason };
}
