/**
 * GET /api/meditations/:id/audio
 *
 * Returns audio status for a generated meditation.
 *
 * --- Polling mode (default) ---
 * Response shape:
 *   { status: 'unavailable' }
 *     — no audio jobs queued
 *   { status: 'generating' }
 *     — full-script job in progress
 *   { status: 'available', audioUrl, audioDurationSeconds }
 *     — full-script MP3 ready (meditation.audio_url is set)
 *   { status: 'failed' }
 *     — latest full-script job failed
 *
 * --- SSE streaming mode (?stream=1) ---
 * Opens an SSE stream. Immediately sends a `status` event with current state.
 * When the cron finishes the full-script job it publishes an `audio_ready` or
 * `audio_error` event on the in-memory bus; this route forwards it to the client.
 *
 * Events:
 *   status       { status: 'generating' | 'available' | ... }  — initial state
 *   audio_ready  { audioUrl, audioDurationSeconds }
 *   audio_error  { message }
 *
 * No auth required — audio URLs are public Supabase Storage links.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { subscribeAudio } from '@/lib/meditation-audio-bus';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface AudioJobRow {
  script_section: string;
  status: string;
  output_url: string | null;
  job_type: string;
}

async function getAudioStatus(meditationId: string) {
  // Check meditation row for full-script audio (fastest path)
  const { data: med } = await supabase
    .from('meditations')
    .select('audio_url, audio_duration_seconds')
    .eq('id', meditationId)
    .single();

  if (med?.audio_url) {
    return {
      status: 'available' as const,
      audioUrl: med.audio_url as string,
      audioDurationSeconds: (med.audio_duration_seconds as number | null) ?? null,
    };
  }

  const { data: jobs } = await supabase
    .from('audio_jobs')
    .select('script_section, status, output_url, job_type')
    .eq('meditation_id', meditationId)
    .order('created_at', { ascending: false });

  if (!jobs || jobs.length === 0) return { status: 'unavailable' as const };

  const fullJob = (jobs as AudioJobRow[]).find((j) => j.job_type === 'full');
  if (fullJob) {
    if (fullJob.status === 'queued' || fullJob.status === 'processing') {
      return { status: 'generating' as const };
    }
    if (fullJob.status === 'failed') return { status: 'failed' as const };
  }

  // Legacy: per-section jobs
  const sectionJobs = (jobs as AudioJobRow[]).filter((j) => j.job_type === 'section');
  if (sectionJobs.length === 0) return { status: 'unavailable' as const };

  const allDone = sectionJobs.every((j) => j.status === 'done');
  const anyPending = sectionJobs.some(
    (j) => j.status === 'queued' || j.status === 'processing',
  );

  if (allDone) {
    return {
      status: 'available' as const,
      sections: sectionJobs.map((j) => ({ section: j.script_section, url: j.output_url })),
    };
  }
  if (anyPending) return { status: 'generating' as const };
  return { status: 'partial' as const };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response | NextResponse> {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'Invalid meditation id.' } },
      { status: 400 },
    );
  }

  if (req.nextUrl.searchParams.get('stream') !== '1') {
    // Polling mode
    const audioStatus = await getAudioStatus(id);
    return NextResponse.json(audioStatus);
  }

  // ── SSE streaming mode ────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  function frame(eventType: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const currentStatus = await getAudioStatus(id);
      controller.enqueue(frame('status', currentStatus));

      if (currentStatus.status === 'available' || currentStatus.status === 'failed') {
        controller.close();
        return;
      }

      const unsubscribe = subscribeAudio(id, (event) => {
        try {
          controller.enqueue(frame(event.type, event.data));
          if (event.type === 'audio_ready' || event.type === 'audio_error') {
            setTimeout(() => {
              try { controller.close(); } catch { /* already closed */ }
            }, 500);
          }
        } catch { /* stream already closed */ }
      });

      const pingInterval = setInterval(() => {
        try { controller.enqueue(encoder.encode(': ping\n\n')); }
        catch { clearInterval(pingInterval); }
      }, 20_000);

      const timeoutTimer = setTimeout(() => {
        try {
          controller.enqueue(frame('audio_error', { message: 'Audio generation timed out.' }));
          controller.close();
        } catch { /* already closed */ }
      }, 5 * 60_000);

      req.signal.addEventListener('abort', () => {
        unsubscribe();
        clearInterval(pingInterval);
        clearTimeout(timeoutTimer);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
