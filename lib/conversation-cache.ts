/**
 * Conversation history cache backed by Upstash Redis.
 *
 * Stores the last N turns for active Q&A sessions with a 2-hour TTL so
 * follow-up questions can retrieve context without a Supabase round-trip.
 * Falls back gracefully (returns null / no-ops) when Redis is not configured.
 */
import type { HistoryMessage } from './conversation-session';

const TTL_SECONDS = 2 * 60 * 60; // 2 hours
const KEY_PREFIX = 'conv:';

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

/**
 * Retrieve conversation history from the Redis cache.
 * Returns null when the key doesn't exist, has expired, or Redis is unavailable.
 */
export async function getConversationHistory(
  conversationId: string,
): Promise<HistoryMessage[] | null> {
  const redis = redisConfig();
  if (!redis) return null;

  try {
    const res = await fetch(`${redis.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([['GET', `${KEY_PREFIX}${conversationId}`]]),
    });
    if (!res.ok) return null;

    const results = (await res.json()) as Array<{ result: string | null }>;
    const raw = results[0]?.result;
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryMessage[]) : null;
  } catch {
    return null;
  }
}

/**
 * Write conversation history to the Redis cache with a 2-hour TTL.
 * Fire-and-forget — errors are logged but never thrown.
 */
export async function setConversationHistory(
  conversationId: string,
  history: HistoryMessage[],
): Promise<void> {
  const redis = redisConfig();
  if (!redis) return;

  try {
    await fetch(`${redis.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redis.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([
        ['SET', `${KEY_PREFIX}${conversationId}`, JSON.stringify(history), 'EX', TTL_SECONDS],
      ]),
    });
  } catch (err) {
    console.warn(
      `[conversation-cache] set_error conv=${conversationId} err=${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
