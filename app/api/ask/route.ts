import * as Sentry from '@sentry/nextjs';
import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError as OpenAIRateLimitError,
  AuthenticationError as OpenAIAuthError,
  InternalServerError as OpenAIServerError,
} from 'openai';
import { CohereClient } from 'cohere-ai';
import { Pinecone } from '@pinecone-database/pinecone';
import { checkRateLimitWithFallback, checkDailyLimit, getClientIp, isInternalRequest, MINUTE_MS } from '@/lib/rate-limit';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import { getUserSubscription, FREE_TIER_DAILY_LIMIT } from '@/lib/subscription';
import { isValidConversationId, buildQueryText, appendTurn } from '@/lib/conversation-session';
import type { HistoryMessage } from '@/lib/conversation-session';
import { getConversationHistory, setConversationHistory } from '@/lib/conversation-cache';
import { monitoredQuery } from '@/lib/db-monitor';
import { logOpenAIUsage } from '@/lib/openai-usage';
import { embedOne, embedBatch } from '@/lib/embeddings';
import { getConceptContext } from '@/lib/concept-graph';
import { shouldExpandQuery, expandQuery, reciprocalRankFusion } from '@/lib/query-expansion';
import { getEssayContext, getCourseSessionContext } from '@/lib/essay-cache';
import { RagTracer } from '@/lib/rag-tracer';
import { buildAnswerCacheKey, getAnswerCache, setAnswerCache } from '@/lib/qa-answer-cache';

const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMENSIONS = 1536;
const CHAT_MODEL = 'gpt-4o';
const PINECONE_NAMESPACE = 'waking-up';
const PINECONE_SUMMARY_NAMESPACE = 'waking-up-summaries';
const TOP_K = 20; // broad retrieval per namespace — merged result is re-ranked below
const RERANK_TOP_N = 6; // final chunk count after Cohere re-ranking
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheChunk {
  text: string;
  speaker: string;
  source: string;
  score: number;
  chunkId?: string;
}

/** Stable chunk identifier: SHA-256 of "source::text_prefix". Matches the
 *  format expected by citation_feedback.chunk_id. */
function computeChunkId(source: string, text: string): string {
  return createHash('sha256').update(source + '::' + text.slice(0, 100)).digest('hex');
}

const SYSTEM_PROMPT_BASE = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, non-dual awareness, and contemplative traditions.
Answer any question with your full knowledge — mindfulness, psychology, neuroscience, philosophy of mind, contemplative practice. When transcript excerpts are provided, weave their insights naturally into your answer as enrichment.
Rules:
- Be warm, direct, and conversational — like a wise friend, not a textbook.
- Never name specific teachers, authors, or brands. Refer to "teachers in this tradition" or "contemplative traditions" instead.
- Never refuse to answer. If excerpts are sparse, rely on your own knowledge.
- No numbered lists or academic structure unless the user asks for it.
- Always use clear paragraph breaks between distinct ideas — never write a wall of text.
- Format your response in markdown, using blank lines between paragraphs.`;

const SYSTEM_PROMPTS: Record<string, string> = {
  detailed: `${SYSTEM_PROMPT_BASE}
- Keep answers concise: 2-4 short paragraphs max. No walls of text.
- Use inline citations like [1], [2] when weaving in specific passage insights.`,
  brief: `${SYSTEM_PROMPT_BASE}
- Keep answers very concise: 2-3 short paragraphs max.
- Do not include inline citation markers — synthesize insights seamlessly without referencing specific sources.`,
  citations_first: `${SYSTEM_PROMPT_BASE}
- Structure your answer in two parts:
  1. Key insights: 2-3 brief pull-quotes or paraphrases from the provided excerpts (one per line, introduced with a dash). Each should stand alone and be clearly attributed with its citation number e.g. [1].
  2. Synthesis: 1-2 paragraphs weaving the insights together with your own knowledge.
