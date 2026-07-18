import { Redis } from "@upstash/redis";

// Durable cache with a graceful in-memory fallback. Uses Upstash Redis when
// UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set (shared across all
// server instances + survives cold starts); otherwise an in-process Map so dev
// works with no external service. @upstash/redis JSON-serializes values for us.
const hasRedis = !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
const redis = hasRedis ? Redis.fromEnv() : null;

export const kvEnabled = hasRedis;

const mem = new Map<string, { value: unknown; exp: number }>();

export async function kvGet<T>(key: string): Promise<T | null> {
  if (redis) {
    try {
      return (await redis.get<T>(key)) ?? null;
    } catch (e) {
      console.log("[kv] get failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }
  const hit = mem.get(key);
  if (!hit) return null;
  if (hit.exp && Date.now() > hit.exp) {
    mem.delete(key);
    return null;
  }
  return hit.value as T;
}

export async function kvSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch (e) {
      console.log("[kv] set failed:", e instanceof Error ? e.message : e);
    }
    return;
  }
  mem.set(key, { value, exp: Date.now() + ttlSeconds * 1000 });
}

export async function kvDel(key: string): Promise<void> {
  if (redis) {
    try {
      await redis.del(key);
    } catch (e) {
      console.log("[kv] del failed:", e instanceof Error ? e.message : e);
    }
    return;
  }
  mem.delete(key);
}

// Atomic counter with a TTL window (for rate limiting). Returns the new count;
// the TTL is set only when the counter is first created so the window is fixed.
// Returns 0 on a Redis error so KV hiccups never block a legit sign-in.
export async function kvIncr(key: string, ttlSeconds: number): Promise<number> {
  if (redis) {
    try {
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, ttlSeconds);
      return n;
    } catch (e) {
      console.log("[kv] incr failed:", e instanceof Error ? e.message : e);
      return 0;
    }
  }
  const now = Date.now();
  const hit = mem.get(key);
  if (!hit || (hit.exp && now > hit.exp)) {
    mem.set(key, { value: 1, exp: now + ttlSeconds * 1000 });
    return 1;
  }
  const n = (hit.value as number) + 1;
  hit.value = n;
  return n;
}
