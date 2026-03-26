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
| `RESEND_API_KEY` | resend.com → API Keys | `pnpm export:subscribers` fails; deploy notifications fall back to Slack or are skipped |
| `RESEND_AUDIENCE_ID` | resend.com → Audiences → copy ID | `pnpm export:subscribers` fails |
| `VERCEL_WEBHOOK_SECRET` | Generated (see §10 below); set in Vercel Webhooks config | Deploy webhook accepts unsigned requests (insecure) |
| `ADMIN_EMAIL` | Your email address | Deploy notifications are not sent (unless `SLACK_WEBHOOK_URL` is set) |
| `SLACK_WEBHOOK_URL` | Optional. api.slack.com → Incoming Webhooks | Email used instead; omit if you prefer email |

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
| `008_soft_delete.sql` | Soft delete (`deleted_at`) for posts and replies |
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
| `023_rls_policies.sql` | Row-level security policies |
| `024_soft_deletes.sql` | Soft delete (`deleted_at`) for conversation_sessions |

---

## 4. Backups and Data Recovery

### Supabase daily backups (automatic)

Supabase runs daily backups automatically on all plans.

- **Free tier**: retained for 7 days. Restore via Supabase dashboard → Settings → Database → Backups → Restore.
- **Pro + PITR add-on ($25/mo)**: point-in-time recovery to any second in the last 7 days.

To verify backups are enabled: Supabase dashboard → Settings → Database → Backups. Confirm the list shows recent daily snapshots.

### Manual SQL dump (on-demand)

Creates a timestamped `.sql.gz` dump in `backups/`.

```bash
pnpm backup:db
# or directly:
tsx scripts/backup-db.ts
```

**Requires:**
- Supabase CLI installed (`npm i -g supabase` or `brew install supabase/tap/supabase`)
- Project linked: `supabase link --project-ref <ref>`

What it does:
1. Runs `supabase db dump --linked` to export full SQL.
2. Gzip-compresses (level 9) the output.
3. Writes `backups/YYYY-MM-DD.sql.gz`.

The `backups/` directory is gitignored. Safe to re-run — same-day files are overwritten.

### Emergency subscriber export

Exports the Resend audience to `exports/subscribers-YYYY-MM-DD.csv` as a fallback if Resend becomes unavailable.

```bash
pnpm export:subscribers
# or directly:
tsx scripts/export-subscribers.ts
```

**Requires:** `RESEND_API_KEY` and `RESEND_AUDIENCE_ID` in `.env.local`.

CSV columns: `email, first_name, last_name, subscribed, created_at`.

**Schedule:** Run once a month. Add a calendar reminder. Store the CSV off-site (e.g., encrypted S3 bucket or local encrypted drive).

### Restore procedure (staging validation)

Always test a restore on staging before applying to production.

1. **Get the dump**: download from Supabase dashboard, or use a `backups/*.sql.gz` local file.

2. **Spin up a staging Supabase project** (free tier is fine).

3. **Restore**:
   ```bash
   # From a local .sql.gz
   gunzip -c backups/YYYY-MM-DD.sql.gz | psql "<staging-db-url>"

   # From the Supabase dashboard backup:
   # Settings → Database → Backups → select backup → Restore to new project
   ```

4. **Validate**: check row counts against production.
   ```sql
   SELECT 'posts' AS tbl, count(*) FROM posts
   UNION ALL SELECT 'replies', count(*) FROM replies
   UNION ALL SELECT 'subscribers', count(*) FROM subscribers;
   ```

5. **Promote to prod** only after validation passes.

### Recovery contacts

| Who | Role | Contact |
|---|---|---|
| Supabase support | Database restore help | support.supabase.com |
| Resend support | Audience/email recovery | resend.com/support |

---

## 5. Pinecone Corpus Refresh

Embeds new or changed transcripts into Pinecone. Skips files already in the corpus manifest.

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
4. Embeds with `text-embedding-3-small`, upserts to Pinecone corpus namespace in batches of 100.
5. Writes new rows to `corpus_manifest`.

Safe to re-run at any time — idempotent.

---

## 6. Topic Re-Clustering

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

## 7. Admin Access

Admin routes are under `/api/community/admin/*`.

Authentication: `Authorization: Bearer <wallet-address>` header.

The wallet address must match `ADMIN_WALLET` in your environment.

Admin pages (browser):
- No dedicated admin UI is currently built — admin actions are API-only.

To grant admin access to another wallet, update `ADMIN_WALLET` in Vercel → Environment Variables → redeploy.

---

## 8. Monitoring

