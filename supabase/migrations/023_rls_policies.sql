-- 023_rls_policies.sql
-- Row Level Security audit: enable RLS on all tables that lack it and
-- verify policies match the intended access model.
--
-- Access model:
--   All writes flow through API routes that use the SERVICE ROLE key, which
--   bypasses RLS by design (Supabase default). RLS is a defence-in-depth
--   layer that prevents data exposure even if the anon key were to leak or
--   an API route were misconfigured.
--
--   The anon key is NOT used or exposed anywhere in this codebase — only
--   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present in the env, and
--   neither carries a NEXT_PUBLIC_ prefix (server-only).
--
-- Policy tiers used here:
--   "public read"       — SELECT allowed for all roles; no direct writes.
--   "service role only" — RLS enabled, USING(false) blocks all non-service access.
--
-- ── Tables already handled in prior migrations (no changes needed) ───────────
--
--   posts, replies          (001) — RLS on, "public read" SELECT policy
--   votes, user_profiles    (005) — RLS on, "public read" SELECT policy
--   flags                   (002) — RLS on, no permissive policy (service only)
--   audit_logs              (003) — RLS on, no permissive policy (service only)
--   webhooks,
--   webhook_deliveries      (004) — RLS on, explicit USING(false) policy
--   guest_usage             (019) — RLS on, no permissive policy (service only)
--
-- ── Tables receiving RLS in this migration ───────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLIC READ — content that is intentionally visible to all visitors
-- ─────────────────────────────────────────────────────────────────────────────

-- qa_answers: each answer gets a stable UUID for shareable links / OG images.
ALTER TABLE qa_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read qa_answers"
  ON qa_answers FOR SELECT USING (true);

-- post_reactions: emoji reaction counts shown on every community post.
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read post_reactions"
  ON post_reactions FOR SELECT USING (true);

-- qa_cache: cached answer content mirrors qa_answers; safe for anon reads.
ALTER TABLE qa_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read qa_cache"
  ON qa_cache FOR SELECT USING (true);

-- question_clusters: topic-cluster labels derived from hashed questions (no PII).
ALTER TABLE question_clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read question_clusters"
  ON question_clusters FOR SELECT USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- SERVICE ROLE ONLY — user-private data or internal state
-- USING(false) is explicit: no SELECT, INSERT, UPDATE, or DELETE for
-- the anon or authenticated roles. Service role bypasses this entirely.
-- ─────────────────────────────────────────────────────────────────────────────

-- conversation_sessions: per-user conversation history keyed by Privy user_id.
ALTER TABLE conversation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - conversation_sessions"
  ON conversation_sessions USING (false);

-- qa_feedback: thumbs-up/down quality ratings, one per (user_id, answer_id).
ALTER TABLE qa_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - qa_feedback"
  ON qa_feedback USING (false);

-- qa_analytics: internal query metrics (hashed questions, latency, model used).
ALTER TABLE qa_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - qa_analytics"
  ON qa_analytics USING (false);

-- corpus_manifest: tracks which transcript files have been embedded into Pinecone.
ALTER TABLE corpus_manifest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only - corpus_manifest"
  ON corpus_manifest USING (false);
