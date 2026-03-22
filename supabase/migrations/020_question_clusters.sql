-- Question topic clusters
-- Written by scripts/cluster-questions.ts; updated weekly (or on demand).
-- Clusters are derived from k-means on OpenAI text-embedding-3-small embeddings.

create table if not exists question_clusters (
  question_hash  text        not null primary key,  -- SHA-256(question), hex
  question_text  text        not null,              -- original question text
  cluster_id     integer     not null,              -- 0-indexed cluster number
  cluster_label  text        not null,              -- 2-3 word topic label
  updated_at     timestamptz not null default now()
);

-- Fast lookup of all questions in a cluster
create index if not exists question_clusters_cluster_id_idx on question_clusters(cluster_id);
