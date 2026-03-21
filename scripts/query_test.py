#!/usr/bin/env python3
"""
Quick query smoke test against the Pinecone index.

Usage:
  PINECONE_API_KEY=<key> OPENAI_API_KEY=<key> python3 query_test.py "what is mindfulness?"
"""

import os
import sys

from openai import OpenAI
from pinecone import Pinecone

INDEX_NAME = "convergence-mvp"
EMBED_MODEL = "text-embedding-3-small"
TOP_K = 5


def main():
    query = " ".join(sys.argv[1:]) or "what is mindfulness?"

    pinecone_key = os.environ.get("PINECONE_API_KEY")
    openai_key = os.environ.get("OPENAI_API_KEY")
    if not pinecone_key or not openai_key:
        print("ERROR: Set PINECONE_API_KEY and OPENAI_API_KEY", file=sys.stderr)
        sys.exit(1)

    oai = OpenAI(api_key=openai_key)
    pc = Pinecone(api_key=pinecone_key)
    index = pc.Index(INDEX_NAME)

    print(f"Query: {query!r}\n")
    resp = oai.embeddings.create(model=EMBED_MODEL, input=[query])
    embedding = resp.data[0].embedding

    results = index.query(vector=embedding, top_k=TOP_K, include_metadata=True)
    for i, match in enumerate(results.matches, 1):
        meta = match.metadata or {}
        print(f"[{i}] score={match.score:.4f} | {meta.get('speaker', '?')} @ {meta.get('timestamp', '?')}")
        print(f"    {meta.get('text', '')[:200]}")
        print()


if __name__ == "__main__":
    main()
