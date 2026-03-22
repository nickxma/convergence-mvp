# Convergence MVP — Operations Runbook

> Single reference for operating, deploying, and onboarding on Convergence MVP.
> Last updated: 2026-03-22

---

## 1. Required Environment Variables

Copy `.env.example` to `.env.local` and fill in each value.

| Variable | Where to get it | Fails without it |
|---|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | [dashboard.privy.io](https://dashboard.privy.io) → Settings → App ID | Auth broken; all wallet login fails |
| `PRIVY_APP_SECRET` | dashboard.privy.io → Settings → App Secret (server-only) | Server-side auth verification fails |
| `SUPABASE_URL` | dashboard.supabase.com → Project → Settings → API → Project URL | All DB reads/writes fail |
| `SUPABASE_SERVICE_ROLE_KEY` | dashboard.supabase.com → Project → Settings → API → service_role | All DB reads/writes fail |
| `PINECONE_API_KEY` | app.pinecone.io → API Keys | Q&A ask endpoint fails; no semantic search |
| `PINECONE_INDEX` | Name of your Pinecone index (default: `convergence-mvp`) | Q&A returns no results |
| `OPENAI_API_KEY` | platform.openai.com → API Keys | Embeddings and answer generation fail |
| `ACCEPTANCE_PASS_CONTRACT_ADDRESS` | `0x9691107411afb05b81cfde537efc4a00b9b1bb69` (Base mainnet) | Token gate broken; pass holders lose access |
| `NEXT_PUBLIC_ACCEPTANCE_PASS_CONTRACT` | Same as above | Pass badge / explorer links broken |
| `ADMIN_WALLET` | Your wallet address (e.g. `0x60dFFC7...`) | `/api/community/admin/*` endpoints return 401 |
| `CRON_SECRET` | `openssl rand -hex 32` | Vercel cron for `embed-posts` fails auth |
| `NEXT_PUBLIC_SENTRY_DSN` | sentry.io → Project → Settings → Client Keys | Client-side errors not reported to Sentry |
| `SENTRY_DSN` | Same Sentry project → DSN | Server-side errors not reported |
| `NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC` | Optional. Defaults to `https://sepolia-rollup.arbitrum.io/rpc` | Falls back to public endpoint; fine for dev |
| `BASE_RPC_URL` | Optional. Defaults to `https://mainnet.base.org` | Falls back to public endpoint |
| `UPSTASH_REDIS_REST_URL` | Optional. console.upstash.com → Redis → REST API | Rate limiting falls back to in-memory (single process only) |
| `UPSTASH_REDIS_REST_TOKEN` | Optional. Same dashboard | Same as above |
| `ENABLE_COMMUNITY_RAG` | `"true"` to enable community posts in RAG pipeline | Community posts excluded from Q&A answers (default: `false`) |

Vercel auto-injects `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` and `NEXT_PUBLIC_VERCEL_ENV` — do not set manually.

---

## 2. Deploy Process

### Auto-deploy (normal flow)

Push to `main` → Vercel detects the push → builds and deploys automatically.

Check deploy status: Vercel dashboard → Convergence MVP → Deployments.

### Manual deploy

```bash
# Install Vercel CLI if needed
npm i -g vercel

# Deploy to production
vercel --prod
```

### Rollback

Vercel dashboard → Deployments → click any previous deployment → **Promote to Production**.

---

## 3. Database Migrations

Migrations live in `supabase/migrations/`. They run in numeric order.

### Apply all pending migrations

```bash
pnpm supabase db push
```

This pushes all local migrations to the linked Supabase project.

### Check current state

```bash
pnpm supabase migration list
```

### Roll back a migration

Supabase does not have built-in rollbacks. To undo:

1. Write a corrective SQL script (reverse the schema change).
2. Run it in the Supabase SQL Editor, or create a new numbered migration file and push it.

### Migration files (in order)

| File | What it does |
|---|---|
| `001_community.sql` | Core community posts/users tables |
| `002_moderation.sql` | Moderation flags |
| `003_audit_logs.sql` | Audit trail |
| `004_webhooks.sql` | Webhook config |
| `005_schema_fixes.sql` | Schema corrections |
| `006_community_indexes.sql` | Community query indexes |
| `007_posts_fts.sql` | Full-text search on posts |
| `008_soft_delete.sql` | Soft delete support |
| `009_search_replies_fts.sql` | FTS on replies |
| `010_wallet_indexes.sql` | Wallet address lookup indexes |
| `011_conversation_sessions.sql` | Conversation session tracking |
| `012_qa_analytics.sql` | Q&A analytics events |
| `013_qa_answers.sql` | Cached Q&A answers |
| `014_qa_feedback.sql` | User feedback on answers |
| `015_qa_cache.sql` | Semantic cache |
| `016_corpus_manifest.sql` | Pinecone corpus sync manifest |
| `017_post_reactions.sql` | Post reactions (likes etc.) |
| `018_conversations.sql` | Conversations table |
| `019_guest_usage.sql` | Guest usage tracking |
| `020_question_clusters.sql` | Topic cluster assignments |
| `021_semantic_cache.sql` | Extended semantic cache |
| `022_performance_indexes.sql` | Performance tuning indexes |

---

## 4. Pinecone Corpus Refresh

Embeds new or changed Waking Up transcripts into Pinecone. Skips files already in the corpus manifest.

```bash
pnpm refresh:corpus
# or directly:
pnpm tsx scripts/refresh-corpus.ts
```

**Requires:** `PINECONE_API_KEY`, `PINECONE_INDEX`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

What it does:
1. Reads `.txt` transcript files from the transcript directory.
2. Hashes each file and checks `corpus_manifest` in Supabase — skips unchanged files.
3. Chunks new/changed files (~300 tokens, 50-token overlap).
4. Embeds with `text-embedding-3-small`, upserts to Pinecone namespace `waking-up` in batches of 100.
5. Writes new rows to `corpus_manifest`.

Safe to re-run at any time — idempotent.

---

## 5. Topic Re-Clustering

Groups Q&A questions into topic clusters using k-means on embeddings. Safe to re-run — idempotent.

```bash
pnpm cluster:questions
# or directly:
pnpm tsx scripts/cluster-questions.ts
```

**Requires:** `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

What it does:
1. Fetches all unique questions from `qa_answers`.
2. Embeds each question with `text-embedding-3-small`.
3. Runs k-means clustering (k=10, k-means++ init).
4. Labels each cluster with a 2–3 word topic via GPT-4o-mini.
5. Upserts results into `question_clusters`.

Run after accumulating significant new Q&A data, or when topic labels feel stale.

---

## 6. Admin Access

Admin routes are under `/api/community/admin/*`.

Authentication: `Authorization: Bearer <wallet-address>` header.

The wallet address must match `ADMIN_WALLET` in your environment.

Admin pages (browser):
- No dedicated admin UI is currently built — admin actions are API-only.

To grant admin access to another wallet, update `ADMIN_WALLET` in Vercel → Environment Variables → redeploy.

---

## 7. Monitoring

| System | Where to look |
|---|---|
| **Sentry** | sentry.io → Convergence MVP project — errors, replays, performance |
| **Vercel Analytics** | Vercel dashboard → Analytics tab — page views, web vitals |
| **Health endpoint** | `GET /api/health` — returns Supabase, Pinecone, and cache status with latency |
| **Cron job** | Vercel dashboard → Settings → Cron Jobs — `embed-posts` runs daily at midnight UTC |

### Health endpoint

```bash
curl https://your-domain.vercel.app/api/health
```

Returns JSON with `status: ok | degraded | down` for each dependency. Use this as a quick sanity check after deploys.

---

## 8. Common Issues

| Symptom | Likely cause | Fix |
|---|---|---|
| Q&A returns "I don't know" or empty | Pinecone index empty or wrong index name | Run `pnpm refresh:corpus`; verify `PINECONE_INDEX` matches dashboard |
| Auth fails / wallet login broken | Privy keys misconfigured | Verify `NEXT_PUBLIC_PRIVY_APP_ID` and `PRIVY_APP_SECRET` match Privy dashboard |
| `SUPABASE_SERVICE_ROLE_KEY` error on deploy | Key rotated or wrong project | Copy fresh key from Supabase → Settings → API |
| Community posts not in Q&A answers | `ENABLE_COMMUNITY_RAG` not set | Set `ENABLE_COMMUNITY_RAG=true` in env |
| `/api/community/admin/*` returns 401 | `ADMIN_WALLET` not set or wrong address | Set `ADMIN_WALLET` to your wallet address in env |
| Cron job `embed-posts` failing | `CRON_SECRET` mismatch | Regenerate with `openssl rand -hex 32`, update in both Vercel env and any calling config |
| Rate limiting not working across restarts | Redis not configured | Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; in-memory resets on restart |
| Token gate not recognizing pass holders | Wrong contract address or wrong chain | Verify `ACCEPTANCE_PASS_CONTRACT_ADDRESS` matches Base mainnet `0x9691107...` |
| Build fails with Sentry error | DSN env vars missing | Set `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in Vercel env |
