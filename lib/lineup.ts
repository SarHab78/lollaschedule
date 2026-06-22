import lineup from "../data/lineup-2026.json";

export type LineupSet = {
  id: string;
  artist: string;
  stage: string;
  date: string; // "2026-07-30"
  day: string; // "Thursday"
  start: string; // "2026-07-30T16:30"
  end: string;
};

export type Lineup = {
  festival: string;
  location: string;
  dates: string[];
  stages: string[];
  sets: LineupSet[];
};

export function getLineup(): Lineup {
  return lineup as Lineup;
}

export function uniqueArtists(): string[] {
  return [...new Set(getLineup().sets.map((s) => s.artist))];
}
