-- Track per-request OpenAI token usage and estimated cost for spend visibility and alerting.

CREATE TYPE openai_endpoint AS ENUM ('embedding', 'completion');

CREATE TABLE openai_usage (
  id                 UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  model              TEXT             NOT NULL,
  prompt_tokens      INTEGER          NOT NULL DEFAULT 0,
  completion_tokens  INTEGER          NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 8)   NOT NULL DEFAULT 0,
  endpoint           openai_endpoint  NOT NULL,
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

-- Daily cost aggregation (cron + admin API)
CREATE INDEX openai_usage_created_at_idx ON openai_usage (created_at DESC);
-- Per-model breakdown queries
CREATE INDEX openai_usage_model_created_at_idx ON openai_usage (model, created_at DESC);
