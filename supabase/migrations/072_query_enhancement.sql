-- 072_query_enhancement.sql
--
-- Query enhancement pipeline (OLU-792): spell correction and synonym expansion.
--
-- 1. query_synonyms — curated mindfulness vocabulary synonym table.
--    Seeds the same mapping used by lib/query-normalization.ts SYNONYM_MAP
--    so the two stay in sync and admins can audit / extend the list via SQL.
--
-- 2. qa_analytics additions — log original vs. normalised query and whether
--    spell correction fired.  Lets us measure how often users misspell terms
--    and evaluate correction quality over time.

-- ── Synonyms table ────────────────────────────────────────────────────────────

create table if not exists query_synonyms (
  id         uuid        primary key default gen_random_uuid(),
  term       text        not null unique,
  synonyms   text[]      not null default '{}',
  created_at timestamptz not null default now()
);

comment on table query_synonyms is
  'Curated synonyms for mindfulness/meditation domain terms. '
  'Mirrors SYNONYM_MAP in lib/query-normalization.ts for admin visibility.';

-- Seed initial mindfulness vocabulary
insert into query_synonyms (term, synonyms) values
  ('meditation',   array['mindfulness', 'contemplation']),
  ('mindfulness',  array['meditation', 'awareness']),
  ('awareness',    array['mindfulness', 'consciousness']),
  ('consciousness',array['awareness', 'presence']),
  ('impermanence', array['anicca', 'transience']),
  ('anicca',       array['impermanence', 'transience']),
  ('transience',   array['impermanence', 'anicca']),
  ('anatta',       array['selflessness', 'non-self']),
  ('selflessness', array['anatta', 'non-self']),
  ('dukkha',       array['suffering', 'dissatisfaction']),
  ('suffering',    array['dukkha', 'dissatisfaction']),
  ('equanimity',   array['calm', 'serenity']),
  ('compassion',   array['kindness', 'metta']),
  ('metta',        array['loving-kindness', 'compassion']),
  ('enlightenment',array['awakening', 'liberation']),
  ('awakening',    array['enlightenment', 'liberation']),
  ('liberation',   array['awakening', 'enlightenment']),
  ('nonduality',   array['non-dual', 'advaita']),
  ('advaita',      array['nonduality', 'non-dual']),
  ('vipassana',    array['insight', 'mindfulness']),
  ('insight',      array['wisdom', 'vipassana']),
  ('wisdom',       array['insight', 'prajna']),
  ('presence',     array['awareness', 'now']),
  ('attachment',   array['clinging', 'craving']),
  ('craving',      array['attachment', 'desire']),
  ('breath',       array['breathing', 'pranayama']),
  ('breathing',    array['breath', 'pranayama']),
  ('pranayama',    array['breathwork', 'breathing']),
  ('emptiness',    array['sunyata', 'openness']),
  ('sunyata',      array['emptiness', 'openness']),
  ('samadhi',      array['concentration', 'absorption']),
  ('karma',        array['action', 'intention']),
  ('dharma',       array['teaching', 'truth']),
  ('sangha',       array['community', 'practice']),
  ('retreat',      array['silence', 'practice'])
on conflict (term) do nothing;

-- ── qa_analytics additions ────────────────────────────────────────────────────

alter table qa_analytics
  add column if not exists original_query   text,
  add column if not exists normalized_query text,
  add column if not exists spell_corrected  boolean default false;

comment on column qa_analytics.original_query is
  'Raw question as submitted by the user before normalization.';
comment on column qa_analytics.normalized_query is
  'Query after spell-correction and normalization (OLU-792). '
  'Null when the pipeline was skipped (e.g. follow-up turns).';
comment on column qa_analytics.spell_corrected is
  'True when the spell-corrector changed at least one word in the query.';
