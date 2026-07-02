type Props = { searchParams: Promise<{ error?: string }> };

export default async function Home({ searchParams }: Props) {
  const { error } = await searchParams;

  return (
    <main>
      <h1>LollaSchedule 🎸</h1>
      <p className="subtitle">
        Connect your Spotify and we&apos;ll build your optimal Lollapalooza 2026 schedule
        (Grant Park · July 30 – Aug 2) from what you actually listen to — resolving stage
        conflicts and surfacing artists you&apos;d love but haven&apos;t found yet.
      </p>

      {error === "spotify_busy" ? (
        <div className="error">
          Spotify is temporarily rate-limiting us (too many requests in a short window).
          Wait a minute, then hit Connect again — your data&apos;s fine, it just needs a breather.
        </div>
      ) : error === "spotify_failed" ? (
        <div className="error">
          Couldn&apos;t reach Spotify just now. Wait a moment and try connecting again.
        </div>
      ) : error ? (
        <div className="error">
          Login error: {error}. If this says &quot;user not registered,&quot; add your Spotify
          account under your app&apos;s Settings → User Management in the developer dashboard.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <a className="btn" href="/login">
          Connect Spotify
        </a>
        <a className="btn" href="/pick" style={{ background: "#26262f" }}>
          Pick your artists (no login)
        </a>
      </div>
      <p className="subtitle" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
        No Spotify? Just tap the lineup artists you love — takes under a minute.
      </p>
    </main>
  );
}
