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
import { logOpenAIUsage } from '@/lib/openai-usage';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TOP_K = 8;

const MEDITATION_SYSTEM_PROMPT = `You are a skilled guided meditation teacher drawing on a curated archive of mindfulness teachings.
Your task is to write a 5-10 minute guided meditation script on the requested topic. Use the provided excerpts to ground the meditation in authentic teachings.

Structure the script naturally with these phases:
1. Opening (about 1 minute): Invite the listener to settle, find a comfortable position, close their eyes, and take a few slow breaths.
2. Theme introduction (1-2 minutes): Gently introduce the topic and its relationship to present-moment awareness.
3. Core practice (5-6 minutes): Guide the listener through a focused experience directly informed by the source material.
4. Closing (about 1 minute): Gently guide the listener back to ordinary awareness, carrying the insight forward.

Write in second person ("you", "your"), present tense. Use a warm, unhurried, conversational tone.
Indicate natural pauses with ellipses (...). Aim for 900-1200 words.
Begin directly with the opening — no preamble, titles, or meta-commentary.`;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function isAuthenticated(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') ?? '';
  return auth.toLowerCase().startsWith('bearer ');
}

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
  // Meditation generation is expensive — tighter limits than /api/ask
  const rateLimit = authenticated ? 10 : 3;
  const rateLimitLabel = authenticated ? 'auth' : 'anon';

  const rl = checkRateLimit(`meditate:${rateLimitLabel}:${ip}`, rateLimit);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    console.warn(`[/api/meditate] rate_limit ip=${ip} auth=${authenticated}`);
    return errorResponse(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests — please wait before trying again.', {
      'Retry-After': String(retryAfterSec),
      'X-RateLimit-Limit': String(rateLimit),
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
    });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const topic: string = typeof body?.topic === 'string' ? body.topic.trim() : '';
  if (!topic) {
    return errorResponse(400, 'MISSING_TOPIC', 'topic is required and must be a non-empty string.');
  }
  if (topic.length > 300) {
    return errorResponse(400, 'TOPIC_TOO_LONG', 'topic must be 300 characters or fewer.');
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    console.error('[/api/meditate] missing required env vars: OPENAI_API_KEY or PINECONE_API_KEY');
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured. Contact the administrator.');
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });

  const logCtx = `ip=${ip} auth=${authenticated} topic="${topic.slice(0, 60)}"`;

  // ── Embed the topic ───────────────────────────────────────────────────────
  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({
      model: EMBED_MODEL,
      input: topic,
    });
    queryVector = embedResp.data[0].embedding;
    logOpenAIUsage({ model: EMBED_MODEL, endpoint: 'embedding', promptTokens: embedResp.usage.total_tokens });
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
    .filter((m) => m.score && m.score > 0.35)
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
      if (!c.text || seenTexts.has(c.text)) return false;
      seenTexts.add(c.text);
      return true;
    })
    .slice(0, 5);

  const context =
    chunks.length > 0
      ? chunks.map((c, i) => `[${i + 1}] ${c.speaker ? `${c.speaker}: ` : ''}${c.text}`).join('\n\n')
      : 'No specific passages found — draw on general mindfulness teachings about awareness and presence.';

  // ── Generate meditation script ────────────────────────────────────────────
  let script: string;
  try {
    const chat = await oai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: MEDITATION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Source excerpts:\n\n${context}\n\nTopic: ${topic}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 1800,
    });
    logOpenAIUsage({ model: CHAT_MODEL, endpoint: 'completion', promptTokens: chat.usage?.prompt_tokens ?? 0, completionTokens: chat.usage?.completion_tokens ?? 0 });
    script = chat.choices[0]?.message?.content ?? '';
  } catch (err) {
    return handleOpenAIError(err, 'chat', logCtx);
  }

  // Estimate read-aloud duration at ~130 words/minute (meditation pace)
  const wordCount = script.split(/\s+/).length;
  const minutes = Math.round(wordCount / 130);
  const duration = `~${Math.max(5, Math.min(12, minutes))} min`;

  console.info(`[/api/meditate] generated script words=${wordCount} ${logCtx}`);

  return NextResponse.json({
    script,
    duration,
    sources: chunks.map((c) => ({
      text: c.text.slice(0, 200),
      speaker: c.speaker,
      source: c.source,
      score: Math.round(c.score * 100) / 100,
    })),
  });
}

// ── Error handlers ──────────────────────────────────────────────────────────

function handleOpenAIError(err: unknown, stage: string, logCtx: string): NextResponse {
  if (err instanceof OpenAIRateLimitError) {
    console.warn(`[/api/meditate] openai_rate_limit stage=${stage} ${logCtx}`);
    return errorResponse(503, 'UPSTREAM_RATE_LIMITED', 'AI service is temporarily over capacity. Please try again shortly.');
  }
  if (err instanceof APIConnectionTimeoutError) {
    console.error(`[/api/meditate] openai_timeout stage=${stage} ${logCtx}`);
    return errorResponse(504, 'UPSTREAM_TIMEOUT', 'AI service did not respond in time. Please try again.');
  }
  if (err instanceof APIConnectionError) {
    console.error(`[/api/meditate] openai_connection_error stage=${stage} ${logCtx}`);
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'Could not reach AI service. Please try again.');
  }
  if (err instanceof OpenAIAuthError) {
    console.error(`[/api/meditate] openai_auth_error stage=${stage} ${logCtx}`);
    return errorResponse(503, 'SERVICE_MISCONFIGURED', 'AI service authentication failed. Contact the administrator.');
  }
  if (err instanceof OpenAIServerError) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/meditate] openai_server_error stage=${stage} ${logCtx} err=${msg}`);
    return errorResponse(502, 'UPSTREAM_ERROR', 'AI service encountered an error. Please try again.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[/api/meditate] openai_unknown stage=${stage} ${logCtx} err=${msg}`);
  return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

function handlePineconeError(err: unknown, logCtx: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    console.error(`[/api/meditate] pinecone_timeout ${logCtx} err=${msg}`);
    return errorResponse(504, 'RETRIEVAL_TIMEOUT', 'Knowledge base did not respond in time. Please try again.');
  }
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('network')) {
    console.error(`[/api/meditate] pinecone_connection_error ${logCtx} err=${msg}`);
    return errorResponse(502, 'RETRIEVAL_UNAVAILABLE', 'Could not reach knowledge base. Please try again.');
  }
  if (lower.includes('not found') || lower.includes('index')) {
    console.error(`[/api/meditate] pinecone_index_error ${logCtx} err=${msg}`);
    return errorResponse(503, 'RETRIEVAL_MISCONFIGURED', 'Knowledge base index not found. Contact the administrator.');
  }
  console.error(`[/api/meditate] pinecone_error ${logCtx} err=${msg}`);
  return errorResponse(502, 'RETRIEVAL_ERROR', 'Knowledge base encountered an error. Please try again.');
}
