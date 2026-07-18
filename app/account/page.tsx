import { getSessionEmail } from "@/lib/session";
import { mailerEnabled } from "@/lib/mailer";
import { loadManualPicks } from "@/lib/manual";
import SignOutButton from "../SignOutButton";
import AccountClient from "./AccountClient";

export const dynamic = "force-dynamic";

export default async function Account() {
  const email = await getSessionEmail();

  // Already signed in → show status instead of the form.
  if (email) {
    const picks = await loadManualPicks();
    return (
      <main style={{ maxWidth: 440 }}>
        <h1>Your account 🎟️</h1>
        <p className="subtitle">
          Signed in as <strong>{email}</strong>. Your picks
          {picks.length ? ` (${picks.length} artists)` : ""} are saved to your account and
          follow you on any device.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <a className="btn" href="/schedule">View my schedule →</a>
          <a className="btn" href="/pick" style={{ background: "#26262f" }}>Edit my picks</a>
          <SignOutButton />
        </div>
      </main>
    );
  }

  if (!mailerEnabled() || !process.env.AUTH_SECRET) {
    return (
      <main style={{ maxWidth: 440 }}>
        <h1>Save your picks 🎟️</h1>
        <p className="subtitle">Email sign-in isn&apos;t configured yet. Your picks are still saved on this device.</p>
        <a className="btn" href="/pick">Back to picking</a>
      </main>
    );
  }

  return <AccountClient />;
}
