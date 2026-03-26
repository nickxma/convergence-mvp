/**
 * Essay context fetcher with Upstash Redis caching.
 *
 * Fetches essay title, body_markdown, and tags from the `essays` Supabase table.
 * Caches the result in Upstash for 1 hour by slug so /api/ask doesn't hit
 * Supabase on every request.
 * Falls back gracefully (returns null) when the essay is not found, Redis is
 * unavailable, or any error occurs — the caller should treat null as "no essay
 * context available".
 */
import { supabase } from './supabase';

const CACHE_TTL_SEC = 60 * 60; // 1 hour
const KEY_PREFIX = 'essay:v1:';

export interface EssayContext {
  slug: string;
  title: string;
  bodyMarkdown: string;
  tags: string[];
}

// ── Upstash helpers ────────────────────────────────────────────────────────────

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

async function cacheGet(slug: string): Promise<EssayContext | null> {
  const redis = redisConfig();
  if (!redis) return null;
  try {
    const res = await fetch(
      `${redis.url}/get/${encodeURIComponent(`${KEY_PREFIX}${slug}`)}`,
      { headers: { Authorization: `Bearer ${redis.token}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { result: string | null };
    if (!json.result) return null;
    return JSON.parse(json.result) as EssayContext;
  } catch {
    return null;
  }
}

async function cacheSet(slug: string, value: EssayContext): Promise<void> {
  const redis = redisConfig();
  if (!redis) return;
  try {
    await fetch(
      `${redis.url}/set/${encodeURIComponent(`${KEY_PREFIX}${slug}`)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${redis.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ value: JSON.stringify(value), ex: CACHE_TTL_SEC }),
      },
    );
  } catch {
    // Non-fatal
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Returns essay context for the given slug, or null if not found / on error.
 * Results are cached in Upstash for 1 hour.
 */
export async function getEssayContext(slug: string): Promise<EssayContext | null> {
  if (!slug) return null;

  const cached = await cacheGet(slug);
  if (cached) return cached;

  try {
    const { data, error } = await supabase
      .from('essays')
      .select('slug, title, body_markdown, tags')
      .eq('slug', slug)
      .eq('published', true)
      .single();

    if (error || !data) return null;

    const ctx: EssayContext = {
      slug: data.slug as string,
      title: data.title as string,
      bodyMarkdown: (data.body_markdown as string) ?? '',
      tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
    };

    await cacheSet(slug, ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Returns essay context for a course session, or null if not found / on error.
 * Uses the course slug + session slug pair (unique per course) to fetch from
 * the course_sessions table and maps it to the EssayContext shape.
 * Results are cached in Upstash for 1 hour.
 */
export async function getCourseSessionContext(courseSlug: string, sessionSlug: string): Promise<EssayContext | null> {
  if (!courseSlug || !sessionSlug) return null;

  const cacheKey = `course:${courseSlug}:${sessionSlug}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const { data: courseData, error: courseError } = await supabase
      .from('courses')
      .select('id')
      .eq('slug', courseSlug)
      .single();

    if (courseError || !courseData) return null;

    const { data, error } = await supabase
      .from('course_sessions')
      .select('slug, title, body')
      .eq('course_id', courseData.id as string)
      .eq('slug', sessionSlug)
      .single();

    if (error || !data) return null;

    const ctx: EssayContext = {
      slug: data.slug as string,
      title: data.title as string,
      bodyMarkdown: (data.body as string) ?? '',
      tags: [],
    };

    await cacheSet(cacheKey, ctx);
    return ctx;
  } catch {
    return null;
  }
}
