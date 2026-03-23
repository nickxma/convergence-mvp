-- Q&A response quality / format metrics
-- Adds per-response structural metrics to qa_analytics so we can track
-- formatting quality before and after model changes (see OLU-588 / OLU-592).
-- No PII — only structural counts and booleans derived from the response text.

alter table qa_analytics
  add column if not exists word_count      integer,   -- total words in response
  add column if not exists paragraph_count integer,   -- \n\n-separated non-empty blocks
  add column if not exists has_headers     boolean,   -- response contains # markdown headers
  add column if not exists has_bullets     boolean;   -- response contains - / * list items

-- Index for aggregate queries: average paragraph_count over time (before/after model change)
create index if not exists qa_analytics_format_created_at_idx
  on qa_analytics (created_at, paragraph_count)
  where paragraph_count is not null;
