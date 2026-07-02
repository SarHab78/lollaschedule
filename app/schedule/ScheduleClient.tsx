"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { optimizeDay, PlannableSet } from "@/lib/optimizer";
import { buildIcs, IcsSet } from "@/lib/ics";
import type { Tier } from "@/lib/scoring";
import type { TasteOptions, TimeWindow } from "@/lib/taste";

export type UISet = {
  id: string;
  artist: string;
  stage: string;
  start: string;
  end: string;
  score: number;
  fit: number; // AI taste-fit 0..100 (discoveries; 0 for direct artists)
  tier: Tier;
  reason: string;
  image: string | null;
};

export type DayData = { date: string; label: string; sets: UISet[] };
type Friend = { name: string; ids: string[] };

// Kept local (not imported from taste.ts) so the Node-only deps in that module
// don't get pulled into the client bundle.
const WINDOW_LABEL: Partial<Record<TimeWindow, string>> = {
  medium_term: "Last 6 months",
  long_term: "All time",
};
const FRIEND_COLORS = ["#ff8a5c", "#ffd35c", "#5cffd3", "#c98aff"];

const TIER_COLOR: Record<Tier, string> = {
  "must-see": "#1db954", // green
  "worth-it": "#4ad6ff", // blue
  discovery: "#b07cff", // purple
};
const TIER_LABEL: Record<Tier, string> = {
  "must-see": "🔥 Must-see",
  "worth-it": "👍 Worth it",
  discovery: "🔮 Discovery",
};

const DAY_START = 12 * 60;
const DAY_END = 22 * 60;
const PX_PER_MIN = 1.3;
// A 🔮 discovery at/above this AI fit is "strong" — surfaced (dashed outline +
// ⭐ panel) when a conflict knocks it out, so you don't miss a great rec. Tunable.
const HIGH_FIT = 70;

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

// Lay out a stage's sets into side-by-side lanes so overlapping sets (e.g. a
// data conflict where two acts share a stage+time, or back-to-back overlaps)
// render legibly next to each other instead of stacking on top. Returns
// id -> { lane index, number of lanes in that set's overlap cluster }.
function layoutLanes(sets: UISet[]): Map<string, { lane: number; lanes: number }> {
  const res = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...sets].sort((a, b) => mins(a.start) - mins(b.start) || mins(a.end) - mins(b.end));
  let cluster: UISet[] = [];
  let clusterEnd = -1;
  const flush = (cl: UISet[]) => {
    const laneEnds: number[] = []; // lane -> end-minute of its last set
    for (const s of cl) {
      let lane = laneEnds.findIndex((end) => mins(s.start) >= end);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = mins(s.end);
      res.set(s.id, { lane, lanes: 0 });
    }
    for (const s of cl) res.get(s.id)!.lanes = laneEnds.length;
  };
  for (const s of sorted) {
    if (cluster.length && mins(s.start) >= clusterEnd) {
      flush(cluster);
      cluster = [];
      clusterEnd = -1;
    }
    cluster.push(s);
    clusterEnd = Math.max(clusterEnd, mins(s.end));
  }
  if (cluster.length) flush(cluster);
  return res;
}

// Small localStorage-backed state so locks/excludes/friends survive reloads and
// the soft navigations we trigger when taste settings change.
function usePersisted<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setVal(JSON.parse(raw));
    } catch {}
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    if (loaded) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch {}
    }
  }, [key, val, loaded]);
  return [val, setVal];
}