| System | Where to look |
|---|---|
| **Sentry** | sentry.io → Convergence MVP project — errors, replays, performance |
| **Vercel Analytics** | Vercel dashboard → Analytics tab — page views, web vitals, custom events |
| **Vercel Speed Insights** | Vercel dashboard → Speed Insights tab — Core Web Vitals per route |
| **Health endpoint** | `GET /api/health` — returns Supabase, Pinecone, and cache status with latency |
| **Cron job** | Vercel dashboard → Settings → Cron Jobs — `embed-posts` runs daily at midnight UTC |

### Vercel Analytics

**Enable:** Vercel dashboard → Convergence MVP project → Analytics tab → **Enable**. Requires Vercel Pro or Hobby plan. No additional environment variables needed — `@vercel/analytics` is already installed and rendered in the root layout.

**Dashboard URL:** `https://vercel.com/dashboard/<team>/convergence-mvp/analytics`

**Web Vitals:** Vercel dashboard → Speed Insights tab. Powered by `@vercel/speed-insights` (also installed in root layout). Shows LCP, CLS, FID, TTFB, and INP broken down by route.

**Custom events tracked:**

| Event | Fires when |
|---|---|
| `question_asked` | User submits any Q&A question |
| `conversation_started` | User submits the first question in a new session |
| `community_post_created` | User successfully publishes a Knowledge Commons post |
| `wallet_connected` | User completes Privy auth (session login) |

These events appear under **Analytics → Events** in the Vercel dashboard with counts and trend graphs.

### Health endpoint

```bash
curl https://your-domain.vercel.app/api/health
```

Returns JSON with `status: ok | degraded | down` for each dependency. Use this as a quick sanity check after deploys.

---

## 9. Common Issues

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
| Deploy notifications not arriving | `ADMIN_EMAIL` / `RESEND_API_KEY` not set, or `SLACK_WEBHOOK_URL` missing | Set the relevant env vars in Vercel → Environment Variables |
| Deploy webhook returns 401 | `VERCEL_WEBHOOK_SECRET` mismatch | Regenerate with `openssl rand -hex 32`, update in both Vercel Webhooks settings and env vars |

---

## 10. Deploy Notifications (Vercel Webhook)

`POST /api/webhooks/deploy` receives Vercel deployment events and sends a notification when a production deploy succeeds or fails.

### How it works

1. Vercel sends a signed POST request on each deployment event.
2. The endpoint validates `x-vercel-signature` (HMAC-SHA1 of the raw body using `VERCEL_WEBHOOK_SECRET`).
3. For `deployment.succeeded` → sends ✅ success notification.
4. For `deployment.error` / `deployment.canceled` → sends ❌ failure notification.
5. Non-production deployments (preview, branch) are silently acknowledged and skipped.

**Notification routing (first match wins):**
- `SLACK_WEBHOOK_URL` is set → Slack incoming webhook
- Otherwise → email via Resend to `ADMIN_EMAIL`

### Registration steps

1. **Generate a webhook secret:**
   ```bash
   openssl rand -hex 32
   ```

2. **Add env vars in Vercel** (dashboard → Project → Settings → Environment Variables):
   | Variable | Value |
   |---|---|
   | `VERCEL_WEBHOOK_SECRET` | the secret from step 1 |
   | `ADMIN_EMAIL` | your email address (if using email) |
   | `RESEND_API_KEY` | resend.com API key (if using email) |
   | `SLACK_WEBHOOK_URL` | Slack webhook URL (if using Slack instead) |

3. **Register the webhook in Vercel** (dashboard → Project → Settings → Webhooks → Add):
   - **URL:** `https://convergence-mvp.vercel.app/api/webhooks/deploy`
   - **Secret:** same value as `VERCEL_WEBHOOK_SECRET`
   - **Events to subscribe:** `deployment.succeeded`, `deployment.error`, `deployment.canceled`

4. **Redeploy** (or trigger a manual deploy) to confirm notifications arrive.

### Testing locally

```bash
# Generate a test payload + signature
SECRET=your-webhook-secret
PAYLOAD='{"type":"deployment.succeeded","payload":{"deployment":{"id":"test","name":"convergence-mvp","url":"convergence-mvp.vercel.app","meta":{"githubCommitSha":"abc1234","githubCommitMessage":"test deploy","githubCommitRef":"main"}},"target":"production"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha1 -hmac "$SECRET" | awk '{print $2}')

curl -X POST http://localhost:3000/api/webhooks/deploy \
  -H "Content-Type: application/json" \
  -H "x-vercel-signature: $SIG" \
  -d "$PAYLOAD"
```
