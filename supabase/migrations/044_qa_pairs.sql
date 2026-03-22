-- Curated question catalogue for autocomplete suggestions.
-- qa_pairs stores canonical questions used in type-ahead; view_count is
-- incremented each time a question is selected from the suggestion dropdown.
-- Full-text search index enables fast prefix/keyword matching.

create table if not exists qa_pairs (
  id          uuid        primary key default gen_random_uuid(),
  question    text        not null,
  view_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

-- Full-text search over question text (English stemming)
create index if not exists qa_pairs_question_fts_idx
  on qa_pairs using gin(to_tsvector('english', question));

-- Fast ordering by popularity
create index if not exists qa_pairs_view_count_idx
  on qa_pairs(view_count desc);

-- Seed curated starter questions so new users see suggestions immediately.
-- Questions are drawn from core Paradox of Acceptance / contemplative themes.
insert into qa_pairs (question, view_count) values
  ('What is the paradox of acceptance?', 0),
  ('How does acceptance relate to change?', 0),
  ('What is the difference between acceptance and resignation?', 0),
  ('How can I practice acceptance in daily life?', 0),
  ('What does it mean to accept difficult emotions?', 0),
  ('How do I meditate when my mind keeps wandering?', 0),
  ('What is mindfulness and how do I practice it?', 0),
  ('How can I observe my thoughts without getting caught up in them?', 0),
  ('What does it mean to be present in this moment?', 0),
  ('How does resistance cause suffering?', 0),
  ('What is non-attachment and how do I cultivate it?', 0),
  ('How do I stop identifying with my thoughts?', 0),
  ('What is the nature of the self?', 0),
  ('How does mindfulness reduce anxiety?', 0),
  ('What is loving-kindness meditation and how do I practice it?', 0),
  ('How can I sit with uncomfortable emotions without reacting?', 0),
  ('What is the relationship between consciousness and awareness?', 0),
  ('How does the mind construct a sense of self?', 0),
  ('What is Vipassana meditation?', 0),
  ('How do I deal with intrusive thoughts during meditation?', 0),
  ('What is the observer self?', 0),
  ('How can equanimity help with suffering?', 0),
  ('What does Buddhist philosophy say about impermanence?', 0),
  ('How does acceptance relate to compassion?', 0),
  ('What is the default mode network and why does it matter?', 0),
  ('How can I apply mindfulness to anger or frustration?', 0),
  ('What is the relationship between thoughts and emotions?', 0),
  ('How do I know if my meditation practice is working?', 0),
  ('What does it mean to let go?', 0),
  ('How can I maintain awareness throughout the day, not just during formal meditation?', 0)
on conflict do nothing;
