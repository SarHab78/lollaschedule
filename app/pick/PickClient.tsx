"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type PickArtist = { name: string; image: string | null };

export default function PickClient({ artists }: { artists: PickArtist[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [others, setOthers] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return artists;
    return artists.filter((a) => a.name.toLowerCase().includes(q));
  }, [artists, query]);

  // Off-lineup favorites typed free-form sharpen the AI's discovery picks.
  const extraNames = useMemo(
    () => others.split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    [others],
  );
  const total = selected.size + extraNames.length;

  const build = async () => {
    if (total === 0 || submitting) return;
    setSubmitting(true);
    const names = [...selected, ...extraNames];
    try {
      const res = await fetch("/pick/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.push("/schedule");
    } catch {
      setSubmitting(false);
      alert("Couldn't save your picks — try again.");
    }
  };

  return (
    <main style={{ maxWidth: 1000, paddingBottom: 96 }}>
      <h1>Pick your artists 🎸</h1>
      <p className="subtitle">
        Tap <strong>every</strong> artist you recognize and like — the more you pick, the better
        your schedule matches your real taste, so don&apos;t hold back. We&apos;ll build your Lolla
        2026 schedule and surface others on the lineup you&apos;d dig. No login, about a minute.
      </p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the lineup…"
        style={{
          width: "100%", maxWidth: 360, background: "#0f0f14", border: "1px solid #26262f",
          borderRadius: 10, padding: "0.6rem 0.9rem", color: "#f5f5f7", fontSize: "0.95rem",
          marginBottom: "1rem",
        }}
      />

      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          gap: 10, marginBottom: "1.5rem",
        }}
      >
        {filtered.map((a) => {
          const on = selected.has(a.name);
          return (
            <button
              key={a.name}
              onClick={() => toggle(a.name)}
              style={{
                position: "relative", textAlign: "center", cursor: "pointer", padding: "0.5rem",
                borderRadius: 12, background: on ? "#13351f" : "#1a1a22",
                border: on ? "2px solid #1db954" : "1px solid #26262f",
              }}
            >
              <div
                style={{
                  width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden",
                  background: "#26262f", marginBottom: 6,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                {a.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                  <span style={{ color: "#8a8a94", fontWeight: 700, fontSize: "1.4rem", letterSpacing: 1 }}>
                    {a.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, color: on ? "#1db954" : "#d8d8de", lineHeight: 1.15 }}>
                {on ? "✓ " : ""}{a.name}
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p style={{ color: "#8a8a94", gridColumn: "1 / -1" }}>No lineup artists match “{query}”.</p>
        )}
      </div>

      <details style={{ background: "#1a1a22", border: "1px solid #26262f", borderRadius: 10, padding: "0.85rem 1.1rem", marginBottom: "1rem" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          + Add favorites who aren&apos;t playing (optional — sharpens discovery)
        </summary>
        <textarea
          value={others}
          onChange={(e) => setOthers(e.target.value)}
          placeholder="Taylor Swift, Phoebe Bridgers, Frank Ocean…"
          rows={3}
          style={{
            width: "100%", marginTop: "0.7rem", background: "#0f0f14", border: "1px solid #26262f",
            borderRadius: 10, padding: "0.6rem 0.9rem", color: "#f5f5f7", fontSize: "0.9rem", resize: "vertical",
          }}
        />
        <p style={{ fontSize: "0.78rem", color: "#6a6a74", margin: "0.4rem 0 0" }}>
          Comma or line separated. These don&apos;t get scheduled — they just help the AI guess what else you&apos;d like.
        </p>
      </details>

      {/* Sticky build bar */}
      <div
        style={{
          position: "fixed", left: 0, right: 0, bottom: 0, padding: "0.9rem 1rem",
          background: "rgba(10,10,14,0.92)", borderTop: "1px solid #26262f", backdropFilter: "blur(6px)",
          display: "flex", justifyContent: "center", gap: "1rem", alignItems: "center", flexWrap: "wrap",
        }}
      >
        <span style={{ color: total >= 20 ? "#1db954" : "#8a8a94", fontSize: "0.85rem", fontWeight: 600 }}>
          {total === 0
            ? "Tap the artists you love"
            : total < 20
              ? `${total} tapped — keep going, add everyone you recognize`
              : `${total} tapped — nice, that's a rich picture 🎯`}
        </span>
        <button className="btn" onClick={build} disabled={total === 0 || submitting} style={{ opacity: total === 0 ? 0.5 : 1 }}>
          {submitting ? "Building…" : `Build my schedule${total ? ` (${total})` : ""}`}
        </button>
      </div>
    </main>
  );
}
