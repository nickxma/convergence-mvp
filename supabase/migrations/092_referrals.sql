-- 092_referrals.sql
-- Referral program for OpenClaw.
--
-- user_referral_codes  — each user gets a unique 8-char alphanumeric referral code
-- referrals            — tracks referrer → referee relationships
--
-- Flow:
--   1. GET  /api/users/me/referral        → get_or_create_referral_code(); return stats
--   2. POST /api/referrals/register       → client calls with ?ref=CODE after auth
--   3. POST /api/openclaw/sessions/start  → on first session, calls convert_referral()
--      which awards 3 free credits to the referrer

-- ─── user_referral_codes ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_referral_codes (
  user_id    TEXT        PRIMARY KEY,   -- Privy DID
  code       TEXT        UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE user_referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_user_referral_codes" ON user_referral_codes
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS user_referral_codes_code_idx ON user_referral_codes (code);

-- ─── referrals ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS referrals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id      TEXT        NOT NULL,   -- Privy DID of user who shared the link
  referee_id       TEXT        NOT NULL UNIQUE,  -- each user can only be referred once
  converted_at     TIMESTAMPTZ,            -- when referee completed first paid session
  reward_issued_at TIMESTAMPTZ,            -- when 3 credits were credited to referrer
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_referrals" ON referrals
  USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON referrals (referrer_id);
CREATE INDEX IF NOT EXISTS referrals_referee_id_idx  ON referrals (referee_id);

-- ─── Helper functions ─────────────────────────────────────────────────────────

-- Returns or creates the referral code for p_user_id.
-- Code is 8 uppercase alphanumeric characters derived from gen_random_uuid().
CREATE OR REPLACE FUNCTION get_or_create_referral_code(p_user_id TEXT)
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_code TEXT;
  v_attempt INT := 0;
BEGIN
  -- Try to fetch existing code first (fast path)
  SELECT code INTO v_code FROM user_referral_codes WHERE user_id = p_user_id;
  IF v_code IS NOT NULL THEN
    RETURN v_code;
  END IF;

  -- Generate a unique 8-char code, retry on collision (extremely rare)
  LOOP
    v_attempt := v_attempt + 1;
    IF v_attempt > 10 THEN
      RAISE EXCEPTION 'Failed to generate unique referral code after 10 attempts';
    END IF;

    -- Take first 8 chars of a UUID (hex), uppercase
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));

    BEGIN
      INSERT INTO user_referral_codes (user_id, code)
      VALUES (p_user_id, v_code);
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- code collision — retry
      CONTINUE;
    END;
  END LOOP;
END;
$$;

-- Register a referral: called when a newly-authenticated user has a ref= cookie.
-- Safe to call multiple times — is a no-op if referee already has a referral.
-- Returns TRUE on success, FALSE if the code is invalid or already referred.
CREATE OR REPLACE FUNCTION register_referral(p_referee_id TEXT, p_ref_code TEXT)
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id TEXT;
BEGIN
  -- Resolve the code to a referrer user_id
  SELECT user_id INTO v_referrer_id
  FROM user_referral_codes
  WHERE code = upper(p_ref_code);

  IF v_referrer_id IS NULL THEN
    RETURN FALSE;  -- unknown code
  END IF;

  -- Prevent self-referral
  IF v_referrer_id = p_referee_id THEN
    RETURN FALSE;
  END IF;

  -- Insert (no-op on conflict — unique referee_id)
  INSERT INTO referrals (referrer_id, referee_id)
  VALUES (v_referrer_id, p_referee_id)
  ON CONFLICT (referee_id) DO NOTHING;

  RETURN TRUE;
END;
$$;

-- Convert a referral: called on the referee's first paid claw session.
-- Awards 3 credits to the referrer.
-- Returns TRUE if conversion happened, FALSE if no pending referral exists or already converted.
CREATE OR REPLACE FUNCTION convert_referral(p_referee_id TEXT)
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_referral_id UUID;
  v_referrer_id TEXT;
BEGIN
  -- Find an unconverted referral for this referee
  SELECT id, referrer_id
  INTO v_referral_id, v_referrer_id
  FROM referrals
  WHERE referee_id = p_referee_id
    AND converted_at IS NULL
  FOR UPDATE SKIP LOCKED;

  IF v_referral_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Mark the referral as converted
  UPDATE referrals
  SET converted_at = now()
  WHERE id = v_referral_id;

  -- Award 3 credits to the referrer
  PERFORM add_user_credits(v_referrer_id, 3);

  -- Record reward issuance
  UPDATE referrals
  SET reward_issued_at = now()
  WHERE id = v_referral_id;

  RETURN TRUE;
END;
$$;

-- Referral leaderboard: top 20 referrers by converted referrals.
CREATE OR REPLACE FUNCTION get_referral_leaderboard()
  RETURNS TABLE (
    user_id      TEXT,
    converted    BIGINT,
    pending      BIGINT,
    credits_earned BIGINT
  )
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
AS $$
  SELECT
    referrer_id                                   AS user_id,
    COUNT(*) FILTER (WHERE converted_at IS NOT NULL) AS converted,
    COUNT(*) FILTER (WHERE converted_at IS NULL)     AS pending,
    COUNT(*) FILTER (WHERE reward_issued_at IS NOT NULL) * 3 AS credits_earned
  FROM referrals
  GROUP BY referrer_id
  ORDER BY converted DESC, pending DESC
  LIMIT 20;
$$;
