-- 032_course_reviews.sql
-- Per-user course ratings and optional text reviews for paradoxofacceptance.xyz.
--
-- course_reviews — one row per (user, course); upsert on resubmit
--
-- RLS model:
--   SELECT  → public (anyone may read reviews)
--   INSERT/UPDATE/DELETE → service role only (API server owns writes)

CREATE TABLE IF NOT EXISTS course_reviews (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL,
  course_id   UUID        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  rating      INT         NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT        CHECK (char_length(review_text) <= 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_course_reviews_course
  ON course_reviews (course_id, created_at DESC);

ALTER TABLE course_reviews ENABLE ROW LEVEL SECURITY;

-- Anyone can read reviews
CREATE POLICY "public read course_reviews"
  ON course_reviews FOR SELECT USING (true);

-- All writes go through the service-role API server
CREATE POLICY "service role writes course_reviews"
  ON course_reviews FOR ALL USING (false);
