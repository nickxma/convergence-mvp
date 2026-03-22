import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  /* config options here */
};

export default withSentryConfig(nextConfig, {
  // Org and project slugs from Sentry (used only for source map uploads).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token for uploading source maps — set in Vercel as SENTRY_AUTH_TOKEN.
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps only on CI/Vercel builds.
  sourcemaps: {
    disable: !process.env.VERCEL,
  },

  // Silence Sentry's build-time output (informational, not errors).
  silent: !process.env.CI,

  // Auto-instrument route handlers and server components.
  autoInstrumentServerFunctions: true,
  autoInstrumentMiddleware: true,
  autoInstrumentAppDirectory: true,
});
