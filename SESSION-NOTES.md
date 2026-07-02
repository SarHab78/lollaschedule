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
