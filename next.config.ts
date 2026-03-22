import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// CSP allows:
// - Privy (auth modal + embedded wallet iframes)
// - Sentry (error reporting)
// - Vercel Analytics (script load from va.vercel-scripts.com; data sent to /insights on same origin)
// - Supabase, Pinecone, OpenAI (API connections)
// - Google Fonts (next/font/google self-hosts at build time, but kept for safety)
// - unsafe-inline: required for inline theme script + Privy/wallet lib styles
// - unsafe-eval: required by Privy's crypto libraries at runtime
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' *.privy.io *.sentry.io va.vercel-scripts.com;
  style-src 'self' 'unsafe-inline' fonts.googleapis.com;
  font-src 'self' fonts.gstatic.com;
  img-src 'self' blob: data: https://*.privy.io;
  connect-src 'self' *.supabase.co *.pinecone.io *.openai.com *.privy.io *.sentry.io;
  frame-src *.privy.io;
  object-src 'none';
  base-uri 'self';
`.replace(/\s{2,}/g, " ").trim();

const securityHeaders = [
  // Enforce HTTPS for 2 years; include subdomains; eligible for browser preload lists.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Prevent this page from being embedded in iframes on other origins.
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop browsers from MIME-sniffing the content type.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Only send the origin (no path/query) when navigating cross-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Opt out of camera, microphone, and geolocation browser APIs.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: cspHeader },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes.
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
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
