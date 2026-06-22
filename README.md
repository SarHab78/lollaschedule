# LollaSchedule 🎸

Build your perfect **Lollapalooza Chicago 2026** schedule from your actual listening history.

LollaSchedule is a web app that connects to your **Spotify** (and/or **Apple Music**) account, analyzes what you actually listen to, cross-references it against the Lollapalooza 2026 lineup, and generates the most optimal day-by-day set schedule — maximizing time with the artists you love while resolving stage conflicts and minimizing walking between stages.

> **Event:** Lollapalooza 2026 · Grant Park, Chicago, IL · **Thursday July 30 – Sunday August 2, 2026** · 8 stages · 170+ artists
>
> **Headliners by day:** Thu 7/30 — Lorde, John Summit · Fri 7/31 — Charli XCX, The Smashing Pumpkins · Sat 8/1 — Olivia Dean, JENNIE · Sun 8/2 — Tate McRae, The xx

---

## ✨ What it does

- **Connect your music** — OAuth into Spotify and/or Apple Music.
- **Analyze your taste** — pull top artists, top tracks, recently played, saved library, and audio features to score how much you'd enjoy each act.
- **Match the lineup** — map your listening profile onto the official Lolla 2026 lineup, including artists you don't follow yet but would probably love ("discovery" picks).
- **Resolve conflicts** — when two artists you love play at the same time, decide based on your affinity score, set length, and how many of their tracks you actually play.
- **Optimize the walk** — Grant Park is big. Factor in stage-to-stage travel time so your day isn't a sprint across the park.
- **Export it** — download an ICS calendar, share a link, or get a printable single-page schedule per day.

---

## 🧠 How the scheduling works

1. **Affinity scoring** — each lineup artist gets a score from your listening data:
   - direct play counts / top-artist rank
   - genre + audio-feature similarity to your most-played music
   - recency weighting (what you've had on repeat lately)
2. **Conflict graph** — set times are loaded as time intervals per stage. Overlapping sets you care about form conflicts.
3. **Optimization** — a weighted interval-scheduling pass (with travel-time penalties between stages) selects the set of performances that maximizes total affinity, day by day.
4. **Output** — an ordered, conflict-free itinerary with "must-see," "if you have time," and "discovery" tiers.

---

## 🏗️ Planned architecture

```
┌─────────────┐     OAuth      ┌──────────────────┐
│   Browser   │ ─────────────► │  Spotify API     │
│  (Web app)  │ ◄───────────── │  Apple MusicKit  │
└──────┬──────┘   listening    └──────────────────┘
       │            data
       ▼
┌──────────────────────────────┐
│         Backend API          │
│  • taste analysis            │
│  • lineup + set-time data    │
│  • schedule optimizer        │
└──────┬───────────────────────┘
       ▼
┌──────────────────────────────┐
│  Lineup / set-times dataset  │
│  (Lolla 2026 schedule)       │
└──────────────────────────────┘
```

**Suggested stack** (not yet committed — adjust as you build):

- **Frontend:** React + TypeScript (Vite or Next.js), Tailwind CSS
- **Backend:** Node.js (Express/Fastify) or Next.js API routes
- **Auth:** Spotify Authorization Code w/ PKCE; Apple MusicKit JS + developer token
- **Data:** Lolla 2026 lineup + set times stored as structured JSON (manually curated until/if an official API exists)

---

## 🔌 APIs used

### Spotify Web API
- `GET /me/top/artists` and `/me/top/tracks` — your top acts and songs (short/medium/long term)
- `GET /me/player/recently-played` — recent listening
- `GET /me/tracks` — saved library
- `GET /audio-features` — tempo, energy, danceability for similarity matching
- Auth: **Authorization Code with PKCE** (no client secret in the browser)
- Docs: https://developer.spotify.com/documentation/web-api

### Apple Music API (MusicKit)
- Heavy rotation, recently played, and library endpoints via the Apple Music API
- Auth: **MusicKit JS** with a signed developer token (requires an Apple Developer account)
- Docs: https://developer.apple.com/documentation/applemusicapi

> **Note:** Lollapalooza has **no official lineup/set-times API**, but the full 2026 lineup, stages, and daily set times are already publicly announced (official daily schedule posted May 2026). We curate that into structured JSON in this repo (`data/lineup-2026.json`) — sourced from the official schedule and aggregators that already expose machine-readable set times (e.g. Festival Dust).

---

## 🚀 Getting started

> ⚠️ This repo is currently a scaffold — code is not in place yet. These steps describe the intended setup.

### Prerequisites
- Node.js 20+
- A **Spotify Developer** app → https://developer.spotify.com/dashboard
- (Optional) An **Apple Developer** account for Apple Music / MusicKit

### 1. Clone & install
```bash
git clone <this-repo-url>
cd lollaschedule
npm install
```

### 2. Configure environment
Create a `.env` file (see `.env.example` once added):
```bash
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/callback

# Apple Music (optional)
APPLE_TEAM_ID=your_team_id
APPLE_KEY_ID=your_key_id
APPLE_PRIVATE_KEY_PATH=./AuthKey_XXXX.p8
```
In the Spotify dashboard, add `http://127.0.0.1:3000/callback` as a redirect URI. **Note:** Spotify no longer accepts `localhost` — you must use the loopback IP `127.0.0.1` (rule change, April 2025).

### 3. Run
```bash
npm run dev
```
Open http://localhost:3000.

---

## 🗺️ Roadmap

- [ ] Project scaffold (frontend + backend)
- [ ] Spotify OAuth (PKCE) + token handling
- [ ] Pull and normalize listening history
- [ ] Affinity scoring model
- [ ] Lolla 2026 lineup + set-times dataset
- [ ] Conflict detection + schedule optimizer
- [ ] Stage travel-time map for Grant Park
- [ ] Schedule UI (per-day timeline view)
- [ ] Apple Music support
- [ ] Export to ICS / shareable link
- [ ] "Discovery" recommendations for artists you don't know yet

---

## 📄 License

TBD.

## 🙋 Disclaimer

Not affiliated with Lollapalooza, C3 Presents, Spotify, or Apple. Spotify and Apple Music are trademarks of their respective owners. Use of their APIs is subject to their developer terms.
