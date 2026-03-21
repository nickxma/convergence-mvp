import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { Pinecone } from '@pinecone-database/pinecone';

const EMBED_MODEL = 'text-embedding-3-small';
const CHAT_MODEL = 'gpt-4o-mini';
const TOP_K = 10; // fetch extra to allow dedup headroom

const SYSTEM_PROMPT = `You are a knowledgeable guide to the teachings of Sam Harris and the Waking Up community.
Answer questions using only the provided transcript excerpts. Be direct and clear.
If the excerpts don't contain enough information to answer, say so honestly.
Do not invent teachings or attribute views not present in the source material.`;

interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const question: string = body?.question?.trim();
  const history: HistoryMessage[] = Array.isArray(body?.history) ? body.history : [];
  // Wallet address passed for future personalization (query history, preferences, etc.)
  const walletAddress: string | null = typeof body?.walletAddress === 'string' ? body.walletAddress : null;

  if (!question) {
    return NextResponse.json({ error: 'question is required' }, { status: 400 });
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  const pineconeKey = process.env.PINECONE_API_KEY;
  const pineconeIndex = process.env.PINECONE_INDEX ?? 'convergence-mvp';

  if (!openaiKey || !pineconeKey) {
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 });
  }

  const oai = new OpenAI({ apiKey: openaiKey });
  const pc = new Pinecone({ apiKey: pineconeKey });
  const index = pc.Index(pineconeIndex);

  // 1. Embed the question
  const embedResp = await oai.embeddings.create({
    model: EMBED_MODEL,
    input: question,
  });
  const queryVector = embedResp.data[0].embedding;

  // 2. Retrieve relevant chunks from Pinecone
  const results = await index.query({
    vector: queryVector,
    topK: TOP_K,
    includeMetadata: true,
  });

  // Deduplicate by text content (duplicate source files can produce identical chunks)
  const seenTexts = new Set<string>();
  const chunks = results.matches
    .filter((m) => m.score && m.score > 0.4)
    .map((m) => {
      const meta = m.metadata as Record<string, string> | undefined;
      return {
        text: meta?.text ?? '',
        speaker: meta?.speaker ?? '',
        source: meta?.source_file ?? '',
        score: m.score ?? 0,
      };
    })
    .filter((c) => {
      if (seenTexts.has(c.text)) return false;
      seenTexts.add(c.text);
      return true;
    })
    .slice(0, 6);

  if (chunks.length === 0) {
    return NextResponse.json({
      answer: "I couldn't find relevant passages in the Waking Up corpus for that question.",
      sources: [],
    });
  }

  // 3. Build context from chunks
  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.speaker ? `${c.speaker}: ` : ''}${c.text}`)
    .join('\n\n');

  // 4. Generate answer
  const priorMessages = history.slice(-6).map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const chat = await oai.chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...priorMessages,
      {
        role: 'user',
        content: `Transcript excerpts:\n\n${context}\n\nQuestion: ${question}`,
      },
    ],
    temperature: 0.3,
    max_tokens: 600,
  });

  const answer = chat.choices[0]?.message?.content ?? '';

  return NextResponse.json({
    answer,
    sources: chunks.map((c) => ({
      text: c.text.slice(0, 200),
      speaker: c.speaker,
      source: c.source,
      score: Math.round(c.score * 100) / 100,
    })),
  });
}
