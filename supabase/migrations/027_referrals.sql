-- Referral system: unique per-user codes, conversion tracking
--
-- user_referrals   – one row per user; holds their share code + conversion count
-- referral_conversions – one row per referred user who connected wallet

CREATE TABLE user_referrals (
  user_id       TEXT        NOT NULL PRIMARY KEY,
  code          TEXT        NOT NULL,
  invite_count  INTEGER     NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_referrals_code_unique UNIQUE (code)
);

CREATE TABLE referral_conversions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id TEXT        NOT NULL,
  referred_user_id TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referral_conversions_referred_unique UNIQUE (referred_user_id),
  CONSTRAINT referral_conversions_referrer_fk
    FOREIGN KEY (referrer_user_id) REFERENCES user_referrals(user_id)
);

CREATE INDEX referral_conversions_referrer_idx
  ON referral_conversions(referrer_user_id);

-- Service-role only; deny all direct RLS access
ALTER TABLE user_referrals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all ON user_referrals       USING (false);
CREATE POLICY deny_all ON referral_conversions USING (false);

-- record_referral_conversion(referred_user_id, ref_code)
-- Idempotent: UNIQUE on referred_user_id prevents double-counting.
-- Returns true if a new conversion was recorded, false otherwise.
CREATE OR REPLACE FUNCTION record_referral_conversion(
  p_referred_user_id TEXT,
  p_ref_code         TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_referrer_user_id TEXT;
BEGIN
  SELECT user_id INTO v_referrer_user_id
    FROM user_referrals
   WHERE code = p_ref_code;

  IF v_referrer_user_id IS NULL THEN
    RETURN false; -- unknown code
  END IF;

  IF v_referrer_user_id = p_referred_user_id THEN
    RETURN false; -- can't refer yourself
  END IF;

  INSERT INTO referral_conversions (referrer_user_id, referred_user_id)
       VALUES (v_referrer_user_id, p_referred_user_id)
  ON CONFLICT (referred_user_id) DO NOTHING;

  IF FOUND THEN
    UPDATE user_referrals
       SET invite_count = invite_count + 1
     WHERE user_id = v_referrer_user_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;
