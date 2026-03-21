import { NextRequest, NextResponse } from 'next/server';
import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  RateLimitError as OpenAIRateLimitError,
  AuthenticationError as OpenAIAuthError,
  InternalServerError as OpenAIServerError,
} from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { checkRateLimit } from '@/lib/rate-limit';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TOP_K = 10; // fetch extra to allow dedup headroom

const SYSTEM_PROMPT = `You are a knowledgeable guide to the teachings of Sam Harris and the Waking Up community.
Answer questions using only the provided transcript excerpts. Be direct and clear.
If the excerpts don't contain enough information to answer, say so honestly.
Do not invent teachings or attribute views not present in the source material.`;

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Extract the best available client IP from request headers. */
function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

/** True when the request carries a Bearer auth token (Privy JWT). */
function isAuthenticated(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ');
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

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const authenticated = isAuthenticated(req);
  const rateLimit = authenticated ? 60 : 10;
  const rateLimitLabel = authenticated ? 'auth' : 'anon';

  // ── Rate limiting ──────────────────────────────────────────────────────────
  const rl = checkRateLimit(`ask:${rateLimitLabel}:${ip}`, rateLimit);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    console.warn(`[/api/ask] rate_limit ip=${ip} auth=${authenticated}`);
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

  const logCtx = `ip=${ip} auth=${authenticated} wallet=${walletAddress ?? 'none'} q="${question.slice(0, 80)}"`;

  // ── Embed the question ────────────────────────────────────────────────────
  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({
      model: EMBED_MODEL,
      input: question,
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

  if (chunks.length === 0) {
    return NextResponse.json({
      answer: "I couldn't find relevant passages in the Waking Up corpus for that question.",
      sources: [],
    });
  }

  // ── Build context and generate answer ────────────────────────────────────
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.speaker ? `${c.speaker}: ` : ''}${c.text}`)
    .join('\n\n');

  const priorMessages = history.slice(-6).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  let answer: string;
  try {
    const chat = await oai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...priorMessages,
        {
          role: 'user',
          content: `Transcript excerpts:\n\n${context}\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 600,
    });
    answer = chat.choices[0]?.message?.content ?? '';
  } catch (err) {
    return handleOpenAIError(err, 'chat', logCtx);
  }

  return NextResponse.json({
    answer,
    sources: chunks.map((c) => ({
      text: c.text.slice(0, 200),
      speaker: c.speaker,
      source: c.source,
      score: Math.round(c.score * 100) / 100,
    })),
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