- If excerpts are sparse, skip Part 1 and answer directly.`,
};

/** Compute response-quality format metrics for qa_analytics logging. No text is stored — only counts/flags. */
function computeFormatMetrics(text: string) {
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const paragraphCount = text.split(/\n\n+/).filter((p) => p.trim().length > 0).length;
  const hasHeaders = /^#{1,6}\s/m.test(text);
  const hasBullets = /^[\-\*]\s/m.test(text);
  return { word_count: wordCount, paragraph_count: paragraphCount, has_headers: hasHeaders, has_bullets: hasBullets };
}

/** Structured error response helper. */
function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

// Per-minute rate limits — authenticated users get 6× the budget
const RATE_LIMIT_AUTHED = 30; // wallet-authenticated requests per minute
const RATE_LIMIT_ANON = 5;    // unauthenticated requests per minute
const GUEST_LIMIT = 3; // free questions per IP per 24h (Supabase-tracked overall cap)
const REFERRED_GUEST_LIMIT = 5; // bumped limit for visitors arriving via referral link

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const requestId = randomUUID();
  const tracer = new RagTracer();
  const ip = getClientIp(req);

  // rag.query_receive — point-in-time span marking request receipt
  tracer.trace('rag.query_receive', () => Promise.resolve()).catch(() => {});

  // ── Identify caller ───────────────────────────────────────────────────────
  const authResult = await verifyRequest(req);
  const userId = authResult?.userId ?? null;

  // ── Rate limit (bypassed for internal/agent calls) ────────────────────────
  const rateLimit = userId ? RATE_LIMIT_AUTHED : RATE_LIMIT_ANON;
  const rateLimitKey = userId ? `ask:user:${userId}` : `ask:anon:${ip}`;
  const rl = isInternalRequest(req)
    ? null
    : await checkRateLimitWithFallback(rateLimitKey, rateLimit, MINUTE_MS);

  if (rl !== null && !rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    console.warn(`[/api/ask] rate_limit ip=${ip} userId=${userId ?? 'anon'} store=${rl.store}`);
    return errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests — please wait before trying again.', {
      'Retry-After': String(retryAfterSec),
      'X-RateLimit-Limit': String(rateLimit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
    });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const question: string = typeof body?.question === 'string' ? body.question.trim() : '';
  const history: HistoryMessage[] = Array.isArray(body?.history) ? (body.history as HistoryMessage[]) : [];
  const walletAddress: string | null = typeof body?.walletAddress === 'string' ? body.walletAddress : null;
  // Answer style — controls which system prompt variant is used. Unauthenticated users always get 'detailed'.
  const rawStyle = typeof body?.answerStyle === 'string' ? body.answerStyle : 'detailed';
  const answerStyle: string = userId && rawStyle in SYSTEM_PROMPTS ? rawStyle : 'detailed';
  const activeSystemPrompt = SYSTEM_PROMPTS[answerStyle] ?? SYSTEM_PROMPTS.detailed;
  // Teacher filter: restricts Pinecone retrieval to a single teacher's chunks.
  // Bypass cache when active — different teachers yield different results for the same question.
  const teacher: string | null = typeof body?.teacher === 'string' && body.teacher.trim() ? body.teacher.trim() : null;

  // Attach per-request identity to the active Sentry scope so all events from this
  // request include the wallet address and a stable request ID for correlation.
  const sentryScope = Sentry.getCurrentScope();
  sentryScope.setTag('request.id', requestId);
  if (userId) sentryScope.setUser({ id: userId });
  if (walletAddress) sentryScope.setTag('wallet.address', walletAddress);

  // Essay context: when provided the answer is injected with the essay body and bypasses cache.
  const essaySlug: string | null = typeof body?.essaySlug === 'string' && body.essaySlug.trim() ? body.essaySlug.trim() : null;
  const courseSlug: string | null = typeof body?.courseSlug === 'string' && body.courseSlug.trim() ? body.courseSlug.trim() : null;

  const rawConvId = body?.conversationId;
  const isExistingConversation = isValidConversationId(rawConvId);
  const conversationId: string = isExistingConversation ? rawConvId : randomUUID();

  if (!question) {
    return errorResponse(400, 'MISSING_QUESTION', 'question is required and must be a non-empty string.');
  }

  const MAX_QUESTION_LENGTH = 500;
  if (question.length > MAX_QUESTION_LENGTH) {
    return errorResponse(400, 'QUESTION_TOO_LONG', `question must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }

  // Prompt injection guard — reject questions containing common override patterns
  const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /forget\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
    /\bsystem\s*:/i,
    /\boverride\s+(your\s+)?(instructions?|rules?|guidelines?)/i,
    /you\s+are\s+now\s+/i,
    /act\s+as\s+(if\s+you\s+are\s+)?a\s+/i,
    /\bjailbreak\b/i,
    /\bdan\s+mode\b/i,
  ];
  if (INJECTION_PATTERNS.some((re) => re.test(question))) {
    console.warn(`[/api/ask] prompt_injection_attempt ip=${ip} userId=${userId ?? 'anon'} q="${question.slice(0, 80)}"`);
    return errorResponse(400, 'INVALID_QUESTION', 'question contains disallowed content.');
  }

  // ── Daily rate limit state (for response headers) ─────────────────────────
  let dailyRlHeaders: Record<string, string> = {};
  let guestQueriesRemaining: number | null = null;
  let userQuestionsRemaining: number | null = null;
  let isProUser = false;

  // ── Guest rate limit ──────────────────────────────────────────────────────
  // Referred visitors (those with a `ref` cookie) get 5 free questions instead of 3.
  // Uses Upstash Redis keyed by IP hash + UTC date; fails open on Redis error.
  if (!userId) {
    const hasRefCookie = Boolean(req.cookies.get('ref')?.value?.trim());
    const effectiveGuestLimit = hasRefCookie ? REFERRED_GUEST_LIMIT : GUEST_LIMIT;
    const ipHash = createHash('sha256').update(ip).digest('hex');
    const guestRl = await checkDailyLimit(`guest:${ipHash}`, effectiveGuestLimit);
    dailyRlHeaders = {
      'X-RateLimit-Limit': String(effectiveGuestLimit),
      'X-RateLimit-Remaining': String(Math.max(0, guestRl.remaining)),
      'X-RateLimit-Reset': String(Math.ceil(guestRl.resetAt / 1000)),
    };
    if (!guestRl.allowed) {
      console.warn(`[/api/ask] guest_daily_limit ip=${ip} store=${guestRl.store}`);
      return NextResponse.json(
        {
          error: 'rate_limited',
          limit: effectiveGuestLimit,
          reset_at: new Date(guestRl.resetAt).toISOString(),
          upgrade_url: '/subscribe',
        },
        {
          status: 429,
          headers: { ...dailyRlHeaders, 'Retry-After': String(Math.ceil((guestRl.resetAt - Date.now()) / 1000)) },
        },
      );
    }
    guestQueriesRemaining = guestRl.remaining;
  }

  // ── Free-tier authenticated user daily limit ──────────────────────────────
  // Pro/team users bypass this; free users are capped at FREE_TIER_DAILY_LIMIT/day.
  // Uses Upstash Redis keyed by userId + UTC date; fails open on Redis error.
  if (userId && !isInternalRequest(req)) {
    const sub = await getUserSubscription(userId);
    isProUser = sub.tier === 'pro' || sub.tier === 'team';
    if (!isProUser) {
      const userRl = await checkDailyLimit(`user:${userId}`, FREE_TIER_DAILY_LIMIT);
      dailyRlHeaders = {
        'X-RateLimit-Limit': String(FREE_TIER_DAILY_LIMIT),
        'X-RateLimit-Remaining': String(Math.max(0, userRl.remaining)),
        'X-RateLimit-Reset': String(Math.ceil(userRl.resetAt / 1000)),
      };
      if (!userRl.allowed) {
        console.warn(`[/api/ask] user_daily_limit userId=${userId} store=${userRl.store}`);
        return NextResponse.json(
          {
            error: 'rate_limited',
            limit: FREE_TIER_DAILY_LIMIT,
            reset_at: new Date(userRl.resetAt).toISOString(),
            upgrade_url: '/subscribe',
          },
          {
            status: 429,
            headers: { ...dailyRlHeaders, 'Retry-After': String(Math.ceil((userRl.resetAt - Date.now()) / 1000)) },
          },
        );
      }
      userQuestionsRemaining = userRl.remaining;
    }
  }

  // ── Env / config check ────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    console.error('[/api/ask] missing required env vars: OPENAI_API_KEY or PINECONE_API_KEY');
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured. Contact the administrator.');
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });

  const logCtx = `ip=${ip} userId=${userId ?? 'anon'} wallet=${walletAddress ?? 'none'} conv=${conversationId} q="${question.slice(0, 80)}"`;

  // ── Load server-side history if conversationId provided but client sent no history ──
  // Primary: Upstash Redis (2h TTL, fast). Fallback: Supabase conversation_sessions.
  let effectiveHistory = history;
  if (isExistingConversation && history.length === 0) {
    const cached = await getConversationHistory(conversationId);
    if (cached) {
      effectiveHistory = cached;
    } else {
      try {
        const { data } = await monitoredQuery('conversation_sessions.fetch', () =>
          supabase
            .from('conversation_sessions')
            .select('history')
            .eq('id', conversationId)
            .gt('expires_at', new Date().toISOString())
            .single(),
        );
        if (data?.history && Array.isArray(data.history)) {
          effectiveHistory = data.history as HistoryMessage[];
        }
      } catch {
        // Proceed without server-side history — not fatal
      }
    }
  }

  // ── Cache flags ───────────────────────────────────────────────────────────
  // Semantic threshold from env; default 0.92.
  const semanticThreshold = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD ?? '0.92');
  // Cache key: SHA-256 of lowercased+trimmed question (independent of questionHash in analytics).
  const cacheKey = createHash('sha256').update(question.toLowerCase()).digest('hex');
  // Pro users and teacher-filtered queries always get fresh answers (bypass semantic cache).
  // Bypass cache when answer style is non-default — cached answers were generated with the 'detailed' prompt.
  const noCacheParam = req.nextUrl.searchParams.get('noCache') === '1' || isProUser || teacher !== null || essaySlug !== null || answerStyle !== 'detailed';
  // Only cache standalone (first-turn) questions. Follow-ups depend on conversation
  // context, so caching them would return mismatched answers.
  const isFollowUp = effectiveHistory.length > 0;

  // ── Exact-hash cache lookup ───────────────────────────────────────────────
  if (!noCacheParam && !isFollowUp) {
    let exact: { answer: string; follow_ups: string[] | null; chunks_json: unknown[] | null } | null = null;
    try {
      exact = await tracer.trace('rag.cache_check', async () => {
        const { data } = await supabase
          .from('qa_cache')
          .select('answer, follow_ups, chunks_json')
          .eq('hash', cacheKey)
          .gt('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
          .single();
        return data ?? null;
      }, { type: 'exact' });
    } catch {
      // Non-fatal — fall through to live path
    }

    if (exact) {
      console.log(`[/api/ask] exact_cache_hit ${logCtx}`);
      const cachedChunks = (exact.chunks_json ?? []) as CacheChunk[];
      const cachedAnswer = exact.answer as string;
      const cachedFollowUps = (exact.follow_ups ?? []) as string[];

      supabase.rpc('increment_qa_cache_hit', { p_hash: cacheKey }).then(({ error }) => {
        if (error) console.warn(`[/api/ask] cache_hit_increment_error err=${error.message}`);
      });

      const answerSources = cachedChunks.slice(0, 3).map((c) => ({
        text: c.text.slice(0, 200), speaker: c.speaker, source: c.source,
        score: Math.round(c.score * 100) / 100,
      }));
      let answerId: string | null = null;
      try {
        const { data: ar, error: ae } = await supabase
          .from('qa_answers')
          .insert({ question, answer: cachedAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: cacheKey, ...(userId ? { user_id: userId } : {}) })
          .select('id').single();
        if (ae) console.warn(`[/api/ask] qa_answer_write_error err=${ae.message}`);
        else answerId = ar?.id ?? null;
      } catch (err) {
        console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
      }

      const latencyMs = Date.now() - requestStart;
      const questionHash = createHash('sha256').update(question).digest('hex');
      const fmtMetrics = computeFormatMetrics(cachedAnswer);
      supabase.from('qa_analytics')
        .insert({ question_hash: questionHash, pinecone_scores: [], latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: true, semantic_cache_hit: false, ...fmtMetrics })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

      const updatedHistory = appendTurn(effectiveHistory, question, cachedAnswer);
      supabase.from('conversation_sessions')
        .upsert({ id: conversationId, history: updatedHistory, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, { onConflict: 'id' })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });
      setConversationHistory(conversationId, updatedHistory).catch(() => {});
      supabase.from('qa_conversations')
        .upsert({ id: conversationId, messages: updatedHistory, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) }, { onConflict: 'id' })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_conv_error conv=${conversationId} err=${error.message}`); });

      await tracer.trace('rag.response_send', () => Promise.resolve(), { cached: true, type: 'exact' });
      return NextResponse.json({
        answer: cachedAnswer, answerId, conversationId, followUps: cachedFollowUps, cached: true,
        sources: cachedChunks.map((c) => ({ text: c.text.slice(0, 200), speaker: c.speaker, source: c.source, score: Math.round(c.score * 100) / 100, chunkId: c.chunkId ?? computeChunkId(c.source, c.text) })),
        ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
        ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
        ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
      }, { headers: dailyRlHeaders });
    }
  }

  // ── Fetch essay context (when essaySlug provided) ─────────────────────────
  // When courseSlug is also present, fetch from course_sessions (session pages).
  // Otherwise fall back to the essays table (standalone essay pages).
  // Cached in Upstash for 1 hour. Returns null when not found — graceful.
  const essayCtx = essaySlug
    ? courseSlug
      ? await getCourseSessionContext(courseSlug, essaySlug).catch(() => null)
      : await getEssayContext(essaySlug).catch(() => null)
    : null;

  // ── Embed ─────────────────────────────────────────────────────────────────
  // For standalone questions (no history): embed the raw question.
  //   - Used for semantic cache search AND as the Pinecone query vector (they're equivalent
  //     since buildQueryText returns the question unchanged when history is empty).
  // For follow-ups: embed queryText (question + last assistant turn) for Pinecone only.
  // When an essay context is present, append essay title + tags to the embed input so
  // Pinecone retrieval is biased toward chunks topically related to the essay.
  const queryText = buildQueryText(question, effectiveHistory);
  const baseEmbedInput = isFollowUp ? queryText : question;
  const embedInput = essayCtx
    ? `${baseEmbedInput}\n\nEssay topic: ${essayCtx.title}${essayCtx.tags.length ? `. Tags: ${essayCtx.tags.join(', ')}` : ''}`
    : baseEmbedInput;

  let queryVector: number[];
  try {
    queryVector = await tracer.trace('rag.embed_query', () =>
      embedOne(embedInput, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai }),
    );
  } catch (err) {
    return handleOpenAIError(err, 'embeddings', logCtx);
  }

  // ── Semantic cache lookup ─────────────────────────────────────────────────
  if (!noCacheParam && !isFollowUp) {
    let semanticRow: { answer: string; follow_ups: string[] | null; chunks_json: unknown[] | null; similarity?: number } | null = null;
    try {
      semanticRow = await tracer.trace('rag.cache_check', async () => {
        const { data: rows } = await monitoredQuery('qa_cache.semantic_lookup', () =>
          supabase.rpc('match_qa_cache', {
            query_embedding: queryVector,
            match_threshold: semanticThreshold,
            match_count: 1,
          }),
        );
        return Array.isArray(rows) ? (rows[0] ?? null) : null;
      }, { type: 'semantic', threshold: semanticThreshold });
    } catch {
      // Non-fatal — fall through to live path
    }

    if (semanticRow) {
      console.log(`[/api/ask] semantic_cache_hit similarity=${semanticRow.similarity?.toFixed(4)} ${logCtx}`);
      const cachedChunks = (semanticRow.chunks_json ?? []) as CacheChunk[];
      const cachedAnswer = semanticRow.answer as string;
      const cachedFollowUps = (semanticRow.follow_ups ?? []) as string[];

      supabase.rpc('increment_qa_cache_hit', { p_hash: cacheKey }).then(({ error }) => {
        if (error) console.warn(`[/api/ask] cache_hit_increment_error err=${error.message}`);
      });

      const answerSources = cachedChunks.slice(0, 3).map((c) => ({
        text: c.text.slice(0, 200), speaker: c.speaker, source: c.source,
        score: Math.round(c.score * 100) / 100,
      }));
      let answerId: string | null = null;
      try {
        const { data: ar, error: ae } = await supabase
          .from('qa_answers')
          .insert({ question, answer: cachedAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: cacheKey, ...(userId ? { user_id: userId } : {}) })
          .select('id').single();
        if (ae) console.warn(`[/api/ask] qa_answer_write_error err=${ae.message}`);
        else answerId = ar?.id ?? null;
      } catch (err) {
        console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
      }

      const latencyMs = Date.now() - requestStart;
      const questionHash = createHash('sha256').update(question).digest('hex');
      const fmtMetrics = computeFormatMetrics(cachedAnswer);
      supabase.from('qa_analytics')
        .insert({ question_hash: questionHash, pinecone_scores: [], latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: true, semantic_cache_hit: true, ...fmtMetrics })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

      const updatedHistory = appendTurn(effectiveHistory, question, cachedAnswer);
      supabase.from('conversation_sessions')
        .upsert({ id: conversationId, history: updatedHistory, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, { onConflict: 'id' })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });
      setConversationHistory(conversationId, updatedHistory).catch(() => {});
      supabase.from('qa_conversations')
        .upsert({ id: conversationId, messages: updatedHistory, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) }, { onConflict: 'id' })
        .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_conv_error conv=${conversationId} err=${error.message}`); });

      await tracer.trace('rag.response_send', () => Promise.resolve(), { cached: true, type: 'semantic' });
      return NextResponse.json({
        answer: cachedAnswer, answerId, conversationId, followUps: cachedFollowUps, cached: true,
        sources: cachedChunks.map((c) => ({ text: c.text.slice(0, 200), speaker: c.speaker, source: c.source, score: Math.round(c.score * 100) / 100, chunkId: c.chunkId ?? computeChunkId(c.source, c.text) })),
        ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
        ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
        ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
      }, { headers: dailyRlHeaders });
    }
  }

  // ── Query expansion for short/abstract queries (OLU-597 Fix 2) ───────────
  // Single-word or very short queries (≤ 3 words) match conversational fragments
  // rather than substantive chunks. Expand to 3 richer phrasings via GPT-4o, then
  // fuse per-phrasing retrievals with Reciprocal Rank Fusion.
  // Only applies to standalone (non-follow-up) questions without essay/teacher context
  // (follow-ups have richer context already; essay/teacher context changes the query).
  const canExpand = !isFollowUp && !essayCtx && !teacher;
  let queryPhrasings: string[] = [embedInput];
  if (canExpand && shouldExpandQuery(question)) {
    try {
      queryPhrasings = await expandQuery(question, oai);
      console.log(`[/api/ask] query_expansion phrasings=${queryPhrasings.length} q="${question.slice(0, 60)}" ${logCtx}`);
    } catch (expandErr) {
      console.warn(`[/api/ask] query_expansion_failed err=${expandErr instanceof Error ? expandErr.message : String(expandErr)}`);
      queryPhrasings = [embedInput];
    }
  }

  // Embed all phrasings (batch call when >1; falls back to already-computed queryVector for single)
  let queryVectors: number[][];
  if (queryPhrasings.length === 1) {
    queryVectors = [queryVector];
  } else {
    try {
      queryVectors = await embedBatch(queryPhrasings, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai });
    } catch (batchEmbedErr) {
      console.warn(`[/api/ask] batch_embed_failed err=${batchEmbedErr instanceof Error ? batchEmbedErr.message : String(batchEmbedErr)}`);
      queryVectors = [queryVector];
    }
  }

  // ── Retrieve from Pinecone (dual-namespace, per phrasing) ─────────────────
  // Query both raw and summary namespaces in parallel, then merge by chunk text.
  // Summary vectors capture semantic meaning; raw vectors capture exact terminology.
  type PineconeMatch = { id: string; score?: number; metadata?: Record<string, string> };
  // When a teacher filter is active, restrict retrieval to that teacher's chunks only.
  const pineconeFilter = teacher ? { speaker: { $eq: teacher } } : undefined;

  function matchesToChunks(matches: PineconeMatch[]): Array<{ text: string; speaker: string; source: string; score: number; chunkId: string }> {
    const map = new Map<string, { text: string; speaker: string; source: string; score: number; chunkId: string }>();
    for (const m of matches) {
      const meta = m.metadata ?? {};
      const text = meta.text ?? '';
      if (!text || (m.score ?? 0) < 0.4) continue;
      const existing = map.get(text);
      if (!existing || (m.score ?? 0) > existing.score) {
        const source = meta.source_file ?? '';
        map.set(text, { text, speaker: meta.speaker ?? '', source, score: m.score ?? 0, chunkId: computeChunkId(source, text) });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.score - a.score);
  }

  const perPhrasingChunks: Array<Array<{ text: string; speaker: string; source: string; score: number; chunkId: string }>> = [];

  try {
    await tracer.trace('rag.vector_search', async () => {
      const index = pc.Index(pineconeIndex);

      for (const vec of queryVectors) {
        const [rawResults, summaryResults] = await Promise.all([
          index.namespace(PINECONE_NAMESPACE).query({
            vector: vec,
            topK: TOP_K,
            includeMetadata: true,
            ...(pineconeFilter ? { filter: pineconeFilter } : {}),
          }),
          index.namespace(PINECONE_SUMMARY_NAMESPACE).query({
            vector: vec,
            topK: TOP_K,
            includeMetadata: true,
            ...(pineconeFilter ? { filter: pineconeFilter } : {}),
          }).catch(() => ({ matches: [] })), // graceful fallback if namespace empty
        ]);

        const rawMatches = (rawResults.matches ?? []) as PineconeMatch[];
        const summaryMatches = (summaryResults.matches ?? []) as PineconeMatch[];

        // ── Fallback: primary namespace empty → query __default__ ───────────
        if (rawMatches.length === 0 && summaryMatches.length === 0 && !pineconeFilter) {
          try {
            const fallbackResults = await index.namespace('__default__').query({
              vector: vec,
              topK: TOP_K,
              includeMetadata: true,
            });
            const fallbackMatches = (fallbackResults.matches ?? []) as PineconeMatch[];
            if (fallbackMatches.length > 0) {
              console.log(`[/api/ask] fallback_ns_default matches=${fallbackMatches.length} ${logCtx}`);
              perPhrasingChunks.push(matchesToChunks(fallbackMatches));
              continue;
            }
          } catch (fallbackErr) {
            console.warn(`[/api/ask] fallback_ns_failed err=${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
          }
        }

        perPhrasingChunks.push(matchesToChunks([...rawMatches, ...summaryMatches]));
      }
    }, { k: TOP_K, phrasings: queryVectors.length },
    () => ({
      chunk_count: perPhrasingChunks.reduce((s, c) => s + c.length, 0),
      top_score: perPhrasingChunks.flat().sort((a, b) => b.score - a.score)[0]?.score ?? 0,
    }));
  } catch (err) {
    return handlePineconeError(err, logCtx);
  }

  // ── Merge: RRF (multi-phrasing expansion) or direct sort (single phrasing) ─
  const allChunks = queryVectors.length > 1 && perPhrasingChunks.length > 1
    ? reciprocalRankFusion(perPhrasingChunks)
    : (perPhrasingChunks[0] ?? []);

  // ── Feedback score re-ranking boost ───────────────────────────────────────
  // Multiply each chunk's retrieval score by (1 + 0.1 * feedback_score) using
  // aggregated citation_feedback signals. Fire-and-forget: skip silently on DB
  // error so retrieval is never blocked by a feedback lookup failure.
  if (allChunks.length > 0) {
    try {
      const chunkIds = allChunks.map((c) => c.chunkId).filter((id): id is string => !!id);
      const { data: feedbackRows } = await supabase
        .from('corpus_chunks')
        .select('chunk_id, feedback_score')
        .in('chunk_id', chunkIds);
      if (feedbackRows && feedbackRows.length > 0) {
        const scoreMap = new Map(
          (feedbackRows as Array<{ chunk_id: string; feedback_score: number }>).map(
            (r) => [r.chunk_id, r.feedback_score],
          ),
        );
        for (const c of allChunks) {
          const fScore = scoreMap.get(c.chunkId ?? '') ?? 0;
          if (fScore !== 0) c.score = c.score * (1 + 0.1 * fScore);
        }
        allChunks.sort((a, b) => b.score - a.score);
      }
    } catch (fbErr) {
      console.warn(`[/api/ask] feedback_score_lookup_failed err=${fbErr instanceof Error ? fbErr.message : String(fbErr)}`);
    }
  }

  // ── Cohere re-ranking ─────────────────────────────────────────────────────
  // If COHERE_API_KEY is set, re-rank the broad retrieval set and keep top N.
  // Falls back to cosine-score order if the key is absent or the call fails.
  const cohereKey = process.env.COHERE_API_KEY;
  let chunks: typeof allChunks;
  if (cohereKey && allChunks.length > RERANK_TOP_N) {
    try {
      chunks = await tracer.trace('rag.cohere_rerank', async () => {
        const cohere = new CohereClient({ token: cohereKey });
        const rerankResult = await cohere.rerank({
          model: 'rerank-v3.5',
          query: question,
          documents: allChunks.map((c) => ({ text: c.text })),
          topN: RERANK_TOP_N,
          returnDocuments: false,
        });
        return rerankResult.results.map((r) => ({
          ...allChunks[r.index],
          score: r.relevanceScore,
        }));
      }, { input_count: allChunks.length, top_n: RERANK_TOP_N });
      console.log(`[/api/ask] reranked ${allChunks.length} → ${chunks.length} chunks ${logCtx}`);
    } catch (err) {
      console.warn(`[/api/ask] rerank_failed fallback to cosine err=${err instanceof Error ? err.message : String(err)}`);
      chunks = allChunks.slice(0, RERANK_TOP_N);
    }
  } else {
    chunks = allChunks.slice(0, RERANK_TOP_N);
  }

  // ── Build context ─────────────────────────────────────────────────────────
  const context = chunks.length > 0
    ? chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')
    : null;

  // ── Concept graph augmentation (OLU-443, OLU-603) ────────────────────────
  // Retrieves related concepts from the knowledge graph for prompt augmentation
  // and for surfacing in the API response. Fails gracefully — never blocks the
  // response.
  const conceptContext = await getConceptContext(supabase, queryVector).catch(() => []);

  const conceptPreamble = (() => {
    const sections = conceptContext.flatMap(({ concept, teachers }) => {
      if (teachers.length === 0) return [];
      const lines = teachers.map((t) => `  - ${t.teacher}: "${t.summary}"`).join('\n');
      return [`Concept: "${concept.name}"\n${lines}`];
    });
    return sections.length > 0 ? `[Cross-teacher context]\n${sections.join('\n\n')}` : null;
  })();

  const relatedConcepts = conceptContext.map(({ concept }) => ({
    name: concept.name,
    definition_excerpt: concept.description ?? null,
    url: `/glossary/${concept.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`,
  }));

  const priorMessages = effectiveHistory.slice(-6).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const userContent = (() => {
    const parts: string[] = [];
    if (conceptPreamble) parts.push(conceptPreamble);
    if (essayCtx) {
      const essayBody = essayCtx.bodyMarkdown.slice(0, 2000);
      parts.push(`[Essay context: ${essayCtx.title}\n${essayBody}]`);
    }
    if (context) parts.push(`Transcript excerpts from our archive:\n\n${context}`);
    parts.push(`Question: ${question}`);
    return parts.join('\n\n');
  })();

  // Shared sources payloads (built once, used in both paths)
  // chunkId is included so clients can reference specific chunks when submitting
  // feedback via POST /api/qa/feedback.
  const sourcesPayload = chunks.map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
    chunkId: c.chunkId ?? computeChunkId(c.source, c.text),
  }));

  const answerSources = chunks.slice(0, 3).map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
    chunkId: c.chunkId ?? computeChunkId(c.source, c.text),
  }));

  // Shared follow-up messages (same input for both paths)
  const followUpMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content:
        'You generate follow-up questions for a mindfulness Q&A. Return exactly 3 short, distinct questions a curious reader might ask next. Output only a JSON array of strings, no other text.',
    },
    { role: 'user', content: `Original question: ${question}\n\nAnswer summary: ${userContent.slice(0, 400)}` },
  ];

  // ── Branch: streaming (default) vs non-streaming (?stream=false) ──────────
  const streamMode = req.nextUrl.searchParams.get('stream') !== 'false';

  // ============================================================
  // NON-STREAMING FALLBACK
  // ============================================================
  if (!streamMode) {
    // ── Redis answer cache check ───────────────────────────────────────────
    // Key combines the normalised question with the top-3 chunk fingerprints so
    // an answer is only reused when both the query and retrieved context match.
    // Skip for follow-ups, filtered queries, and any bypass condition already
    // captured by noCacheParam (pro users, teacher filter, essay context, etc.).
    const redisAnswerKey = buildAnswerCacheKey(question, chunks);
    if (!noCacheParam && !isFollowUp) {
      const redisHit = await getAnswerCache(redisAnswerKey);
      if (redisHit) {
        console.log(`[/api/ask] redis_answer_cache_hit ${logCtx}`);
        const { answer: cachedAnswer, followUps: cachedFollowUps, chunks: cachedChunks } = redisHit;
        const latencyMs = Date.now() - requestStart;
        const questionHash = createHash('sha256').update(question).digest('hex');
        const fmtMetrics = computeFormatMetrics(cachedAnswer);

        supabase.from('qa_analytics')
          .insert({ question_hash: questionHash, pinecone_scores: chunks.slice(0, 3).map((c) => c.score), latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: true, semantic_cache_hit: false, ...fmtMetrics })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

        const hitSources = cachedChunks.slice(0, 3).map((c) => ({
          text: c.text.slice(0, 200), speaker: c.speaker, source: c.source,
          score: Math.round(c.score * 100) / 100,
          chunkId: c.chunkId ?? computeChunkId(c.source, c.text),
        }));
        let answerId: string | null = null;
        try {
          const { data: ar, error: ae } = await supabase
            .from('qa_answers')
            .insert({ question, answer: cachedAnswer, sources: hitSources, conversation_id: conversationId, cache_hash: redisAnswerKey, ...(userId ? { user_id: userId } : {}) })
            .select('id').single();
          if (ae) console.warn(`[/api/ask] qa_answer_write_error err=${ae.message}`);
          else answerId = ar?.id ?? null;
        } catch (err) {
          console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
        }

        const updatedHistory = appendTurn(effectiveHistory, question, cachedAnswer);
        const sessionTitle = updatedHistory.find((m) => m.role === 'user')?.content.slice(0, 120) ?? question.slice(0, 120);
        supabase.from('conversation_sessions')
          .upsert({ id: conversationId, history: updatedHistory, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(), updated_at: new Date().toISOString(), message_count: updatedHistory.length, ...(userId ? { user_id: userId } : {}), ...(isExistingConversation ? {} : { title: sessionTitle }) }, { onConflict: 'id' })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });
        setConversationHistory(conversationId, updatedHistory).catch(() => {});
        supabase.from('qa_conversations')
          .upsert({ id: conversationId, messages: updatedHistory, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) }, { onConflict: 'id' })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_conv_error conv=${conversationId} err=${error.message}`); });

        await tracer.trace('rag.response_send', () => Promise.resolve(), { cached: true, type: 'redis' });
        return NextResponse.json({
          answer: cachedAnswer, answerId, conversationId, followUps: cachedFollowUps, cached: true,
          sources: cachedChunks.map((c) => ({ text: c.text.slice(0, 200), speaker: c.speaker, source: c.source, score: Math.round(c.score * 100) / 100, chunkId: c.chunkId ?? computeChunkId(c.source, c.text) })),
          related_concepts: relatedConcepts,
          ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
          ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
          ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
        }, { headers: { ...dailyRlHeaders, 'X-Cache': 'HIT' } });
      }
    }

    let answer: string;
    let followUps: string[] = [];
    try {
      const [chatResp, followUpsResp] = await Promise.all([
        tracer.trace('rag.llm_call', () =>
          oai.chat.completions.create({
            model: CHAT_MODEL,
            messages: [
              { role: 'system', content: activeSystemPrompt },
              ...priorMessages,
              { role: 'user', content: userContent },
            ],
            temperature: 0.5,
            max_tokens: 600,
          }),
          { 'llm.model': CHAT_MODEL },
          (resp) => ({
            'llm.prompt_tokens': resp.usage?.prompt_tokens ?? 0,
            'llm.completion_tokens': resp.usage?.completion_tokens ?? 0,
          }),
        ),
        oai.chat.completions.create({
          model: CHAT_MODEL,
          messages: followUpMessages,
          temperature: 0.7,
          max_tokens: 150,
        }),
      ]);
      logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: chatResp.usage?.prompt_tokens ?? 0, completionTokens: chatResp.usage?.completion_tokens ?? 0, cachedTokens: chatResp.usage?.prompt_tokens_details?.cached_tokens ?? 0 });
      logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: followUpsResp.usage?.prompt_tokens ?? 0, completionTokens: followUpsResp.usage?.completion_tokens ?? 0, cachedTokens: followUpsResp.usage?.prompt_tokens_details?.cached_tokens ?? 0 });
      answer = chatResp.choices[0]?.message?.content ?? '';
      try {
        const raw = followUpsResp.choices[0]?.message?.content ?? '[]';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) followUps = parsed.slice(0, 3).map(String);
      } catch {
        // Follow-ups are non-critical
      }
    } catch (err) {
      return handleOpenAIError(err, 'chat', logCtx);
    }

    const latencyMs = Date.now() - requestStart;
    const questionHash = createHash('sha256').update(question).digest('hex');
    const pineconeScores = chunks.slice(0, 3).map((c) => c.score);
    const fmtMetrics = computeFormatMetrics(answer);

    // Log structured spans and persist timing to qa_metrics (fire-and-forget)
    tracer.log(logCtx);
    const ragSpans = tracer.summarize();
    supabase
      .from('qa_metrics')
      .insert({ question_hash: questionHash, conversation_id: conversationId, embed_ms: ragSpans.embed_ms, retrieve_ms: ragSpans.retrieve_ms, rerank_ms: ragSpans.rerank_ms, generate_ms: ragSpans.generate_ms, total_ms: ragSpans.total_ms })
      .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_metrics_write_error err=${error.message}`); });

    supabase
      .from('qa_analytics')
      .insert({ question_hash: questionHash, pinecone_scores: pineconeScores, latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: false, semantic_cache_hit: false, ...fmtMetrics })
      .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

    // Cache write on miss (standalone questions only, no teacher/essay filter, fire-and-forget)
    if (!isFollowUp && !teacher && !essaySlug) {
      const pineconeTop1Score = chunks[0]?.score ?? null;
      supabase
        .from('qa_cache')
        .insert({ hash: cacheKey, question, answer, follow_ups: followUps, chunks_json: chunks, question_embedding: queryVector, pinecone_top1_score: pineconeTop1Score })
        .then(({ error }) => {
          if (error && error.code !== '23505') {
            console.warn(`[/api/ask] cache_write_error err=${error.message}`);
          }
        });
      // Redis answer cache write — 1hr TTL, faster than Supabase for repeat queries
      setAnswerCache(redisAnswerKey, { answer, followUps, chunks }).catch(() => {});
    }

    let answerId: string | null = null;
    try {
      const { data: answerRow, error: answerError } = await supabase
        .from('qa_answers')
        .insert({ question, answer, sources: answerSources, conversation_id: conversationId, cache_hash: isFollowUp ? null : cacheKey, ...(userId ? { user_id: userId } : {}) })
        .select('id')
        .single();
      if (answerError) {
        console.warn(`[/api/ask] qa_answer_write_error err=${answerError.message}`);
      } else {
        answerId = answerRow?.id ?? null;
      }
    } catch (err) {
      console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
    }

    const updatedHistory = appendTurn(effectiveHistory, question, answer);
    const sessionTitle = updatedHistory.find((m) => m.role === 'user')?.content.slice(0, 120) ?? question.slice(0, 120);
    supabase
      .from('conversation_sessions')
      .upsert({
        id: conversationId,
        history: updatedHistory,
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
        updated_at: new Date().toISOString(),
        message_count: updatedHistory.length,
        ...(userId ? { user_id: userId } : {}),
        ...(isExistingConversation ? {} : { title: sessionTitle }),
      }, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });
    setConversationHistory(conversationId, updatedHistory).catch(() => {});
    supabase.from('qa_conversations')
      .upsert({ id: conversationId, messages: updatedHistory, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) }, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_conv_error conv=${conversationId} err=${error.message}`); });

    await tracer.trace('rag.response_send', () => Promise.resolve(), { cached: false, streaming: false });
    return NextResponse.json({
      answer,
      answerId,
      conversationId,
      followUps,
      sources: sourcesPayload,
      related_concepts: relatedConcepts,
      cached: false,
      ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
      ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
      ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
    }, { headers: { ...dailyRlHeaders, 'X-Cache': 'MISS' } });
  }

  // ============================================================
  // STREAMING PATH (SSE)
  // ============================================================

  // Fire follow-up questions in parallel — input doesn't depend on the answer text,
  // only on the question + context which we already have.
  const followUpsPromise: Promise<string[]> = oai.chat.completions
    .create({ model: CHAT_MODEL, messages: followUpMessages, temperature: 0.7, max_tokens: 150 })
    .then((r) => {
      logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: r.usage?.prompt_tokens ?? 0, completionTokens: r.usage?.completion_tokens ?? 0, cachedTokens: r.usage?.prompt_tokens_details?.cached_tokens ?? 0 });
      try {
        const raw = r.choices[0]?.message?.content ?? '[]';
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.slice(0, 3).map(String);
      } catch { /* non-critical */ }
      return [];
    })
    .catch(() => []);

  const encoder = new TextEncoder();
  const sseEvent = (data: object) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  let streamAbortController: AbortController | undefined;

  const readableStream = new ReadableStream({
    async start(controller) {
      streamAbortController = new AbortController();
      try {
        let fullAnswer = '';
        const generateStart = Date.now();

        const chatStream = await oai.chat.completions.create(
          {
            model: CHAT_MODEL,
            messages: [
              { role: 'system', content: activeSystemPrompt },
              ...priorMessages,
              { role: 'user', content: userContent },
            ],
            temperature: 0.5,
            max_tokens: 600,
            stream: true,
            stream_options: { include_usage: true },
          },
          { signal: streamAbortController.signal },
        );

        let streamUsage: { prompt_tokens: number; completion_tokens: number } | null = null;
        for await (const chunk of chatStream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            fullAnswer += delta;
            controller.enqueue(sseEvent({ delta }));
          }
          if (chunk.usage) {
            logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0 });
            streamUsage = { prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens };
          }
        }

        tracer.recordGenerateSpan(Date.now() - generateStart, {
          'llm.model': CHAT_MODEL,
          'llm.prompt_tokens': streamUsage?.prompt_tokens ?? 0,
          'llm.completion_tokens': streamUsage?.completion_tokens ?? 0,
        });

        // Main stream complete — follow-ups should be ready by now
        const followUps = await followUpsPromise;

        // Log structured spans and persist timing to qa_metrics (fire-and-forget)
        tracer.log(logCtx);
        const ragSpans = tracer.summarize();
        const questionHash = createHash('sha256').update(question).digest('hex');
        supabase
          .from('qa_metrics')
          .insert({ question_hash: questionHash, conversation_id: conversationId, embed_ms: ragSpans.embed_ms, retrieve_ms: ragSpans.retrieve_ms, rerank_ms: ragSpans.rerank_ms, generate_ms: ragSpans.generate_ms, total_ms: ragSpans.total_ms })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_metrics_write_error err=${error.message}`); });

        // Analytics (fire and forget)
        const latencyMs = Date.now() - requestStart;
        const pineconeScores = chunks.slice(0, 3).map((c) => c.score);
        const fmtMetrics = computeFormatMetrics(fullAnswer);
        supabase
          .from('qa_analytics')
          .insert({ question_hash: questionHash, pinecone_scores: pineconeScores, latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: false, semantic_cache_hit: false, ...fmtMetrics })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

        // Cache write on miss (standalone questions only, no teacher filter, fire-and-forget)
        if (!isFollowUp && !teacher) {
          const pineconeTop1Score = chunks[0]?.score ?? null;
          supabase
            .from('qa_cache')
            .insert({ hash: cacheKey, question, answer: fullAnswer, follow_ups: followUps, chunks_json: chunks, question_embedding: queryVector, pinecone_top1_score: pineconeTop1Score })
            .then(({ error }) => {
              if (error && error.code !== '23505') {
                console.warn(`[/api/ask] cache_write_error err=${error.message}`);
              }
            });
        }

        // Persist answer to get shareable answerId
        let answerId: string | null = null;
        try {
          const { data: answerRow, error: answerError } = await supabase
            .from('qa_answers')
            .insert({ question, answer: fullAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: isFollowUp ? null : cacheKey, ...(userId ? { user_id: userId } : {}) })
            .select('id')
            .single();
          if (answerError) {
            console.warn(`[/api/ask] qa_answer_write_error err=${answerError.message}`);
          } else {
            answerId = answerRow?.id ?? null;
          }
        } catch (err) {
          console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
        }

        // Persist conversation session (fire and forget)
        const updatedHistory = appendTurn(effectiveHistory, question, fullAnswer);
        const sessionTitle = updatedHistory.find((m) => m.role === 'user')?.content.slice(0, 120) ?? question.slice(0, 120);
        supabase
          .from('conversation_sessions')
          .upsert(
            {
              id: conversationId,
              history: updatedHistory,
              expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
              updated_at: new Date().toISOString(),
              message_count: updatedHistory.length,
              ...(userId ? { user_id: userId } : {}),
              ...(isExistingConversation ? {} : { title: sessionTitle }),
            },
            { onConflict: 'id' },
          )
          .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });
        setConversationHistory(conversationId, updatedHistory).catch(() => {});
        supabase.from('qa_conversations')
          .upsert({ id: conversationId, messages: updatedHistory, updated_at: new Date().toISOString(), ...(userId ? { user_id: userId } : {}) }, { onConflict: 'id' })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] qa_conv_error conv=${conversationId} err=${error.message}`); });

        // Send done event with all metadata
        await tracer.trace('rag.response_send', () => Promise.resolve(), { cached: false, streaming: true });
        controller.enqueue(
          sseEvent({
            done: true,
            conversationId,
            answerId,
            followUps,
            sources: sourcesPayload,
            related_concepts: relatedConcepts,
            cached: false,
            ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
            ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
            ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
          }),
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          console.log(`[/api/ask] stream_aborted ${logCtx}`);
        } else {
          Sentry.withScope((scope) => { scope.setTag('rag.stage', 'llm_call'); scope.setTag('rag.path', 'streaming'); Sentry.captureException(err); });
          const userMsg =
            err instanceof OpenAIRateLimitError
              ? 'AI service is temporarily over capacity. Please try again shortly.'
              : err instanceof APIConnectionTimeoutError
                ? 'AI service did not respond in time. Please try again.'
                : err instanceof APIConnectionError
                  ? 'Could not reach AI service. Please try again.'
                  : 'An error occurred while generating the response.';
          console.error(`[/api/ask] stream_error ${logCtx} err=${err instanceof Error ? err.message : String(err)}`);
          try {
            controller.enqueue(sseEvent({ error: userMsg }));
          } catch { /* stream may already be closing */ }
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() {
      streamAbortController?.abort();
      console.log(`[/api/ask] stream_cancelled ${logCtx}`);
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...dailyRlHeaders,
    },
  });
}

