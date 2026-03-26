import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { streamText, createUIMessageStreamResponse } from 'ai';
import type { UIMessageChunk } from 'ai';
import { openai } from '@ai-sdk/openai';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { CohereClientV2 } from 'cohere-ai';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabase } from '@/lib/supabase';
import { RagTracer } from '@/lib/rag-tracer';
import { isValidConversationId, buildQueryText, appendTurn } from '@/lib/conversation-session';
import type { HistoryMessage } from '@/lib/conversation-session';
import { isCacheEnabled, getSemanticCache, setSemanticCache } from '@/lib/semantic-answer-cache';
import type { CachedSource } from '@/lib/semantic-answer-cache';
import { detectQueryLanguage, translateToEnglish } from '@/lib/language-detection';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o';
const TOP_K = 20;
const RERANK_MODEL = 'rerank-v3.5';
const RERANK_TOP_N = 5;
const SCORE_THRESHOLD = 0.4;

// Authority blending weights (configurable via env vars).
// blendedScore = vectorScore * (1 - w_auth - w_qual)
//              + authorityScore * w_auth
//              + positiveRatioWhenCited * w_qual
const AUTHORITY_WEIGHT = Number(process.env.AUTHORITY_WEIGHT ?? '0.10');
const CITATION_QUALITY_WEIGHT = Number(process.env.CITATION_QUALITY_WEIGHT ?? '0.05');
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const BASE_SYSTEM_PROMPT = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, non-dual awareness, and contemplative traditions.
Answer any question with your full knowledge — mindfulness, psychology, neuroscience, philosophy of mind, contemplative practice. When transcript excerpts are provided, weave their insights naturally into your answer as enrichment.
Rules:
- Keep answers concise: 2-4 short paragraphs max. No walls of text.
- Be warm, direct, and conversational — like a wise friend, not a textbook.
- Never name specific teachers, authors, or brands. Refer to "teachers in this tradition" or "contemplative traditions" instead.
- Never refuse to answer. If excerpts are sparse, rely on your own knowledge.
- No numbered lists or academic structure unless the user asks for it.`;

type PromptVariant = { id: string; name: string; system_prompt: string; traffic_pct: number };

/** Select a variant by weighted random. Returns null if no variants are active / configured. */
function selectVariant(variants: PromptVariant[]): PromptVariant | null {
  const total = variants.reduce((s, v) => s + v.traffic_pct, 0);
  if (total <= 0 || variants.length === 0) return null;
  let rand = Math.random() * total;
  for (const v of variants) {
    rand -= v.traffic_pct;
    if (rand <= 0) return v;
  }
  return variants[variants.length - 1];
}

function buildCacheHitResponse(
  answer: string,
  sources: CachedSource[],
  conversationId: string,
): Response {
  const textId = randomUUID();
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      controller.enqueue({ type: 'text-start', id: textId });
      controller.enqueue({ type: 'text-delta', delta: answer, id: textId });
      controller.enqueue({ type: 'text-end', id: textId });
      controller.enqueue({
        type: 'finish',
        finishReason: 'stop',
        messageMetadata: { sources, conversationId, cached: true } as unknown,
      });
      controller.close();
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isAuthenticated(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ');
}

export async function POST(req: NextRequest) {
  const queryStartMs = Date.now();
  const queryId = randomUUID();

  const ip = getClientIp(req);
  const authenticated = isAuthenticated(req);
  const rateLimit = authenticated ? 60 : 10;
  const rateLimitLabel = authenticated ? 'auth' : 'anon';

  // ── Rate limiting ──
  const rl = checkRateLimit(`ask:${rateLimitLabel}:${ip}`, rateLimit);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests — please wait before trying again.' } }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec),
        },
      },
    );
  }

  // ── Parse body ──
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Support AI SDK format (messages array)
  let question: string;
  let priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const messages = body?.messages as Array<{ role: string; content: string }> | undefined;
  if (Array.isArray(messages) && messages.length > 0) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    question = lastUserMsg?.content?.trim() ?? '';
    priorMessages = messages
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  } else {
    // Legacy format
    question = typeof body?.question === 'string' ? body.question.trim() : '';
    const history: HistoryMessage[] = Array.isArray(body?.history) ? (body.history as HistoryMessage[]) : [];
    priorMessages = history.slice(-6).map((m) => ({ role: m.role, content: m.content }));
  }

  const walletAddress: string | null = typeof body?.walletAddress === 'string' ? body.walletAddress : null;

  const rawConvId = body?.conversationId;
  const isExistingConversation = isValidConversationId(rawConvId);
  const conversationId: string = isExistingConversation ? rawConvId : randomUUID();

  if (!question) {
    return new Response(
      JSON.stringify({ error: { code: 'MISSING_QUESTION', message: 'question is required.' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Env check ──
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';
  const cohereKey = process.env.COHERE_API_KEY;
  const rerankingEnabled = process.env.ENABLE_RERANKING === 'true' && !!cohereKey;

  if (!openaiKey || !pineconeKey) {
    return new Response(
      JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Load active prompt variants and select one ──
  let activeVariant: PromptVariant | null = null;
  try {
    const { data } = await supabase
      .from('prompt_variants')
      .select('id, name, system_prompt, traffic_pct')
      .eq('is_active', true)
      .order('created_at');
    if (data && data.length > 0) {
      activeVariant = selectVariant(data as PromptVariant[]);
    }
  } catch {
    // Non-fatal — fall through to default prompt
  }

  const tracer = new RagTracer();
  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });

  // ── Language detection + query translation ──
  const detectedLang = detectQueryLanguage(question);
  let embeddingQuery = question;
  if (detectedLang) {
    embeddingQuery = await translateToEnglish(question, detectedLang);
    console.log(JSON.stringify({
      event: 'rag.lang_detected',
      lang: detectedLang.code,
      translated: embeddingQuery !== question,
      q: question.slice(0, 60),
    }));
  }

  // Build system prompt — append language instruction when non-English
  const basePrompt = activeVariant?.system_prompt ?? BASE_SYSTEM_PROMPT;
  const effectiveSystemPrompt = detectedLang
    ? `${basePrompt}\n- The user's question was originally in ${detectedLang.name}. You MUST respond entirely in ${detectedLang.name}.`
    : basePrompt;

  // ── Load server-side history if needed ──
  let effectiveHistory: HistoryMessage[] = priorMessages;
  if (isExistingConversation && priorMessages.length === 0) {
    try {
      const { data } = await supabase
        .from('conversation_sessions')
        .select('history')
        .eq('id', conversationId)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (data?.history && Array.isArray(data.history)) {
        effectiveHistory = data.history as HistoryMessage[];
      }
    } catch {
      // Proceed without — not fatal
    }
  }

  // ── Embed + retrieve from Pinecone ──
  // Use the (possibly translated) English query for embedding to maximize
  // retrieval quality against the English-language vector index.
  const queryText = buildQueryText(embeddingQuery, effectiveHistory);

  let queryVector: number[];
  try {
    queryVector = await tracer.trace(
      'rag.embed_query',
      () => oai.embeddings.create({ model: EMBED_MODEL, input: queryText }).then((r) => r.data[0].embedding),
      { model: EMBED_MODEL },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/ask] embed_error: ${msg}`);
    return new Response(
      JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Failed to process question.' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Semantic answer cache check ──
  const cacheEnabled = isCacheEnabled();
  if (cacheEnabled) {
    const cached = await getSemanticCache(queryVector);
    if (cached) {
      console.log(
        JSON.stringify({ event: 'rag.semantic_cache_hit', similarity: cached.similarity, q: question.slice(0, 60) }),
      );
      return buildCacheHitResponse(cached.answer, cached.sources, conversationId);
    }
    console.log(JSON.stringify({ event: 'rag.semantic_cache_miss', q: question.slice(0, 60) }));
  }

  let results: Awaited<ReturnType<ReturnType<typeof pc.Index>['query']>>;
  try {
    const index = pc.Index(pineconeIndex);
    results = await tracer.trace(
      'rag.vector_search',
      () => index.query({ vector: queryVector, topK: TOP_K, includeMetadata: true }),
      { top_k: TOP_K },
      (r) => ({ chunk_count: r.matches.length, top_score: r.matches[0]?.score ?? 0 }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/ask] pinecone_error: ${msg}`);
    return new Response(
      JSON.stringify({ error: { code: 'RETRIEVAL_ERROR', message: 'Knowledge base error.' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // ── Deduplicate chunks ──
  const seenTexts = new Set<string>();
  let chunks = results.matches
    .filter((m) => m.score && m.score > SCORE_THRESHOLD)
    .map((m) => {
      const meta = m.metadata as Record<string, string> | undefined;
      return {
        text: meta?.text ?? '',
        speaker: meta?.speaker ?? '',
        source: meta?.source_file ?? '',
        score: m.score ?? 0,
      };
    })
    .filter((c) => {
      if (seenTexts.has(c.text)) return false;
      seenTexts.add(c.text);
      return true;
    });

  // ── Authority blending ──
  // Fetch per-source quality signals for the documents that matched.
  // Non-fatal: if lookup fails, fall through with raw vector scores.
  const uniqueSources = [...new Set(chunks.map((c) => c.source).filter(Boolean))];
  if (uniqueSources.length > 0 && (AUTHORITY_WEIGHT > 0 || CITATION_QUALITY_WEIGHT > 0)) {
    try {
      const { data: docRows } = await supabase
        .from('documents')
        .select('source_id, authority_score, positive_ratio_when_cited')
        .in('source_id', uniqueSources);

      if (docRows && docRows.length > 0) {
        const scoreMap = new Map(
          docRows.map((r) => [
            r.source_id as string,
            {
              authority: (r.authority_score as number) ?? 0.5,
              quality: (r.positive_ratio_when_cited as number | null) ?? 0.5,
            },
          ]),
        );

        const wVec = Math.max(0, 1 - AUTHORITY_WEIGHT - CITATION_QUALITY_WEIGHT);
        chunks = chunks.map((c) => {
          const sig = scoreMap.get(c.source);
          if (!sig) return c;
          const blended =
            c.score * wVec +
            sig.authority * AUTHORITY_WEIGHT +
            sig.quality * CITATION_QUALITY_WEIGHT;
          return { ...c, score: blended };
        });

        // Re-sort by blended score descending (Pinecone already sorted by vector score)
        chunks.sort((a, b) => b.score - a.score);
      }
    } catch (err) {
      console.warn('[/api/ask] authority_blend_error:', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Log citations (fire-and-forget) ──
  // Records which documents were retrieved so the weekly rollup can compute
  // citation_count and positive_ratio_when_cited per document.
  if (uniqueSources.length > 0) {
    void supabase.from('answer_source_log').insert(
      uniqueSources.map((sid) => ({ query_id: queryId, source_id: sid })),
    );
  }

  // ── Cross-encoder reranking (ENABLE_RERANKING=true) ──
  if (rerankingEnabled && chunks.length >= 2) {
    const cohere = new CohereClientV2({ token: cohereKey! });
    try {
      const reranked = await tracer.trace(
        'rag.cohere_rerank',
        () =>
          cohere
            .rerank({
              model: RERANK_MODEL,
              query: question,
              documents: chunks.map((c) => c.text),
              topN: Math.min(RERANK_TOP_N, chunks.length),
            })
            .then((r) => r.results),
        { model: RERANK_MODEL, candidate_count: chunks.length, top_n: RERANK_TOP_N },
        (res) => ({
          result_count: res.length,
          top_rerank_score: res[0]?.relevanceScore ?? 0,
          min_rerank_score: res[res.length - 1]?.relevanceScore ?? 0,
        }),
      );

      // Log score distribution for observability
      const scoreDistribution = Array.from({ length: 10 }, (_, i) => {
        const lo = i / 10;
        const hi = (i + 1) / 10;
        return { band: `${lo.toFixed(1)}-${hi.toFixed(1)}`, count: reranked.filter((r) => r.relevanceScore >= lo && r.relevanceScore < hi).length };
      });
      console.log(JSON.stringify({ event: 'rag.rerank_scores', scores: reranked.map((r) => ({ idx: r.index, relevance: r.relevanceScore })), distribution: scoreDistribution }));

      // Reorder chunks by reranker relevance
      chunks = reranked.map((r) => ({ ...chunks[r.index], score: r.relevanceScore }));
    } catch (err) {
      // Reranking failure is non-fatal — fall through with vector scores
      console.warn(`[/api/ask] cohere_rerank_error: ${err instanceof Error ? err.message : String(err)}`);
      chunks = chunks.slice(0, RERANK_TOP_N);
    }
  } else {
    chunks = chunks.slice(0, 6);
  }

  // ── Build context ──
  const context = chunks.length > 0
    ? chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')
    : null;

  const userContent = context
    ? `Transcript excerpts from our archive:\n\n${context}\n\nQuestion: ${question}`
    : `Question: ${question}`;

  // ── Sources for client ──
  const sources = chunks.map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
  }));

  // ── Stream response using AI SDK ──
  const result = streamText({
    model: openai(CHAT_MODEL),
    messages: [
      { role: 'system', content: effectiveSystemPrompt },
      ...priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ],
    temperature: 0.5,
    maxOutputTokens: 600,
    onFinish: async ({ text }) => {
      const latencyMs = Date.now() - queryStartMs;

      // Persist conversation session (best-effort)
      const updatedHistory = appendTurn(effectiveHistory, question, text);
      try {
        await supabase
          .from('conversation_sessions')
          .upsert(
            {
              id: conversationId,
              history: updatedHistory,
              expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
              ...(detectedLang ? { detected_language: detectedLang.code } : {}),
            },
            { onConflict: 'id' },
          );
      } catch (err) {
        console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${err}`);
      }

      // Log variant assignment (fire-and-forget)
      if (activeVariant) {
        void supabase.from('query_variant_log').insert({
          query_id: queryId,
          variant_id: activeVariant.id,
          latency_ms: latencyMs,
        });
      }

      // Write to semantic cache (fire-and-forget)
      if (cacheEnabled) {
        void setSemanticCache(question, queryVector, text, sources);
      }
    },
  });

  // Return as a UI message stream with sources as metadata
  const response = result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      // Attach sources metadata on the finish event
      if (part.type === 'finish') {
        return {
          sources,
          conversationId,
          queryId,
          ...(detectedLang ? { detectedLanguage: { code: detectedLang.code, name: detectedLang.name } } : {}),
        } as Record<string, unknown>;
      }
      return undefined;
    },
  });

  tracer.log(`q=${question.slice(0, 60)} rerank=${rerankingEnabled}`);

  return response;
}
