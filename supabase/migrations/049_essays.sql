-- Essays table: stores Paradox of Acceptance essays for Q&A context injection.
-- Used by /api/ask when essaySlug is provided to make answers essay-aware.

create table if not exists public.essays (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  title       text        not null,
  body_markdown text      not null default '',
  tags        text[]      not null default '{}',
  published   boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists essays_slug_idx on public.essays (slug);
create index if not exists essays_published_idx on public.essays (published) where published = true;

-- Seed with known essays (body_markdown populated separately via CMS/scripts)
insert into public.essays (slug, title, tags, published) values
  ('paradox-of-acceptance',         'The Paradox of Acceptance',                                    array['acceptance','ambition','mindfulness','non-dual'], true),
  ('should-you-get-into-mindfulness','Should You Get Into Mindfulness? The Case for Dosage',          array['mindfulness','dosage','practice','beginners'],    true),
  ('the-avoidance-problem',          'The Avoidance Problem: When Meditation Becomes Evasion',        array['avoidance','meditation','evasion','emotions'],    true),
  ('the-cherry-picking-problem',     'The Cherry-Picking Problem: What Non-Dual Practice Costs',      array['non-dual','self','ambition','practice'],          true),
  ('when-to-quit',                   'When to Quit: The Exit Conditions Mindfulness Never Names',     array['quitting','exit','mindfulness','boundaries'],     true)
on conflict (slug) do nothing;
