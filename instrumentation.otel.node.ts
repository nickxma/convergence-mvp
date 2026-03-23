/**
 * OpenTelemetry OTLP export setup — Node.js runtime only.
 *
 * Only imported when OTEL_EXPORTER_OTLP_ENDPOINT is set (see instrumentation.ts).
 *
 * Traces: appends a BatchSpanProcessor + OTLPTraceExporter to the TracerProvider
 * already registered by @sentry/nextjs. Spans flow to both Sentry and the OTLP
 * collector without conflict.
 *
 * Metrics: registers a standalone MeterProvider that exports RAG span duration
 * histograms via OTLP every 15 s. The collector can aggregate these into
 * p50/p95/p99 latency percentiles per span.
 */

import { trace, metrics } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT!;

const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: 'convergence-qa',
  'deployment.environment': process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
});

// ── Traces: add OTLP span processor to the existing TracerProvider ────────
// @sentry/nextjs registers a NodeTracerProvider as the OTel global (wrapped in a
// ProxyTracerProvider). We resolve the underlying provider and append our exporter
// so spans go to both Sentry and the OTLP collector.
try {
  const rawProvider = trace.getTracerProvider();
  // ProxyTracerProvider exposes getDelegate(); fall back to the raw provider
  const actualProvider = typeof (rawProvider as any).getDelegate === 'function'
    ? (rawProvider as any).getDelegate()
    : rawProvider;
  if (typeof (actualProvider as any).addSpanProcessor === 'function') {
    (actualProvider as any).addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })),
    );
  } else {
    console.warn('[otel] TracerProvider does not expose addSpanProcessor — OTLP trace export skipped');
  }
} catch (err) {
  console.warn('[otel] failed to attach OTLP span processor:', err);
}

// ── Metrics: standalone MeterProvider with OTLP export ───────────────────
const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
  ],
});

metrics.setGlobalMeterProvider(meterProvider);

process.on('SIGTERM', () => {
  meterProvider.shutdown().catch(() => {});
});
