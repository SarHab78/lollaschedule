import { loadManualPicks } from "@/lib/manual";
import { getSessionEmail } from "@/lib/session";
import { mailerEnabled } from "@/lib/mailer";
import SignOutButton from "./SignOutButton";

type Props = { searchParams: Promise<{ error?: string }> };

// NOTE: the Spotify connect flow (/login → /callback → /dashboard, lib/spotify.ts)
// is intentionally HIDDEN — it's dev-mode-capped at 25 allowlisted accounts, so
// no real user can use it. The code is kept (not deleted) but unlinked from the
// UI. The only entry points now are manual picks (anonymous, per-device) and the
// optional email account (picks that follow you across devices).
export default async function Home({ searchParams }: Props) {
  const { error } = await searchParams;

  // Returning visitor with saved picks (cookie or account)? Offer a straight
  // shot back to their schedule so they never have to re-select.
  const [savedPicks, accountEmail] = await Promise.all([loadManualPicks(), getSessionEmail()]);
  const returning = savedPicks.length > 0;
  const canSignIn = mailerEnabled() && !!process.env.AUTH_SECRET;

  return (
    <main>
      <h1>LollaSchedule 🎸</h1>
      <p className="subtitle">
        Tell us which artists you love and we&apos;ll build your optimal Lollapalooza 2026
        schedule (Grant Park · July 30 – Aug 2) — resolving stage conflicts and surfacing
        artists you&apos;d love but haven&apos;t found yet.
      </p>

      {error ? (
        <div className="error">Something went wrong: {error}. Please try again.</div>
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
              Picks saved on this device only.{" "}
              {canSignIn && (
                <>
                  <a href="/account" style={{ color: "#1db954" }}>Sign in with email</a> to keep
                  them on any device.
                </>
              )}
            </p>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <a className="btn" href="/pick">
              Pick your artists →
            </a>
            {canSignIn && (
              <a className="btn" href="/account" style={{ background: "#26262f" }}>
                Sign in with email
              </a>
            )}
          </div>
          <p className="subtitle" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
            Just tap the lineup artists you love — takes under a minute.{" "}
            {canSignIn ? (
              <>
                <a href="/account" style={{ color: "#1db954" }}>Sign in with email</a> to save your
                picks across devices. Skip it and your picks are kept on this device only — you&apos;d
                need to re-pick on another phone or computer.
              </>
            ) : (
              <>Your picks are saved on this device.</>
            )}
          </p>
        </>
      )}
    </main>
  );
}
