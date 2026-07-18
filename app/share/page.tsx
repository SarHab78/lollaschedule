import { getLineup } from "@/lib/lineup";
import { decodeSets } from "@/lib/setcode";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ s?: string; sets?: string }> };

function fmt(iso: string): string {
  const [, t] = iso.split("T");
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

// Public, read-only view of a schedule encoded as ?s=<compact code> (or the
// legacy ?sets=id1,id2,... CSV) — renders purely from the (public) lineup data,
// so anyone can open it without a login.
export default async function Share({ searchParams }: Props) {
  const { s, sets } = await searchParams;
  // New compact form: ?s=<base64url bitset>. Legacy form: ?sets=id1,id2,... —
  // still honored so links shared before the compact encoding keep working.
  const ids = new Set(
    s ? decodeSets(s) : (sets ?? "").split(",").filter(Boolean)
  );
  const lineup = getLineup();
  const picked = lineup.sets.filter((s) => ids.has(s.id));

  const byDate = new Map<string, typeof picked>();
  for (const s of picked) {
    const arr = byDate.get(s.date) ?? [];
    arr.push(s);
    byDate.set(s.date, arr);
  }
  for (const arr of byDate.values()) arr.sort((a, b) => a.start.localeCompare(b.start));

  return (
    <main>
      <h1>Lollapalooza 2026 schedule</h1>
      <p className="subtitle">Grant Park, Chicago · July 30 – Aug 2, 2026</p>

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