export default function ScheduleClient({
  days,
  stageOrder,
  options,
  manualMode = false,
}: {
  days: DayData[];
  stageOrder: string[];
  options: TasteOptions;
  manualMode?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [active, setActive] = useState(0);
  const [missedOpen, setMissedOpen] = useState(true);
  const [locks, setLocks] = usePersisted<string[]>("lolla_locks", []);
  const [friends, setFriends] = usePersisted<Friend[]>("lolla_friends", []);
  const [friendName, setFriendName] = useState("");
  const [friendLink, setFriendLink] = useState("");

  const lockSet = useMemo(() => new Set(locks), [locks]);

  const toggleLock = (id: string) =>
    setLocks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const validIds = useMemo(
    () => new Set(days.flatMap((d) => d.sets.map((s) => s.id))),
    [days],
  );

  // Optimize each day, honoring locked picks.
  const itineraries = useMemo(() => {
    return days.map((d) => {
      const plannable: PlannableSet[] = d.sets.map((s) => ({ id: s.id, artist: s.artist, stage: s.stage, start: s.start, end: s.end, score: s.score }));
      const chosen = optimizeDay(plannable, [...lockSet]);
      return { date: d.date, chosenIds: new Set(chosen.map((c) => c.id)) };
    });
  }, [days, lockSet]);

  const day = days[active];
  const dayItin = itineraries[active];

  const yourChosenIds = useMemo(
    () => new Set(itineraries.flatMap((it) => [...it.chosenIds])),
    [itineraries],
  );
  const allChosenSets: UISet[] = useMemo(() => {
    const byId = new Map(days.flatMap((d) => d.sets).map((s) => [s.id, s]));
    return [...yourChosenIds].map((id) => byId.get(id)!).filter(Boolean).sort((a, b) => a.start.localeCompare(b.start));
  }, [days, yourChosenIds]);

  // Sets a conflict knocked out that you'd want to know about: direct favorites
  // (must-see/worth-it) AND strong AI discoveries (fit ≥ HIGH_FIT). Shows what
  // you're missing + what beat it, so you can lock it back in.
  const missed = useMemo(() => {
    const rows: { set: UISet; day: string; conflict?: UISet }[] = [];
    itineraries.forEach((it, di) => {
      const d = days[di];
      d.sets.forEach((s) => {
        if (it.chosenIds.has(s.id)) return;
        if (s.tier === "discovery" && s.fit < HIGH_FIT) return; // weak discovery — skip
        const conflict = d.sets.find(
          (o) => it.chosenIds.has(o.id) && mins(o.start) < mins(s.end) && mins(o.end) > mins(s.start),
        );
        rows.push({ set: s, day: d.label, conflict });
      });
    });
    // Direct favorites (banded score 60-100) sort above discoveries (≤54); within
    // each, higher first. For discoveries that means higher fit first.
    return rows.sort((a, b) => b.set.score - a.set.score);
  }, [days, itineraries]);

  // ---- taste settings → server re-score via URL ----
  // Always score on all signals; only the listening window is user-selectable.
  const applyWindow = (window: TimeWindow) => {
    startTransition(() => router.push(`/schedule?window=${window}`));
  };

  // ---- export ----
  const downloadIcs = () => {
    const blob = new Blob([buildIcs(allChosenSets as IcsSet[])], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lollapalooza-2026.ics";
    a.click();
    URL.revokeObjectURL(url);
  };
  const copyShare = async () => {
    const link = `${location.origin}/share?sets=${allChosenSets.map((s) => s.id).join(",")}`;
    try {
      await navigator.clipboard.writeText(link);
      alert("Share link copied! Send it to a friend — they can paste it below to compare.");
    } catch {
      prompt("Copy your share link:", link);
    }
  };

  // ---- friends ----
  const addFriend = () => {
    const raw = friendLink.trim();
    let s = raw;
    const i = s.indexOf("sets=");
    if (i >= 0) s = s.slice(i + 5);
    s = s.split("&")[0];
    try { s = decodeURIComponent(s); } catch {}
    const ids = s.split(",").map((x) => x.trim()).filter((x) => validIds.has(x));
    if (ids.length === 0) {
      alert("Couldn't find any valid sets in that link.");
      return;
    }
    const name = friendName.trim() || `Friend ${friends.length + 1}`;
    setFriends((p) => [...p, { name, ids }]);
    setFriendName("");
    setFriendLink("");
  };
  const removeFriend = (idx: number) => setFriends((p) => p.filter((_, i) => i !== idx));

  // For the active day, which friends are on each set, and your overlaps.
  const friendsOnSet = (id: string) => friends.map((f, i) => (f.ids.includes(id) ? i : -1)).filter((i) => i >= 0);

  return (
    <main style={{ maxWidth: 1100 }}>
      <h1>Your Lolla 2026 schedule</h1>
      <p className="subtitle">
        Each column is a stage; time runs top to bottom. We picked the sets that maximize
        how much you&apos;d enjoy the day, minus walking time between stages.
      </p>

      {/* ---- Taste settings (Spotify only — no listening windows in manual mode) ---- */}
      {!manualMode && (
        <details className="no-print" style={panel} open>
          <summary style={summary}>⚙️ Taste settings {pending && <span style={{ color: "#4ad6ff" }}>· updating…</span>}</summary>
          <div style={{ marginTop: "0.75rem" }}>
            <div style={{ fontSize: "0.82rem", color: "#8a8a94", marginBottom: 6 }}>Listening window:</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(Object.keys(WINDOW_LABEL) as TimeWindow[]).map((w) => (
                <button key={w} onClick={() => applyWindow(w)} style={chip(options.window === w)}>
                  {WINDOW_LABEL[w]}
                </button>
              ))}
            </div>
          </div>
        </details>
      )}

      {/* ---- Friends ---- */}
      <details className="no-print" style={panel}>
        <summary style={summary}>👯 Compare with friends {friends.length > 0 && <span style={{ color: "#4ad6ff" }}>· {friends.length}</span>}</summary>
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "0.82rem", color: "#8a8a94", margin: "0 0 0.6rem" }}>
            Ask a friend to hit <strong>Copy share link</strong> and send it to you. Paste it here to
            see where your schedules overlap.
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
            <input value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="Friend's name" style={{ ...input, maxWidth: 160 }} />
            <input value={friendLink} onChange={(e) => setFriendLink(e.target.value)} placeholder="Paste their share link" style={{ ...input, flex: 1, minWidth: 220 }} />
            <button className="btn" onClick={addFriend}>Add</button>
          </div>
          {friends.map((f, i) => {
            const overlap = f.ids.filter((id) => yourChosenIds.has(id));
            const byId = new Map(days.flatMap((d) => d.sets).map((s) => [s.id, s]));
            return (
              <div key={i} style={{ borderTop: "1px solid #26262f", padding: "0.6rem 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: FRIEND_COLORS[i % FRIEND_COLORS.length] }} />
                  <strong>{f.name}</strong>
                  <span style={{ color: "#8a8a94", fontSize: "0.82rem" }}>
                    {overlap.length} set{overlap.length === 1 ? "" : "s"} together · {f.ids.length} total
                  </span>
                  <button onClick={() => removeFriend(i)} style={{ marginLeft: "auto", background: "none", border: "none", color: "#6a6a74", cursor: "pointer" }}>remove</button>
                </div>
                {overlap.length > 0 && (
                  <div style={{ fontSize: "0.8rem", color: "#b8b8c0", marginTop: 4, paddingLeft: 20 }}>
                    👯 Plan together: {overlap.map((id) => byId.get(id)?.artist).filter(Boolean).join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>

      {/* ---- Missing favorites ---- */}
      <details className="no-print" style={panel} open={missedOpen} onToggle={(e) => setMissedOpen((e.target as HTMLDetailsElement).open)}>
        <summary style={summary}>
          ⭐ Missing picks {missed.length > 0 && <span style={{ color: "#ffd35c" }}>· {missed.length}</span>}
        </summary>
        <div style={{ marginTop: "0.75rem" }}>
          {missed.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#8a8a94", margin: 0 }}>
              Nothing — every favorite and strong discovery made the cut. 🎉
            </p>
          ) : (
            <>
              <p style={{ fontSize: "0.82rem", color: "#8a8a94", margin: "0 0 0.6rem" }}>
                Favorites you listen to — and <span style={{ color: TIER_COLOR.discovery }}>🔮 strong discoveries</span> (high AI fit) —
                that a conflict knocked out. <strong>Lock</strong> one to force it in; the day re-optimizes around it.
              </p>
              {missed.slice(0, 30).map(({ set: s, day, conflict }) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0", borderTop: "1px solid #26262f", fontSize: "0.85rem", flexWrap: "wrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: TIER_COLOR[s.tier], flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{s.artist}</span>
                  <span style={{ color: "#8a8a94" }}>{day} {fmt(s.start)} · {s.stage} · {s.tier === "discovery" ? `${s.fit} fit` : s.score}</span>
                  {conflict && <span style={{ color: "#6a6a74" }}>— clashes with {conflict.artist}</span>}
                  <button className="btn" style={{ marginLeft: "auto", padding: "0.3rem 0.85rem", fontSize: "0.8rem", background: lockSet.has(s.id) ? "#1db954" : "#26262f" }} onClick={() => toggleLock(s.id)}>
                    {lockSet.has(s.id) ? "🔒 Locked" : "Lock in"}
                  </button>
                </div>
              ))}
              {missed.length > 30 && <p style={{ fontSize: "0.78rem", color: "#6a6a74", marginTop: 6 }}>+ {missed.length - 30} more…</p>}
            </>
          )}
        </div>
      </details>

      {/* How to read the timeline */}
      <div className="no-print" style={{ ...panel, fontSize: "0.85rem", lineHeight: 1.5, color: "#b8b8c0" }}>
        <strong style={{ color: "#f5f5f7" }}>How to read this:</strong> every box is a set; the
        whole day is filled. <strong>Colored boxes are your plan</strong> — color = how well the
        artist fits your listening:
        <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
          <li><span style={{ color: TIER_COLOR["must-see"], fontWeight: 700 }}>🔥 Must-see</span> — one of your top artists.</li>
          <li><span style={{ color: TIER_COLOR["worth-it"], fontWeight: 700 }}>👍 Worth it</span> — an artist you already listen to.</li>
          <li><span style={{ color: TIER_COLOR.discovery, fontWeight: 700 }}>🔮 Discovery</span> — an artist you don&apos;t play yet, AI-ranked by how well they fit your taste. The <strong>fit</strong> score (0–100) on each shows the prediction; higher = better match.</li>
          <li><span style={{ color: TIER_COLOR["worth-it"], fontWeight: 700, border: `1.5px dashed ${TIER_COLOR["worth-it"]}`, borderRadius: 4, padding: "0 4px" }}>Dashed colored outline</span> = a favorite — or a <strong>strong 🔮 discovery</strong> (high AI fit) — you&apos;re <strong>missing</strong> because a conflict beat it. See the ⭐ panel above to lock it back in.</li>
          <li><span style={{ color: "#7a7a84", fontWeight: 700 }}>Dark gray boxes</span> are other sets we didn&apos;t pick.</li>
          <li><strong>Click</strong> a box to lock it (🔒) and re-optimize · colored dots = a friend is going too.</li>
        </ul>
      </div>

      {/* Export + day tabs */}
      <div className="no-print" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        <button className="btn" onClick={downloadIcs}>📅 Download .ics</button>
        <button className="btn" style={{ background: "#26262f" }} onClick={copyShare}>🔗 Copy share link</button>
        <button className="btn" style={{ background: "#26262f" }} onClick={() => window.print()}>🖨️ Print</button>
        {locks.length > 0 && (
          <button className="btn" style={{ background: "#3a2030" }} onClick={() => setLocks([])}>✕ Clear {locks.length} lock{locks.length > 1 ? "s" : ""}</button>
        )}
      </div>

      <div className="no-print" style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        {days.map((d, i) => (
          <button key={d.date} onClick={() => setActive(i)} style={tab(i === active)}>
            {d.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>{d.date.slice(5)}</span>
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="no-print" style={{ display: "flex", gap: 4, overflowX: "auto", opacity: pending ? 0.5 : 1 }}>
        <div style={{ position: "relative", width: 44, flexShrink: 0, height: (DAY_END - DAY_START) * PX_PER_MIN }}>
          {Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => (
            <div key={i} style={{ position: "absolute", top: i * 60 * PX_PER_MIN - 7, right: 6, fontSize: "0.7rem", color: "#6a6a74" }}>
              {fmt(`x T${String(12 + i).padStart(2, "0")}:00`)}
            </div>
          ))}
        </div>

        {stageOrder.map((stage) => (
          <div key={stage} style={{ flex: "1 1 0", minWidth: 120 }}>
            <div style={{ textAlign: "center", fontSize: "0.75rem", fontWeight: 600, color: "#8a8a94", marginBottom: 4, whiteSpace: "nowrap" }}>{stage}</div>
            <div style={{ position: "relative", height: (DAY_END - DAY_START) * PX_PER_MIN, background: "#14141a", borderRadius: 6 }}>
              {Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, i) => (
                <div key={i} style={{ position: "absolute", top: i * 60 * PX_PER_MIN, left: 0, right: 0, borderTop: "1px solid #1f1f27" }} />
              ))}
              {(() => {
                const stageSets = day.sets.filter((s) => s.stage === stage);
                const lanes = layoutLanes(stageSets);
                return stageSets.map((s) => {
                  const top = (mins(s.start) - DAY_START) * PX_PER_MIN;
                  const height = Math.max(18, (mins(s.end) - mins(s.start)) * PX_PER_MIN - 2);
                  // Side-by-side lane within this stage (1 lane = full width).
                  const li = lanes.get(s.id);
                  const laneIdx = li?.lane ?? 0;
                  const laneCount = li?.lanes ?? 1;
                  const widthPct = 100 / laneCount;
                  const isChosen = dayItin.chosenIds.has(s.id);
                  // A favorite OR a strong discovery (fit ≥ HIGH_FIT) bumped by a conflict.
                  const isMissed =
                    !isChosen && (s.tier !== "discovery" || s.fit >= HIGH_FIT);
                  const isLocked = lockSet.has(s.id);
                  const fos = friendsOnSet(s.id);
                  const color = TIER_COLOR[s.tier];
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggleLock(s.id)}
                      title={`${s.artist} · ${fmt(s.start)}–${fmt(s.end)} · ${TIER_LABEL[s.tier]} (${s.tier === "discovery" ? `${s.fit} fit` : s.score}) — ${s.reason}\nClick to lock`}
                      style={{
                        position: "absolute", top, height, textAlign: "left", overflow: "hidden",
                        left: `calc(${laneIdx * widthPct}% + 2px)`, width: `calc(${widthPct}% - 4px)`,
                        borderRadius: 5, padding: "2px 5px", cursor: "pointer",
                        background: isChosen ? color : "#1a1a22",
                        color: isChosen ? "#06210f" : isMissed ? color : "#7a7a84",
                        border: isLocked
                          ? "2px solid #fff"
                          : isChosen
                            ? `1px solid ${color}`
                            : isMissed
                              ? `1.5px dashed ${color}`
                              : "1px solid #26262f",
                        opacity: isChosen ? 1 : isMissed ? 0.95 : 0.55,
                        fontSize: "0.72rem", fontWeight: isChosen ? 700 : 500, lineHeight: 1.15,
                      }}
                    >
                      {isLocked ? "🔒 " : ""}{s.artist}
                      <span style={{ display: "block", fontWeight: 400, fontSize: "0.66rem", opacity: 0.85 }}>{fmt(s.start)} · {s.tier === "discovery" ? `${s.fit} fit` : s.score}</span>
                      {fos.length > 0 && (
                        <span style={{ position: "absolute", top: 3, right: 3, display: "flex", gap: 2 }}>
                          {fos.map((fi) => (
                            <span key={fi} title={friends[fi].name} style={{ width: 7, height: 7, borderRadius: "50%", background: FRIEND_COLORS[fi % FRIEND_COLORS.length] }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                });
              })()}
            </div>
          </div>
        ))}
      </div>

      {/* Print-only itinerary */}
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

      <a className="btn no-print" href={manualMode ? "/pick" : "/dashboard"} style={{ background: "#26262f", marginTop: "1.5rem" }}>
        ← {manualMode ? "Edit your picks" : "Back to your artists"}
      </a>
    </main>
  );
}

// ---- shared inline styles ----
const panel: React.CSSProperties = {
  background: "#1a1a22", border: "1px solid #26262f", borderRadius: 10,
  padding: "0.85rem 1.1rem", marginBottom: "1rem",
};
const summary: React.CSSProperties = { cursor: "pointer", fontWeight: 600, color: "#f5f5f7" };
const input: React.CSSProperties = {
  background: "#0f0f14", border: "1px solid #26262f", borderRadius: 8,
  padding: "0.5rem 0.7rem", color: "#f5f5f7", fontSize: "0.9rem",
};
function chip(activeState: boolean): React.CSSProperties {
  return {
    padding: "0.4rem 0.8rem", borderRadius: 999, cursor: "pointer", fontSize: "0.82rem", fontWeight: 600,
    border: `1px solid ${activeState ? "#1db954" : "#26262f"}`,
    background: activeState ? "#1db954" : "#0f0f14",
    color: activeState ? "#fff" : "#b8b8c0",
  };
}
function tab(activeState: boolean): React.CSSProperties {
  return {
    padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #26262f", fontWeight: 600, cursor: "pointer",
    background: activeState ? "#1db954" : "#1a1a22", color: activeState ? "#fff" : "#b8b8c0",
  };
}
