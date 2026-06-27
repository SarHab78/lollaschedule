# SCALING.md — making LollaSchedule public

Tracking doc for taking the app from a 25-person dev-mode build to something that
can be shared widely ("fully public / could spread"). Check items off as we go.

**Owner key:** 👤 = Sarah (account/dashboard/legal actions) · 🤖 = Claude (code).
**Status:** ☐ not started · ◐ in progress · ☑ done.

---

## The one hard gate
The app is in Spotify **Development Mode** → **only 25 manually-allowlisted Spotify
accounts can ever log in.** Person #26 gets "user not registered." Going past 25
requires a **Spotify Quota Extension Request** (a review, not a toggle). That review
takes days–weeks, so it's the **critical path** — file it first; harden the backend
while it's in the queue. Approval also raises the app-wide rate limit.

---

## Phase 0 — Unblock the long pole (start immediately)
Mostly process; the privacy policy is the thing that lets the quota request be filed.

- [ ] 🤖 ☐ Write **privacy policy** page (`/privacy`) — what data we read (top
      artists/tracks, recent, saved, follows), that we don't sell it, retention,
      contact. Required to file the quota request AND legally.
- [ ] 🤖 ☐ Write **terms of service** page (`/terms`).
- [ ] 👤 ☐ Add **app branding** in Spotify dashboard: name, logo, description of
      exactly what we do with the data.
- [ ] 👤 ☐ File the **Spotify Quota Extension Request** (links privacy policy).
- [ ] 👤 ☐ Set an **Anthropic spending cap** in the console (viral-spike guard).
- [ ] 👤 ☐ Decide **app name + logo** for the submission.

## Phase 1 — Durability (core engineering)
Today caches live in memory per server instance; on Vercel's read-only FS the disk
writes are no-ops → predictions + Spotify fetches re-run on every cold start/instance
(cost + rate-limit risk). Make them durable + per-user.

- [ ] 👤 ◐ Create **Upstash Redis** account (free tier); put
      `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` in `.env.local` + Vercel.
      Code is live with an in-memory fallback until these land.
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
