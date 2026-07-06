import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import crypto from "crypto";
import { kvGet, kvSet } from "./kv";

// AI taste-fit prediction. Spotify gives us no genre/similarity data, so we use
// Claude's music knowledge as the discovery engine: given the artists the user
// demonstrably likes, score each unfamiliar lineup artist 0-100 for how much
// they'd enjoy them, with a one-line reason. Replaces the dead genre signal.

export type Fit = { fit: number; reason: string };

// Sonnet refused to use the top of the 0-100 range (ceiling ~78); Opus calibrates
// far better. One-line swap back to claude-sonnet-4-6 if speed/cost matters more.
const MODEL = "claude-opus-4-8";
// Bump when the prompt/calibration changes so cached scores auto-invalidate.
const PROMPT_VERSION = "v2";
const CACHE_TTL = 60 * 60 * 24 * 30; // 30 days; key also changes when favorites do
// Score in small parallel batches (one 137-artist call took 23-65s). Keep
// concurrency modest so we don't trip Anthropic 429/529 overload ourselves.
const CHUNK = 20;
const CONCURRENCY = 4;

const PredictionsSchema = z.object({
  predictions: z.array(
    z.object({
      artist: z.string(),
      fit: z.number(),
      reason: z.string(),
    }),
  ),
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clampFit = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Predictions live in KV (durable, shared across instances), keyed by the hash
// below as `predict:<key>` -> { normalizedArtist -> Fit }. Falls back to
// in-memory automatically (lib/kv.ts) when Upstash isn't configured.
// Share one prediction across concurrent /schedule loads (no thundering herd).
const inflight = new Map<string, Promise<Record<string, Fit>>>();

// Key on the inputs that change the answer: model + favorites + candidate set.
// Favorites change ⇒ new key ⇒ stale predictions auto-invalidate.
function keyFor(favorites: string[], candidates: string[]): string {
  const h = crypto.createHash("sha256");
  h.update(`${MODEL}|${PROMPT_VERSION}|${favorites.map(norm).join(",")}|${[...candidates].map(norm).sort().join(",")}`);
  return h.digest("hex").slice(0, 16);
}

// Run async tasks with a concurrency cap (results in input order).
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// status lets the UI tell "the AI ran and these are the scores" apart from "the
// AI never answered" (e.g. an overload) — so we can show a clear banner instead
// of a schedule full of misleading 0-fit discoveries.
//   ok          — fits are populated (fresh or cached)
//   unavailable — we tried but got nothing back (API overloaded/erroring); retry
//   disabled    — no ANTHROPIC_API_KEY configured (feature off, not an error)
export type PredictResult = { fits: Map<string, Fit>; status: "ok" | "unavailable" | "disabled" };

// Score each candidate lineup artist for taste-fit against the user's favorites.
// Fits are keyed by the ORIGINAL candidate string; a missing fit is treated as 0.
export async function predictFits(
  favorites: string[],
  candidates: string[],
): Promise<PredictResult> {
  const out = new Map<string, Fit>();
  if (candidates.length === 0) return { fits: out, status: "ok" };

  const key = keyFor(favorites, candidates);

  // Cache hit (KV): the key encodes the exact candidate set, so trust it — but
  // ignore an empty entry (a prior failure should never count as a hit).
  const cached = await kvGet<Record<string, Fit>>(`predict:${key}`);
  if (cached && Object.keys(cached).length > 0) {
    for (const c of candidates) {
      const hit = cached[norm(c)];
      if (hit) out.set(c, hit);
    }
    console.log(`[predict] cache hit — ${out.size}/${candidates.length}, 0 API calls`);
    return { fits: out, status: "ok" };
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[predict] no ANTHROPIC_API_KEY — discoveries left unscored (graceful)");
    return { fits: out, status: "disabled" };
  }

  // Dedup concurrent loads of the same key onto a single in-flight prediction.
  let job = inflight.get(key);
  if (!job) {
    job = runPrediction(favorites, candidates, key);
    inflight.set(key, job);
    job.finally(() => inflight.delete(key));
  } else {
    console.log("[predict] joining in-flight prediction");
  }
  const byNorm = await job;

  for (const c of candidates) {
    const hit = byNorm[norm(c)];
    if (hit) out.set(c, hit);
  }
  // Nothing came back at all → the call failed (overload/error), not "0 fit".
  const status = out.size === 0 ? "unavailable" : "ok";
  return { fits: out, status };
}

async function runPrediction(
  favorites: string[],
  candidates: string[],
  key: string,
): Promise<Record<string, Fit>> {
  // maxRetries: the SDK retries 429/5xx (incl. 529 overload) with exp. backoff.
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });
  const chunks: string[][] = [];
  for (let i = 0; i < candidates.length; i += CHUNK) chunks.push(candidates.slice(i, i + CHUNK));

  const started = Date.now();
  const results = await mapPool(chunks, CONCURRENCY, (ch) => scoreChunk(client, favorites, ch));

  const byNorm: Record<string, Fit> = {};
  let failed = 0;
  for (const r of results) {
    if (r.ok) Object.assign(byNorm, r.fits);
    else failed++;
  }

  const ms = Date.now() - started;
  if (failed === 0) {
    await kvSet(`predict:${key}`, byNorm, CACHE_TTL);
    console.log(`[predict] scored ${Object.keys(byNorm).length}/${candidates.length} via ${MODEL} (${chunks.length} chunks, ${ms}ms) — cached`);
  } else {
    // Don't cache a partial result — retry the whole set on the next load.
    console.log(`[predict] ${failed}/${chunks.length} chunks FAILED (${ms}ms) — not caching; got ${Object.keys(byNorm).length} fits this load, retry next reload`);
  }
  return byNorm;
}

