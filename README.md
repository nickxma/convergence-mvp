# Convergence MVP

A crypto-native mindfulness knowledge platform. Ask questions sourced from 760+ hours of guided meditations, teachings, and conversations. On-chain from day one.

## Stack

- **Framework:** Next.js 15 (App Router, TypeScript)
- **Styling:** Tailwind CSS
- **Auth:** Privy (email + embedded Ethereum wallets)
- **Chain:** Arbitrum Sepolia (testnet) → Arbitrum One (mainnet)
- **RAG:** Pinecone + OpenAI embeddings
- **Deploy:** Vercel

## Project Structure

```
/app          — Next.js App Router pages and layouts
/components   — Shared React components
/lib          — Utilities, API clients, RAG logic
/scripts      — One-off scripts (embedding, data prep, etc.)
/public       — Static assets
```

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Corpus Refresh

To add new Waking Up transcripts to the Pinecone vector store without re-embedding the entire corpus:

```bash
pnpm refresh:corpus
```

The script reads all `.txt` files from the iCloud transcript directory, compares them against the `corpus_manifest` table in Supabase, and only embeds files that are new or have changed. Re-running is safe and idempotent.

**Required env vars:** `PINECONE_API_KEY`, `PINECONE_INDEX`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

After the run, new transcripts are immediately queryable via `/api/ask`.

## Topic Clustering

Questions are grouped into 10 thematic clusters (e.g. "Meditation practice", "Nature of self") using k-means on OpenAI embeddings. The clusters power the `/api/topics` endpoint and the browse-by-theme UI.

To run a fresh clustering pass:

```bash
pnpm cluster:questions
```

The script fetches all unique questions from `qa_answers`, embeds them with `text-embedding-3-small`, runs k-means (k=10), auto-labels each cluster with GPT-4o-mini, and upserts results into `question_clusters`. Re-running is safe and idempotent — existing rows are updated in place.

**Required env vars:** `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Re-cluster after significant new question volume (suggested: weekly via cron or Supabase Edge Function). The minimum corpus size is 10 unique questions.

## Uptime Monitoring

Both production sites are monitored via [UptimeRobot](https://uptimerobot.com) (free tier, 5-minute polling).

### Monitors to create

| Friendly name              | Type  | URL                                             |
| -------------------------- | ----- | ----------------------------------------------- |
| Convergence MVP — Health   | HTTP  | `https://convergence-mvp.vercel.app/api/health` |
| Convergence MVP — Frontend | HTTP  | `https://convergence-mvp.vercel.app/`           |
| Paradox of Acceptance      | HTTP  | `https://paradoxofacceptance.xyz/`              |

### Setup steps

1. Create a free account at <https://uptimerobot.com>.
2. For each row in the table above, click **Add New Monitor** and fill in:
   - **Monitor Type:** HTTP(s)
   - **Friendly Name:** as shown
   - **URL:** as shown
   - **Monitoring Interval:** 5 minutes
3. Create an **Alert Contact** using the email stored in `ADMIN_EMAIL` env var. Set the notification threshold to **2 consecutive failures** to avoid noise from transient blips.
4. Under **My Settings → Integrations/API**, copy your API key.
5. Add a webhook alert contact pointing to `https://convergence-mvp.vercel.app/api/webhooks/uptime-alert` — this logs down/up events to Sentry.
6. Enable the **Public Status Page** for the account and copy the URL into this README once created.

### Vercel cron keep-warm

`vercel.json` includes a cron that pings `/api/health` every 5 minutes. This keeps the serverless function warm and produces a Sentry breadcrumb if the health endpoint returns non-200.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys (Privy, Pinecone, OpenAI).
