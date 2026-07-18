import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTopArtists } from "@/lib/spotify";

export default async function Dashboard() {
  const token = (await cookies()).get("spotify_access_token")?.value;
  if (!token) redirect("/?error=not_logged_in");

  let artists;
  try {
    artists = await getTopArtists(token, "medium_term");
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_failed";
    redirect(`/?error=${encodeURIComponent(msg)}`);
  }

  return (
    <main>
      <div className="hero">
        <h1>Your top artists</h1>
        <p className="subtitle">
          This is the raw signal we score the Lolla 2026 lineup against. Ready to see your
          optimized day-by-day schedule?
        </p>
        <a className="btn" href="/schedule">
          Build my schedule →
        </a>
      </div>

      <div className="grid">
        {artists.map((a, i) => (
          <div className="card" key={a.id}>
            {a.images?.[0]?.url && <img src={a.images[0].url} alt={a.name} />}
            <div className="rank">#{i + 1}</div>
            <div className="name">{a.name}</div>
            <div className="genres">{(a.genres ?? []).slice(0, 2).join(" · ")}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
