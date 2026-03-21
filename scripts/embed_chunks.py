#!/usr/bin/env python3
"""
Embed chunks.jsonl into Pinecone using OpenAI text-embedding-3-small.

Usage:
  PINECONE_API_KEY=<key> OPENAI_API_KEY=<key> python3 embed_chunks.py

Reads chunks.jsonl (28,713 chunks), embeds in batches of 100,
upserts to Pinecone index 'convergence-mvp'.

Cost estimate: ~$0.07 total (28,713 chunks × avg 40 tokens × $0.00002/1K tokens)
"""

import json
import os
import sys
import time
from pathlib import Path

from openai import OpenAI
from pinecone import Pinecone

INDEX_NAME = "convergence-mvp"
EMBED_MODEL = "text-embedding-3-small"
BATCH_SIZE = 100  # upsert batch size
EMBED_BATCH = 100  # OpenAI embedding batch size
CHUNKS_FILE = Path(__file__).parent / "chunks.jsonl"


def embed_texts(client: OpenAI, texts: list[str]) -> list[list[float]]:
    resp = client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in resp.data]


def main():
    pinecone_key = os.environ.get("PINECONE_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not pinecone_key:
        print("ERROR: PINECONE_API_KEY not set", file=sys.stderr)
        sys.exit(1)
    if not openai_key:
        print("ERROR: OPENAI_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    oai = OpenAI(api_key=openai_key)
    pc = Pinecone(api_key=pinecone_key)
    index = pc.Index(INDEX_NAME)

    # Load chunks
    print(f"Loading chunks from {CHUNKS_FILE}...")
    chunks = []
    with open(CHUNKS_FILE) as f:
        for line in f:
            chunks.append(json.loads(line))
    print(f"Loaded {len(chunks):,} chunks.")

    # Check existing vector count to support resuming
    stats = index.describe_index_stats()
    existing_count = stats.get("total_vector_count", 0)
    if existing_count > 0:
        print(f"Index already has {existing_count:,} vectors. Resuming from where we left off.")

    upserted = 0
    batch_texts, batch_meta = [], []

    for i, chunk in enumerate(chunks):
        chunk_id = chunk["id"]
        # Skip already-upserted chunks if resuming (naive: by index)
        if i < existing_count:
            continue

        batch_texts.append(chunk["text"])
        batch_meta.append({
            "id": chunk_id,
            "metadata": {
                "text": chunk["text"],
                "speaker": chunk.get("speaker", ""),
                "timestamp": chunk.get("timestamp", ""),
                "source_file": chunk.get("source_file", ""),
                "chunk_index": chunk.get("chunk_index", i),
            },
        })

        if len(batch_texts) == EMBED_BATCH:
            embeddings = embed_texts(oai, batch_texts)
            vectors = [
                {"id": m["id"], "values": emb, "metadata": m["metadata"]}
                for m, emb in zip(batch_meta, embeddings)
            ]
            index.upsert(vectors=vectors)
            upserted += len(vectors)
            print(f"Upserted {upserted:,} / {len(chunks) - existing_count:,} chunks...")
            batch_texts, batch_meta = [], []
            time.sleep(0.1)  # brief pause to avoid rate limits

    # Flush remaining
    if batch_texts:
        embeddings = embed_texts(oai, batch_texts)
        vectors = [
            {"id": m["id"], "values": emb, "metadata": m["metadata"]}
            for m, emb in zip(batch_meta, embeddings)
        ]
        index.upsert(vectors=vectors)
        upserted += len(vectors)

    print(f"\nDone. Total upserted this run: {upserted:,}")
    stats = index.describe_index_stats()
    print(f"Index total vector count: {stats.get('total_vector_count', '?'):,}")


if __name__ == "__main__":
    main()
