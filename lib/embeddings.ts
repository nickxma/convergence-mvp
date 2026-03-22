/**
 * Centralized embeddings service.
 *
 * Wraps the OpenAI embeddings API with a consistent interface, usage logging,
 * and batch support. All call sites should use these functions instead of
 * calling oai.embeddings.create directly.
 *
 * embedOne  — single text, backward-compatible with previous inline calls.
 * embedBatch — multiple texts in one API call (up to 2048 for text-embedding-3-small).
 */
import OpenAI from 'openai';
import { logOpenAIUsage } from '@/lib/openai-usage';

export const DEFAULT_EMBED_MODEL = 'text-embedding-3-small';

export interface EmbedOptions {
  /** OpenAI model. Defaults to text-embedding-3-small. */
  model?: string;
  /** Output dimensions (supported by text-embedding-3-* models). Omit to use model default. */
  dimensions?: number;
  /** Pre-created OpenAI client. If omitted, created from OPENAI_API_KEY env var. */
  client?: OpenAI;
}

function resolveClient(client?: OpenAI): OpenAI {
  if (client) return client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');
  return new OpenAI({ apiKey });
}

/**
 * Embed a single text string.
 * Drop-in replacement for inline oai.embeddings.create calls.
 */
export async function embedOne(text: string, options: EmbedOptions = {}): Promise<number[]> {
  const model = options.model ?? DEFAULT_EMBED_MODEL;
  const oai = resolveClient(options.client);
  const resp = await oai.embeddings.create({
    model,
    input: text,
    ...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
  });
  logOpenAIUsage({
    model,
    endpoint: 'embedding',
    promptTokens: resp.usage.total_tokens,
    inputTextsCount: 1,
  });
  return resp.data[0].embedding;
}

/**
 * Embed multiple texts in a single API call.
 *
 * OpenAI processes all inputs in one round-trip, saving ~100-200ms per
 * additional item vs. sequential embedOne calls.
 *
 * text-embedding-3-small supports up to 2048 inputs per request. For larger
 * batches, callers should chunk externally (e.g. in groups of 50-100).
 */
export async function embedBatch(texts: string[], options: EmbedOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = options.model ?? DEFAULT_EMBED_MODEL;
  const oai = resolveClient(options.client);
  const resp = await oai.embeddings.create({
    model,
    input: texts,
    ...(options.dimensions !== undefined ? { dimensions: options.dimensions } : {}),
  });
  logOpenAIUsage({
    model,
    endpoint: 'embedding',
    promptTokens: resp.usage.total_tokens,
    inputTextsCount: texts.length,
  });
  return resp.data.map((d) => d.embedding);
}
