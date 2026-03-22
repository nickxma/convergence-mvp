-- Migration 037: Concept Knowledge Graph for Cross-Teacher Synthesis
-- OLU-443: RAG improvement stretch goal
--
-- Schema overview:
--   concepts          — unique concept nodes with embeddings for semantic search
--   concept_teachers  — concept × teacher associations with perspective summaries
--   concept_relations — directed edges: agrees_with, contrasts_with, builds_on, subtopic_of
--   chunk_concepts    — chunk (Pinecone vector ID) × concept mapping

-- ── concepts ─────────────────────────────────────────────────────────────────
-- Each row is a unique concept extracted from the corpus.
-- embedding allows pgvector similarity search at query time.

create table if not exists concepts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  normalized_name text not null unique,   -- lowercase, stripped for dedup
  description     text,                   -- one-sentence definition (LLM-generated)
  embedding       vector(1536),           -- text-embedding-3-small for concept search
  chunk_count     integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists concepts_normalized_name_idx on concepts (normalized_name);

-- HNSW index for concept semantic search (used at query time to find related concepts)
create index if not exists concepts_embedding_hnsw_idx
  on concepts using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- ── concept_teachers ─────────────────────────────────────────────────────────
-- How each teacher engages with each concept.
-- perspective_summary is a short LLM-generated synthesis of that teacher's view.

create table if not exists concept_teachers (
  concept_id          uuid not null references concepts (id) on delete cascade,
  teacher_name        text not null,
  chunk_count         integer not null default 0,
  perspective_summary text,               -- ~2-sentence synthesis per teacher×concept pair
  updated_at          timestamptz not null default now(),
  primary key (concept_id, teacher_name)
);

create index if not exists concept_teachers_teacher_idx on concept_teachers (teacher_name);
create index if not exists concept_teachers_concept_idx on concept_teachers (concept_id);

-- ── concept_relations ────────────────────────────────────────────────────────
-- Directed relationships between concepts.
-- relation_type: 'agrees_with' | 'contrasts_with' | 'builds_on' | 'subtopic_of'
-- strength: 0.0–1.0 (frequency/confidence of the detected relationship)

create table if not exists concept_relations (
  from_concept_id uuid not null references concepts (id) on delete cascade,
  to_concept_id   uuid not null references concepts (id) on delete cascade,
  relation_type   text not null check (relation_type in ('agrees_with', 'contrasts_with', 'builds_on', 'subtopic_of')),
  strength        real not null default 1.0 check (strength >= 0.0 and strength <= 1.0),
  created_at      timestamptz not null default now(),
  primary key (from_concept_id, to_concept_id, relation_type)
);

create index if not exists concept_relations_from_idx on concept_relations (from_concept_id);
create index if not exists concept_relations_to_idx   on concept_relations (to_concept_id);

-- ── chunk_concepts ────────────────────────────────────────────────────────────
-- Maps Pinecone chunk IDs to concepts.
-- relevance: 0.0–1.0, how strongly this chunk covers this concept.
-- chunk_id matches the Pinecone vector ID (source_file + "#" + chunk_index convention).

create table if not exists chunk_concepts (
  chunk_id    text not null,
  concept_id  uuid not null references concepts (id) on delete cascade,
  relevance   real not null default 1.0 check (relevance >= 0.0 and relevance <= 1.0),
  created_at  timestamptz not null default now(),
  primary key (chunk_id, concept_id)
);

create index if not exists chunk_concepts_chunk_idx   on chunk_concepts (chunk_id);
create index if not exists chunk_concepts_concept_idx on chunk_concepts (concept_id);

-- ── Helper function: match_concepts ──────────────────────────────────────────
-- Returns the top-N most semantically similar concepts for a query vector.
-- Used at /api/ask time to find relevant concepts without a full table scan.

create or replace function match_concepts(
  query_embedding  vector(1536),
  match_threshold  real    default 0.5,
  match_count      integer default 5
)
returns table (
  id              uuid,
  name            text,
  normalized_name text,
  description     text,
  similarity      real
)
language sql stable
as $$
  select
    c.id,
    c.name,
    c.normalized_name,
    c.description,
    1 - (c.embedding <=> query_embedding) as similarity
  from concepts c
  where c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) >= match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
