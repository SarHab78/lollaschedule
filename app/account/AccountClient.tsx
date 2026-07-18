"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#0f0f14", border: "1px solid #26262f",
  borderRadius: 10, padding: "0.7rem 0.9rem", color: "#f5f5f7", fontSize: "1rem",
};

export default function AccountClient({ next = "/schedule" }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error === "rate_limited" ? "Too many codes requested — wait a few minutes."
          : data.error === "bad_email" ? "That doesn't look like a valid email."
          : data.error === "auth_not_configured" ? "Sign-in isn't set up yet."
          : "Couldn't send the code — try again.",
        );
      } else {
        setStep("code");
        setNote(`We emailed a 6-digit code to ${email}. It expires in 10 minutes.`);
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || code.trim().length < 6) return;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          data.error === "bad_code" ? "Wrong code — check and try again."
          : data.error === "expired" ? "That code expired. Send a new one."
          : data.error === "too_many_attempts" ? "Too many tries. Send a new code."
          : "Couldn't verify — try again.",
        );
      } else {
        router.push(next);
        router.refresh();
      }
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 440 }}>
      <h1>Save your picks 🎟️</h1>
      <p className="subtitle">
        Sign in with just your email so your schedule follows you across devices — no
        password, no account to manage. We&apos;ll email you a 6-digit code.
      </p>

      {step === "email" ? (
        <form onSubmit={sendCode} style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <input
            type="email" inputMode="email" autoComplete="email" autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com" style={inputStyle}
          />
          <button className="btn" type="submit" disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Email me a code"}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <input
            inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
            style={{ ...inputStyle, fontSize: "1.5rem", letterSpacing: "0.4rem", textAlign: "center" }}
          />
          <button className="btn" type="submit" disabled={busy || code.length < 6}>
            {busy ? "Verifying…" : "Sign in"}
          </button>
          <button
            type="button" onClick={sendCode} disabled={busy}
            style={{ background: "none", border: "none", color: "#8a8a94", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline" }}
          >
            Resend code
          </button>
        </form>
      )}

      {note && <p style={{ color: "#1db954", fontSize: "0.9rem", marginTop: "0.9rem" }}>{note}</p>}
      {error && <p style={{ color: "#ff6b6b", fontSize: "0.9rem", marginTop: "0.9rem" }}>{error}</p>}

      <p style={{ color: "#6a6a74", fontSize: "0.75rem", marginTop: "1.4rem" }}>
        We store only your email and your artist picks — used just to sync your schedule
        across devices. No passwords, no sharing, no marketing. Sign out anytime.
      </p>
    </main>
  );
}
