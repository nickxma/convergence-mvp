import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Capture 10% of transactions for performance monitoring in production.
  // Increase this value to get more performance data.
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Tag each event with the git commit SHA so stack traces are linkable.
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',

  // Print useful info to the browser console while setting up Sentry.
  debug: process.env.NODE_ENV === 'development',
});
