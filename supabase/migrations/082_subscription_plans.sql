-- 082_subscription_plans.sql
-- Structured subscription plan catalogue for PYUSD recurring billing.
--
-- subscription_plans  — the plan menu (Free, Pro, Team)
-- subscriptions       — gets plan_id + cancel_at_period_end columns added
--
-- Renewal flow:
--   1. Cron (GET /api/cron/subscription-renewals) runs 24h before currentPeriodEnd
--   2. Creates a new pyusd_payment_session (fulfillment_type='subscription')
--   3. Sends reminder email with payment link
--   4. Webhook confirms payment → upsert_subscription extends currentPeriodEnd by 30d

-- ─── subscription_plans ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscription_plans (
  id                   TEXT          PRIMARY KEY,     -- 'free', 'pro', 'team'
  name                 TEXT          NOT NULL,
  description          TEXT,
  features             JSONB         NOT NULL DEFAULT '[]',
  price_monthly_pyusd  NUMERIC(20,6) NOT NULL DEFAULT 0,
  active               BOOLEAN       NOT NULL DEFAULT true,
  sort_order           INTEGER       NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_subscription_plans" ON subscription_plans
  USING (auth.role() = 'service_role');

-- Allow public reads so the /pricing page can fetch plans via the anon key
CREATE POLICY "public_read_subscription_plans" ON subscription_plans
  FOR SELECT USING (active = true);

INSERT INTO subscription_plans (id, name, description, features, price_monthly_pyusd, sort_order)
VALUES
  ('free', 'Free', 'Get started with core Q&A.',
   '["5 questions/day","Read community","Intro courses only"]',
   0.00, 1),
  ('pro', 'Pro', 'Unlimited access for individual practitioners.',
   '["Unlimited Q&A","Full community access","Session notes","Wallet & token features","All courses"]',
   9.99, 2),
  ('team', 'Team', 'Everything in Pro, shared across your team.',
   '["Everything in Pro","Up to 5 team seats","Priority support","Team analytics"]',
   29.99, 3)
ON CONFLICT (id) DO NOTHING;

-- ─── Extend subscriptions table ───────────────────────────────────────────────

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS plan_id            TEXT REFERENCES subscription_plans(id),
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

-- Backfill plan_id from existing tier values
UPDATE subscriptions
SET plan_id = tier::text
WHERE plan_id IS NULL;

-- ─── subscription_payment_history ─────────────────────────────────────────────
-- Lightweight audit log so /account/billing can show payment history without
-- querying pyusd_payment_sessions directly.

CREATE TABLE IF NOT EXISTS subscription_payment_history (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT          NOT NULL,
  plan_id       TEXT          REFERENCES subscription_plans(id),
  amount_pyusd  NUMERIC(20,6) NOT NULL,
  tx_hash       TEXT,
  paid_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  period_end    TIMESTAMPTZ,
  notes         TEXT
);

ALTER TABLE subscription_payment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_sub_history" ON subscription_payment_history
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS sub_payment_history_user_idx
  ON subscription_payment_history (user_id, paid_at DESC);

-- ─── subscription_renewal_sessions ───────────────────────────────────────────
-- Track which renewal reminders have been sent to avoid duplicate emails.

CREATE TABLE IF NOT EXISTS subscription_renewal_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL,
  session_id   UUID        NOT NULL,  -- FK to pyusd_payment_sessions.id
  reminder_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, session_id)
);

ALTER TABLE subscription_renewal_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_renewal_sessions" ON subscription_renewal_sessions
  USING (auth.role() = 'service_role');
