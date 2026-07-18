import crypto from "crypto";
import { kvGet, kvSet, kvDel, kvIncr } from "./kv";
import { sendEmail } from "./mailer";

// Email 6-digit one-time codes. The code is never stored in plaintext — we keep
// an HMAC of it in KV with a short TTL, plus an attempts counter to stop
// brute-forcing. Per-email send throttle caps abuse of the send button.

const CODE_TTL = 60 * 10; // 10 minutes to enter the code
const MAX_ATTEMPTS = 5; // wrong guesses before the code is burned
const SEND_WINDOW = 60 * 15; // rate-limit window for requesting codes
const MAX_SENDS = 5; // codes per email per window

type OtpRecord = { hash: string; attempts: number };

const secret = () => process.env.AUTH_SECRET || "";
const otpKey = (email: string) => `otp:${email}`;
const sendKey = (email: string) => `otpsend:${email}`;

// Basic normalization + shape check. Not full RFC validation — just enough to
// reject obvious junk and canonicalize for keying.
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function hashCode(email: string, code: string): string {
  return crypto.createHmac("sha256", secret()).update(`${email}:${code}`).digest("base64url");
}

export type RequestResult = { ok: true } | { ok: false; error: "rate_limited" | "send_failed" };

// Generate + email a fresh code. Rate-limited per email.
export async function requestCode(email: string): Promise<RequestResult> {
  const sends = await kvIncr(sendKey(email), SEND_WINDOW);
  if (sends > MAX_SENDS) return { ok: false, error: "rate_limited" };

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await kvSet(otpKey(email), { hash: hashCode(email, code), attempts: 0 } satisfies OtpRecord, CODE_TTL);

  try {
    await sendEmail({
      to: email,
      subject: `Your LollaSchedule code: ${code}`,
      text: `Your LollaSchedule sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can ignore this email.`,
      html: `<div style="font-family:system-ui,sans-serif;max-width:420px;margin:0 auto">
        <h2 style="margin:0 0 4px">LollaSchedule 🎸</h2>
        <p style="color:#555;margin:0 0 20px">Enter this code to sign in:</p>
        <div style="font-size:34px;font-weight:700;letter-spacing:8px;background:#f4f4f6;padding:16px 0;text-align:center;border-radius:10px">${code}</div>
        <p style="color:#888;font-size:13px;margin:16px 0 0">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
      </div>`,
    });
  } catch (e) {
    console.log("[otp] send failed:", e instanceof Error ? e.message : e);
    return { ok: false, error: "send_failed" };
  }
  return { ok: true };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: "expired" | "too_many_attempts" | "bad_code" };

// Check a submitted code. Burns the code on success or after too many misses.
export async function verifyCode(email: string, submitted: string): Promise<VerifyResult> {
  const code = String(submitted).trim();
  const rec = await kvGet<OtpRecord>(otpKey(email));
  if (!rec) return { ok: false, error: "expired" };

  if (rec.attempts >= MAX_ATTEMPTS) {
    await kvDel(otpKey(email));
    return { ok: false, error: "too_many_attempts" };
  }

  const expected = Buffer.from(rec.hash);
  const got = Buffer.from(hashCode(email, code));
  const match = expected.length === got.length && crypto.timingSafeEqual(expected, got);

  if (!match) {
    // Persist the incremented attempt (preserve the code's remaining TTL best-effort).
    await kvSet(otpKey(email), { hash: rec.hash, attempts: rec.attempts + 1 } satisfies OtpRecord, CODE_TTL);
    return { ok: false, error: "bad_code" };
  }

  await kvDel(otpKey(email));
  await kvDel(sendKey(email)); // clear the throttle on success
  return { ok: true };
}
