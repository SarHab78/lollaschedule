import { getLineup } from "@/lib/lineup";

// The read-only schedule rendering shared by both share routes:
//   /share?s=<code>   — stateless snapshot, frozen at copy time (legacy + fallback)
//   /share/<slug>     — live link, re-read from KV on every request
// Both render purely from the public lineup data, so neither needs a login.

function fmt(iso: string): string {
  const [, t] = iso.split("T");
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

// "just now" / "3 hours ago" / "2 days ago" — enough for a viewer to judge how
// fresh a live plan is without exposing a precise timestamp.
function ago(ms: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 90) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function ShareView({
  ids,
  live = false,
  updatedAt,
}: {
  ids: Iterable<string>;
  live?: boolean;
  updatedAt?: number;
}) {
  const idSet = new Set(ids);
  const lineup = getLineup();
  const picked = lineup.sets.filter((s) => idSet.has(s.id));

  const byDate = new Map<string, typeof picked>();
  for (const s of picked) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }
  for (const arr of byDate.values()) arr.sort((a, b) => a.start.localeCompare(b.start));

  return (
    <main>
      <div className="hero">
        <h1>Lollapalooza 2026 schedule</h1>
        <p className="subtitle">Grant Park, Chicago · July 30 – Aug 2, 2026</p>
      </div>

      {live && (
        <p
          className="no-print"
          style={{ fontSize: "0.82rem", color: "#5cffd3", margin: "0 0 1rem" }}
        >
          ● Live link — this updates automatically when they change their schedule
          {updatedAt ? ` · last updated ${ago(updatedAt)}` : ""}
        </p>
      )}

      {picked.length === 0 && <p>No sets in this link.</p>}

      {lineup.dates
        .filter((d) => byDate.has(d))
        .map((date) => {
          const rows = byDate.get(date)!;
          const label = rows[0]?.day ?? date;
          return (
            <section key={date} style={{ marginBottom: "1.75rem" }}>
              <h2 style={{ fontSize: "1.3rem", color: "#4ad6ff", margin: "1rem 0 0.5rem" }}>
                {label} · {date.slice(5)}
              </h2>
              {rows.map((s) => (
                <div
                  key={s.id}
                  style={{
                    display: "flex",
                    gap: "1rem",
                    padding: "0.5rem 0.75rem",
                    borderBottom: "1px solid #26262f",
                  }}
                >
                  <span style={{ color: "#8a8a94", minWidth: 120, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(s.start)}–{fmt(s.end)}
                  </span>
                  <span style={{ fontWeight: 600 }}>{s.artist}</span>
                  <span style={{ color: "#8a8a94" }}>· {s.stage}</span>
                </div>
              ))}
            </section>
          );
        })}

      <a className="btn no-print" href="/schedule" style={{ background: "#26262f" }}>
        Build your own →
      </a>
    </main>
  );
}
