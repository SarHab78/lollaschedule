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
    <main className="hero">
      <h1>LollaSchedule 🎸</h1>
      <p className="subtitle">
        Tell us which artists you&apos;re excited to see and we&apos;ll build your best
        Lollapalooza 2026 schedule, highlighting some new artists you might love but
        haven&apos;t heard yet.
      </p>

      {error ? (
        <div className="error">Something went wrong: {error}. Please try again.</div>
      ) : null}

      {returning ? (
        <>
          <div className="btn-row" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
            <a className="btn" href="/schedule">
              View my schedule →
            </a>
            <a className="btn" href="/pick" style={{ background: "#26262f" }}>
              Edit my picks
            </a>
          </div>
          {accountEmail ? (
            <p className="subtitle" style={{ fontSize: "0.85rem", marginTop: "0.75rem" }}>
              Signed in as {accountEmail}.{" "}
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
          <div className="btn-row" style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
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
            Just tap the artists you want to see.{" "}
            {canSignIn ? (
              <>
                <a href="/account" style={{ color: "#1db954" }}>Sign in with email</a> (no password
                needed) to save your picks across devices. Skip it and your picks are kept on this
                device only.
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
