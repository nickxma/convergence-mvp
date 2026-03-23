-- 077_prize_shipments.sql
-- Prize shipment tracking for OpenClaw wins.
-- Created when POST /api/openclaw/sessions/:id/claim-prize records a prize
-- and a shipping address is provided.

CREATE TABLE prize_shipments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID        NOT NULL REFERENCES claw_sessions(id),
  user_id     TEXT        NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'processing', 'shipped', 'delivered', 'failed')),
  -- Shipping address supplied at claim time
  address     JSONB,
  -- Prize metadata (prizeId, wonAt, etc.) copied from claw_sessions.prize_metadata
  prize_meta  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX prize_shipments_session ON prize_shipments(session_id);
CREATE INDEX prize_shipments_user    ON prize_shipments(user_id);
CREATE INDEX prize_shipments_status  ON prize_shipments(status)
  WHERE status NOT IN ('delivered', 'failed');
