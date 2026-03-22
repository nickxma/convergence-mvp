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
import { checkRateLimitWithFallback, getClientIp, isInternalRequest, MINUTE_MS } from '@/lib/rate-limit';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import { getUserSubscription, incrementUserQaUsage, FREE_TIER_DAILY_LIMIT } from '@/lib/subscription';
import { isValidConversationId, buildQueryText, appendTurn } from '@/lib/conversation-session';
import type { HistoryMessage } from '@/lib/conversation-session';
import { monitoredQuery } from '@/lib/db-monitor';
import { logOpenAIUsage } from '@/lib/openai-usage';
import { embedOne } from '@/lib/embeddings';
import { buildConceptPreamble } from '@/lib/concept-graph';

const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIMENSIONS = 1536;
const CHAT_MODEL = 'gpt-4o-mini';
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
}

const SYSTEM_PROMPT = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, non-dual awareness, and contemplative traditions.
Answer any question with your full knowledge — mindfulness, psychology, neuroscience, philosophy of mind, contemplative practice. When transcript excerpts are provided, weave their insights naturally into your answer as enrichment.
Rules:
- Keep answers concise: 2-4 short paragraphs max. No walls of text.
- Be warm, direct, and conversational — like a wise friend, not a textbook.
- Never name specific teachers, authors, or brands. Refer to "teachers in this tradition" or "contemplative traditions" instead.
- Never refuse to answer. If excerpts are sparse, rely on your own knowledge.
- No numbered lists or academic structure unless the user asks for it.`;

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
  const ip = getClientIp(req);

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

  // ── Guest rate limit ──────────────────────────────────────────────────────
  // Referred visitors (those with a `ref` cookie) get 5 free questions instead of 3.
  let guestQueriesRemaining: number | null = null;
  if (!userId) {
    const hasRefCookie = Boolean(req.cookies.get('ref')?.value?.trim());
    const effectiveGuestLimit = hasRefCookie ? REFERRED_GUEST_LIMIT : GUEST_LIMIT;
    const ipHash = createHash('sha256').update(ip).digest('hex');
    const { data: newCount, error: guestError } = await supabase.rpc('increment_guest_usage', { p_ip_hash: ipHash });
    if (guestError) {
      console.warn(`[/api/ask] guest_usage_error ip=${ip} err=${guestError.message}`);
      // Fail open — allow the request if usage tracking fails
    } else {
      const count = newCount as number;
      if (count > effectiveGuestLimit) {
        return NextResponse.json(
          { error: 'guest_limit_reached', message: 'Connect your wallet for unlimited questions' },
          { status: 402 },
        );
      }
      guestQueriesRemaining = effectiveGuestLimit - count;
    }
  }

  // ── Free-tier authenticated user daily limit ──────────────────────────────
  // Pro/team users bypass this; free users are capped at FREE_TIER_DAILY_LIMIT/day.
  let userQuestionsRemaining: number | null = null;
  let isProUser = false;
  if (userId && !isInternalRequest(req)) {
    const sub = await getUserSubscription(userId);
    isProUser = sub.tier === 'pro' || sub.tier === 'team';
    if (!isProUser) {
      const count = await incrementUserQaUsage(userId);
      if (count > FREE_TIER_DAILY_LIMIT) {
        return NextResponse.json(
          {
            error: 'tier_limit_reached',
            message: `You've used all ${FREE_TIER_DAILY_LIMIT} free questions today. Upgrade to Pro for unlimited access.`,
            questionsLimit: FREE_TIER_DAILY_LIMIT,
          },
          { status: 402 },
        );
      }
      userQuestionsRemaining = FREE_TIER_DAILY_LIMIT - count;
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
  let effectiveHistory = history;
  if (isExistingConversation && history.length === 0) {
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

  // ── Cache flags ───────────────────────────────────────────────────────────
  // Semantic threshold from env; default 0.92.
  const semanticThreshold = parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD ?? '0.92');
  // Cache key: SHA-256 of lowercased+trimmed question (independent of questionHash in analytics).
  const cacheKey = createHash('sha256').update(question.toLowerCase()).digest('hex');
  // Pro users always get fresh answers (bypass semantic cache).
  const noCacheParam = req.nextUrl.searchParams.get('noCache') === '1' || isProUser;
  // Only cache standalone (first-turn) questions. Follow-ups depend on conversation
  // context, so caching them would return mismatched answers.
  const isFollowUp = effectiveHistory.length > 0;

  // ── Exact-hash cache lookup ───────────────────────────────────────────────
  if (!noCacheParam && !isFollowUp) {
    try {
      const { data: exact } = await supabase
        .from('qa_cache')
        .select('answer, follow_ups, chunks_json')
        .eq('hash', cacheKey)
        .gt('created_at', new Date(Date.now() - CACHE_TTL_MS).toISOString())
        .single();

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
            .insert({ question, answer: cachedAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: cacheKey })
            .select('id').single();
          if (ae) console.warn(`[/api/ask] qa_answer_write_error err=${ae.message}`);
          else answerId = ar?.id ?? null;
        } catch (err) {
          console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
        }

        const latencyMs = Date.now() - requestStart;
        const questionHash = createHash('sha256').update(question).digest('hex');
        supabase.from('qa_analytics')
          .insert({ question_hash: questionHash, pinecone_scores: [], latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: true, semantic_cache_hit: false })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

        const updatedHistory = appendTurn(effectiveHistory, question, cachedAnswer);
        supabase.from('conversation_sessions')
          .upsert({ id: conversationId, history: updatedHistory, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, { onConflict: 'id' })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });

        return NextResponse.json({
          answer: cachedAnswer, answerId, conversationId, followUps: cachedFollowUps, cached: true,
          sources: cachedChunks.map((c) => ({ text: c.text.slice(0, 200), speaker: c.speaker, source: c.source, score: Math.round(c.score * 100) / 100 })),
          ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
          ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
          ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
        });
      }
    } catch {
      // Non-fatal — fall through to live path
    }
  }

  // ── Embed ─────────────────────────────────────────────────────────────────
  // For standalone questions (no history): embed the raw question.
  //   - Used for semantic cache search AND as the Pinecone query vector (they're equivalent
  //     since buildQueryText returns the question unchanged when history is empty).
  // For follow-ups: embed queryText (question + last assistant turn) for Pinecone only.
  const queryText = buildQueryText(question, effectiveHistory);
  const embedInput = isFollowUp ? queryText : question;

  let queryVector: number[];
  try {
    queryVector = await embedOne(embedInput, { model: EMBED_MODEL, dimensions: EMBED_DIMENSIONS, client: oai });
  } catch (err) {
    return handleOpenAIError(err, 'embeddings', logCtx);
  }

  // ── Semantic cache lookup ─────────────────────────────────────────────────
  if (!noCacheParam && !isFollowUp) {
    try {
      const { data: semanticRows } = await monitoredQuery('qa_cache.semantic_lookup', () =>
        supabase.rpc('match_qa_cache', {
          query_embedding: queryVector,
          match_threshold: semanticThreshold,
          match_count: 1,
        }),
      );

      const semanticRow = Array.isArray(semanticRows) ? semanticRows[0] : null;
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
            .insert({ question, answer: cachedAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: cacheKey })
            .select('id').single();
          if (ae) console.warn(`[/api/ask] qa_answer_write_error err=${ae.message}`);
          else answerId = ar?.id ?? null;
        } catch (err) {
          console.warn(`[/api/ask] qa_answer_exception err=${err instanceof Error ? err.message : String(err)}`);
        }

        const latencyMs = Date.now() - requestStart;
        const questionHash = createHash('sha256').update(question).digest('hex');
        supabase.from('qa_analytics')
          .insert({ question_hash: questionHash, pinecone_scores: [], latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: true, semantic_cache_hit: true })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

        const updatedHistory = appendTurn(effectiveHistory, question, cachedAnswer);
        supabase.from('conversation_sessions')
          .upsert({ id: conversationId, history: updatedHistory, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() }, { onConflict: 'id' })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`); });

        return NextResponse.json({
          answer: cachedAnswer, answerId, conversationId, followUps: cachedFollowUps, cached: true,
          sources: cachedChunks.map((c) => ({ text: c.text.slice(0, 200), speaker: c.speaker, source: c.source, score: Math.round(c.score * 100) / 100 })),
          ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
          ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
          ...(userQuestionsRemaining !== null ? { userQuestionsRemaining } : {}),
        });
      }
    } catch {
      // Non-fatal — fall through to live path
    }
  }

  // ── Retrieve from Pinecone (dual-namespace) ───────────────────────────────
  // Query both raw and summary namespaces in parallel, then merge by chunk text.
  // Summary vectors capture semantic meaning; raw vectors capture exact terminology.
  type PineconeMatch = { id: string; score?: number; metadata?: Record<string, string> };
  let rawMatches: PineconeMatch[] = [];
  let summaryMatches: PineconeMatch[] = [];
  try {
    const index = pc.Index(pineconeIndex);
    const [rawResults, summaryResults] = await Promise.all([
      index.namespace(PINECONE_NAMESPACE).query({
        vector: queryVector,
        topK: TOP_K,
        includeMetadata: true,
      }),
      index.namespace(PINECONE_SUMMARY_NAMESPACE).query({
        vector: queryVector,
        topK: TOP_K,
        includeMetadata: true,
      }).catch(() => ({ matches: [] })), // graceful fallback if namespace empty
    ]);
    rawMatches = (rawResults.matches ?? []) as PineconeMatch[];
    summaryMatches = (summaryResults.matches ?? []) as PineconeMatch[];
  } catch (err) {
    return handlePineconeError(err, logCtx);
  }

  // ── Merge and deduplicate chunks ──────────────────────────────────────────
  // Summary matches resolve to their raw chunk text; raw matches are used directly.
  // Deduplicate by chunk text; take the higher score when both namespaces return the same chunk.
  const chunkScores = new Map<string, { text: string; speaker: string; source: string; score: number }>();

  for (const m of rawMatches) {
    const meta = m.metadata ?? {};
    const text = meta.text ?? '';
    if (!text || (m.score ?? 0) < 0.4) continue;
    const existing = chunkScores.get(text);
    if (!existing || (m.score ?? 0) > existing.score) {
      chunkScores.set(text, { text, speaker: meta.speaker ?? '', source: meta.source_file ?? '', score: m.score ?? 0 });
    }
  }

  for (const m of summaryMatches) {
    const meta = m.metadata ?? {};
    // Summary records carry the full raw chunk text in their metadata
    const text = meta.text ?? '';
    if (!text || (m.score ?? 0) < 0.4) continue;
    const existing = chunkScores.get(text);
    if (!existing || (m.score ?? 0) > existing.score) {
      chunkScores.set(text, { text, speaker: meta.speaker ?? '', source: meta.source_file ?? '', score: m.score ?? 0 });
    }
  }

  const allChunks = Array.from(chunkScores.values())
    .sort((a, b) => b.score - a.score);

  // ── Cohere re-ranking ─────────────────────────────────────────────────────
  // If COHERE_API_KEY is set, re-rank the broad retrieval set and keep top N.
  // Falls back to cosine-score order if the key is absent or the call fails.
  const cohereKey = process.env.COHERE_API_KEY;
  let chunks: typeof allChunks;
  if (cohereKey && allChunks.length > RERANK_TOP_N) {
    try {
      const cohere = new CohereClient({ token: cohereKey });
      const rerankResult = await cohere.rerank({
        model: 'rerank-v3.5',
        query: question,
        documents: allChunks.map((c) => ({ text: c.text })),
        topN: RERANK_TOP_N,
        returnDocuments: false,
      });
      chunks = rerankResult.results.map((r) => ({
        ...allChunks[r.index],
        score: r.relevanceScore,
      }));
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

  // ── Concept graph augmentation (OLU-443) ──────────────────────────────────
  // Adds a cross-teacher concept preamble when the concept graph is populated.
  // Fails gracefully — never blocks the response.
  const conceptPreamble = await buildConceptPreamble(supabase, queryVector).catch(() => null);

  const priorMessages = effectiveHistory.slice(-6).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const userContent = (() => {
    const parts: string[] = [];
    if (conceptPreamble) parts.push(conceptPreamble);
    if (context) parts.push(`Transcript excerpts from our archive:\n\n${context}`);
    parts.push(`Question: ${question}`);
    return parts.join('\n\n');
  })();

  // Shared sources payloads (built once, used in both paths)
  const sourcesPayload = chunks.map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
  }));

  const answerSources = chunks.slice(0, 3).map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
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
    let answer: string;
    let followUps: string[] = [];
    try {
      const [chatResp, followUpsResp] = await Promise.all([
        oai.chat.completions.create({
          model: CHAT_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...priorMessages,
            { role: 'user', content: userContent },
          ],
          temperature: 0.5,
          max_tokens: 600,
        }),
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

    supabase
      .from('qa_analytics')
      .insert({ question_hash: questionHash, pinecone_scores: pineconeScores, latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: false, semantic_cache_hit: false })
      .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

    // Cache write on miss (standalone questions only, fire-and-forget)
    if (!isFollowUp) {
      const pineconeTop1Score = chunks[0]?.score ?? null;
      supabase
        .from('qa_cache')
        .insert({ hash: cacheKey, question, answer, follow_ups: followUps, chunks_json: chunks, question_embedding: queryVector, pinecone_top1_score: pineconeTop1Score })
        .then(({ error }) => {
          if (error && error.code !== '23505') {
            console.warn(`[/api/ask] cache_write_error err=${error.message}`);
          }
        });
    }

    let answerId: string | null = null;
    try {
      const { data: answerRow, error: answerError } = await supabase
        .from('qa_answers')
        .insert({ question, answer, sources: answerSources, conversation_id: conversationId, cache_hash: isFollowUp ? null : cacheKey })
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

    return NextResponse.json({
      answer,
      answerId,
      conversationId,
      followUps,
      sources: sourcesPayload,
      cached: false,
      ...(rl !== null ? { rateLimit: { remaining: rl.remaining, resetAt: new Date(rl.resetAt).toISOString() } } : {}),
      ...(guestQueriesRemaining !== null ? { guestQueriesRemaining } : {}),
    });
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

        const chatStream = await oai.chat.completions.create(
          {
            model: CHAT_MODEL,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
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

        for await (const chunk of chatStream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            fullAnswer += delta;
            controller.enqueue(sseEvent({ delta }));
          }
          if (chunk.usage) {
            logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, cachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0 });
          }
        }

        // Main stream complete — follow-ups should be ready by now
        const followUps = await followUpsPromise;

        // Analytics (fire and forget)
        const latencyMs = Date.now() - requestStart;
        const questionHash = createHash('sha256').update(question).digest('hex');
        const pineconeScores = chunks.slice(0, 3).map((c) => c.score);
        supabase
          .from('qa_analytics')
          .insert({ question_hash: questionHash, pinecone_scores: pineconeScores, latency_ms: latencyMs, model_used: CHAT_MODEL, cache_hit: false, semantic_cache_hit: false })
          .then(({ error }) => { if (error) console.warn(`[/api/ask] analytics_write_error err=${error.message}`); });

        // Cache write on miss (standalone questions only, fire-and-forget)
        if (!isFollowUp) {
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
            .insert({ question, answer: fullAnswer, sources: answerSources, conversation_id: conversationId, cache_hash: isFollowUp ? null : cacheKey })
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

        // Send done event with all metadata
        controller.enqueue(
          sseEvent({
            done: true,
            conversationId,
            answerId,
            followUps,
            sources: sourcesPayload,
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
    return errorResponse(504, 'UPSTREAM_TIMEOUT', 'AI service did not respond in time. Please try again.');
  }
  if (err instanceof APIConnectionError) {
    console.error(`[/api/ask] openai_connection_error stage=${stage} ${logCtx}`);
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'Could not reach AI service. Please try again.');
  }
  if (err instanceof OpenAIAuthError) {
    console.error(`[/api/ask] openai_auth_error stage=${stage} ${logCtx}`);
    return errorResponse(503, 'SERVICE_MISCONFIGURED', 'AI service authentication failed. Contact the administrator.');
  }
  if (err instanceof OpenAIServerError) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/ask] openai_server_error stage=${stage} ${logCtx} err=${msg}`);
    return errorResponse(502, 'UPSTREAM_ERROR', 'AI service encountered an error. Please try again.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[/api/ask] openai_unknown stage=${stage} ${logCtx} err=${msg}`);
  return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

function handlePineconeError(err: unknown, logCtx: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

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
