-- 035_subscription_tiers.sql
-- Subscription tier system: free / pro / team
--
-- subscriptions         — one row per authenticated user; tracks tier + Stripe billing
-- user_daily_qa_usage   — per-user daily Q&A question counter (free tier enforcement)
--
-- Free tier:  5 Q&A questions / day, community read+write, intro courses only
-- Pro tier:   unlimited Q&A, all courses, bypass semantic cache
-- Team tier:  placeholder for future

-- ─── Tier enum ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'team');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── subscriptions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                TEXT              UNIQUE NOT NULL,  -- Privy DID (did:privy:…)
  wallet_address         TEXT,
  tier                   subscription_tier NOT NULL DEFAULT 'free',
  stripe_subscriber      BOOLEAN           NOT NULL DEFAULT false,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  subscription_status    TEXT,             -- active, canceled, past_due, …
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- All reads and writes flow through the service-role API server
CREATE POLICY "service role only subscriptions"
  ON subscriptions USING (false);

-- Index for fast user_id lookup
CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS subscriptions_wallet_address_idx ON subscriptions (wallet_address);

-- ─── user_daily_qa_usage ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_daily_qa_usage (
  user_id  TEXT  NOT NULL,
  date     DATE  NOT NULL DEFAULT CURRENT_DATE,
  count    INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT user_daily_qa_usage_pkey PRIMARY KEY (user_id, date)
);

ALTER TABLE user_daily_qa_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only usage"
  ON user_daily_qa_usage USING (false);

-- ─── Helper functions ─────────────────────────────────────────────────────────

-- Atomically increment a user's daily Q&A count and return the new value.
-- Used to enforce free-tier daily limits.
CREATE OR REPLACE FUNCTION increment_user_qa_usage(p_user_id TEXT)
  RETURNS INTEGER
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO user_daily_qa_usage (user_id, date, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, date)
  DO UPDATE SET count = user_daily_qa_usage.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

-- Upsert a subscription record (create or update tier + stripe fields).
-- Called by Stripe webhook handler on checkout.session.completed.
CREATE OR REPLACE FUNCTION upsert_subscription(
  p_user_id              TEXT,
  p_wallet_address       TEXT,
  p_tier                 subscription_tier,
  p_stripe_subscriber    BOOLEAN,
  p_stripe_customer_id   TEXT DEFAULT NULL,
  p_stripe_subscription_id TEXT DEFAULT NULL,
  p_subscription_status  TEXT DEFAULT NULL,
  p_current_period_end   TIMESTAMPTZ DEFAULT NULL
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO subscriptions (
    user_id, wallet_address, tier, stripe_subscriber,
    stripe_customer_id, stripe_subscription_id,
    subscription_status, current_period_end, updated_at
  ) VALUES (
    p_user_id, p_wallet_address, p_tier, p_stripe_subscriber,
    p_stripe_customer_id, p_stripe_subscription_id,
    p_subscription_status, p_current_period_end, NOW()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    wallet_address        = COALESCE(EXCLUDED.wallet_address, subscriptions.wallet_address),
    tier                  = EXCLUDED.tier,
    stripe_subscriber     = EXCLUDED.stripe_subscriber,
    stripe_customer_id    = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
    stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, subscriptions.stripe_subscription_id),
    subscription_status   = EXCLUDED.subscription_status,
    current_period_end    = EXCLUDED.current_period_end,
    updated_at            = NOW();
END;
$$;
