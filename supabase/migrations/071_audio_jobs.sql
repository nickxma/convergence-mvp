-- 071_audio_jobs.sql
--
-- Audio generation job queue for ElevenLabs TTS pipeline.
-- Activated when ELEVENLABS_API_KEY is provisioned (see OLU-236).
--
-- Each row is one TTS request for a single script section of a meditation.
-- Sections are identified by:
--   'intro'       → meditations.intro
--   'section-0'   → meditations.sections[0].text
--   'section-N'   → meditations.sections[N].text
--   'closing'     → meditations.closing

CREATE TABLE IF NOT EXISTS audio_jobs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meditation_id   uuid        NOT NULL REFERENCES meditations(id) ON DELETE CASCADE,
  script_section  text        NOT NULL,
  voice_id        text        NOT NULL,
  status          text        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued', 'processing', 'done', 'failed')),
  output_url      text,                  -- Supabase Storage public URL; set when done
  error           text,                  -- error message; set on failure
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup by meditation for the audio GET endpoint
CREATE INDEX IF NOT EXISTS idx_audio_jobs_meditation_id
  ON audio_jobs (meditation_id, created_at ASC);

-- Worker queue scan — only index pending rows
CREATE INDEX IF NOT EXISTS idx_audio_jobs_queued
  ON audio_jobs (created_at ASC)
  WHERE status = 'queued';

COMMENT ON TABLE audio_jobs IS
  'ElevenLabs TTS generation queue. One row per script section per meditation. '
  'Processed by /api/cron/audio-generation every minute. No-op when ELEVENLABS_API_KEY absent.';

COMMENT ON COLUMN audio_jobs.script_section IS
  'Section identifier: intro | section-0 | section-1 | ... | closing';
COMMENT ON COLUMN audio_jobs.voice_id IS
  'ElevenLabs voice ID to use for TTS synthesis';
COMMENT ON COLUMN audio_jobs.output_url IS
  'Supabase Storage public URL to the generated MP3; null until status = done';
COMMENT ON COLUMN audio_jobs.error IS
  'Last error message when status = failed';
