import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';
import { checkRateLimit } from '@/lib/rate-limit';
import { supabase } from '@/lib/supabase';
import { isValidConversationId, buildQueryText, appendTurn } from '@/lib/conversation-session';
import type { HistoryMessage } from '@/lib/conversation-session';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o';
const TOP_K = 10;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const SYSTEM_PROMPT = `You are a knowledgeable mindfulness guide with deep expertise in meditation, consciousness, non-dual awareness, and contemplative traditions.
Answer any question with your full knowledge — mindfulness, psychology, neuroscience, philosophy of mind, contemplative practice. When transcript excerpts are provided, weave their insights naturally into your answer as enrichment.
Rules:
- Keep answers concise: 2-4 short paragraphs max. No walls of text.
- Be warm, direct, and conversational — like a wise friend, not a textbook.
- Never name specific teachers, authors, or brands. Refer to "teachers in this tradition" or "contemplative traditions" instead.
- Never refuse to answer. If excerpts are sparse, rely on your own knowledge.
- No numbered lists or academic structure unless the user asks for it.`;

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

  // Extract text from either flat content or AI SDK v6 parts format
  function extractText(msg: { content?: string; parts?: Array<{ type: string; text?: string }> }): string {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.parts)) {
      return msg.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text)
        .join('');
    }
    return '';
  }

  // Support AI SDK format (messages array — both v5 flat and v6 parts)
  let question: string;
  let priorMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const messages = body?.messages as Array<{ role: string; content?: string; parts?: Array<{ type: string; text?: string }> }> | undefined;
  if (Array.isArray(messages) && messages.length > 0) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    question = lastUserMsg ? extractText(lastUserMsg).trim() : '';
    priorMessages = messages
      .slice(0, -1)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-6)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: extractText(m) }));
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

  if (!openaiKey || !pineconeKey) {
    return new Response(
      JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Service is not configured.' } }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });

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
  const queryText = buildQueryText(question, effectiveHistory);

  let queryVector: number[];
  try {
    const embedResp = await oai.embeddings.create({ model: EMBED_MODEL, input: queryText });
    queryVector = embedResp.data[0].embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/ask] embed_error: ${msg}`);
    return new Response(
      JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: 'Failed to process question.' } }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let results: Awaited<ReturnType<ReturnType<typeof pc.Index>['query']>>;
  try {
    const index = pc.Index(pineconeIndex);
    results = await index.query({ vector: queryVector, topK: TOP_K, includeMetadata: true });
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
      { role: 'system', content: SYSTEM_PROMPT },
      ...priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: userContent },
    ],
    temperature: 0.5,
    maxOutputTokens: 600,
    onFinish: async ({ text }) => {
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
            },
            { onConflict: 'id' },
          );
      } catch (err) {
        console.warn(`[/api/ask] supabase_session_error conv=${conversationId} err=${err}`);
      }
    },
  });

  // Return as a UI message stream with sources as metadata
  return result.toUIMessageStreamResponse({
    messageMetadata: ({ part }) => {
      // Attach sources metadata on the finish event
      if (part.type === 'finish') {
        return { sources, conversationId } as Record<string, unknown>;
      }
      return undefined;
    },
  });
}
