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

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys (Privy, Pinecone, OpenAI).
