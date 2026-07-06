import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  buildTasteProfile,
  buildManualProfile,
  DEFAULT_TASTE_OPTIONS,
  normalizeName,
  TasteOptions,
  TasteProfile,
  TimeWindow,
} from "@/lib/taste";
import { enrichArtists, cachedArtists, ArtistMeta } from "@/lib/enrich";
import { getMe } from "@/lib/spotify";
import { kvGet } from "@/lib/kv";
import { getLineup, uniqueArtists } from "@/lib/lineup";
import { scoreArtist } from "@/lib/scoring";
import { predictFits } from "@/lib/predict";
import stageDistances from "@/data/stage-distances.json";
import ScheduleClient, { UISet, DayData } from "./ScheduleClient";

export const dynamic = "force-dynamic";
// The AI fit prediction (cold/uncached) can exceed Vercel's default 10s budget.
export const maxDuration = 60;

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
  const jar = await cookies();
  const token = jar.get("spotify_access_token")?.value;
  const manualId = jar.get("manual_id")?.value;

  const options = parseOptions(await searchParams);
  const lineup = getLineup();
  const artists = uniqueArtists();

  // Two taste sources: Spotify (the 25 allowlisted) or the manual pick flow
  // (anyone). The rest of the pipeline is identical.
  let taste: TasteProfile;
  let meta: Map<string, ArtistMeta>;
  const manualMode = !token && !!manualId;

  if (token) {
    // Spotify's rate limit is app-wide; a fetch can 429. Fail gracefully to a
    // friendly retry screen instead of crashing the page with a stack trace.
    try {
      const { id: userId } = await getMe(token); // stable key for the durable cache
      taste = await buildTasteProfile(token, userId, options);
      meta = await enrichArtists(artists, token);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      redirect(`/?error=${msg.includes("429") ? "spotify_busy" : "spotify_failed"}`);
    }
  } else if (manualId) {
    const loved = (await kvGet<string[]>(`manual:${manualId}`)) ?? [];
    if (loved.length === 0) redirect("/pick");
    taste = buildManualProfile(loved);
    meta = cachedArtists(artists); // images only, no Spotify needed
  } else {
    redirect("/?error=not_logged_in");
  }

  // AI discovery: artists you don't directly listen to (would-be discoveries)
  // get a taste-fit score from Claude, ranked against your demonstrated favorites.
  const isDirect = (name: string) => (taste.affinityByName.get(normalizeName(name)) ?? 0) >= 0.15;
  const favorites = [...taste.affinityByName.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60)
    .map(([name]) => name);
  const candidates = artists.filter((a) => !isDirect(a));
  console.log(`[predict] favorites fed to AI (${favorites.length}):`, favorites.join(", "));
  console.log(`[predict] candidates to score: ${candidates.length}`);
  const prediction = await predictFits(favorites, candidates).catch(
    () => ({ fits: new Map(), status: "unavailable" as const }),
  );
  const fits = prediction.fits;
  const aiUnavailable = prediction.status === "unavailable";

  // Score each artist once, then attach to every set they play.
  const scoredArtist = new Map<string, ReturnType<typeof scoreArtist>>();
  const byDate = new Map<string, UISet[]>();
  for (const set of lineup.sets) {
    const sc =
      scoredArtist.get(set.artist) ?? scoreArtist(set.artist, taste, fits.get(set.artist));
    scoredArtist.set(set.artist, sc);
    const ui: UISet = {
      id: set.id,
      artist: set.artist,
      stage: set.stage,
      start: set.start,
      end: set.end,
      score: sc.score,
      fit: sc.fit,
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

  return <ScheduleClient days={days} stageOrder={stageOrder} options={options} manualMode={manualMode} aiUnavailable={aiUnavailable} />;
}
