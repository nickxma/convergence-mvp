/**
 * RAG pipeline tracer — wraps each stage in a real OpenTelemetry span.
 *
 * @opentelemetry/api is installed as a transitive dep of @sentry/nextjs.
 * Spans flow to Sentry's registered TracerProvider automatically; when
 * OTEL_EXPORTER_OTLP_ENDPOINT is set, they are also exported to the OTLP
 * collector via the BatchSpanProcessor added in instrumentation.otel.node.ts.
 *
 * Span names:
 *   rag.query_receive   — overall request receipt (recorded in route.ts)
 *   rag.cache_check     — exact + semantic cache lookup (recorded in route.ts)
 *   rag.embed_query     — embedding the user question
 *   rag.vector_search   — Pinecone retrieval (chunk_count + top_score attrs)
 *   rag.cohere_rerank   — Cohere re-ranking
 *   rag.llm_call        — LLM generation (prompt_tokens + completion_tokens attrs)
 *   rag.response_send   — serialising and sending the response (recorded in route.ts)
 */

import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { recordRagDuration } from './otel-metrics';

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

const otelTracer = trace.getTracer('rag-pipeline', '1.0.0');

export class RagTracer {
  private spans: SpanRecord[] = [];
  private readonly totalStart: number;

  constructor() {
    this.totalStart = Date.now();
  }

  /**
   * Wrap an async operation in a named OTel span.
   *
   * `attributes` are set at span start. `postAttributes` is called with the
   * resolved result to attach additional attributes (e.g. token counts that
   * are only known after the call completes). Timing is recorded even on error.
   */
  async trace<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, string | number | boolean>,
    postAttributes?: (result: T) => Record<string, string | number | boolean>,
  ): Promise<T> {
    const span = otelTracer.startSpan(name, { attributes });
    const ctx = trace.setSpan(context.active(), span);
    const start = Date.now();
    try {
      const result = await context.with(ctx, fn);
      const duration_ms = Date.now() - start;
      if (postAttributes) {
        try { span.setAttributes(postAttributes(result)); } catch { /* non-critical */ }
      }
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      this.spans.push({ name, duration_ms, attributes });
      recordRagDuration(name, duration_ms);
      return result;
    } catch (err) {
      const duration_ms = Date.now() - start;
      if (err instanceof Error) span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      span.end();
      this.spans.push({ name, duration_ms, attributes: { ...attributes, error: true } });
      recordRagDuration(name, duration_ms, true);
      throw err;
    }
  }

  /**
   * Record a generate span manually (used for streaming where timing spans the
   * iteration loop and token counts are only known after the last chunk).
   */
  recordGenerateSpan(durationMs: number, attributes?: Record<string, string | number | boolean>) {
    const startTime: [number, number] = [
      Math.floor((Date.now() - durationMs) / 1000),
      ((Date.now() - durationMs) % 1000) * 1_000_000,
    ];
    const span = otelTracer.startSpan('rag.llm_call', { attributes, startTime });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
    this.spans.push({ name: 'rag.llm_call', duration_ms: durationMs, attributes });
    recordRagDuration('rag.llm_call', durationMs);
  }

  /** Returns per-stage timing summary. Call after all stages complete. */
  summarize(): RagSpans {
    const get = (name: string) => this.spans.find((s) => s.name === name)?.duration_ms ?? null;
    return {
      embed_ms: get('rag.embed_query'),
      retrieve_ms: get('rag.vector_search'),
      rerank_ms: get('rag.cohere_rerank'),
      generate_ms: get('rag.llm_call'),
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
