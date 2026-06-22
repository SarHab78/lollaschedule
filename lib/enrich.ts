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
  genresFetched: boolean; // have we hit /artists for genres+popularity yet?
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

// Resolve metadata for many artist names:
//  1. search (cache miss only) to get the Spotify id + image,
//  2. batch /artists?ids= to get genres + popularity — the SEARCH endpoint no
//     longer returns those reliably, so we must hit the full artist endpoint.
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

  // 1. Search for cache misses → id + image (bounded concurrency).
  const CONCURRENCY = 6;
  let i = 0;
  async function searchWorker() {
    while (i < misses.length) {
      const name = misses[i++];
      try {
        const a = await searchArtist(name, token);
        const meta: ArtistMeta = {
          name,
          spotifyId: a?.id ?? null,
          genres: [],
          popularity: 0,
          image: a?.images?.[0]?.url ?? null,
          genresFetched: false,
        };
        cache[name] = meta;
        result.set(name, meta);
      } catch {
        result.set(name, { name, spotifyId: null, genres: [], popularity: 0, image: null, genresFetched: false });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, searchWorker));

  // NOTE: the /artists endpoint (genres + popularity) returns 403 Forbidden for
  // this app — Spotify restricts it for development-mode apps. Genres are also
  // empty from /search. So we currently can't get genre/popularity from Spotify;
  // matching relies on direct listening signals (top/recent/saved/followed).

  saveCache(cache);
  return result;
}
