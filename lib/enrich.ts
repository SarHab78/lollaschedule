import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { searchArtist } from "./spotify";

// Per-artist Spotify metadata (genres/popularity/image) needed to score lineup
// acts you don't already listen to. Genres are global, not user-specific, so we
// cache to disk and reuse across users/sessions.
export type ArtistMeta = {
  name: string;
  spotifyId: string | null;
  genres: string[];
  popularity: number; // 0..100
  image: string | null;
};

const CACHE_PATH = join(process.cwd(), "data", "enriched-cache.json");

function loadCache(): Record<string, ArtistMeta> {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, ArtistMeta>) {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  } catch {
    // best-effort; a read-only FS just means we re-fetch next time
  }
}

// Resolve metadata for many artist names, hitting Spotify search only for cache
// misses, with bounded concurrency to stay friendly with rate limits.
export async function enrichArtists(
  names: string[],
  token: string,
): Promise<Map<string, ArtistMeta>> {
  const cache = loadCache();
  const result = new Map<string, ArtistMeta>();
  const misses: string[] = [];

  for (const name of names) {
    const hit = cache[name];
    if (hit) result.set(name, hit);
    else misses.push(name);
  }

  const CONCURRENCY = 6;
  let i = 0;
  async function worker() {
    while (i < misses.length) {
      const name = misses[i++];
      try {
        const a = await searchArtist(name, token);
        const meta: ArtistMeta = {
          name,
          spotifyId: a?.id ?? null,
          genres: a?.genres ?? [],
          popularity: a?.popularity ?? 0,
          image: a?.images?.[0]?.url ?? null,
        };
        cache[name] = meta;
        result.set(name, meta);
      } catch {
        const meta: ArtistMeta = { name, spotifyId: null, genres: [], popularity: 0, image: null };
        result.set(name, meta); // don't cache failures
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (misses.length) saveCache(cache);
  return result;
}
