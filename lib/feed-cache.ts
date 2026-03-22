/**
 * Short-lived feed cache for GET /api/community/posts.
 *
 * Primary store: Upstash Redis (when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set).
 * Fallback: in-memory Map (single Node.js process — not shared across Vercel invocations).
 *
 * TTL: 30 seconds. Invalidated on new post creation.
 */

const FEED_TTL_SEC = 30;

// ─── In-memory fallback store ─────────────────────────────────────────────────

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const memStore = new Map<string, CacheEntry>();

// Prune expired entries periodically to prevent unbounded growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memStore.entries()) {
    if (entry.expiresAt <= now) memStore.delete(key);
  }
}, 60_000).unref();

// ─── Redis helpers ────────────────────────────────────────────────────────────

function getRedisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function redisGet(key: string): Promise<unknown | null> {
  const redis = getRedisConfig();
  if (!redis) return null;

  try {
    const res = await fetch(`${redis.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { result: string | null };
    if (json.result === null) return null;
    return JSON.parse(json.result);
  } catch {
    return null;
  }
}

async function redisSet(key: string, value: unknown, ttlSec: number): Promise<void> {
  const redis = getRedisConfig();
  if (!redis) return;

  try {
    await fetch(`${redis.url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: JSON.stringify(value), ex: ttlSec }),
    });
  } catch {
    // Non-fatal: cache write failure degrades to uncached
  }
}

async function redisDel(pattern: string): Promise<void> {
  const redis = getRedisConfig();
  if (!redis) return;

  try {
    // SCAN + DEL for pattern match (Upstash supports SCAN)
    const scanRes = await fetch(`${redis.url}/scan/0/match/${encodeURIComponent(pattern)}/count/100`, {
      headers: { Authorization: `Bearer ${redis.token}` },
    });
    if (!scanRes.ok) return;
    const scanJson = (await scanRes.json()) as { result: [string, string[]] };
    const keys = scanJson.result?.[1] ?? [];
    if (keys.length === 0) return;

    await fetch(`${redis.url}/del/${keys.map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${redis.token}` },
    });
  } catch {
    // Non-fatal
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function feedKey(page: number): string {
  return `feed:v1:${page}`;
}

export async function getFeedCache(page: number): Promise<unknown | null> {
  const key = feedKey(page);

  // Try Redis first
  const redisVal = await redisGet(key);
  if (redisVal !== null) return redisVal;

  // Fall back to in-memory
  const entry = memStore.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

export async function setFeedCache(page: number, data: unknown): Promise<void> {
  const key = feedKey(page);

  // Write to Redis (non-blocking — don't await to avoid adding latency)
  redisSet(key, data, FEED_TTL_SEC).catch(() => {});

  // Write to in-memory as well (serves requests in same process)
  memStore.set(key, { value: data, expiresAt: Date.now() + FEED_TTL_SEC * 1000 });
}

export async function invalidateFeedCache(): Promise<void> {
  // Clear all pages from Redis
  redisDel('feed:v1:*').catch(() => {});

  // Clear all pages from memory
  for (const key of memStore.keys()) {
    if (key.startsWith('feed:v1:')) memStore.delete(key);
  }
}
