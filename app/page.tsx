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

      {error && (
        <div className="error">
          Login error: {error}. If this says &quot;user not registered,&quot; add your Spotify
          account under your app&apos;s Settings → User Management in the developer dashboard.
        </div>
      )}

      <a className="btn" href="/login">
        Connect Spotify
      </a>
    </main>
  );
}
