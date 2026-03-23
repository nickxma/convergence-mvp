-- 081_credit_packages.sql
-- Credit system for OpenClaw machine play sessions.
--
-- credit_packages  — catalogue of purchasable credit packs (e.g. 3 / 10 / 25 plays)
-- user_credits     — per-user credit balance
--
-- Purchasing flow:
--   1. POST /api/credits/purchase  → creates pyusd_payment_session (fulfillment_type='credit_purchase')
--   2. POST /api/webhooks/pyusd-transfer confirms payment → calls add_user_credits()
--   3. GET  /api/users/me/credits  → returns current balance
--
-- Credit deduction happens in the machine queue join route (one credit per play).

-- ─── credit_packages ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS credit_packages (
  id             TEXT          PRIMARY KEY,            -- e.g. 'pack_3', 'pack_10', 'pack_25'
  label          TEXT          NOT NULL,               -- display name: "3 Play Credits"
  credits        INTEGER       NOT NULL CHECK (credits > 0),
  price_usd      NUMERIC(10,2) NOT NULL,
  price_pyusd    NUMERIC(20,6) NOT NULL,
  active         BOOLEAN       NOT NULL DEFAULT true,
  sort_order     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE credit_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_credit_packages" ON credit_packages
  USING (auth.role() = 'service_role');

-- Seed the three standard packs
INSERT INTO credit_packages (id, label, credits, price_usd, price_pyusd, sort_order)
VALUES
  ('pack_3',  '3 Play Credits',   3,  3.00,  3.00, 1),
  ('pack_10', '10 Play Credits', 10,  8.00,  8.00, 2),
  ('pack_25', '25 Play Credits', 25, 15.00, 15.00, 3)
ON CONFLICT (id) DO NOTHING;

-- ─── user_credits ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_credits (
  user_id     TEXT        PRIMARY KEY,   -- Privy DID
  balance     INTEGER     NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_user_credits" ON user_credits
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS user_credits_user_id_idx ON user_credits (user_id);

-- ─── Extend pyusd_payment_sessions ────────────────────────────────────────────
--
-- fulfillment_type  — 'subscription' (existing) or 'credit_purchase' (new)
-- credit_package_id — FK to credit_packages; set when fulfillment_type='credit_purchase'
-- tier is only required for subscriptions; nullable for credit purchases.

ALTER TABLE pyusd_payment_sessions
  ALTER COLUMN tier DROP NOT NULL,
  ALTER COLUMN tier DROP DEFAULT;

ALTER TABLE pyusd_payment_sessions
  ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'subscription'
    CHECK (fulfillment_type IN ('subscription', 'credit_purchase')),
  ADD COLUMN IF NOT EXISTS credit_package_id TEXT REFERENCES credit_packages(id);

-- Restore sensible defaults for existing rows (all pre-081 rows are subscriptions)
UPDATE pyusd_payment_sessions SET fulfillment_type = 'subscription' WHERE fulfillment_type IS NULL;

-- ─── Helper function ──────────────────────────────────────────────────────────

-- Atomically add credits to a user's balance (upsert).
-- Returns the new balance.
CREATE OR REPLACE FUNCTION add_user_credits(p_user_id TEXT, p_amount INTEGER)
  RETURNS INTEGER
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_balance INTEGER;
BEGIN
  INSERT INTO user_credits (user_id, balance, updated_at)
  VALUES (p_user_id, p_amount, now())
  ON CONFLICT (user_id) DO UPDATE
    SET balance    = user_credits.balance + EXCLUDED.balance,
        updated_at = now()
  RETURNING balance INTO v_balance;
  RETURN v_balance;
END;
$$;

-- Atomically deduct one credit (returns false if balance insufficient).
CREATE OR REPLACE FUNCTION deduct_user_credit(p_user_id TEXT)
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  UPDATE user_credits
  SET balance    = balance - 1,
      updated_at = now()
  WHERE user_id = p_user_id
    AND balance >= 1;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;
