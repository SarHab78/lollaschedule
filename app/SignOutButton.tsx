"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Small client button that clears the session cookie then refreshes.
export default function SignOutButton({ label = "Sign out" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        await fetch("/api/auth/signout", { method: "POST" });
        router.refresh();
      }}
      disabled={busy}
      style={{ background: "none", border: "none", color: "#8a8a94", cursor: "pointer", fontSize: "0.9rem", textDecoration: "underline" }}
    >
      {busy ? "Signing out…" : label}
    </button>
  );
}
