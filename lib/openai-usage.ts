/**
 * Lightweight helper for logging OpenAI token usage to the openai_usage table.
 * All writes are fire-and-forget — errors are logged but never throw.
 */
import { supabase } from '@/lib/supabase';

export type OpenAIEndpoint = 'embedding' | 'completion';

// USD per 1K tokens (as of 2025)
const COST_PER_K: Record<string, { prompt: number; completion: number; embedding: number }> = {
  'text-embedding-3-small': { prompt: 0, completion: 0, embedding: 0.00002 },
  'gpt-4o-mini':            { prompt: 0.00015, completion: 0.0006, embedding: 0 },
};

function calcCostUsd(
  model: string,
  endpoint: OpenAIEndpoint,
  promptTokens: number,
  completionTokens: number,
): number {
  const p = COST_PER_K[model];
  if (!p) return 0;
  if (endpoint === 'embedding') return (promptTokens / 1000) * p.embedding;
  return (promptTokens / 1000) * p.prompt + (completionTokens / 1000) * p.completion;
}

/**
 * Fire-and-forget: insert a usage row after an OpenAI API call.
 *
 * @param model           OpenAI model name (e.g. 'gpt-4o-mini')
 * @param endpoint        'embedding' or 'completion'
 * @param promptTokens    Input/prompt token count (total_tokens for embeddings)
 * @param completionTokens Output token count (0 for embeddings)
 */
export function logOpenAIUsage({
  model,
  endpoint,
  promptTokens,
  completionTokens = 0,
}: {
  model: string;
  endpoint: OpenAIEndpoint;
  promptTokens: number;
  completionTokens?: number;
}): void {
  const estimatedCostUsd = calcCostUsd(model, endpoint, promptTokens, completionTokens);
  supabase
    .from('openai_usage')
    .insert({ model, endpoint, prompt_tokens: promptTokens, completion_tokens: completionTokens, estimated_cost_usd: estimatedCostUsd })
    .then(({ error }) => {
      if (error) {
        console.warn(`[openai-usage] insert_error model=${model} endpoint=${endpoint} err=${error.message}`);
      }
    });
}
