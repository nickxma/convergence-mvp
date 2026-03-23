/**
 * GET /api/cron/audio-generation
 *
 * Vercel cron job (every minute) that processes the audio_jobs queue.
 *
 * Supports two job types:
 *   - 'section'  (legacy) — per-section TTS, uploads individual MP3 files
 *   - 'full'     (new)    — full-script TTS: splits script into paragraphs,
 *                           calls ElevenLabs for each paragraph with
 *                           exponential backoff, concatenates all chunks
 *                           into one MP3, uploads to Supabase Storage, and
 *                           updates meditation.audio_url + audio_duration_seconds.
 *                           Publishes an SSE `audio_ready` event on completion.
 *
 * No-op when ELEVENLABS_API_KEY is absent — zero disruption to text-only flow.
 *
 * Auth: CRON_SECRET header.
 *
 * Rate limit handling: ElevenLabs returns 429 with a Retry-After header.
 * Each paragraph call retries up to MAX_RETRIES times with exponential backoff
 * (1 s → 2 s → 4 s … cap 30 s) before giving up.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { publishAudioEvent, makeAudioEvent } from '@/lib/meditation-audio-bus';

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'meditation-audio';
const BATCH_SIZE = 3; // full-script jobs are heavier — fewer per cron tick
const MAX_RETRIES = 4;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// Typical TTS speaking rate for duration estimation: ~130 wpm at meditation pace
const WORDS_PER_SECOND = 130 / 60;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AudioJobRow {
  id: string;
  meditation_id: string;
  script_section: string;
  voice_id: string;
  job_type: 'section' | 'full';
}

interface MeditationScriptRow {
  intro: string;
  sections: Array<{ name: string; duration: number; text: string }>;
  closing: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function ensureBucketExists(): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === AUDIO_BUCKET)) {
    await supabase.storage.createBucket(AUDIO_BUCKET, { public: true });
  }
}

/**
 * Split full meditation text into paragraph chunks.
 * ElevenLabs performs best on natural sentence groups (< ~500 chars each).
 */
function splitIntoParagraphs(script: MeditationScriptRow): string[] {
  const parts: string[] = [];
  if (script.intro?.trim()) parts.push(script.intro.trim());
  for (const section of script.sections ?? []) {
    if (section.text?.trim()) {
      const subParts = section.text
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean);
      parts.push(...subParts);
    }
  }
  if (script.closing?.trim()) parts.push(script.closing.trim());
  return parts.filter((p) => p.length > 0);
}

function estimateDurationSeconds(paragraphs: string[]): number {
  const totalWords = paragraphs.join(' ').trim().split(/\s+/).length;
  return Math.round(totalWords / WORDS_PER_SECOND);
}

/**
 * Call ElevenLabs TTS for a single text chunk with exponential backoff on 429s.
 */
