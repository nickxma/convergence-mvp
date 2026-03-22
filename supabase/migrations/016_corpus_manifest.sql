-- 016_corpus_manifest.sql
-- Tracks which transcript files have been embedded into Pinecone.
-- Enables incremental refresh: only new/changed files are re-embedded.

CREATE TABLE corpus_manifest (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  filename    text        NOT NULL UNIQUE,
  file_hash   text        NOT NULL,   -- SHA-256 of file content (change detection)
  chunk_count integer     NOT NULL DEFAULT 0,
  embedded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX corpus_manifest_filename_idx ON corpus_manifest (filename);
