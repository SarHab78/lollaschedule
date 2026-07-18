// Weighted interval scheduling, per day, with a stage-to-stage travel penalty.
// We pick the conflict-free set of performances that maximizes total enjoyment,
// while discouraging tight back-to-back hops across opposite ends of the park.

export type PlannableSet = {
  id: string;
  artist: string;
  stage: string;
  start: string; // ISO local, e.g. "2026-07-30T16:30"
  end: string;
  score: number; // 0..100 affinity
};

export type ItineraryEntry = PlannableSet & {
  conflictedWith: { artist: string; stage: string; score: number }[]; // higher-scored? no — the runners-up we gave up
};

import stageDistances from "../data/stage-distances.json";
const stagePositions: Record<string, number> = stageDistances.walkMinutesFromNorth;

function minutes(iso: string): number {
  // Parse "YYYY-MM-DDTHH:MM" as wall-clock minutes since midnight.
  const [, time] = iso.split("T");
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function travelMinutes(stageA: string, stageB: string): number {
  if (stageA === stageB) return 0;
  const a = stagePositions[stageA] ?? 0;
  const b = stagePositions[stageB] ?? 0;
  return Math.abs(a - b);
}

// Penalty applied when seeing `next` right after `prev`: if you can't walk
// between the stages before `next` starts, you'll miss part of it.
function transitionPenalty(prev: PlannableSet, next: PlannableSet): number {
  const gap = minutes(next.start) - minutes(prev.end); // free minutes between sets
  const walk = travelMinutes(prev.stage, next.stage);
  const shortfall = walk - gap; // minutes of the next set you'd miss
  if (shortfall <= 0) return 0;
  // Lose roughly the fraction of the set you'd miss, scaled by its value.
  const setLen = Math.max(15, minutes(next.end) - minutes(next.start));
  return Math.min(next.score, next.score * (shortfall / setLen));
}

// A break is a "take a break" window (all stages). The optimizer schedules
// nothing overlapping it, leaving a genuine gap — and because the DP only ever
// maximizes, removing options here can never cram extra acts into the rest of
// the day, so your other picks stay put around the break.
export type BreakWindow = { start: string; end: string };

export function optimizeDay(
  allSets: PlannableSet[],
  lockedIds: string[] = [],
  breakWindows: BreakWindow[] = [],
): ItineraryEntry[] {
  const locked = new Set(lockedIds);

  // Drop anything overlapping a break up front — breaks win over everything,
  // including a stale lock that happens to fall inside one.
  const overlapsBreak = (x: PlannableSet) =>
    breakWindows.some(
      (b) => minutes(x.start) < minutes(b.end) && minutes(x.end) > minutes(b.start),
    );
  const avail = allSets.filter((x) => !overlapsBreak(x));

  // Locked picks are mandatory: drop any other set that time-overlaps a lock,
  // then give locks an overwhelming score so the DP always selects them.
  const lockedSets = avail.filter((x) => locked.has(x.id));
  const overlapsLock = (x: PlannableSet) =>
    lockedSets.some(
      (l) =>
        l.id !== x.id &&
        minutes(x.start) < minutes(l.end) &&
        minutes(x.end) > minutes(l.start),
    );
  const sets = avail.filter((x) => locked.has(x.id) || !overlapsLock(x));
  const LOCK_BONUS = 1e6;
  const eff = (x: PlannableSet) => x.score + (locked.has(x.id) ? LOCK_BONUS : 0);

  // Sort by end time for the classic weighted-interval DP.
  const s = [...sets].sort((a, b) => minutes(a.end) - minutes(b.end));
  const n = s.length;
  if (n === 0) return [];

  // p[i] = index of the latest set that ends at or before s[i] starts.
  const p: number[] = new Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (minutes(s[j].end) <= minutes(s[i].start)) {
        p[i] = j;
        break;
      }
    }
  }

  // best[i] = max achievable score using sets[0..i].
  const best: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const prevIdx = p[i];
    const penalty = prevIdx >= 0 ? transitionPenalty(s[prevIdx], s[i]) : 0;
    const take = eff(s[i]) - penalty + (prevIdx >= 0 ? best[prevIdx] : 0);
    const skip = i > 0 ? best[i - 1] : 0;
    best[i] = Math.max(take, skip);
  }

  // Backtrack to recover which sets were chosen.
  const chosen: PlannableSet[] = [];
  let i = n - 1;
  while (i >= 0) {
    const prevIdx = p[i];
    const penalty = prevIdx >= 0 ? transitionPenalty(s[prevIdx], s[i]) : 0;
    const take = eff(s[i]) - penalty + (prevIdx >= 0 ? best[prevIdx] : 0);
    const skip = i > 0 ? best[i - 1] : 0;
    if (take >= skip) {
      chosen.push(s[i]);
      i = prevIdx;
    } else {
      i -= 1;
    }
  }
  chosen.reverse();

  // For each chosen set, note the best alternatives we passed up at that time.
  return chosen.map((c) => {
    const overlap = avail
      .filter(
        (o) =>
          o.id !== c.id &&
          minutes(o.start) < minutes(c.end) &&
          minutes(o.end) > minutes(c.start),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((o) => ({ artist: o.artist, stage: o.stage, score: o.score }));
    return { ...c, conflictedWith: overlap };
  });
}