// One small batch → one Claude call. Returns ok=false on failure so the caller
// can avoid caching a partial result.
async function scoreChunk(
  client: Anthropic,
  favorites: string[],
  candidates: string[],
): Promise<{ ok: boolean; fits: Record<string, Fit> }> {
  const system =
    "You are a music recommender. You'll get a list of artists a user " +
    "demonstrably likes (STRONGEST FIRST — the earliest names are their core " +
    "taste), then a short list of candidate artists. Score EACH candidate 0-100 " +
    "for how much THIS user would enjoy them, by sonic/genre/scene/era " +
    "similarity to their favorites.\n\n" +
    "Use the FULL range and be DECISIVE — do not cluster everything in 55-72:\n" +
    "- 85-100: clearly the same lane as their top favorites, or directly " +
    "adjacent to an artist NAMED in their list (shares genre/scene with them).\n" +
    "- 65-84: solid genre overlap with their taste.\n" +
    "- 40-64: loosely related, one-dimensional overlap.\n" +
    "- 15-39: a different lane from their taste.\n" +
    "- 0-14: you don't recognize the artist, or a clear clash.\n\n" +
    "Critical: if your reason cites an artist who is LITERALLY in their " +
    "favorites (e.g. 'Charli XCX adjacent' when Charli XCX is listed), that's an " +
    "85+, never middling. Return EVERY candidate exactly once using its name " +
    "verbatim. Reason: at most 6 words.";
  const userMsg =
    `User's favorite artists (strongest first):\n${favorites.join("\n")}\n\n` +
    `Candidates to score:\n${candidates.join("\n")}`;

  try {
    const message = await client.messages.parse({
      model: MODEL,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: userMsg }],
      output_config: { format: zodOutputFormat(PredictionsSchema) },
    });
    const parsed = message.parsed_output;
    const fits: Record<string, Fit> = {};
    if (parsed) {
      for (const p of parsed.predictions) {
        fits[norm(p.artist)] = { fit: clampFit(p.fit), reason: p.reason.trim() };
      }
    }
    return { ok: true, fits };
  } catch (e) {
    console.log("[predict] chunk failed:", e instanceof Error ? e.message : e);
    return { ok: false, fits: {} };
  }
}
