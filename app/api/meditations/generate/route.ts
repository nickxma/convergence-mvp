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
import { logOpenAIUsage } from '@/lib/openai-usage';
import { embedOne } from '@/lib/embeddings';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const CHAT_MODEL = 'gpt-4o';
const TOP_K = 10;
const FREE_TIER_LIMIT = 3; // per hour per user

const VALID_STYLES = ['body-scan', 'breath', 'loving-kindness', 'open-awareness'] as const;
const VALID_DURATIONS = [5, 10, 20] as const;

type MeditationStyle = (typeof VALID_STYLES)[number];
type MeditationDuration = (typeof VALID_DURATIONS)[number];

interface MeditationSection {
  name: string;
  duration: number;
  text: string;
}

interface GeneratedMeditation {
  title: string;
  intro: string;
  sections: MeditationSection[];
  closing: string;
}

const STYLE_DESCRIPTIONS: Record<MeditationStyle, string> = {
  'body-scan': 'Progressive body scan — guide attention systematically through each region of the body, noticing sensations without judgment.',
  'breath': 'Breath anchor — use the breath as the primary object of attention, gently returning whenever the mind wanders.',
  'loving-kindness': 'Loving-kindness (metta) — cultivate warmth and compassion, radiating goodwill from self outward to all beings.',
  'open-awareness': 'Open awareness — non-directive, spacious awareness with no single object; thoughts, sounds, and sensations arise and pass without grasping.',
};

