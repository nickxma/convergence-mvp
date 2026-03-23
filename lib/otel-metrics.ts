/**
 * RAG pipeline metrics — histogram for per-span latency.
 *
 * Uses the @opentelemetry/api metrics interface. When OTEL_EXPORTER_OTLP_ENDPOINT
 * is set, the MeterProvider registered in instrumentation.otel.node.ts exports
 * histograms to the collector, enabling p50/p95/p99 aggregation server-side.
 * Without an endpoint the calls are no-ops.
 */

import { metrics, type Histogram } from '@opentelemetry/api';

let _histogram: Histogram | null = null;

function getHistogram(): Histogram {
  if (!_histogram) {
    const meter = metrics.getMeter('rag-pipeline', '1.0.0');
    _histogram = meter.createHistogram('rag.span.duration_ms', {
      description: 'Duration of each RAG pipeline span in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [10, 25, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
      },
    });
  }
  return _histogram;
}

/** Record a span duration sample. Attributes include span name and error flag. */
export function recordRagDuration(spanName: string, durationMs: number, error = false): void {
  try {
    getHistogram().record(durationMs, {
      'rag.span': spanName,
      ...(error ? { error: 'true' } : {}),
    });
  } catch {
    // Metrics are non-critical
  }
}
