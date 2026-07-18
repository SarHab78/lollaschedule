# Session notes — 2026-07-17

**Security hardening pass.** Audited every page/route/flow and fixed the live
issues (all in this commit):
- **Email-bomb / sender-reputation / Gmail-quota DoS** (top issue): `/api/auth/request`
  sends real mail and had only a per-*email* throttle → an attacker could cycle
  addresses to bomb inboxes or burn the ~500/day Gmail cap (DoS on sign-in for
  everyone). Added a per-**IP** cap (8/10min) + CSRF origin check. `lib/security.ts`.
- **CSRF**: all state-changing POSTs (`/api/auth/{request,verify,signout}`,
  `/pick/save`) now reject cross-origin requests (`sameOrigin()`), on top of the
  existing SameSite=Lax cookies.
- **Unbounded KV writes** at `/pick/save`: array count was capped (300) but each
  string wasn't → multi-MB writes possible. Now per-string cap (120 chars) +
  dedup + per-IP save cap (40/10min) so bots can't mint unlimited 1-yr keys.
- **Session token**: now enforces the signed `iat` max-age server-side (a token
  copied out of the cookie jar no longer lives forever), and refuses to
  verify/sign against an empty/short `AUTH_SECRET` (fail closed, not forgeable).
- **Brute-force**: per-IP cap (30/10min) on `/api/auth/verify` on top of the
  per-code 5-attempt limit.
- **Security headers** (`next.config.js`): X-Frame-Options DENY, nosniff,
  Referrer-Policy, Permissions-Policy always; CSP + HSTS in production only (dev
  HMR unaffected).
- Verified live in dev: cross-origin POSTs → 403, same-origin → 200, oversized
  strings truncated+deduped in KV, rate limit trips to 429, all pages render.
