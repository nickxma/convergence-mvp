-- 034_course_sessions.sql
-- Individual sessions (lessons) within a course.
-- Each session has text content and an optional audio narration URL.
--
-- RLS model:
--   course_sessions → public read
--   writes          → service role only (admin API)

CREATE TABLE IF NOT EXISTS course_sessions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id     UUID        NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  slug          TEXT        NOT NULL,
  title         TEXT        NOT NULL,
  body          TEXT        NOT NULL DEFAULT '',
  audio_url     TEXT        DEFAULT NULL,  -- Supabase Storage signed URL or public CDN URL
  sort_order    INT         NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(course_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_course_sessions_course
  ON course_sessions (course_id, sort_order ASC);

ALTER TABLE course_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read course_sessions"
  ON course_sessions FOR SELECT USING (true);

CREATE POLICY "service role writes course_sessions"
  ON course_sessions FOR ALL USING (false);

-- ─── Seed: The Honest Meditator — 6 sessions ─────────────────────────────────

WITH course AS (
  SELECT id FROM courses WHERE slug = 'the-honest-meditator' LIMIT 1
)
INSERT INTO course_sessions (course_id, slug, title, body, sort_order)
SELECT
  course.id,
  s.slug,
  s.title,
  s.body,
  s.sort_order
FROM course, (VALUES
  (1, 'session-1', 'What Meditation Actually Does',
   'Most accounts of meditation focus on what it gives you: calm, clarity, presence. This session examines the other side — what it takes away, and why that matters for how you live.

The honest starting point is that sustained meditation practice tends to reduce the sense of urgency that normally drives action. Goals feel less pressing. Stakes feel lower. This is often framed as a feature, but it deserves examination.

Notice over the next few days: which of your motivations depend on a felt sense of threat or lack? How many of your ambitions are fueled by something you''re trying to escape?'),
  (2, 'session-2', 'The Urgency Problem',
   'Urgency is a signal. It tells you something matters, that time is short, that action is required. Meditation, practiced deeply, quiets that signal.

For many practitioners, this creates a paradox: they wanted meditation to help them perform better, but find themselves less driven. The tasks remain; the burning need to complete them has cooled.

This session explores whether that cooling is wisdom or erosion — and how to tell the difference from the inside.'),
  (3, 'session-3', 'Motivation Without Suffering',
   'Is it possible to care about something without suffering when it''s absent? To want without the wanting being a kind of pain?

This is one of the central questions meditation surfaces but rarely answers directly. Most teachings side-step it by suggesting that true goals will remain after practice — that you''ll still pursue what matters, just without the neurotic edge.

The evidence is mixed. Some practitioners report exactly this. Others find their goals quietly dissolve. This session looks honestly at both outcomes.'),
  (4, 'session-4', 'Felt Stakes and Real Consequences',
   'There''s a difference between felt stakes — the emotional weight you experience around an outcome — and actual consequences, what objectively happens if you succeed or fail.

Meditation tends to reduce felt stakes. It does not reduce actual consequences. The project still has a deadline. The relationship still needs tending. The body still ages.

Understanding this gap is essential for practice that doesn''t become spiritual bypassing.'),
  (5, 'session-5', 'What Teachers Don''t Say',
   'The gaps in meditation instruction are often more revealing than the content. What gets omitted, softened, or left to the student to discover?

This session catalogs the common silences: the relationship between deep practice and reduced goal-directedness, the way some practitioners use meditation to avoid rather than engage, the difficulty of maintaining practice through periods of genuine suffering rather than just stress.

These aren''t criticisms of meditation. They''re the map the honest practitioner needs.'),
  (6, 'session-6', 'Integration',
   'The final session is about living with what you''ve found. If meditation has changed what you want — or how much you want it — what do you do with that?

Integration isn''t about resolving the paradox. It''s about being honest with yourself about the trade-offs, understanding what you''ve gained and what you''ve lost, and making deliberate choices about how to practice going forward.

Acceptance, in the end, isn''t passive. It''s a form of clear seeing that allows more precise action, not less.')
) AS s(sort_order, slug, title, body)
ON CONFLICT (course_id, slug) DO NOTHING;
