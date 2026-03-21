#!/usr/bin/env python3
"""
Pinecone index setup for Convergence MVP RAG pipeline.

Usage:
  PINECONE_API_KEY=<key> python3 setup_pinecone.py

Creates a serverless index (dimension=1536, text-embedding-3-small)
on the free tier, then runs a smoke test upsert + query.
"""

import os
import sys
from pinecone import Pinecone, ServerlessSpec

INDEX_NAME = "convergence-mvp"
DIMENSION = 1536  # text-embedding-3-small
METRIC = "cosine"

def main():
    api_key = os.environ.get("PINECONE_API_KEY")
    if not api_key:
        print("ERROR: PINECONE_API_KEY not set. Export it and re-run.", file=sys.stderr)
        sys.exit(1)

    pc = Pinecone(api_key=api_key)

    # Create index if it doesn't exist
    existing = [idx.name for idx in pc.list_indexes()]
    if INDEX_NAME in existing:
        print(f"Index '{INDEX_NAME}' already exists — skipping creation.")
    else:
        print(f"Creating index '{INDEX_NAME}' (dim={DIMENSION}, metric={METRIC})...")
        pc.create_index(
            name=INDEX_NAME,
            dimension=DIMENSION,
            metric=METRIC,
            spec=ServerlessSpec(cloud="aws", region="us-east-1"),
        )
        print("Index created.")

    index = pc.Index(INDEX_NAME)
    stats = index.describe_index_stats()
    print(f"Index stats: {stats}")

    # Smoke test: upsert 2 fake vectors, query, then delete
    print("\nRunning smoke test...")
    fake_vectors = [
        {"id": "__smoke_test_0__", "values": [0.1] * DIMENSION, "metadata": {"text": "smoke test alpha"}},
        {"id": "__smoke_test_1__", "values": [0.2] * DIMENSION, "metadata": {"text": "smoke test beta"}},
    ]
    index.upsert(vectors=fake_vectors)
    print("Upserted 2 test vectors.")

    result = index.query(vector=[0.1] * DIMENSION, top_k=2, include_metadata=True)
    print(f"Query result: {result}")

    index.delete(ids=["__smoke_test_0__", "__smoke_test_1__"])
    print("Smoke test vectors deleted.")

    print("\nSetup complete. Index is ready for embedding pipeline.")

if __name__ == "__main__":
    main()