// ── Error handlers ─────────────────────────────────────────────────────────

function handleOpenAIError(err: unknown, stage: string, logCtx: string): NextResponse {
  if (err instanceof OpenAIRateLimitError) {
    console.warn(`[/api/ask] openai_rate_limit stage=${stage} ${logCtx}`);
    return errorResponse(503, 'UPSTREAM_RATE_LIMITED', 'AI service is temporarily over capacity. Please try again shortly.');
  }
  if (err instanceof APIConnectionTimeoutError) {
    console.error(`[/api/ask] openai_timeout stage=${stage} ${logCtx}`);
    Sentry.withScope((scope) => { scope.setTag('rag.stage', stage); Sentry.captureException(err); });
    return errorResponse(504, 'UPSTREAM_TIMEOUT', 'AI service did not respond in time. Please try again.');
  }
  if (err instanceof APIConnectionError) {
    console.error(`[/api/ask] openai_connection_error stage=${stage} ${logCtx}`);
    Sentry.withScope((scope) => { scope.setTag('rag.stage', stage); Sentry.captureException(err); });
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'Could not reach AI service. Please try again.');
  }
  if (err instanceof OpenAIAuthError) {
    console.error(`[/api/ask] openai_auth_error stage=${stage} ${logCtx}`);
    Sentry.withScope((scope) => { scope.setTag('rag.stage', stage); Sentry.captureException(err); });
    return errorResponse(503, 'SERVICE_MISCONFIGURED', 'AI service authentication failed. Contact the administrator.');
  }
  if (err instanceof OpenAIServerError) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/ask] openai_server_error stage=${stage} ${logCtx} err=${msg}`);
    Sentry.withScope((scope) => { scope.setTag('rag.stage', stage); Sentry.captureException(err); });
    return errorResponse(502, 'UPSTREAM_ERROR', 'AI service encountered an error. Please try again.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[/api/ask] openai_unknown stage=${stage} ${logCtx} err=${msg}`);
  Sentry.withScope((scope) => { scope.setTag('rag.stage', stage); Sentry.captureException(err); });
  return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

function handlePineconeError(err: unknown, logCtx: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  Sentry.withScope((scope) => { scope.setTag('rag.stage', 'vector_search'); Sentry.captureException(err); });

  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    console.error(`[/api/ask] pinecone_timeout ${logCtx} err=${msg}`);
    return errorResponse(504, 'RETRIEVAL_TIMEOUT', 'Knowledge base did not respond in time. Please try again.');
  }
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('network')) {
    console.error(`[/api/ask] pinecone_connection_error ${logCtx} err=${msg}`);
    return errorResponse(502, 'RETRIEVAL_UNAVAILABLE', 'Could not reach knowledge base. Please try again.');
  }
  if (lower.includes('not found') || lower.includes('index')) {
    console.error(`[/api/ask] pinecone_index_error ${logCtx} err=${msg}`);
    return errorResponse(503, 'RETRIEVAL_MISCONFIGURED', 'Knowledge base index not found. Contact the administrator.');
  }
  console.error(`[/api/ask] pinecone_error ${logCtx} err=${msg}`);
  return errorResponse(502, 'RETRIEVAL_ERROR', 'Knowledge base encountered an error. Please try again.');
}
