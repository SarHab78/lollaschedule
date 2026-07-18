import { cookies } from "next/headers";
import { loadManualPicks } from "@/lib/manual";
import { getSessionEmail } from "@/lib/session";
import { mailerEnabled } from "@/lib/mailer";
import SignOutButton from "./SignOutButton";

type Props = { searchParams: Promise<{ error?: string }> };

export default async function Home({ searchParams }: Props) {
  const { error } = await searchParams;

  // Returning manual visitor with saved picks (cookie or account)? Offer a
  // straight shot back to their schedule so they never have to re-select.
  const jar = await cookies();
  const hasSpotify = !!jar.get("spotify_access_token")?.value;
  const [savedPicks, accountEmail] = await Promise.all([loadManualPicks(), getSessionEmail()]);
  const returning = !hasSpotify && savedPicks.length > 0;
  const canSignIn = mailerEnabled() && !!process.env.AUTH_SECRET;

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

      {returning ? (
        <>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <a className="btn" href="/schedule">
              View my schedule ({savedPicks.length} artists) →
            </a>
            <a className="btn" href="/pick" style={{ background: "#26262f" }}>
              Edit my picks
            </a>
          </div>
          {accountEmail ? (
            <p className="subtitle" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
              Signed in as {accountEmail} — your picks follow you on any device.{" "}
              <SignOutButton />
            </p>
          ) : (
            <p className="subtitle" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
              Picks saved on this device.{" "}
              {canSignIn && (
                <>
                  <a href="/account" style={{ color: "#1db954" }}>Sign in with email</a> to keep them across devices.{" "}
                </>
              )}
              Have Spotify? <a href="/login" style={{ color: "#1db954" }}>Connect it</a> for an auto-built schedule.
            </p>
          )}
        </>
      ) : (
        <>
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
            {canSignIn && (
              <>
                {" "}Want your picks on every device?{" "}
                <a href="/account" style={{ color: "#1db954" }}>Sign in with email</a>.
              </>
            )}
          </p>
        </>
      )}
    </main>
  );
}