- **Known / NOT fixed (low priority):** the hidden Spotify OAuth flow lacks a
  `state` param (login-CSRF) — left as-is since it's unreachable/unused; `npm
  audit` flags a moderate `postcss` advisory that's a build-time transitive dep
  of Next (only affects processing untrusted CSS — we don't). Rate limits
  fail-open on a KV error by design (a Redis blip shouldn't lock out sign-in).

---

**Spotify flow hidden.** The landing (`app/page.tsx`) no longer links to the
Spotify connect flow — dev mode caps it at 25 allowlisted accounts, so no real
user could use it. Entry points are now (1) **manual picks** (anonymous,
per-device cookie) and (2) **optional email account** (picks follow you across
devices; landing notes that skipping email = re-pick on another device). The
Spotify code is KEPT, not deleted (`/login`, `/callback`, `/dashboard`,
`lib/spotify.ts`, and `/schedule`'s Spotify branch all still exist) — just
unlinked so it's unreachable from the UI. Easy to un-hide later if quota opens.

---

Email accounts are now **LIVE locally**. Created the dedicated sender
`lollaschedule@gmail.com`, enabled 2FA + generated a Gmail app password, filled
`GMAIL_USER`/`GMAIL_APP_PASSWORD` in `.env.local` (`AUTH_SECRET` was already set).
Verified SMTP auth, sent a test email (landed in inbox, NOT spam), and ran the
full `/account` → email → 6-digit code → session → `/pick`/`/schedule` loop
end-to-end in the browser — works. Typecheck clean. Committed (`28bffca`) +
pushed to `main`.
- **Vercel prod now LIVE:** installed + linked the Vercel CLI (scope
  `sarahs-projects-6a29c197`), added `AUTH_SECRET`, `GMAIL_USER`,
  `GMAIL_APP_PASSWORD` to Production + redeployed. Confirmed prod
  `/api/auth/request` sends a real code (accounts work cross-device in prod).
- **Caught a prod gap:** `ANTHROPIC_API_KEY` was **never set in Production** —
  the AI discovery predictor had been silently degrading to picks-only in prod
  this whole time (`predict.ts` is graceful without the key). Pushed the key +
  redeployed, so AI discovery now actually runs live. (Earlier notes claiming
  "AI predictions verified live" were local-only.)

---

# Session notes — 2026-07-15

Quick handoff for the next session. See CLAUDE.md (architecture) and SCALING.md
(distribution plan) for the longer picture. Older notes are below this section.

## What we did this session

### Manual picks now persist (durable, per device)
- `/pick/save` TTL 24h → **1 year**, and it **reuses the existing `manual_id`**
  cookie instead of minting a new id each save (stable identity).
- `/pick` **re-hydrates** on return: pre-checks saved lineup picks in the grid,
  pre-fills off-lineup free-text, shows a "Welcome back" note.
- Landing page: returning manual visitor gets a **"View my schedule (N artists) →"**
  shortcut so they skip re-picking.
- Confirmed with Sarah: Upstash vars ARE in Vercel now, so prod KV is durable
  (SESSION-NOTES/SCALING earlier said this was a TODO — it's done). Updated
  SCALING.md accordingly.

### Optional email accounts — 6-digit code (BUILT, typechecks clean, DORMANT)
Cross-device persistence beyond the per-device cookie. **Custom lightweight OTP,
no Auth.js, no DB** — reuses Upstash + an HMAC-signed cookie. Decisions locked
with Sarah: email 6-digit **code** (Partiful-style, not a magic link); **Gmail
SMTP now, transport-agnostic** so we can swap to Resend/SES if it goes viral;
accounts **optional** (Spotify / cookie / email all coexist).
- New files: `lib/session.ts` (signed cookie holding email), `lib/mailer.ts`
  (Gmail SMTP, swappable), `lib/otp.ts` (code gen/hash/verify: 10-min TTL, max 5
  wrong tries, send throttle), `lib/manual.ts` (identity → KV key + **lazy
  migration** of cookie picks into the account on first sign-in).
- Routes: `app/api/auth/{request,verify,signout}/route.ts`.
- UI: `app/account/{page,AccountClient}.tsx` (email → code, 2-step),
  `app/SignOutButton.tsx`. Wired into `/pick`, `/schedule`, landing.
- Keys: signed-in → `manual:user:<email>`; anonymous → `manual:<uuid>` cookie.
- New dep: `nodemailer` (+ `@types/nodemailer`). No Auth.js installed.

### ⚠️ TO TURN ACCOUNTS ON (Sarah — required before it does anything)
Right now `GMAIL_USER`/`GMAIL_APP_PASSWORD` are **blank**, so `mailerEnabled()`
is false → the sign-in UI is hidden and cookie-only persistence works. To enable:
1. Pick/create a sender Gmail (recommend a dedicated `lollaschedule@gmail.com`).
2. Turn on **2-Step Verification**, then generate an **app password** at
   myaccount.google.com/apppasswords (16 chars, NOT the login password).
3. Fill the two blank lines in `.env.local` (`AUTH_SECRET` already generated there):
   `GMAIL_USER=…@gmail.com` and `GMAIL_APP_PASSWORD=<16-char>`.
4. Add all three (`AUTH_SECRET`, `GMAIL_USER`, `GMAIL_APP_PASSWORD`) to **Vercel**
   env + redeploy.
5. Restart dev server, go to `/account`, run the full email→code→schedule loop.

### Notes / gotchas for accounts
- Gmail free cap ≈ **500 emails/day** (= 500 sign-ins/day). Fine for friends. To
  scale past it: add a Resend/SES branch in `lib/mailer.ts` keyed on a new env
  var + a verified domain — nothing else changes (built for this).
- Brand-new Gmail sender has zero reputation → first codes may hit spam; at
  friends-scale (known contacts) it self-corrects.
- All new code **degrades gracefully** with creds unset — safe to commit/deploy
  before Gmail is set up.

### Uncommitted
- Everything above is **written + typechecks clean but NOT committed**. Sarah
  wanted to exit here. Next session: (optionally) test locally after adding Gmail
  creds, then commit + push. Suggested commit split is fine as one commit:
  "Persist manual picks (1yr) + optional email 6-digit-code accounts".

---

# Session notes — 2026-06-30

Quick handoff for the next session. See CLAUDE.md (architecture) and SCALING.md
(distribution plan) for the longer picture.

## What we did this session

### AI discovery predictor — tuned
- Switched the model **Sonnet 4.6 → Opus 4.8** (`lib/predict.ts`). Sonnet capped
  scores at ~78 and gave lazy reasons; Opus uses the full 0–100 range.
- Rewrote the prompt for decisive calibration (`PROMPT_VERSION = "v2"`; the cache
  key includes it, so prompt changes auto-invalidate).
- **JADE/HORSEGIIRL takeaway:** low fits there are *honest AI similarity
  judgments*, not bugs. HORSEGIIRL specifically is a **Spotify-detected fave** —
  in manual mode she wasn't tapped, so she dropped to a mid-fit discovery. Don't
  chase individual scores up; it wrecks calibration. Users can lock anything in.

### UI / scoring (committed)
- Default listening window is now **All time** (`long_term`).
- **Missing-picks** panel + dashed outline now also surface **strong discoveries
  (fit ≥ HIGH_FIT = 70)** knocked out by a conflict, not just direct faves.
- Timeline now lays **same-stage overlapping sets side-by-side** (`layoutLanes`).
  Note: AMBLE + LOS RETROS is a real **data conflict** (both at Airbnb 5:15–6pm
  Sunday in build-lineup.mjs) — one is mis-stamped; the side-by-side render is
  the workaround, not a data fix.

### Durable caching — DONE + verified live
- **Upstash Redis** (`lib/kv.ts`, graceful in-memory fallback). Taste profile
  (24h TTL, keyed by stable Spotify user id) + AI predictions (30d) now in KV.
  Verified keys persist. Env vars added to `.env.local` AND Vercel (redeployed).
- Solves the app-wide Spotify rate-limit + per-cold-start AI cost.

### BIG strategic finding: Spotify can't scale past 25 users
Researched + spike-tested (all in SCALING.md). Every path is dead for an
individual dev: quota extension needs an org + **250k MAU**; Wrapped playlist
**404s**; Liked Songs has **no shareable link**; public-playlist tracks **403**
via Client Credentials; embed scraping **works but violates ToS** (declined —
`SPOTIFY_CLIENT_SECRET` is in `.env.local` from the spike, now unused).
→ **Pivot:** reach people via non-Spotify-API sources.

### Manual entry flow — BUILT + verified, NOT committed yet
- `/pick` (tap lineup artists from a photo grid + optional off-lineup free-text)
  → `/pick/save` (stashes picks in KV under a `manual_id` cookie) → `/schedule`
  reads it, `buildManualProfile()` makes picks must-see, AI fills the rest.
  Source-agnostic; landing has a "Pick your artists (no login)" CTA.
- Verified end-to-end (pick → KV → manual profile → AI fits → schedule renders).
- ⚠️ **Uncommitted** — Sarah was testing it in the browser when we paused.

### Manual vs Spotify comparison (data experiments)
- **Discovery quality ≈ identical:** AI fits differ only ~7.4 pts avg between
  full-Spotify favorites and 19 manual taps; 77% within 10 pts.
- **Coverage is the gap:** Spotify auto-detected 36 lineup faves; 19 taps missed
  22 of them. Manual's weakness is forgetting to tap known faves.
- **Sweet-spot experiment (Monte Carlo + real optimizer):** recovery of the full
  Spotify schedule is ~**linear** in picks — NO diminishing-returns sweet spot.
  ~**44% comes free from the AI at zero taps**; need ~30 taps for ~86%. Product
  nudge should be "tap everyone you recognize," not "pick ~15."

## Open / next
- [ ] **Commit the manual flow** once Sarah signs off on the browser test.
- [ ] Add the `/pick` nudge: live count + "more is better / AI already nails ~44%".
- [ ] Build **Last.fm** path (`user.getTopArtists/...`, API key only, uncapped) —
      best for existing scrobblers. Source-agnostic pipeline already supports it.
- [ ] (later) Spotify data-export upload for power users.
- [ ] Spotify ToS gaps still open (see the earlier audit): **token refresh** not
      implemented; **no "Powered by Spotify" attribution**; persistent caching vs
      "immediate use" — less urgent now that public Spotify is off the table.

## Dev server
Runs on `127.0.0.1:3000` (`npm run dev`). It accumulates HMR drift over long
sessions — if the UI renders weird (overlapping boxes/images), kill it,
`rm -rf .next`, restart, hard-refresh. Don't run `npm run build` while it's up
(corrupts the shared `.next`).
