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

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys (Privy, Pinecone, OpenAI).
