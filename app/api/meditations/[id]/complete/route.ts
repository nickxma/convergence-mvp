/**
 * POST /api/meditations/:id/complete
 *
 * Called by the frontend when a user finishes a meditation session.
 *
 * 1. Records the completion in meditation_completions (authenticated users only).
 * 2. Awards reputation +2 per completion (upserts user_reputation).
 * 3. Checks current streak and grants badge if a new threshold is crossed:
 *    7-day → "consistent", 30-day → "devoted", 100-day → "enlightened".
 * 4. Fetches top-3 related corpus chunks via Pinecone for the
 *    "Deepen Your Practice" completion screen section.
 *
 * Body (all optional):
 *   durationMinutes — override duration; falls back to meditation.duration
 *   ratingStars     — 1-5 star rating (recorded in completion row)
 *
 * Auth: Bearer token (Privy JWT). Unauthenticated requests still receive
 *       related_concepts but no habit tracking occurs.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pinecone, type ScoredPineconeRecord } from '@pinecone-database/pinecone';
import { embedOne } from '@/lib/embeddings';
import { supabase } from '@/lib/supabase';
import { verifyRequest } from '@/lib/privy-auth';

// ── Constants ─────────────────────────────────────────────────────────────────

const TOP_K = 5;
const RETURN_K = 3;
const MIN_SCORE = 0.30;
const EXCERPT_LEN = 220;
const TITLE_MAX_LEN = 70;
const REPUTATION_PER_COMPLETION = 2;

export const BADGE_THRESHOLDS: { days: number; slug: string }[] = [
  { days: 7,   slug: 'consistent'  },
  { days: 30,  slug: 'devoted'     },
  { days: 100, slug: 'enlightened' },
];

// ── Pure helpers (exported for testing) ──────────────────────────────────────

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

function extractTitle(text: string): string {
  const sentenceEnd = text.search(/[.!?]\s/);
  const raw = sentenceEnd > 0 && sentenceEnd < TITLE_MAX_LEN
    ? text.slice(0, sentenceEnd + 1)
    : text.slice(0, TITLE_MAX_LEN);
  return raw.trim().replace(/\s+/g, ' ') + (raw.length < text.trim().length && !raw.match(/[.!?]$/) ? '…' : '');
}

/**
 * Compute current consecutive-day streak from an array of date strings (YYYY-MM-DD).
 * Streak is live only if the most-recent practice date is today or yesterday.
 */
export function calcCurrentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const unique = [...new Set(dates)].sort(); // ascending
  const latest = unique[unique.length - 1];
  const todayStr     = new Date().toISOString().slice(0, 10);
  const yesterdayStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  if (latest !== todayStr && latest !== yesterdayStr) return 0;

  let streak = 1;
  let cursor = new Date(latest);
  for (let i = unique.length - 2; i >= 0; i--) {
    const expected = new Date(cursor.getTime() - 86_400_000).toISOString().slice(0, 10);
    if (unique[i] === expected) {
      streak++;
      cursor = new Date(unique[i]);
    } else {
      break;
    }
  }
  return streak;
}

// ── Habit tracking ─────────────────────────────────────────────────────────────

async function recordCompletion(
  userId: string,
  meditationId: string,
  durationMinutes: number,
  ratingStars: number | null,
): Promise<void> {
  const { error } = await supabase.from('meditation_completions').insert({
    user_id:          userId,
    meditation_id:    meditationId,
    duration_minutes: durationMinutes,
    rating_stars:     ratingStars,
  });
  if (error) {
    console.error(`[complete] insert_completion uid=${userId} med=${meditationId} err=${error.message}`);
  }
}