function buildSystemPrompt(
  style: MeditationStyle,
  duration: MeditationDuration,
  userName?: string,
): string {
  const sectionCount = duration <= 5 ? 2 : duration <= 10 ? 3 : 5;
  const totalWords = duration * 130; // ~130 words/minute at meditation pace
  const sectionWords = Math.round((totalWords * 0.7) / sectionCount);
  const nameClause = userName ? ` Address the listener by name (${userName}) once during the introduction.` : '';

  return `You are a skilled guided meditation teacher drawing on a curated archive of mindfulness teachings.

Your task is to write a ${duration}-minute guided meditation script in a specific JSON format.

Style: ${STYLE_DESCRIPTIONS[style]}${nameClause}

Write in second person ("you", "your"), present tense. Use a warm, unhurried, conversational tone.
Indicate natural pauses with ellipses (...). Ground the meditation in the provided source excerpts.

Return ONLY a valid JSON object with this exact structure:
{
  "title": "A short evocative title (4–8 words)",
  "intro": "Opening paragraph (~60–80 words). Invite settling, comfortable position, eyes closed, a few slow breaths.",
  "sections": [
    {
      "name": "Section name (2–4 words)",
      "duration": <minutes as integer, all sections must sum to ${Math.round(duration * 0.7)}>,
      "text": "Section body (~${sectionWords} words)"
    }
  ],
  "closing": "Closing paragraph (~60–80 words). Gently guide back to ordinary awareness, invite carrying the insight forward."
}

Requirements:
- Exactly ${sectionCount} sections in the sections array.
- Section durations must be positive integers summing to ${Math.round(duration * 0.7)}.
- Total word count across intro + all section texts + closing should be approximately ${totalWords} words.
- No preamble, markdown, or commentary — output the JSON object only.`;
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
  // ── Auth ──────────────────────────────────────────────────────────────────
  const auth = await verifyRequest(req);
  const userId = auth?.userId ?? null;
  const rateLimitKey = userId
    ? `meditations:generate:user:${userId}`
    : `meditations:generate:ip:${getClientIp(req)}`;

  // ── Rate limit ────────────────────────────────────────────────────────────
  const rl = await checkRateLimitWithFallback(rateLimitKey, FREE_TIER_LIMIT);
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.resetAt - Date.now()) / 1000);
    console.warn(`[/api/meditations/generate] rate_limit userId=${userId} key=${rateLimitKey}`);
    return errorResponse(
      429,
      'RATE_LIMIT_EXCEEDED',
      "You've reached the limit of 3 meditation generations per hour.",
      {
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(FREE_TIER_LIMIT),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
      },
    );
  }

  // ── Parse and validate input ──────────────────────────────────────────────
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const duration = body?.duration;
  const theme: string = typeof body?.theme === 'string' ? body.theme.trim() : '';
  const style = body?.style;
  const userName: string | undefined =
    typeof body?.userName === 'string' ? body.userName.trim().slice(0, 50) : undefined;

  if (!VALID_DURATIONS.includes(duration as MeditationDuration)) {
    return errorResponse(400, 'INVALID_DURATION', 'duration must be 5, 10, or 20.');
  }
  if (!theme) {
    return errorResponse(400, 'MISSING_THEME', 'theme is required and must be a non-empty string.');
  }
  if (theme.length > 300) {
    return errorResponse(400, 'THEME_TOO_LONG', 'theme must be 300 characters or fewer.');
  }
  if (!VALID_STYLES.includes(style as MeditationStyle)) {
    return errorResponse(
      400,
      'INVALID_STYLE',
      `style must be one of: ${VALID_STYLES.join(', ')}.`,
    );
  }

  const validDuration = duration as MeditationDuration;
  const validStyle = style as MeditationStyle;

  // ── Env checks ────────────────────────────────────────────────────────────
  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    console.error('[/api/meditations/generate] missing env vars: OPENAI_API_KEY or PINECONE_API_KEY');
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured. Contact the administrator.');
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });

  const logCtx = `userId=${userId} duration=${validDuration} style=${validStyle} theme="${theme.slice(0, 60)}"`;

  // ── Embed the theme ───────────────────────────────────────────────────────
  let queryVector: number[];
  try {
    queryVector = await embedOne(theme, { client: oai });
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
    .slice(0, 6);

  const context =
    chunks.length > 0
      ? chunks.map((c, i) => `[${i + 1}] ${c.speaker ? `${c.speaker}: ` : ''}${c.text}`).join('\n\n')
      : 'No specific passages found — draw on general mindfulness teachings about awareness and presence.';

  // ── Generate structured meditation script ─────────────────────────────────
  let meditation: GeneratedMeditation;
  try {
    const systemPrompt = buildSystemPrompt(validStyle, validDuration, userName);
    const chat = await oai.chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Source excerpts:\n\n${context}\n\nTheme: ${theme}`,
        },
      ],
      temperature: 0.75,
      max_tokens: 4000,
    });
    logOpenAIUsage({
      model: CHAT_MODEL,
      endpoint: 'completion',
      promptTokens: chat.usage?.prompt_tokens ?? 0,
      completionTokens: chat.usage?.completion_tokens ?? 0,
    });
    const raw = chat.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw) as Partial<GeneratedMeditation>;

    // Validate structure
    if (
      typeof parsed.title !== 'string' ||
      typeof parsed.intro !== 'string' ||
      !Array.isArray(parsed.sections) ||
      typeof parsed.closing !== 'string'
    ) {
      console.error(`[/api/meditations/generate] invalid_json_structure ${logCtx} raw=${raw.slice(0, 200)}`);
      return errorResponse(500, 'GENERATION_ERROR', 'Failed to generate a valid meditation script. Please try again.');
    }

    meditation = {
      title: parsed.title,
      intro: parsed.intro,
      sections: parsed.sections.map((s) => ({
        name: typeof s.name === 'string' ? s.name : 'Practice',
        duration: typeof s.duration === 'number' ? s.duration : 1,
        text: typeof s.text === 'string' ? s.text : '',
      })),
      closing: parsed.closing,
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      console.error(`[/api/meditations/generate] json_parse_error ${logCtx}`);
      return errorResponse(500, 'GENERATION_ERROR', 'Failed to parse the generated script. Please try again.');
    }
    return handleOpenAIError(err, 'chat', logCtx);
  }

  // ── Persist to database ───────────────────────────────────────────────────
  let savedId: string | undefined;
  try {
    const { data, error } = await supabase
      .from('meditations')
      .insert({
        user_id: userId,
        theme,
        duration: validDuration,
        style: validStyle,
        user_name: userName ?? null,
        title: meditation.title,
        intro: meditation.intro,
        sections: meditation.sections,
        closing: meditation.closing,
        sources: chunks.map((c) => ({
          text: c.text.slice(0, 300),
          speaker: c.speaker,
          source: c.source,
          score: Math.round(c.score * 100) / 100,
        })),
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[/api/meditations/generate] db_error ${logCtx} err=${error.message}`);
      // Non-fatal: return the script even if persistence fails
    } else {
      savedId = data?.id;
    }
  } catch (err) {
    console.error(`[/api/meditations/generate] db_exception ${logCtx} err=${err instanceof Error ? err.message : String(err)}`);
    // Non-fatal
  }

  // ── Enqueue audio jobs (fire-and-forget) ─────────────────────────────────
  if (savedId) {
    enqueueAudioJobs(savedId, meditation).catch((err) => {
      console.error(`[/api/meditations/generate] enqueue_audio_error id=${savedId}:`, err);
    });
  }

  console.info(`[/api/meditations/generate] generated id=${savedId ?? 'unsaved'} ${logCtx}`);

  return NextResponse.json({
    id: savedId ?? null,
    ...meditation,
  });
}

