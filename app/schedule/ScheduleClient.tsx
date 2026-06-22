"use client";

import { useMemo, useState } from "react";
import { optimizeDay, PlannableSet } from "@/lib/optimizer";
import { buildIcs, IcsSet } from "@/lib/ics";
import { Tier } from "@/lib/scoring";

export type UISet = {
  id: string;
  artist: string;
  stage: string;
  start: string;
  end: string;
  score: number;
  tier: Tier;
  reason: string;
  image: string | null;
};

export type DayData = { date: string; label: string; sets: UISet[] };

const TIER_COLOR: Record<Tier, string> = {
  "must-see": "#1db954",
  "worth-it": "#4ad6ff",
  discovery: "#b07cff",
  skip: "#5a5a64",
};
const TIER_LABEL: Record<Tier, string> = {
  "must-see": "🔥 Must-see",
  "worth-it": "👍 Worth it",
  discovery: "🔮 Discovery",
  skip: "· Skip",
};

const DAY_START = 12 * 60; // noon
const DAY_END = 22 * 60; // 10pm
const PX_PER_MIN = 1.3;

function mins(iso: string): number {
  const [, t] = iso.split("T");
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function fmt(iso: string): string {
  const [, t] = iso.split("T");
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "pm" : "am";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hr}${ampm}` : `${hr}:${String(m).padStart(2, "0")}${ampm}`;
}

export default function ScheduleClient({
  days,
  stageOrder,
}: {
  days: DayData[];
  stageOrder: string[];
}) {
  const [active, setActive] = useState(0);
  const [locked, setLocked] = useState<Set<string>>(new Set());

  const toggleLock = (id: string) =>
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Optimized itinerary per day, recomputed whenever a lock changes.
  const itineraries = useMemo(() => {
    const lockedIds = [...locked];
    return days.map((d) => {
      const plannable: PlannableSet[] = d.sets.map((s) => ({
        id: s.id,
        artist: s.artist,
        stage: s.stage,
        start: s.start,
        end: s.end,
        score: s.score,
      }));
      const chosen = optimizeDay(plannable, lockedIds);
      return { date: d.date, chosenIds: new Set(chosen.map((c) => c.id)), chosen };
    });
  }, [days, locked]);

  const day = days[active];
  const dayItin = itineraries[active];

  const allChosenSets: UISet[] = useMemo(() => {
    const byId = new Map(days.flatMap((d) => d.sets).map((s) => [s.id, s]));
    return itineraries
      .flatMap((it) => [...it.chosenIds])
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [days, itineraries]);

  const downloadIcs = () => {
    const ics = buildIcs(allChosenSets as IcsSet[]);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lollapalooza-2026.ics";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyShare = async () => {
    const ids = allChosenSets.map((s) => s.id).join(",");
    const link = `${location.origin}/share?sets=${ids}`;
    try {
      await navigator.clipboard.writeText(link);
      alert("Share link copied to clipboard!");
    } catch {
      prompt("Copy your share link:", link);
    }
  };

  return (
    <main style={{ maxWidth: 1100 }}>
      <h1>Your Lolla 2026 schedule</h1>
      <p className="subtitle">
        Each column is a stage; time runs top to bottom. We picked the sets that maximize
        how much you&apos;d enjoy the day, minus walking time between stages.
      </p>

      {/* How to read the timeline */}
      <div
        className="no-print"
        style={{
          background: "#1a1a22",
          border: "1px solid #26262f",
          borderRadius: 10,
          padding: "0.85rem 1.1rem",
          marginBottom: "1.25rem",
          fontSize: "0.85rem",
          lineHeight: 1.5,
          color: "#b8b8c0",
        }}
      >
        <strong style={{ color: "#f5f5f7" }}>How to read this:</strong>
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
          <li>
            <span style={{ color: "#1db954", fontWeight: 700 }}>Colored boxes</span> are the
            sets in your plan — the schedule we built for you. The color is how good a match
            the artist is: <span style={{ color: TIER_COLOR["must-see"] }}>🔥 must-see</span>,{" "}
            <span style={{ color: TIER_COLOR["worth-it"] }}>👍 worth it</span>,{" "}
            <span style={{ color: TIER_COLOR.discovery }}>🔮 discovery</span>.
          </li>
          <li>
            <span style={{ color: "#7a7a84", fontWeight: 700 }}>Gray boxes</span> are sets we
            didn&apos;t pick — either a better act overlapped them, or they&apos;re not your
            taste. They&apos;re still playing; we just didn&apos;t schedule them.
          </li>
          <li>
            <strong>Click any box to lock it</strong> (🔒, white outline). The day re-optimizes
            around your locked picks — handy to override a call you disagree with. Click again
            to unlock.
          </li>
        </ul>
      </div>

      <div className="no-print" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <button className="btn" onClick={downloadIcs}>📅 Download .ics</button>
        <button className="btn" style={{ background: "#26262f" }} onClick={copyShare}>🔗 Copy share link</button>
        <button className="btn" style={{ background: "#26262f" }} onClick={() => window.print()}>🖨️ Print</button>
        {locked.size > 0 && (
          <button className="btn" style={{ background: "#3a2030" }} onClick={() => setLocked(new Set())}>
            ✕ Clear {locked.size} lock{locked.size > 1 ? "s" : ""}
          </button>
        )}
      </div>

      {/* Day tabs */}
      <div className="no-print" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {days.map((d, i) => (
          <button
            key={d.date}
            onClick={() => setActive(i)}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: 8,
              border: "1px solid #26262f",
              background: i === active ? "#1db954" : "#1a1a22",
              color: i === active ? "#fff" : "#b8b8c0",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {d.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>{d.date.slice(5)}</span>
          </button>
        ))}
      </div>

      {/* Timeline: stages as columns, time down the page */}
      <div className="no-print" style={{ display: "flex", gap: 4, overflowX: "auto" }}>
        {/* time gutter */}
        <div style={{ position: "relative", width: 44, flexShrink: 0, height: (DAY_END - DAY_START) * PX_PER_MIN }}>
          {Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                top: i * 60 * PX_PER_MIN - 7,
                right: 6,
                fontSize: "0.7rem",
                color: "#6a6a74",
              }}
            >
              {fmt(`x T${String(12 + i).padStart(2, "0")}:00`)}
            </div>
          ))}
        </div>

        {stageOrder.map((stage) => (
          <div key={stage} style={{ flex: "1 1 0", minWidth: 120 }}>
            <div style={{ textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#8a8a94", marginBottom: 4, whiteSpace: "nowrap" }}>
              {stage}
            </div>
            <div style={{ position: "relative", height: (DAY_END - DAY_START) * PX_PER_MIN, background: "#14141a", borderRadius: 6 }}>
              {/* hour gridlines */}
              {Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => (
                <div key={i} style={{ position: "absolute", top: i * 60 * PX_PER_MIN, left: 0, right: 0, borderTop: "1px solid #1f1f27" }} />
              ))}
              {day.sets
                .filter((s) => s.stage === stage)
                .map((s) => {
                  const top = (mins(s.start) - DAY_START) * PX_PER_MIN;
                  const height = Math.max(18, (mins(s.end) - mins(s.start)) * PX_PER_MIN - 2);
                  const isChosen = dayItin.chosenIds.has(s.id);
                  const isLocked = locked.has(s.id);
                  const color = TIER_COLOR[s.tier];
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleLock(s.id)}
                      title={`${s.artist} · ${fmt(s.start)}–${fmt(s.end)} · ${TIER_LABEL[s.tier]} (${s.score}) — ${s.reason}`}
                      style={{
                        position: "absolute",
                        top,
                        left: 2,
                        right: 2,
                        height,
                        textAlign: "left",
                        overflow: "hidden",
                        borderRadius: 5,
                        padding: "2px 5px",
                        cursor: "pointer",
                        background: isChosen ? color : "#1a1a22",
                        color: isChosen ? "#06210f" : "#7a7a84",
                        border: isLocked ? "2px solid #fff" : `1px solid ${isChosen ? color : "#26262f"}`,
                        opacity: isChosen ? 1 : 0.55,
                        fontSize: "0.72rem",
                        fontWeight: isChosen ? 700 : 500,
                        lineHeight: 1.15,
                      }}
                    >
                      {isLocked ? "🔒 " : ""}{s.artist}
                      <span style={{ display: "block", fontWeight: 400, fontSize: "0.66rem", opacity: 0.85 }}>
                        {fmt(s.start)} · {s.score}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="no-print" style={{ display: "flex", gap: "1rem", marginTop: "1rem", fontSize: "0.78rem", color: "#8a8a94", flexWrap: "wrap" }}>
        {(Object.keys(TIER_LABEL) as Tier[]).filter((t) => t !== "skip").map((t) => (
          <span key={t} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: TIER_COLOR[t], display: "inline-block" }} />
            {TIER_LABEL[t]}
          </span>
        ))}
        <span style={{ color: "#6a6a74" }}>· Gray = not picked · 🔒 = locked</span>
      </div>

      {/* Print-only clean itinerary (all days) */}
      <div className="print-only">
        <h1>Lollapalooza 2026 — your schedule</h1>
        {itineraries.map((it, i) => {
          const d = days[i];
          const byId = new Map(d.sets.map((s) => [s.id, s]));
          const rows = [...it.chosenIds].map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));
          return (
            <section key={d.date} style={{ marginBottom: "1rem" }}>
              <h3 style={{ margin: "0.5rem 0" }}>{d.label} · {d.date}</h3>
              {rows.map((s) => (
                <div key={s.id}>{fmt(s.start)}–{fmt(s.end)} — <strong>{s.artist}</strong> · {s.stage}</div>
              ))}
            </section>
          );
        })}
      </div>

      <a className="btn no-print" href="/dashboard" style={{ background: "#26262f", marginTop: "1.5rem" }}>
        ← Back to your artists
      </a>
    </main>
  );
}
