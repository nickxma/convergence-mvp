export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
    // Add OTLP trace + metrics export when a collector endpoint is configured.
    // Loaded after Sentry so Sentry's TracerProvider is already registered.
    if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
      await import('./instrumentation.otel.node');
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
