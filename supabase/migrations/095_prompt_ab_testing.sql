-- 095_prompt_ab_testing.sql
-- Prompt A/B testing framework for the Q&A engine.
--
-- prompt_variants    — system prompt variants with traffic allocation
-- query_variant_log  — per-query variant assignment + feedback + latency
--
-- Flow:
--   1. Admin creates variants via POST /api/admin/experiments/variants
--   2. /api/ask selects variant by weighted random (trafficPct), logs queryId
--   3. Client submits feedback (thumbs up/down) via POST /api/answers/:queryId/feedback
--   4. GET /api/admin/experiments/results returns per-variant metrics + significance flags

-- ─── prompt_variants ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_variants (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL UNIQUE,
  system_prompt TEXT       NOT NULL,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  traffic_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (traffic_pct >= 0 AND traffic_pct <= 100),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prompt_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_prompt_variants" ON prompt_variants
  USING (auth.role() = 'service_role');

-- ─── query_variant_log ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_variant_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id        UUID        NOT NULL UNIQUE,   -- one entry per Q&A query
  variant_id      UUID        NOT NULL REFERENCES prompt_variants(id),
  feedback_rating SMALLINT    CHECK (feedback_rating IN (-1, 1)),  -- 1=thumbs up, -1=thumbs down; NULL until rated
  latency_ms      INTEGER,    -- milliseconds from request start to finish
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE query_variant_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_query_variant_log" ON query_variant_log
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS query_variant_log_variant_id_idx
  ON query_variant_log (variant_id);

CREATE INDEX IF NOT EXISTS query_variant_log_created_at_idx
  ON query_variant_log (created_at DESC);

-- Composite index for per-variant metrics queries
CREATE INDEX IF NOT EXISTS query_variant_log_variant_feedback_idx
  ON query_variant_log (variant_id, feedback_rating);
