-- 079_meditations_audio_url.sql
--
-- Adds full-script audio URL and duration to the meditations table.
-- Populated by the audio-generation cron after all paragraphs are
-- concatenated and uploaded as a single MP3.
--
-- Also adds a job_type column to audio_jobs to distinguish between
-- per-section jobs (original approach) and full-script jobs (new).

ALTER TABLE meditations
  ADD COLUMN IF NOT EXISTS audio_url               TEXT,
  ADD COLUMN IF NOT EXISTS audio_duration_seconds  INTEGER;

-- job_type: 'section' (original per-section) | 'full' (new full-script)
ALTER TABLE audio_jobs
  ADD COLUMN IF NOT EXISTS job_type TEXT NOT NULL DEFAULT 'section'
    CHECK (job_type IN ('section', 'full'));

-- Index for the cron to quickly find pending full-script jobs
CREATE INDEX IF NOT EXISTS idx_audio_jobs_full_queued
  ON audio_jobs (created_at ASC)
  WHERE status = 'queued' AND job_type = 'full';

COMMENT ON COLUMN meditations.audio_url             IS 'Supabase Storage public URL for the concatenated full-script MP3; null until generated';
COMMENT ON COLUMN meditations.audio_duration_seconds IS 'Duration of the generated audio in seconds; null until generated';
COMMENT ON COLUMN audio_jobs.job_type               IS 'section = per-section TTS job; full = full-script concatenated TTS job';
