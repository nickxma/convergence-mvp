/**
 * GET /api/meditations/:id/audio
 *
 * Returns per-section ElevenLabs audio URLs for a generated meditation,
 * or {status: 'unavailable'} when audio has not been queued or generated.
 *
 * Response shape:
 *   {status: 'unavailable'}
 *     — no audio_jobs rows exist for this meditation
 *   {status: 'generating', sections: [...]}
 *     — at least one job is queued or processing
 *   {status: 'available', sections: [...]}
 *     — all jobs completed successfully
 *   {status: 'partial', sections: [...]}
 *     — all jobs finished but some failed
 *
 * Each section entry: {section: string, status: string, url: string | null}
 *
 * No auth required — audio URLs are public Supabase Storage links.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

interface AudioJobRow {
  script_section: string;
  status: string;
  output_url: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const { data: jobs, error } = await supabase
    .from('audio_jobs')
    .select('script_section, status, output_url')
    .eq('meditation_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error(`[/api/meditations/${id}/audio] db_error:`, error.message);
    return NextResponse.json(
      { error: { code: 'DB_ERROR', message: 'Failed to fetch audio status.' } },
      { status: 502 },
    );
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ status: 'unavailable' });
  }

  const sections = (jobs as AudioJobRow[]).map((j) => ({
    section: j.script_section,
    status: j.status,
    url: j.output_url ?? null,
  }));

  const allDone = sections.every((s) => s.status === 'done');
  const anyPending = sections.some((s) => s.status === 'queued' || s.status === 'processing');

  let overallStatus: 'available' | 'generating' | 'partial';
  if (allDone) {
    overallStatus = 'available';
  } else if (anyPending) {
    overallStatus = 'generating';
  } else {
    overallStatus = 'partial';
  }

  return NextResponse.json({ status: overallStatus, sections });
}
