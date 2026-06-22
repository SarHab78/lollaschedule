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
  tier: Tier;
  reason: string;
  image: string | null;
};

export type DayData = { date: string; label: string; sets: UISet[] };
type Friend = { name: string; ids: string[] };

// Kept local (not imported from taste.ts) so the Node-only deps in that module
// don't get pulled into the client bundle.
const WINDOW_LABEL: Record<TimeWindow, string> = {
  short_term: "Last 4 weeks",
  medium_term: "Last 6 months",
  long_term: "All time",
};
type BoolKey = "useTopArtists" | "useTopTracks" | "useRecent" | "useSaved";
const SOURCES: { key: BoolKey; label: string; param: string }[] = [
  { key: "useTopArtists", label: "Top artists", param: "artists" },
  { key: "useTopTracks", label: "Top tracks", param: "tracks" },
  { key: "useRecent", label: "Recently played", param: "recent" },
  { key: "useSaved", label: "Saved library", param: "saved" },
];
const FRIEND_COLORS = ["#ff8a5c", "#ffd35c", "#5cffd3", "#c98aff"];

const TIER_COLOR: Record<Tier, string> = {
  "must-see": "#1db954", // green
  "worth-it": "#4ad6ff", // blue
  discovery: "#b07cff", // purple
  wildcard: "#f0a24a", // amber
};
const TIER_LABEL: Record<Tier, string> = {
  "must-see": "🔥 Must-see",
  "worth-it": "👍 Worth it",
  discovery: "🔮 Discovery",
  wildcard: "🎲 Wildcard",
};

