import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

// AI taste-fit prediction. Spotify gives us no genre/similarity data, so we use
// Claude's music knowledge as the discovery engine: given the artists the user
// demonstrably likes, score each unfamiliar lineup artist 0-100 for how much
// they'd enjoy them, with a one-line reason. Replaces the dead genre signal.

export type Fit = { fit: number; reason: string };

// One-line swap to a stronger/cheaper model if desired (opus-4-8 / haiku-4-5).
const MODEL = "claude-sonnet-4-6";
const CACHE_PATH = join(process.cwd(), "data", "predict-cache.json");
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

// cacheKey -> { normalizedArtist -> Fit }. Disk-persisted (warm in dev) + an
// in-memory mirror for Vercel's read-only FS. Mirrors lib/enrich.ts.
type CacheShape = Record<string, Record<string, Fit>>;
const memCache = new Map<string, Record<string, Fit>>();
// Share one prediction across concurrent /schedule loads (no thundering herd).
const inflight = new Map<string, Promise<Record<string, Fit>>>();

function loadDisk(): CacheShape {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveDisk(cache: CacheShape) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // read-only FS (prod) — just re-predict next cold start
  }
}

// Key on the inputs that change the answer: model + favorites + candidate set.
// Favorites change ⇒ new key ⇒ stale predictions auto-invalidate.
function keyFor(favorites: string[], candidates: string[]): string {
  const h = crypto.createHash("sha256");
  h.update(`${MODEL}|${favorites.map(norm).join(",")}|${[...candidates].map(norm).sort().join(",")}`);
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

// Score each candidate lineup artist for taste-fit against the user's favorites.
// Returns Map keyed by the ORIGINAL candidate string. Empty map = no key set or
// the call failed; callers treat a missing fit as 0 (graceful degradation).
export async function predictFits(
  favorites: string[],
  candidates: string[],
): Promise<Map<string, Fit>> {
  const out = new Map<string, Fit>();
  if (candidates.length === 0) return out;

  const key = keyFor(favorites, candidates);

  // Cache hit (mem or disk): the key encodes the exact candidate set, so trust
  // it — but ignore an empty entry (a prior failure should never count as a hit).
  const cached = memCache.get(key) ?? loadDisk()[key];
  if (cached && Object.keys(cached).length > 0) {
    memCache.set(key, cached);
    for (const c of candidates) {
      const hit = cached[norm(c)];
      if (hit) out.set(c, hit);
    }
    console.log(`[predict] cache hit — ${out.size}/${candidates.length}, 0 API calls`);
    return out;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[predict] no ANTHROPIC_API_KEY — discoveries left unscored (graceful)");
    return new Map();
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
  return out;
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
    const disk = loadDisk();
    disk[key] = byNorm;
    saveDisk(disk);
    memCache.set(key, byNorm);
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
    "demonstrably likes (strongest first), then a short list of candidate " +
    "artists. For EACH candidate, return a fit score 0-100 for how much THIS " +
    "user would enjoy them, judged by sonic, genre, scene, and era similarity " +
    "to their favorites. Be honest and calibrated: 80-100 = strong match, " +
    "40-79 = plausible, 0-39 = weak or you don't know the artist. Return EVERY " +
    "candidate exactly once using its name verbatim. Reason: at most 6 words.";
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