async function synthesiseWithBackoff(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<ArrayBuffer> {
  let attempt = 0;
  let backoffMs = INITIAL_BACKOFF_MS;

  for (;;) {
    const res = await fetch(`${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_monolingual_v1',
        voice_settings: { stability: 0.65, similarity_boost: 0.75 },
      }),
    });

    if (res.ok) return res.arrayBuffer();

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`ElevenLabs rate limit hit after ${MAX_RETRIES} retries`);
      }
      const retryAfter = res.headers.get('Retry-After');
      const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1_000
        : Math.min(backoffMs, MAX_BACKOFF_MS);
      console.warn(
        `[audio-generation] rate_limit attempt=${attempt + 1}/${MAX_RETRIES} waitMs=${waitMs}`,
      );
      await new Promise<void>((r) => setTimeout(r, waitMs));
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      attempt++;
      continue;
    }

    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Concatenate MP3 ArrayBuffers by simple byte concatenation. */
function concatArrayBuffers(buffers: ArrayBuffer[]): Uint8Array {
  const total = buffers.reduce((s, b) => s + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

// ── Full-script job processor ─────────────────────────────────────────────────

async function processFullJob(job: AudioJobRow, apiKey: string): Promise<void> {
  const { data: claimed } = await supabase
    .from('audio_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');

  if (!claimed || claimed.length === 0) {
    console.log(`[audio-generation] skip full job=${job.id} — already claimed`);
    return;
  }

  const { data: med, error: medErr } = await supabase
    .from('meditations')
    .select('intro, sections, closing')
    .eq('id', job.meditation_id)
    .single();

  if (medErr || !med) {
    throw new Error(`meditation ${job.meditation_id} not found`);
  }

  const paragraphs = splitIntoParagraphs(med as MeditationScriptRow);
  if (paragraphs.length === 0) throw new Error('no text content in meditation script');

  // Synthesise each paragraph with per-paragraph rate-limit backoff
  const audioChunks: ArrayBuffer[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const chunk = await synthesiseWithBackoff(paragraphs[i], job.voice_id, apiKey);
    audioChunks.push(chunk);
    console.info(
      `[audio-generation] paragraph ${i + 1}/${paragraphs.length} ` +
        `meditationId=${job.meditation_id} bytes=${chunk.byteLength}`,
    );
  }

  const fullAudio = concatArrayBuffers(audioChunks);
  const durationSeconds = estimateDurationSeconds(paragraphs);

  await ensureBucketExists();
  const storagePath = `${job.meditation_id}/full.mp3`;
  const { error: uploadErr } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, fullAudio, { contentType: 'audio/mpeg', upsert: true });

  if (uploadErr) throw new Error(`storage upload failed: ${uploadErr.message}`);

  const { data: urlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  await Promise.all([
    supabase
      .from('meditations')
      .update({ audio_url: urlData.publicUrl, audio_duration_seconds: durationSeconds })
      .eq('id', job.meditation_id),
    supabase
      .from('audio_jobs')
      .update({ status: 'done', output_url: urlData.publicUrl, updated_at: new Date().toISOString() })
      .eq('id', job.id),
  ]);

  publishAudioEvent(
    job.meditation_id,
    makeAudioEvent('audio_ready', {
      meditationId: job.meditation_id,
      audioUrl: urlData.publicUrl,
      audioDurationSeconds: durationSeconds,
    }),
  );

  console.info(
    `[audio-generation] full done job=${job.id} meditationId=${job.meditation_id} ` +
      `paragraphs=${paragraphs.length} durationSeconds=${durationSeconds}`,
  );
}

// ── Legacy per-section job processor ─────────────────────────────────────────

function extractSectionText(
  meditation: MeditationScriptRow,
  scriptSection: string,
): string | null {
  if (scriptSection === 'intro') return meditation.intro;
  if (scriptSection === 'closing') return meditation.closing;
  const match = /^section-(\d+)$/.exec(scriptSection);
  if (match) return meditation.sections[parseInt(match[1], 10)]?.text ?? null;
  return null;
}

async function processSectionJob(job: AudioJobRow, apiKey: string): Promise<void> {
  const { data: claimed } = await supabase
    .from('audio_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');

  if (!claimed || claimed.length === 0) {
    console.log(`[audio-generation] skip section job=${job.id} — already claimed`);
    return;
  }

  const { data: med, error: medErr } = await supabase
    .from('meditations')
    .select('intro, sections, closing')
    .eq('id', job.meditation_id)
    .single();

  if (medErr || !med) {
    throw new Error(`meditation ${job.meditation_id} not found: ${medErr?.message ?? 'null'}`);
  }

  const text = extractSectionText(med as MeditationScriptRow, job.script_section);
  if (!text) {
    throw new Error(
      `no text for section "${job.script_section}" on meditation ${job.meditation_id}`,
    );
  }

  const audioBuffer = await synthesiseWithBackoff(text, job.voice_id, apiKey);

  await ensureBucketExists();
  const storagePath = `${job.meditation_id}/${job.script_section}.mp3`;
  const { error: uploadErr } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

  if (uploadErr) throw new Error(`storage upload failed: ${uploadErr.message}`);

  const { data: urlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  await supabase
    .from('audio_jobs')
    .update({ status: 'done', output_url: urlData.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  console.info(
    `[audio-generation] section done job=${job.id} meditationId=${job.meditation_id} section=${job.script_section}`,
  );
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenLabsKey) {
    return NextResponse.json({ skipped: true, reason: 'ELEVENLABS_NOT_CONFIGURED' });
  }

  // Fetch queued jobs — full-script first, then section; oldest first within type
  const { data: jobs, error: fetchErr } = await supabase
    .from('audio_jobs')
    .select('id, meditation_id, script_section, voice_id, job_type')
    .eq('status', 'queued')
    .order('job_type', { ascending: false }) // 'section' < 'full' reversed → full first
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error('[audio-generation] fetch_error:', fetchErr.message);
    return NextResponse.json({ error: 'DB query failed' }, { status: 502 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0 });
  }

  let processed = 0;
  let failed = 0;

  for (const job of jobs as AudioJobRow[]) {
    try {
      if (job.job_type === 'full') {
        await processFullJob(job, elevenLabsKey);
      } else {
        await processSectionJob(job, elevenLabsKey);
      }
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[audio-generation] error job=${job.id} type=${job.job_type}:`, errMsg);
      await supabase
        .from('audio_jobs')
        .update({ status: 'failed', error: errMsg, updated_at: new Date().toISOString() })
        .eq('id', job.id);

      if (job.job_type === 'full') {
        publishAudioEvent(
          job.meditation_id,
          makeAudioEvent('audio_error', { meditationId: job.meditation_id, message: errMsg }),
        );
      }
      failed++;
    }
  }

  return NextResponse.json({ processed, failed });
}
