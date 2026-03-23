/**
 * Lightweight per-request span recorder for the /api/ask RAG pipeline.
 *
 * Records wall-clock timing for each pipeline stage, logs them as structured
 * JSON (Vercel-indexable), and returns timing data for Supabase persistence.
 *
 * Span names mirror OpenTelemetry conventions so they can be replaced with
 * real OTel spans later without changing call-sites:
 *   rag.embed_query, rag.pinecone_retrieve, rag.cohere_rerank, rag.llm_generate, rag.total
 */

export interface RagSpans {
  embed_ms: number | null;
  retrieve_ms: number | null;
  rerank_ms: number | null;
  generate_ms: number | null;
  total_ms: number;
}

interface SpanRecord {
  name: string;
  duration_ms: number;
  attributes?: Record<string, string | number | boolean>;
}

export class RagTracer {
  private spans: SpanRecord[] = [];
  private readonly totalStart: number;

  constructor() {
    this.totalStart = Date.now();
  }

  /** Wrap an async operation in a named span. Timing is recorded even on error. */
  async trace<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.spans.push({ name, duration_ms: Date.now() - start, attributes });
      return result;
    } catch (err) {
      this.spans.push({ name, duration_ms: Date.now() - start, attributes: { ...attributes, error: true } });
      throw err;
    }
  }

  /** Record a generate span manually (used for streaming where timing spans the iteration loop). */
  recordGenerateSpan(durationMs: number, attributes?: Record<string, string | number | boolean>) {
    this.spans.push({ name: 'rag.llm_generate', duration_ms: durationMs, attributes });
  }

  /** Returns per-stage timing summary. Call after all stages complete. */
  summarize(): RagSpans {
    const get = (name: string) => this.spans.find((s) => s.name === name)?.duration_ms ?? null;
    return {
      embed_ms: get('rag.embed_query'),
      retrieve_ms: get('rag.pinecone_retrieve'),
      rerank_ms: get('rag.cohere_rerank'),
      generate_ms: get('rag.llm_generate'),
      total_ms: Date.now() - this.totalStart,
    };
  }

  /** Emit structured JSON log — picked up by Vercel Log Drains. */
  log(logCtx: string) {
    const summary = this.summarize();
    console.log(
      JSON.stringify({
        event: 'rag.pipeline_complete',
        embed_ms: summary.embed_ms,
        retrieve_ms: summary.retrieve_ms,
        rerank_ms: summary.rerank_ms,
        generate_ms: summary.generate_ms,
        total_ms: summary.total_ms,
        spans: this.spans,
        ctx: logCtx,
      }),
    );
  }
}