async function awardReputation(userId: string): Promise<number> {
  const { data: existing } = await supabase
    .from('user_reputation')
    .select('points')
    .eq('user_id', userId)
    .maybeSingle();

  const prev = (existing as { points: number } | null)?.points ?? 0;
  const next = prev + REPUTATION_PER_COMPLETION;

  await supabase
    .from('user_reputation')
    .upsert(
      { user_id: userId, points: next, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );

  return next;
}

/**
 * Check whether the user's current streak earns any new badges.
 * Returns slugs of newly-earned badges (already-earned ones excluded).
 */
async function checkAndAwardBadges(userId: string): Promise<string[]> {
  // Distinct practice dates across all completions
  const { data: rows } = await supabase
    .from('meditation_completions')
    .select('completed_at')
    .eq('user_id', userId);

  const dates = (rows ?? []).map((r: { completed_at: string }) => r.completed_at.slice(0, 10));
  const streak = calcCurrentStreak(dates);

  const qualifyingSlugs = BADGE_THRESHOLDS
    .filter((t) => streak >= t.days)
    .map((t) => t.slug);

  if (qualifyingSlugs.length === 0) return [];

  const { data: existing } = await supabase
    .from('user_meditation_badges')
    .select('badge_slug')
    .eq('user_id', userId)
    .in('badge_slug', qualifyingSlugs);

  const alreadyEarned = new Set(
    (existing ?? []).map((r: { badge_slug: string }) => r.badge_slug),
  );
  const newSlugs = qualifyingSlugs.filter((s) => !alreadyEarned.has(s));

  if (newSlugs.length === 0) return [];

  await supabase.from('user_meditation_badges').insert(
    newSlugs.map((slug) => ({ user_id: userId, badge_slug: slug })),
  );

  return newSlugs;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return errorResponse(400, 'INVALID_ID', 'Invalid meditation ID.');
  }

  // Optional auth — unauthenticated users get related concepts only
  const auth = await verifyRequest(req).catch(() => null);

  // Parse optional body
  let bodyDuration: number | null = null;
  let bodyRating: number | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.durationMinutes === 'number' && body.durationMinutes > 0) {
      bodyDuration = Math.round(body.durationMinutes);
    }
    if (typeof body.ratingStars === 'number' && body.ratingStars >= 1 && body.ratingStars <= 5) {
      bodyRating = Math.round(body.ratingStars);
    }
  } catch {
    // ignore
  }

  // ── Fetch meditation ───────────────────────────────────────────────────────
  const { data: meditation, error: dbError } = await supabase
    .from('meditations')
    .select('theme, style, duration, rating')
    .eq('id', id)
    .single();

  if (dbError || !meditation) {
    console.warn(`[/api/meditations/${id}/complete] not_found err=${dbError?.message ?? 'no row'}`);
    return errorResponse(404, 'NOT_FOUND', 'Meditation not found.');
  }

  const { theme, style, duration, rating } = meditation as {
    theme: string; style: string; duration: number; rating: number | null;
  };

  const durationMinutes = bodyDuration ?? duration;
  const ratingStars     = bodyRating ?? rating ?? null;

  // ── Habit tracking (authenticated users only) ──────────────────────────────
  let badgesEarned: string[] = [];
  let reputationTotal: number | null = null;

  if (auth?.userId) {
    const userId = auth.userId;
    try {
      await recordCompletion(userId, id, durationMinutes, ratingStars);
      reputationTotal = await awardReputation(userId);
      badgesEarned    = await checkAndAwardBadges(userId);
    } catch (err) {
      // Don't fail the whole request — related concepts are the primary payload
      console.error(
        `[/api/meditations/${id}/complete] habit_error uid=${userId} err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Pinecone related concepts ──────────────────────────────────────────────
  const openaiKey    = process.env.OPENAI_API_KEY;
  const pineconeKey  = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';
  const logCtx = `id=${id} theme="${theme.slice(0, 60)}" style=${style}`;

  if (!openaiKey || !pineconeKey) {
    console.error(`[/api/meditations/${id}/complete] missing env vars`);
    return NextResponse.json({ related_concepts: [], badgesEarned, reputationTotal });
  }

  const pc = new Pinecone({ apiKey: pineconeKey });

  let queryVector: number[];
  try {
    queryVector = await embedOne(`${theme} ${style}`);
  } catch (err) {
    console.error(`[/api/meditations/${id}/complete] embed_error ${logCtx} err=${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ related_concepts: [], badgesEarned, reputationTotal });
  }

  let matches: ScoredPineconeRecord[];
  try {
    const index = pc.Index(pineconeIndex);
    const result = await index.query({ vector: queryVector, topK: TOP_K, includeMetadata: true });
    matches = result.matches ?? [];
  } catch (err) {
    console.error(`[/api/meditations/${id}/complete] pinecone_error ${logCtx} err=${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json({ related_concepts: [], badgesEarned, reputationTotal });
  }

  const seenTexts = new Set<string>();
  const related_concepts = matches
    .filter((m) => (m.score ?? 0) >= MIN_SCORE)
    .map((m) => {
      const meta = (m.metadata ?? {}) as Record<string, string>;
      return { text: meta.text ?? '', speaker: meta.speaker ?? '', score: m.score ?? 0 };
    })
    .filter((c) => {
      if (!c.text || seenTexts.has(c.text)) return false;
      seenTexts.add(c.text);
      return true;
    })
    .slice(0, RETURN_K)
    .map((c) => ({
      title:   extractTitle(c.text),
      excerpt: c.text.slice(0, EXCERPT_LEN).trim() + (c.text.length > EXCERPT_LEN ? '…' : ''),
      speaker: c.speaker,
    }));

  console.info(
    `[/api/meditations/${id}/complete] concepts=${related_concepts.length} badges=${badgesEarned.join(',') || 'none'} uid=${auth?.userId ?? 'anon'} ${logCtx}`,
  );

  return NextResponse.json({ related_concepts, badgesEarned, reputationTotal });
}
