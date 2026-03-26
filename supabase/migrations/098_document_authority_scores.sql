-- 098_document_authority_scores.sql
--
-- Adds per-source quality signals to the documents table for authority-aware
-- retrieval ranking. Also creates answer_source_log to track which documents
-- are cited per query, enabling weekly citation metrics computation.
--
-- New columns on documents:
--   authority_score          NUMERIC(3,2)  — admin-set quality weight [0, 1], default 0.50
--   citation_count           INTEGER       — number of queries that cited this document
--   positive_ratio_when_cited NUMERIC(4,3) — thumbs-up fraction when cited (NULL until computed)
--   quality_updated_at       TIMESTAMPTZ   — when citation stats were last recomputed

ALTER TABLE documents
  ADD COLUMN authority_score           NUMERIC(3,2)  NOT NULL DEFAULT 0.50,
  ADD COLUMN citation_count            INTEGER       NOT NULL DEFAULT 0,
  ADD COLUMN positive_ratio_when_cited NUMERIC(4,3),
  ADD COLUMN quality_updated_at        TIMESTAMPTZ;

ALTER TABLE documents
  ADD CONSTRAINT documents_authority_score_range CHECK (authority_score >= 0 AND authority_score <= 1);

COMMENT ON COLUMN documents.authority_score IS
  'Admin-assigned authority weight [0,1]. Blended into retrieval ranking at query time.';
COMMENT ON COLUMN documents.citation_count IS
  'Number of distinct queries whose answer cited at least one chunk from this document.';
COMMENT ON COLUMN documents.positive_ratio_when_cited IS
  'Fraction of cited answers that received a thumbs-up (NULL until weekly rollup has run).';
COMMENT ON COLUMN documents.quality_updated_at IS
  'Timestamp of the last source-authority-rollup cron run that updated this document.';

-- ── answer_source_log ─────────────────────────────────────────────────────────
-- Logs which documents were cited in each query response.
-- Populated fire-and-forget by /api/ask after retrieval.
-- Read by /api/cron/source-authority-rollup to compute citation stats.

CREATE TABLE answer_source_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id   uuid        NOT NULL,
  source_id  text        NOT NULL,  -- matches documents.source_id (Pinecone source_file metadata)
  cited_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX answer_source_log_source_id_idx  ON answer_source_log (source_id);
CREATE INDEX answer_source_log_query_id_idx   ON answer_source_log (query_id);
CREATE INDEX answer_source_log_cited_at_idx   ON answer_source_log (cited_at DESC);