// ── Audio job enqueueing ──────────────────────────────────────────────────────

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"

async function enqueueAudioJobs(
  meditationId: string,
  script: GeneratedMeditation,
): Promise<void> {
  const voiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID ?? DEFAULT_VOICE_ID;

  const rows = [
    { meditation_id: meditationId, script_section: 'intro', voice_id: voiceId, status: 'queued' },
    ...script.sections.map((_, i) => ({
      meditation_id: meditationId,
      script_section: `section-${i}`,
      voice_id: voiceId,
      status: 'queued',
    })),
    { meditation_id: meditationId, script_section: 'closing', voice_id: voiceId, status: 'queued' },
  ];

  const { error } = await supabase.from('audio_jobs').insert(rows);
  if (error) {
    console.warn(
      `[/api/meditations/generate] audio_jobs_insert_error id=${meditationId}:`,
      error.message,
    );
  } else {
    console.info(
      `[/api/meditations/generate] audio_jobs_enqueued id=${meditationId} count=${rows.length}`,
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function handleOpenAIError(err: unknown, stage: string, logCtx: string): NextResponse {
  if (err instanceof OpenAIRateLimitError) {
    console.warn(`[/api/meditations/generate] openai_rate_limit stage=${stage} ${logCtx}`);
    return errorResponse(503, 'UPSTREAM_RATE_LIMITED', 'AI service is temporarily over capacity. Please try again shortly.');
  }
  if (err instanceof APIConnectionTimeoutError) {
    console.error(`[/api/meditations/generate] openai_timeout stage=${stage} ${logCtx}`);
    return errorResponse(504, 'UPSTREAM_TIMEOUT', 'AI service did not respond in time. Please try again.');
  }
  if (err instanceof APIConnectionError) {
    console.error(`[/api/meditations/generate] openai_connection_error stage=${stage} ${logCtx}`);
    return errorResponse(502, 'UPSTREAM_UNAVAILABLE', 'Could not reach AI service. Please try again.');
  }
  if (err instanceof OpenAIAuthError) {
    console.error(`[/api/meditations/generate] openai_auth_error stage=${stage} ${logCtx}`);
    return errorResponse(503, 'SERVICE_MISCONFIGURED', 'AI service authentication failed. Contact the administrator.');
  }
  if (err instanceof OpenAIServerError) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[/api/meditations/generate] openai_server_error stage=${stage} ${logCtx} err=${msg}`);
    return errorResponse(502, 'UPSTREAM_ERROR', 'AI service encountered an error. Please try again.');
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[/api/meditations/generate] openai_unknown stage=${stage} ${logCtx} err=${msg}`);
  return errorResponse(500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
}

function handlePineconeError(err: unknown, logCtx: string): NextResponse {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset')) {
    console.error(`[/api/meditations/generate] pinecone_timeout ${logCtx} err=${msg}`);
    return errorResponse(504, 'RETRIEVAL_TIMEOUT', 'Knowledge base did not respond in time. Please try again.');
  }
  if (lower.includes('enotfound') || lower.includes('econnrefused') || lower.includes('network')) {
    console.error(`[/api/meditations/generate] pinecone_connection_error ${logCtx} err=${msg}`);
    return errorResponse(502, 'RETRIEVAL_UNAVAILABLE', 'Could not reach knowledge base. Please try again.');
  }
  if (lower.includes('not found') || lower.includes('index')) {
    console.error(`[/api/meditations/generate] pinecone_index_error ${logCtx} err=${msg}`);
    return errorResponse(503, 'RETRIEVAL_MISCONFIGURED', 'Knowledge base index not found. Contact the administrator.');
  }
  console.error(`[/api/meditations/generate] pinecone_error ${logCtx} err=${msg}`);
  return errorResponse(502, 'RETRIEVAL_ERROR', 'Knowledge base encountered an error. Please try again.');
}
