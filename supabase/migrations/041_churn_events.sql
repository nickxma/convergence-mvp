-- 041_churn_events.sql
-- Churn analytics: stores cancellation survey responses with MRR tracking.
--
-- churn_events — one row per cancellation survey submission.
--   reason       — short code: price, missing_feature, not_using, switching, other
--   reason_detail — optional free-text elaboration
--   mrr_lost     — monthly recurring revenue lost in USD (computed from Stripe)
--   cancelled_at — when the survey was submitted (defaults to NOW())

CREATE TABLE IF NOT EXISTS churn_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT          NOT NULL,
  subscription_id TEXT          NOT NULL,  -- Stripe subscription ID
  reason          TEXT          NOT NULL,
  reason_detail   TEXT,
  mrr_lost        NUMERIC(10,2),           -- USD; NULL if Stripe lookup fails
  cancelled_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

ALTER TABLE churn_events ENABLE ROW LEVEL SECURITY;

-- All reads and writes flow through the service-role API server
CREATE POLICY "service role only churn_events"
  ON churn_events USING (false);

CREATE INDEX IF NOT EXISTS churn_events_cancelled_at_idx ON churn_events (cancelled_at);
CREATE INDEX IF NOT EXISTS churn_events_user_id_idx      ON churn_events (user_id);
