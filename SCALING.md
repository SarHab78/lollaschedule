# SCALING.md — making LollaSchedule public

Tracking doc for taking the app from a 25-person dev-mode build to something that
can be shared widely ("fully public / could spread"). Check items off as we go.

**Owner key:** 👤 = Sarah (account/dashboard/legal actions) · 🤖 = Claude (code).
**Status:** ☐ not started · ◐ in progress · ☑ done.

---

## The hard reality: Spotify cannot scale past 25 users (researched 2026-06-30)
The app is in Spotify **Development Mode** → **only 25 manually-allowlisted Spotify
accounts can ever log in.** Going public is **NOT achievable** for this project:

- **Quota Extension is dead for individuals.** As of **May 15, 2025** Spotify only
  accepts extended-quota applications from **organizations**, and requires a
  registered business + a **launched service with ≥250k monthly active users**.
  Catch-22 (can't get 250k while capped at 25). An LLC wouldn't clear the MAU bar.
- **Every uncapped Spotify shortcut is also blocked** (verified via spikes):
  - Wrapped "Your Top Songs" playlist → **404** (Spotify-owned; Nov-2024 lockdown).
  - Liked Songs → **no shareable link exists** at all.
  - Any public user playlist via Client Credentials → metadata reads but **tracks
    403 Forbidden** (confirmed on 2 playlists — blanket dev-mode restriction).
  - Nov-2024 also killed Related Artists, Recommendations, Audio Features, genres.

**Conclusion:** Spotify login stays a perk for the ≤25 allowlisted accounts. To
reach anyone else we must get taste data WITHOUT the Spotify Web API (Phase 0 ↓).
`SPOTIFY_CLIENT_SECRET` is in `.env.local` from the spike but is now unused.

---

## Phase 0 — Reach beyond 25 without the Spotify API  ✅ DONE
**Decision (2026-07-01): the reach strategy is just two paths —**
1. **Spotify login** — the ≤25 allowlisted accounts get the premium auto experience.
2. **Manual entry (`/pick`)** — everyone else. Tap lineup artists from a photo grid
   (+ optional off-lineup free-text). Uncapped, no login, ~1 min. The AI predictor
   makes it strong (its discovery fits ≈ Spotify's; ~44% of the schedule comes free
   from AI at zero taps). Copy nudges tapping generously.

- [x] 🤖 ☑ **Manual artist entry** — shipped (`/pick`, `buildManualProfile`).
- [x] 🤖 ☑ Source-agnostic taste (Spotify or manual → same affinity map → same
      scoring/AI/optimizer).

**Dropped — too much friction for users (decided 2026-07-01):**
- ~~Last.fm username~~ — requires having/creating a scrobbling account; new accounts
  are empty (forward-only). Not worth the conversion hit.
- ~~Spotify data-export upload~~ — multi-day wait + file upload. Dead on arrival.

## Deferred (was Phase 0 — now moot)
Privacy/terms pages + Spotify quota request + app branding were for the quota
extension, which is unreachable. Keep a light privacy note for the Last.fm/manual
flows, but the formal Spotify submission is off the table.

## Optional accounts — email 6-digit code (built 2026-07-07)
Cross-device persistence without the per-device cookie limit. **No Auth.js, no
DB** — a lightweight custom OTP over the existing Upstash + a signed cookie.
- Flow: `/account` → enter email → `POST /api/auth/request` (6-digit code, HMAC'd
  in KV `otp:<email>`, 10-min TTL, send-throttled) → email via Gmail SMTP →
  `POST /api/auth/verify` sets an HMAC-signed `session` cookie holding the email.
- Picks key by identity: signed-in → `manual:user:<email>` (any device);
  anonymous → `manual:<uuid>` cookie (per-device). `lib/manual.ts` resolves the
  key and **lazily migrates** cookie picks into the account on first signed-in use.
- Transport-agnostic: `lib/mailer.ts` uses Gmail now; add a Resend/SES branch
  (keyed on its own env var) to blow past Gmail's ~500/day cap — nothing else changes.
- Degrades gracefully: with `GMAIL_USER`/`GMAIL_APP_PASSWORD` unset, `mailerEnabled()`
  is false → sign-in UI hidden, cookie-only persistence still works.
- **Env (👤):** `AUTH_SECRET` (generated into `.env.local`), `GMAIL_USER`,
  `GMAIL_APP_PASSWORD` (Google *app password*, needs 2FA on the account). Add all
  three to Vercel too. Recommend a dedicated `lollaschedule@gmail.com` sender.
- Files: `lib/{session,mailer,otp,manual}.ts`, `app/api/auth/{request,verify,signout}`,
  `app/account/*`, `app/SignOutButton.tsx`; wired into `/pick`, `/schedule`, landing.

## Phase 1 — Durability (core engineering)
Today caches live in memory per server instance; on Vercel's read-only FS the disk
writes are no-ops → predictions + Spotify fetches re-run on every cold start/instance
(cost + rate-limit risk). Make them durable + per-user.

- [x] 👤 ☑ Create **Upstash Redis** account + add `UPSTASH_REDIS_REST_URL` +
      `UPSTASH_REDIS_REST_TOKEN` to `.env.local` **and to Vercel** (Production).
      **VERIFIED live** (taste + predict keys persisting with correct TTLs). Prod
      now uses Redis, so durable caches + saved manual picks survive cold starts.
- [x] 🤖 ☑ **predict cache** → KV (`predict:<favorites-hash>`, 30d TTL). lib/kv.ts.
- [x] 🤖 ☑ **taste-profile cache** → KV, keyed by stable Spotify user ID + window,
      24h TTL (Maps/Sets serialized for JSON).
- [x] 🤖 ☑ `getMe()` for the **Spotify user ID** cache key; page.tsx fetches it.
- [ ] 🤖 ☐ **Token refresh** — use the stored refresh token so users aren't bounced
      after ~1 hour (we set `spotify_refresh_token` but never use it).

## Phase 2 — Resilience (before it actually spreads)
- [ ] 🤖 ☐ **Spotify app-wide rate limit** is the scariest viral risk: each signup
      pulls up to ~100 requests (5000 liked songs + windows + follows), and the
      limit is shared across ALL users. Mitigate: lower saved-songs depth
      (5000 → ~1000 cuts requests 5×), rely on durable per-user cache, throttle/
      queue the heavy fetch.
- [ ] 🤖 ☐ **Friendly error/empty states** — today's Anthropic outage surfaced a raw
      error; public app needs graceful "try again" UI for Spotify/Anthropic down.
- [ ] 🤖 ☐ **Observability** — Sentry (or structured logging) to see failures for
      users we can't watch.
- [ ] 🤖 ☐ **Abuse protection** — basic per-IP rate limiting on auth/predict routes.

## Phase 3 — Polish (nice-to-have for sharing)
- [ ] 🤖 ☐ **Compact share links** (long-standing TODO): replace `?sets=set-26,…`
      with a short code + lookup or base62 payload.
- [ ] 🤖 ☐ Optional **saved schedules** (would need a DB, e.g. Postgres/Neon).
- [ ] 🤖 ☐ Mobile timeline layout pass.

---

## Cost notes
- **Claude:** ~$0.05 per new user (one cached prediction run). 200 users ≈ $10,
  1000 ≈ $50. Durable cache keeps it one-run-per-user. Set the spending cap.
- **Spotify:** free, but the app-wide rate limit is the real constraint at scale.
- **Vercel:** Hobby may suffice early; Pro ($20/mo) for higher limits + 60s
  functions + KV. **Upstash** free tier is generous.
- **Anthropic key:** one key for now, billed to Sarah — fine at friends scale.

## Decisions / open questions
- Target scale: **fully public / could spread** (chosen 2026-06-23).
- Saved-songs depth at scale: keep 5000 (best personalization) vs drop to ~1000
  (5× fewer Spotify requests)? Leaning ~1000 once durable cache lands. — TBD
- Model: `claude-sonnet-4-6` (chosen for knowledge/speed/cost). — settled
- Store any user data server-side beyond ephemeral cache? Currently NO (only
  cookies + caches). Keep minimal for privacy. — keep minimal

## Current status (2026-06-23)
AI discovery predictor built + committed (graceful without key). Verification of
recommendation quality is pending an active **Anthropic API outage** (background
poll running). None of the scaling work below has started yet — this doc is the plan.
