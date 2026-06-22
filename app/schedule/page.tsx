import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildTasteProfile,
  DEFAULT_TASTE_OPTIONS,
  normalizeName,
  TasteOptions,
  TimeWindow,
} from "@/lib/taste";
import { enrichArtists } from "@/lib/enrich";
import { getLineup, uniqueArtists } from "@/lib/lineup";
import { scoreArtist } from "@/lib/scoring";
import stageDistances from "@/data/stage-distances.json";
import ScheduleClient, { UISet, DayData } from "./ScheduleClient";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ window?: string; sources?: string }> };

const WINDOWS: TimeWindow[] = ["short_term", "medium_term", "long_term"];

function parseOptions(sp: { window?: string; sources?: string }): TasteOptions {
  const window = WINDOWS.includes(sp.window as TimeWindow)
    ? (sp.window as TimeWindow)
    : DEFAULT_TASTE_OPTIONS.window;
  // sources is a csv of enabled keys; absent param => defaults.
  if (sp.sources === undefined) return { ...DEFAULT_TASTE_OPTIONS, window };
  const on = new Set(sp.sources.split(",").filter(Boolean));
  return {
    window,
    useTopArtists: on.has("artists"),
    useTopTracks: on.has("tracks"),
    useRecent: on.has("recent"),
    useSaved: on.has("saved"),
  };
}

export default async function Schedule({ searchParams }: Props) {
  const token = (await cookies()).get("spotify_access_token")?.value;
  if (!token) redirect("/?error=not_logged_in");

  const options = parseOptions(await searchParams);
  const taste = await buildTasteProfile(token, options);
  const meta = await enrichArtists(uniqueArtists(), token);
  const lineup = getLineup();

  // Score each artist once, then attach to every set they play.
  const scoredArtist = new Map<string, ReturnType<typeof scoreArtist>>();
  const byDate = new Map<string, UISet[]>();
  for (const set of lineup.sets) {
    const sc =
      scoredArtist.get(set.artist) ?? scoreArtist(set.artist, meta.get(set.artist), taste);
    scoredArtist.set(set.artist, sc);
    const ui: UISet = {
      id: set.id,
      artist: set.artist,
      stage: set.stage,
      start: set.start,
      end: set.end,
      score: sc.score,
      tier: sc.tier,
      reason: sc.reason,
      image: meta.get(set.artist)?.image ?? null,
    };
    const arr = byDate.get(set.date) ?? [];
    arr.push(ui);
    byDate.set(set.date, arr);
  }

  // Debug provenance: for every lineup artist we DID detect in your listening,
  // print their affinity + which signal caught them. Lets us confirm picks like
  // Claire Rosinkranz are landing (and from where). Server console only.
  const detected = [...scoredArtist.values()]
    .filter((s) => s.directAffinity > 0)
    .sort((a, b) => b.directAffinity - a.directAffinity);
  console.log(`[schedule] ${detected.length}/${scoredArtist.size} lineup artists detected in your listening:`);
  for (const s of detected) {
    const src = [...(taste.sourcesByName.get(normalizeName(s.artist)) ?? [])].join(", ") || "—";
    console.log(`  ${s.directAffinity.toFixed(2)}  ${s.tier.padEnd(9)} ${s.artist}  ←  ${src}`);
  }

  const days: DayData[] = lineup.dates.map((date) => ({
    date,
    label: lineup.sets.find((s) => s.date === date)?.day ?? date,
    sets: byDate.get(date) ?? [],
  }));

  // Order stage columns north→south so the timeline matches the park geography.
  const pos = stageDistances.walkMinutesFromNorth as Record<string, number>;
  const stageOrder = [...lineup.stages].sort((a, b) => (pos[a] ?? 0) - (pos[b] ?? 0));

  return <ScheduleClient days={days} stageOrder={stageOrder} options={options} />;
}
