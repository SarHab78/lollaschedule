import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildTasteProfile } from "@/lib/taste";
import { enrichArtists } from "@/lib/enrich";
import { getLineup, uniqueArtists } from "@/lib/lineup";
import { scoreArtist } from "@/lib/scoring";
import stageDistances from "@/data/stage-distances.json";
import ScheduleClient, { UISet, DayData } from "./ScheduleClient";

export const dynamic = "force-dynamic";

export default async function Schedule() {
  const token = (await cookies()).get("spotify_access_token")?.value;
  if (!token) redirect("/?error=not_logged_in");

  const taste = await buildTasteProfile(token);
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

  const days: DayData[] = lineup.dates.map((date) => ({
    date,
    label: lineup.sets.find((s) => s.date === date)?.day ?? date,
    sets: byDate.get(date) ?? [],
  }));

  // Order stage columns north→south so the timeline matches the park geography.
  const pos = stageDistances.walkMinutesFromNorth as Record<string, number>;
  const stageOrder = [...lineup.stages].sort((a, b) => (pos[a] ?? 0) - (pos[b] ?? 0));

  return <ScheduleClient days={days} stageOrder={stageOrder} />;
}
