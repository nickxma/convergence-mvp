import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { Pinecone } from '@pinecone-database/pinecone';
import { checkRateLimitWithFallback, getClientIp } from '@/lib/rate-limit';
import { embedOne } from '@/lib/embeddings';
import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const TOP_K = 10;
const FREE_TIER_LIMIT = 3; // per hour per user

const VALID_VOICE_STYLES = ['calm', 'energetic', 'neutral'] as const;
const VALID_DURATIONS = [5, 10, 20] as const;
const VALID_BACKGROUNDS = ['rain', 'silence', 'bowls'] as const;

type VoiceStyle = (typeof VALID_VOICE_STYLES)[number];
type MeditationDuration = (typeof VALID_DURATIONS)[number];
type Background = (typeof VALID_BACKGROUNDS)[number];

interface MeditationSection {
  name: string;
  duration: number;
  text: string;
  timestamp_sec: number; // cumulative start time in seconds
}

interface GeneratedMeditation {
  title: string;
  intro: string;
  sections: MeditationSection[];
  closing: string;
}

interface MeditationResponse extends GeneratedMeditation {
  estimated_duration_sec: number;
}

const VOICE_STYLE_DESCRIPTIONS: Record<VoiceStyle, string> = {
  calm: 'Use a slow, soft, deeply unhurried voice. Long pauses. Gentle imagery. Soothing and spacious.',
  energetic: 'Use a warm, uplifting, moderately-paced voice. Encouraging and bright without being rushed.',
  neutral: 'Use a clear, balanced, conversational voice. Neither too slow nor too fast. Natural and grounded.',
};

const BACKGROUND_NOTES: Record<Background, string> = {
  rain: 'The listener will be hearing gentle rain in the background. You may subtly reference soft rainfall or water sounds.',
  silence: 'The listener will be in silence. No need to reference ambient sound.',
  bowls: 'The listener will hear Tibetan singing bowls in the background. You may subtly reference resonant tones or vibrational sound.',
};

// Words per minute at meditation pace
const WORDS_PER_MINUTE = 130;

function estimateSeconds(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.round((words / WORDS_PER_MINUTE) * 60);
}

