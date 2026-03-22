import { randomUUID, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError as OpenAIRateLimitError,
  AuthenticationError as OpenAIAuthError,
  InternalServerError as OpenAIServerError,
} from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { checkRateLimitWithFallback } from '@/lib/rate-limit';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';
import { isValidConversationId, buildQueryText, appendTurn } from '@/lib/conversation-session';
import type { HistoryMessage } from '@/lib/conversation-session';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TOP_K = 10; // fetch extra to allow dedup headroom
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24h

const SYSTEM_PROMPT = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, non-dual awareness, and contemplative traditions.
Answer any question with your full knowledge — mindfulness, psychology, neuroscience, philosophy of mind, contemplative practice. When transcript excerpts are provided, weave their insights naturally into your answer as enrichment.
Rules:
- Keep answers concise: 2-4 short paragraphs max. No walls of text.
- Be warm, direct, and conversational — like a wise friend, not a textbook.
- Never name specific teachers, authors, or brands. Refer to "teachers in this tradition" or "contemplative traditions" instead.
- Never refuse to answer. If excerpts are sparse, rely on your own knowledge.
- No numbered lists or academic structure unless the user asks for it.`;

/** Extract the best available client IP from request headers. */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
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

const RATE_LIMIT_PER_USER = 20; // requests per hour

export async function POST(req: NextRequest) {
  const requestStart = Date.now();
  const ip = getClientIp(req);

  // ── Identify caller and rate limit ────────────────────────────────────────
  // Verify Privy JWT to get a stable per-user key; fall back to IP for anon.
  const authResult = await verifyRequest(req);
  const userId = authResult?.userId ?? null;
  const rateLimitKey = userId ? `ask:user:${userId}` : `ask:anon:${ip}`;

  const rl = await checkRateLimitWithFallback(rateLimitKey, RATE_LIMIT_PER_USER);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    console.warn(`[/api/ask] rate_limit ip=${ip} userId=${userId ?? 'anon'} store=${rl.store}`);
    return errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests — please wait before trying again.', {
      'Retry-After': String(retryAfterSec),
      'X-RateLimit-Limit': String(RATE_LIMIT_PER_USER),
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

  // Resolve or generate conversationId
  const rawConvId = body?.conversationId;
  const isExistingConversation = isValidConversationId(rawConvId);
  const conversationId: string = isExistingConversation ? rawConvId : randomUUID();

  if (!question) {
    return errorResponse(400, 'MISSING_QUESTION', 'question is required and must be a non-empty string.');
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
      // Proceed without server-side history — not fatal
    }
  }

  // ── Build augmented query for Pinecone ────────────────────────────────────
  // For follow-up questions, enrich the embedding query with the last assistant
  // response so retrieval is semantically grounded in the current thread.
  const queryText = buildQueryText(question, effectiveHistory);

  // ── Embed the question ────────────────────────────────────────────────────
  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({
      model: EMBED_MODEL,
      input: queryText,
    });
    queryVector = embedResp.data[0].embedding;
  } catch (err) {
    return handleOpenAIError(err, 'embeddings', logCtx);
  }

  // ── Retrieve from Pinecone ────────────────────────────────────────────────
  let results: Awaited<ReturnType<ReturnType<typeof pc.Index>['query']>>;
  try {
    const index = pc.Index(pineconeIndex);
    results = await index.query({
      vector: queryVector,
      topK: TOP_K,
      includeMetadata: true,
    });
  } catch (err) {
    return handlePineconeError(err, logCtx);
  }

  // ── Deduplicate and filter chunks ─────────────────────────────────────────
  const seenTexts = new Set<string>();
  const chunks = results.matches
    .filter((m) => m.score && m.score > 0.4)
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
    })
    .slice(0, 6);

  // ── Build context and generate answer ────────────────────────────────────
  // Strip speaker names from LLM context to prevent name leakage in responses.
  // Speaker metadata is still returned in the sources panel for attribution.
  const context = chunks.length > 0
    ? chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')
    : null;

  const priorMessages = effectiveHistory.slice(-6).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const userContent = context
    ? `Transcript excerpts from our archive:\n\n${context}\n\nQuestion: ${question}`
    : `Question: ${question}`;

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
        messages: [
          {
            role: 'system',
            content:
              'You generate follow-up questions for a mindfulness Q&A. Return exactly 3 short, distinct questions a curious reader might ask next. Output only a JSON array of strings, no other text.',
          },
          { role: 'user', content: `Original question: ${question}\n\nAnswer summary: ${userContent.slice(0, 400)}` },
        ],
        temperature: 0.7,
        max_tokens: 150,
      }),
    ]);
    answer = chatResp.choices[0]?.message?.content ?? '';
    try {
      const raw = followUpsResp.choices[0]?.message?.content ?? '[]';
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) followUps = parsed.slice(0, 3).map(String);
    } catch {
      // Follow-ups are non-critical — silently skip on parse error
    }
  } catch (err) {
    return handleOpenAIError(err, 'chat', logCtx);
  }

  // ── Persist analytics (best-effort, non-blocking) ─────────────────────────
  const latencyMs = Date.now() - requestStart;
  const questionHash = createHash('sha256').update(question).digest('hex');
  const pineconeScores = chunks.slice(0, 3).map((c) => c.score);

  supabase
    .from('qa_analytics')
    .insert({
      question_hash: questionHash,
      pinecone_scores: pineconeScores,
      latency_ms: latencyMs,
      model_used: CHAT_MODEL,
    })
    .then(({ error }) => {
      if (error) {
        console.warn(`[/api/ask] analytics_write_error err=${error.message}`);
      }
    });

  // ── Persist shareable answer (best-effort, non-blocking) ──────────────────
  const answerSources = chunks.slice(0, 3).map((c) => ({
    text: c.text.slice(0, 200),
    speaker: c.speaker,
    source: c.source,
    score: Math.round(c.score * 100) / 100,
  }));
  let answerId: string | null = null;
  try {
    const { data: answerRow, error: answerError } = await supabase
      .from('qa_answers')
      .insert({
        question,
        answer,
        sources: answerSources,
        conversation_id: conversationId,
      })
      .select('id')
      .single();
    if (answerError) {
      console.warn(`[/api/ask] qa_answer_write_error err=${answerError.message}`);
    } else {
      answerId = answerRow?.id ?? null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[/api/ask] qa_answer_exception err=${msg}`);
  }

  // ── Persist conversation session to Supabase (best-effort, non-blocking) ──
  const updatedHistory = appendTurn(effectiveHistory, question, answer);

  supabase
    .from('conversation_sessions')
    .upsert(
      {
        id: conversationId,
        history: updatedHistory,
        expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      },
      { onConflict: 'id' },
    )
    .then(({ error }) => {
      if (error) {
        console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${error.message}`);
      }
    });

  return NextResponse.json({
    answer,
    answerId,
    conversationId,
    followUps,
    sources: chunks.map((c) => ({
      text: c.text.slice(0, 200),
      speaker: c.speaker,
      source: c.source,
      score: Math.round(c.score * 100) / 100,
    })),
    rateLimit: {
      remaining: rl.remaining,
      resetAt: new Date(rl.resetAt).toISOString(),
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
