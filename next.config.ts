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

// Minimal CSP for the embeddable widget iframe page.
// - No Privy, Sentry, or third-party dependencies needed here.
// - frame-ancestors * allows any external site to embed the page in an iframe.
const embedCspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval';
  style-src 'self' 'unsafe-inline';
  font-src 'self';
  img-src 'self' data:;
  connect-src 'self';
  frame-ancestors *;
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
  // Don't emit X-Powered-By: Next.js — leaks server technology.
  poweredByHeader: false,

  // Cap the request body buffered in proxy at 1 MB.
  // Prevents memory exhaustion from oversized payloads hitting proxy.ts.
  // CORS and rate-limiting are handled in proxy.ts; dynamic origin checking
  // is done there (multi-origin support via CORS_ALLOWED_ORIGINS env var).
  experimental: {
    proxyClientMaxBodySize: '1mb',
  },

  async headers() {
    return [
      {
        // Apply security headers to all routes.
        source: "/(.*)",
        headers: securityHeaders,
      },
      {
        // Embed iframe page: allow any external site to frame this page.
        // These headers override the global X-Frame-Options and CSP set above
        // (last-matching-rule wins for duplicate header keys in Next.js).
        source: "/embed/:path*",
        headers: [
          // ALLOWALL is the legacy fallback; frame-ancestors * in CSP takes precedence
          // in all modern browsers.
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: embedCspHeader },
        ],
      },
      {
        // widget.js is loaded by external pages — must be served with CORS open.
        // Cached for 24h; stale-while-revalidate allows background refresh.
        source: "/embed/widget.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
        ],
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