function buildSystemPrompt(
  intent: string,
  voiceStyle: VoiceStyle,
  duration: MeditationDuration,
  background: Background,
): string {
  const sectionCount = duration <= 5 ? 2 : duration <= 10 ? 3 : 5;
  const totalWords = duration * WORDS_PER_MINUTE;
  const sectionWords = Math.round((totalWords * 0.7) / sectionCount);

  return `You are a skilled guided meditation teacher drawing on a curated archive of mindfulness teachings.

Your task is to write a ${duration}-minute guided meditation script in a specific JSON format.

Listener intent: ${intent}
Voice style: ${VOICE_STYLE_DESCRIPTIONS[voiceStyle]}
${BACKGROUND_NOTES[background]}

Write in second person ("you", "your"), present tense. Indicate natural pauses with ellipses (...).
Ground the meditation in the provided source excerpts when relevant.

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

function addTimestamps(raw: Omit<GeneratedMeditation, 'sections'> & { sections: Omit<MeditationSection, 'timestamp_sec'>[] }): MeditationResponse {
  let cursor = 0;
  const introSec = estimateSeconds(raw.intro);
  cursor += introSec;

  const sections: MeditationSection[] = raw.sections.map((s) => {
    const ts = cursor;
    cursor += estimateSeconds(s.text);
    return { ...s, timestamp_sec: ts };
  });

  const closingSec = estimateSeconds(raw.closing);
  const estimated_duration_sec = cursor + closingSec;

  return {
    title: raw.title,
    intro: raw.intro,
    sections,
    closing: raw.closing,
    estimated_duration_sec,
  };
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(
          sseEvent('error', {
            code: 'RATE_LIMIT_EXCEEDED',
            message: "You've reached the limit of 3 meditation generations per hour.",
            retryAfterSec,
          })
        ));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 429,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Retry-After': String(retryAfterSec),
        'X-RateLimit-Limit': String(FREE_TIER_LIMIT),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
      },
    });
  }

  // ── Parse and validate input ──────────────────────────────────────────────
  let body: Record<string, unknown> | null = null;
  try {
    body = await req.json();
  } catch {
    return errorJsonResponse(400, 'INVALID_JSON', 'Request body must be valid JSON.');
  }

  const duration = body?.duration;
  const intent: string = typeof body?.intent === 'string' ? body.intent.trim() : '';
  const voiceStyle = body?.voice_style;
  const background = body?.background ?? 'silence';

  if (!VALID_DURATIONS.includes(duration as MeditationDuration)) {
    return errorJsonResponse(400, 'INVALID_DURATION', 'duration must be 5, 10, or 20.');
  }
  if (!intent) {
    return errorJsonResponse(400, 'MISSING_INTENT', 'intent is required and must be a non-empty string.');
  }
  if (intent.length > 300) {
    return errorJsonResponse(400, 'INTENT_TOO_LONG', 'intent must be 300 characters or fewer.');
  }
  if (!VALID_VOICE_STYLES.includes(voiceStyle as VoiceStyle)) {
    return errorJsonResponse(
      400,
      'INVALID_VOICE_STYLE',
      `voice_style must be one of: ${VALID_VOICE_STYLES.join(', ')}.`,
    );
  }
  if (!VALID_BACKGROUNDS.includes(background as Background)) {
    return errorJsonResponse(
      400,
      'INVALID_BACKGROUND',
      `background must be one of: ${VALID_BACKGROUNDS.join(', ')}.`,
    );
  }

  const validDuration = duration as MeditationDuration;
  const validVoiceStyle = voiceStyle as VoiceStyle;
  const validBackground = background as Background;

  // ── Env checks ────────────────────────────────────────────────────────────
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY; // still needed for embeddings
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!anthropicKey || !openaiKey || !pineconeKey) {
    console.error('[/api/meditations/generate] missing env vars');
    return errorJsonResponse(503, 'SERVICE_UNAVAILABLE', 'Service is not configured. Contact the administrator.');
  }

  const logCtx = `userId=${userId} duration=${validDuration} voice=${validVoiceStyle} bg=${validBackground} intent="${intent.slice(0, 60)}"`;

  // ── SSE stream ────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sseEvent(event, data)));

      try {
        // ── Embed the intent ────────────────────────────────────────────────
        send('status', { message: 'Retrieving context...' });
        let queryVector: number[];
        try {
          queryVector = await embedOne(intent);
        } catch (err) {
          send('error', { code: 'RETRIEVAL_ERROR', message: 'Failed to embed intent for context retrieval.' });
          console.error(`[/api/meditations/generate] embed_error ${logCtx}`, err);
          controller.close();
          return;
        }

        // ── Retrieve from Pinecone ──────────────────────────────────────────
        let context = 'No specific passages found — draw on general mindfulness teachings about awareness and presence.';
        try {
          const pc = new Pinecone({ apiKey: pineconeKey });
          const results = await pc.Index(pineconeIndex).query({
            vector: queryVector,
            topK: TOP_K,
            includeMetadata: true,
          });

          const seenTexts = new Set<string>();
          const chunks = results.matches
            .filter((m) => m.score && m.score > 0.35)
            .map((m) => {
              const meta = m.metadata as Record<string, string> | undefined;
              return { text: meta?.text ?? '', speaker: meta?.speaker ?? '' };
            })
            .filter((c) => {
              if (!c.text || seenTexts.has(c.text)) return false;
              seenTexts.add(c.text);
              return true;
            })
            .slice(0, 6);

          if (chunks.length > 0) {
            context = chunks
              .map((c, i) => `[${i + 1}] ${c.speaker ? `${c.speaker}: ` : ''}${c.text}`)
              .join('\n\n');
          }
        } catch (err) {
          // Non-fatal: continue without RAG context
          console.warn(`[/api/meditations/generate] pinecone_error ${logCtx}`, err);
        }

        // ── Generate with Claude (streaming) ───────────────────────────────
        send('status', { message: 'Generating meditation...' });

        const anthropic = new Anthropic({ apiKey: anthropicKey });

        let fullText = '';
        const claudeStream = anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: 4096,
          system: buildSystemPrompt(intent, validVoiceStyle, validDuration, validBackground),
          messages: [
            {
              role: 'user',
              content: `Source excerpts:\n\n${context}\n\nIntent: ${intent}`,
            },
          ],
          temperature: 0.75,
        });

        for await (const event of claudeStream) {
          if (
            event.type === 'content_block_delta' &&
            event.delta.type === 'text_delta'
          ) {
            fullText += event.delta.text;
            send('chunk', { text: event.delta.text });
          }
        }

        // ── Parse and validate ──────────────────────────────────────────────
        let rawParsed: Partial<GeneratedMeditation>;
        try {
          rawParsed = JSON.parse(fullText) as Partial<GeneratedMeditation>;
        } catch {
          console.error(`[/api/meditations/generate] json_parse_error ${logCtx} raw=${fullText.slice(0, 200)}`);
          send('error', { code: 'GENERATION_ERROR', message: 'Failed to parse the generated script. Please try again.' });
          controller.close();
          return;
        }

        if (
          typeof rawParsed.title !== 'string' ||
          typeof rawParsed.intro !== 'string' ||
          !Array.isArray(rawParsed.sections) ||
          typeof rawParsed.closing !== 'string'
        ) {
          console.error(`[/api/meditations/generate] invalid_structure ${logCtx}`);
          send('error', { code: 'GENERATION_ERROR', message: 'Generated script has unexpected structure. Please try again.' });
          controller.close();
          return;
        }

        const rawMeditation = {
          title: rawParsed.title,
          intro: rawParsed.intro,
          sections: rawParsed.sections.map((s) => ({
            name: typeof s.name === 'string' ? s.name : 'Practice',
            duration: typeof s.duration === 'number' ? s.duration : 1,
            text: typeof s.text === 'string' ? s.text : '',
          })),
          closing: rawParsed.closing,
        };

        const meditation = addTimestamps(rawMeditation);

        // ── Persist to database ─────────────────────────────────────────────
        let savedId: string | undefined;
        try {
          const { data, error } = await supabase
            .from('meditations')
            .insert({
              user_id: userId,
              intent,
              duration: validDuration,
              voice_style: validVoiceStyle,
              background: validBackground,
              title: meditation.title,
              intro: meditation.intro,
              sections: meditation.sections,
              closing: meditation.closing,
              estimated_duration_sec: meditation.estimated_duration_sec,
            })
            .select('id')
            .single();

          if (error) {
            console.error(`[/api/meditations/generate] db_error ${logCtx} err=${error.message}`);
          } else {
            savedId = data?.id;
          }
        } catch (err) {
          console.error(`[/api/meditations/generate] db_exception ${logCtx} err=${err instanceof Error ? err.message : String(err)}`);
        }

        // ── Enqueue audio jobs (fire-and-forget) ────────────────────────────
        if (savedId) {
          enqueueAudioJobs(savedId, rawMeditation).catch((err) => {
            console.error(`[/api/meditations/generate] enqueue_audio_error id=${savedId}:`, err);
          });
        }

        console.info(`[/api/meditations/generate] generated id=${savedId ?? 'unsaved'} ${logCtx}`);

        send('done', { id: savedId ?? null, ...meditation });
        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[/api/meditations/generate] unexpected_error ${logCtx} err=${msg}`);
        send('error', { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ── Audio job enqueueing ──────────────────────────────────────────────────────

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // ElevenLabs "Rachel"

async function enqueueAudioJobs(
  meditationId: string,
  script: Omit<GeneratedMeditation, 'sections'> & { sections: Omit<MeditationSection, 'timestamp_sec'>[] },
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

function errorJsonResponse(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