const DAY_START = 12 * 60;
const DAY_END = 22 * 60;
const PX_PER_MIN = 1.3;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
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
}: {
  days: DayData[];
  stageOrder: string[];
  options: TasteOptions;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [active, setActive] = useState(0);
  const [missedOpen, setMissedOpen] = useState(true);
  const [locks, setLocks] = usePersisted<string[]>("lolla_locks", []);
  const [excludes, setExcludes] = usePersisted<string[]>("lolla_excludes", []); // normalized names
  const [friends, setFriends] = usePersisted<Friend[]>("lolla_friends", []);
  const [artistQuery, setArtistQuery] = useState("");
  const [friendName, setFriendName] = useState("");
  const [friendLink, setFriendLink] = useState("");

  const lockSet = useMemo(() => new Set(locks), [locks]);
  const excludeSet = useMemo(() => new Set(excludes), [excludes]);

  const toggleLock = (id: string) =>
    setLocks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const toggleExclude = (artist: string) => {
    const k = norm(artist);
    setExcludes((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  };

  const allArtists = useMemo(
    () => [...new Set(days.flatMap((d) => d.sets.map((s) => s.artist)))].sort(),
    [days],
  );
  const validIds = useMemo(
    () => new Set(days.flatMap((d) => d.sets.map((s) => s.id))),
    [days],
  );

  // Optimize each day, excluding filtered-out artists, honoring locked picks.
  const itineraries = useMemo(() => {
    return days.map((d) => {
      const plannable: PlannableSet[] = d.sets
        .filter((s) => !excludeSet.has(norm(s.artist)))
        .map((s) => ({ id: s.id, artist: s.artist, stage: s.stage, start: s.start, end: s.end, score: s.score }));
      const chosen = optimizeDay(plannable, [...lockSet]);
      return { date: d.date, chosenIds: new Set(chosen.map((c) => c.id)) };
    });
  }, [days, excludeSet, lockSet]);

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

  // High-affinity sets (not wildcards) that a conflict knocked out of the plan,
  // plus what you're seeing instead — so you can spot a favorite you're missing.
  const missed = useMemo(() => {
    const rows: { set: UISet; day: string; conflict?: UISet }[] = [];
    itineraries.forEach((it, di) => {
      const d = days[di];
      d.sets.forEach((s) => {
        if (it.chosenIds.has(s.id) || excludeSet.has(norm(s.artist)) || s.tier === "wildcard") return;
        const conflict = d.sets.find(
          (o) => it.chosenIds.has(o.id) && mins(o.start) < mins(s.end) && mins(o.end) > mins(s.start),
        );
        rows.push({ set: s, day: d.label, conflict });
      });
    });
    return rows.sort((a, b) => b.set.score - a.set.score);
  }, [days, itineraries, excludeSet]);

  // ---- taste settings → server re-score via URL ----
  const applyOptions = (next: TasteOptions) => {
    const sources = SOURCES.filter((s) => next[s.key]).map((s) => s.param).join(",");
    startTransition(() => router.push(`/schedule?window=${next.window}&sources=${sources}`));
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

      {/* ---- Taste settings ---- */}
      <details className="no-print" style={panel} open>
        <summary style={summary}>⚙️ Taste settings {pending && <span style={{ color: "#4ad6ff" }}>· updating…</span>}</summary>
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ fontSize: "0.82rem", color: "#8a8a94", marginBottom: 6 }}>Listening window (Spotify only offers these three):</div>
          <div style={{ display: "flex", gap: 6, marginBottom: "0.9rem", flexWrap: "wrap" }}>
            {(Object.keys(WINDOW_LABEL) as TimeWindow[]).map((w) => (
              <button key={w} onClick={() => applyOptions({ ...options, window: w })} style={chip(options.window === w)}>
                {WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#8a8a94", marginBottom: 6 }}>Base my taste on:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SOURCES.map((s) => (
              <button key={s.key} onClick={() => applyOptions({ ...options, [s.key]: !options[s.key] })} style={chip(options[s.key])}>
                {options[s.key] ? "✓ " : ""}{s.label}
              </button>
            ))}
          </div>
        </div>
      </details>

      {/* ---- Exclude artists ---- */}
      <details className="no-print" style={panel}>
        <summary style={summary}>🚫 Exclude artists {excludes.length > 0 && <span style={{ color: "#ff8a8a" }}>· {excludes.length} hidden</span>}</summary>
        <div style={{ marginTop: "0.75rem" }}>
          {excludes.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: "0.75rem" }}>
              {excludes.map((k) => {
                const display = allArtists.find((a) => norm(a) === k) ?? k;
                return (
                  <button key={k} onClick={() => toggleExclude(k)} style={{ ...chip(true), background: "#3a2030", borderColor: "#5c2126" }}>
                    {display} ✕
                  </button>
                );
              })}
            </div>
          )}
          <input
            value={artistQuery}
            onChange={(e) => setArtistQuery(e.target.value)}
            placeholder="Search an artist to exclude…"
            style={input}
          />
          {artistQuery.trim() && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              {allArtists
                .filter((a) => a.toLowerCase().includes(artistQuery.toLowerCase()) && !excludeSet.has(norm(a)))
                .slice(0, 12)
                .map((a) => (
                  <button key={a} onClick={() => { toggleExclude(a); setArtistQuery(""); }} style={chip(false)}>
                    + {a}
                  </button>
                ))}
            </div>
          )}
          <p style={{ fontSize: "0.78rem", color: "#6a6a74", marginTop: 8 }}>
            Tip: <strong>Shift-click</strong> any set in the timeline to exclude that artist.
          </p>
        </div>
      </details>

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
          ⭐ Missing favorites {missed.length > 0 && <span style={{ color: "#ffd35c" }}>· {missed.length}</span>}
        </summary>
        <div style={{ marginTop: "0.75rem" }}>
          {missed.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#8a8a94", margin: 0 }}>
              Nothing — every artist you rate highly made the cut. 🎉
            </p>
          ) : (
            <>
              <p style={{ fontSize: "0.82rem", color: "#8a8a94", margin: "0 0 0.6rem" }}>
                Artists you rate highly that a conflict knocked out. <strong>Lock</strong> one to force it in —
                the day re-optimizes around it (and whatever it bumps shows up here instead).
              </p>
              {missed.slice(0, 30).map(({ set: s, day, conflict }) => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "0.4rem 0", borderTop: "1px solid #26262f", fontSize: "0.85rem", flexWrap: "wrap" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: TIER_COLOR[s.tier], flexShrink: 0 }} />
                  <span style={{ fontWeight: 600 }}>{s.artist}</span>
                  <span style={{ color: "#8a8a94" }}>{day} {fmt(s.start)} · {s.stage} · {s.score}</span>
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
          <li><span style={{ color: TIER_COLOR.discovery, fontWeight: 700 }}>🔮 Discovery</span> — new to you, but a strong match to your taste.</li>
          <li><span style={{ color: TIER_COLOR.wildcard, fontWeight: 700 }}>🎲 Wildcard</span> — no real match for this slot, so we picked the most promising unfamiliar act to keep your day full and maybe surprise you.</li>
          <li><span style={{ color: TIER_COLOR["worth-it"], fontWeight: 700, border: `1.5px dashed ${TIER_COLOR["worth-it"]}`, borderRadius: 4, padding: "0 4px" }}>Dashed colored outline</span> = a favorite you&apos;re <strong>missing</strong> (a conflict beat it). See the ⭐ panel above to lock it back in.</li>
          <li><span style={{ color: "#7a7a84", fontWeight: 700 }}>Dark gray boxes</span> are other sets we didn&apos;t pick.</li>
          <li><strong>Click</strong> a box to lock it (🔒) and re-optimize · <strong>Shift-click</strong> to exclude that artist · colored dots = a friend is going too.</li>
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
              {day.sets
                .filter((s) => s.stage === stage)
                .map((s) => {
                  const top = (mins(s.start) - DAY_START) * PX_PER_MIN;
                  const height = Math.max(18, (mins(s.end) - mins(s.start)) * PX_PER_MIN - 2);
                  const isExcluded = excludeSet.has(norm(s.artist));
                  const isChosen = !isExcluded && dayItin.chosenIds.has(s.id);
                  // A real match (not a wildcard) that got bumped by a conflict.
                  const isMissed = !isExcluded && !isChosen && s.tier !== "wildcard";
                  const isLocked = lockSet.has(s.id);
                  const fos = friendsOnSet(s.id);
                  const color = TIER_COLOR[s.tier];
                  return (
                    <button
                      key={s.id}
                      onClick={(e) => (e.shiftKey ? toggleExclude(s.artist) : toggleLock(s.id))}
                      title={`${s.artist} · ${fmt(s.start)}–${fmt(s.end)} · ${TIER_LABEL[s.tier]} (${s.score}) — ${s.reason}\nClick to lock · Shift-click to exclude`}
                      style={{
                        position: "absolute", top, left: 2, right: 2, height, textAlign: "left", overflow: "hidden",
                        borderRadius: 5, padding: "2px 5px", cursor: "pointer",
                        background: isExcluded ? "#241418" : isChosen ? color : "#1a1a22",
                        color: isExcluded ? "#7a5a5a" : isChosen ? "#06210f" : isMissed ? color : "#7a7a84",
                        border: isLocked
                          ? "2px solid #fff"
                          : isChosen
                            ? `1px solid ${color}`
                            : isMissed
                              ? `1.5px dashed ${color}`
                              : "1px solid #26262f",
                        opacity: isExcluded ? 0.6 : isChosen ? 1 : isMissed ? 0.95 : 0.55,
                        fontSize: "0.72rem", fontWeight: isChosen ? 700 : 500, lineHeight: 1.15,
                        textDecoration: isExcluded ? "line-through" : "none",
                      }}
                    >
                      {isLocked ? "🔒 " : ""}{s.artist}
                      <span style={{ display: "block", fontWeight: 400, fontSize: "0.66rem", opacity: 0.85 }}>{fmt(s.start)} · {s.score}</span>
                      {fos.length > 0 && (
                        <span style={{ position: "absolute", top: 3, right: 3, display: "flex", gap: 2 }}>
                          {fos.map((fi) => (
                            <span key={fi} title={friends[fi].name} style={{ width: 7, height: 7, borderRadius: "50%", background: FRIEND_COLORS[fi % FRIEND_COLORS.length] }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
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

      <a className="btn no-print" href="/dashboard" style={{ background: "#26262f", marginTop: "1.5rem" }}>← Back to your artists</a>
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
