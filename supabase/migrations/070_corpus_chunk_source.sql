-- 070_corpus_chunk_source.sql
-- Adds source_url and source_episode_id to corpus_chunks so citation cards
-- can render deep-link buttons back to the Waking Up episode or PoA essay.
--
-- source_url         — direct link: Waking Up app URL or paradoxofacceptance.xyz essay URL
-- source_episode_id  — Waking Up API episode ID (null for PoA chunks)

ALTER TABLE corpus_chunks
  ADD COLUMN IF NOT EXISTS source_url        text,
  ADD COLUMN IF NOT EXISTS source_episode_id text;

CREATE INDEX IF NOT EXISTS corpus_chunks_source_episode_id_idx
  ON corpus_chunks (source_episode_id)
  WHERE source_episode_id IS NOT NULL;
