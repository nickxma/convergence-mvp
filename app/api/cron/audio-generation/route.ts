/**
 * GET /api/cron/audio-generation
 *
 * Vercel cron job (every minute) that drains the audio_jobs queue by calling
 * ElevenLabs TTS and uploading MP3s to Supabase Storage.
 *
 * No-op when ELEVENLABS_API_KEY is absent — zero disruption to text-only flow.
 *
 * Per run: claims up to BATCH_SIZE queued jobs atomically, processes each in
 * series to stay within Vercel serverless timeout budgets.
 *
 * Storage: meditation-audio/<meditationId>/<scriptSection>.mp3 (public bucket)
 *
 * Auth: CRON_SECRET header (same pattern as all other cron routes).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const AUDIO_BUCKET = 'meditation-audio';
const BATCH_SIZE = 5;

// ── Types ──────────────────────────────────────────────────────────────────────

interface AudioJobRow {
  id: string;
  meditation_id: string;
  script_section: string;
  voice_id: string;
}

interface MeditationRow {
  intro: string;
  sections: Array<{ name: string; duration: number; text: string }>;
  closing: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractSectionText(meditation: MeditationRow, scriptSection: string): string | null {
  if (scriptSection === 'intro') return meditation.intro;
  if (scriptSection === 'closing') return meditation.closing;
  const match = /^section-(\d+)$/.exec(scriptSection);
  if (match) {
    const idx = parseInt(match[1], 10);
    return meditation.sections[idx]?.text ?? null;
  }
  return null;
}

async function ensureBucketExists(): Promise<void> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === AUDIO_BUCKET)) {
    await supabase.storage.createBucket(AUDIO_BUCKET, { public: true });
  }
}

async function synthesiseTts(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<ArrayBuffer> {
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

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.arrayBuffer();
}

async function processJob(job: AudioJobRow, apiKey: string): Promise<void> {
  // Claim the job atomically — skip if already taken by a parallel run
  const { data: claimed } = await supabase
    .from('audio_jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id');

  if (!claimed || claimed.length === 0) {
    console.log(`[audio-generation] skip job=${job.id} — already claimed`);
    return;
  }

  // Fetch the meditation text
  const { data: med, error: medErr } = await supabase
    .from('meditations')
    .select('intro, sections, closing')
    .eq('id', job.meditation_id)
    .single();

  if (medErr || !med) {
    throw new Error(`meditation ${job.meditation_id} not found: ${medErr?.message ?? 'null'}`);
  }

  const text = extractSectionText(med as MeditationRow, job.script_section);
  if (!text) {
    throw new Error(`no text for section "${job.script_section}" on meditation ${job.meditation_id}`);
  }

  // Call ElevenLabs TTS
  const audioBuffer = await synthesiseTts(text, job.voice_id, apiKey);

  // Upload to Supabase Storage
  const storagePath = `${job.meditation_id}/${job.script_section}.mp3`;
  const { error: uploadErr } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(storagePath, audioBuffer, { contentType: 'audio/mpeg', upsert: true });

  if (uploadErr) {
    throw new Error(`storage upload failed: ${uploadErr.message}`);
  }

  const { data: urlData } = supabase.storage.from(AUDIO_BUCKET).getPublicUrl(storagePath);

  await supabase
    .from('audio_jobs')
    .update({ status: 'done', output_url: urlData.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', job.id);

  console.info(
    `[audio-generation] done job=${job.id} meditationId=${job.meditation_id} section=${job.script_section}`,
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

  const { data: jobs, error: fetchErr } = await supabase
    .from('audio_jobs')
    .select('id, meditation_id, script_section, voice_id')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchErr) {
    console.error('[audio-generation] fetch_error:', fetchErr.message);
    return NextResponse.json({ error: 'DB query failed' }, { status: 502 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0, failed: 0 });
  }

  await ensureBucketExists().catch((err: unknown) => {
    console.warn('[audio-generation] bucket_check_error:', err);
  });

  let processed = 0;
  let failed = 0;

  for (const job of jobs as AudioJobRow[]) {
    try {
      await processJob(job, elevenLabsKey);
      processed++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[audio-generation] error job=${job.id}:`, errMsg);
      await supabase
        .from('audio_jobs')
        .update({ status: 'failed', error: errMsg, updated_at: new Date().toISOString() })
        .eq('id', job.id);
      failed++;
    }
  }

  return NextResponse.json({ processed, failed });
}
