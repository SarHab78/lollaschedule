import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildTasteProfile } from "@/lib/taste";
import { enrichArtists } from "@/lib/enrich";
import { getLineup, uniqueArtists } from "@/lib/lineup";
import { scoreArtist, Tier } from "@/lib/scoring";
import { optimizeDay, PlannableSet, ItineraryEntry } from "@/lib/optimizer";

export const dynamic = "force-dynamic";

const TIER_LABEL: Record<Tier, string> = {
  "must-see": "🔥 Must-see",
  "worth-it": "👍 Worth it",
  discovery: "🔮 Discovery",
  skip: "· Skip",
};

function fmt(iso: string): string {
  const [, time] = iso.split("T");
  const [h, m] = time.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

export default async function Schedule() {
  const token = (await cookies()).get("spotify_access_token")?.value;
  if (!token) redirect("/?error=not_logged_in");

  const taste = await buildTasteProfile(token);
  const meta = await enrichArtists(uniqueArtists(), token);
  const lineup = getLineup();

  // Score every set, then optimize each day independently.
  const scoredByDate = new Map<string, PlannableSet[]>();
  const tierByArtist = new Map<string, ReturnType<typeof scoreArtist>>();
  for (const set of lineup.sets) {
    const scored = tierByArtist.get(set.artist) ?? scoreArtist(set.artist, meta.get(set.artist), taste);
    tierByArtist.set(set.artist, scored);
    const arr = scoredByDate.get(set.date) ?? [];
    arr.push({
      id: set.id,
      artist: set.artist,
      stage: set.stage,
      start: set.start,
      end: set.end,
      score: scored.score,
    });
    scoredByDate.set(set.date, arr);
  }

  const days = lineup.dates.map((date) => {
    const label = lineup.sets.find((s) => s.date === date)?.day ?? date;
    const itinerary = optimizeDay(scoredByDate.get(date) ?? []);
    return { date, label, itinerary };
  });

  const totalSeen = days.reduce((n, d) => n + d.itinerary.length, 0);

  return (
    <main>
      <h1>Your Lolla 2026 schedule</h1>
      <p className="subtitle">
        Optimized from your listening across {lineup.stages.length} stages and{" "}
        {lineup.sets.length} sets — {totalSeen} performances picked, conflicts resolved by how
        much you&apos;d enjoy each act (minus walking time between stages).
      </p>

      {days.map((d) => (
        <section key={d.date} style={{ marginBottom: "2.5rem" }}>
          <h2 style={{ fontSize: "1.4rem", margin: "1.5rem 0 0.75rem", color: "#4ad6ff" }}>
            {d.label} · {d.date.slice(5)}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {d.itinerary.map((e: ItineraryEntry) => {
              const scored = tierByArtist.get(e.artist)!;
              return (
                <div
                  key={e.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr auto",
                    gap: "1rem",
                    alignItems: "center",
                    background: "#1a1a22",
                    border: "1px solid #26262f",
                    borderRadius: 10,
                    padding: "0.7rem 1rem",
                  }}
                >
                  <div style={{ color: "#8a8a94", fontVariantNumeric: "tabular-nums", minWidth: 110 }}>
                    {fmt(e.start)}–{fmt(e.end)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {e.artist} <span style={{ color: "#8a8a94", fontWeight: 400 }}>· {e.stage}</span>
                    </div>
                    {e.conflictedWith.length > 0 && (
                      <div style={{ fontSize: "0.78rem", color: "#6a6a74" }}>
                        instead of {e.conflictedWith.map((c) => `${c.artist} (${c.score})`).join(", ")}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <div style={{ fontSize: "0.8rem" }}>{TIER_LABEL[scored.tier]}</div>
                    <div style={{ color: "#1db954", fontWeight: 700, fontSize: "0.85rem" }}>
                      {e.score}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <a className="btn" href="/dashboard" style={{ background: "#26262f" }}>
        ← Back to your artists
      </a>
    </main>
  );
}
