-- Migration: 004_webhooks
-- Webhook configuration and delivery tracking for community events

-- Registered webhook endpoints
CREATE TABLE IF NOT EXISTS webhooks (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  url         TEXT        NOT NULL,
  event_types TEXT[]      NOT NULL DEFAULT '{}',  -- e.g. ['post.created','reply.created','vote.milestone']
  secret      TEXT        NOT NULL,               -- HMAC signing secret (stored hashed on retrieval, raw for signing)
  created_by  TEXT        NOT NULL,               -- admin wallet address
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Delivery log — one row per attempted delivery per webhook per event
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID        NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  attempt_count   INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'pending', -- pending | delivered | failed
  last_status_code INTEGER,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for retry sweeps
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON webhook_deliveries (status, next_attempt_at)
  WHERE status = 'pending';

-- Index for per-webhook delivery history
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id
  ON webhook_deliveries (webhook_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER webhooks_updated_at
  BEFORE UPDATE ON webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER webhook_deliveries_updated_at
  BEFORE UPDATE ON webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: service role only (admin-gated at application layer)
ALTER TABLE webhooks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- No public access — all access via service-role client
CREATE POLICY "service role only" ON webhooks           USING (FALSE);
CREATE POLICY "service role only" ON webhook_deliveries USING (FALSE);
