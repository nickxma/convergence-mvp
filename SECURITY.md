# Security

## Auth Model

Convergence MVP uses two distinct authentication mechanisms:

### 1. Privy JWT (user-facing routes)

User identity is established via a bearer token issued by [Privy](https://privy.io).

- **Header**: `Authorization: Bearer <access_token>`
- **Validation**: `verifyRequest()` in `lib/privy-auth.ts` — verifies the token against Privy's JWKS endpoint
- **Returns**: `{ userId, walletAddress }` on success, `null` on failure
- **Failure response**: `401 UNAUTHORIZED`

### 2. Admin secret (internal/admin routes)

Admin access uses a pre-shared secret stored in the `ADMIN_WALLET` environment variable.

- **Header**: `Authorization: Bearer <ADMIN_WALLET>`
- **Validation**: `isAdminRequest()` in `lib/admin-auth.ts` — constant-time comparison against `ADMIN_WALLET`
- **Failure response**: `401 UNAUTHORIZED` (intentionally identical to missing-auth response to avoid leaking route existence)
- **Note**: Phase 1 pattern. Intended for internal tooling only; upgrade to role-based auth before exposing to external operators.

### 3. Cron secret (background jobs)

Vercel Cron jobs authenticate with `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>`.

---

## Route Inventory

### Public routes (no auth required)

| Route | Methods | Notes |
|-------|---------|-------|
| `GET /api/health` | GET | Service liveness check |
| `GET /api/topics` | GET | Question cluster listing |
| `GET /api/topics/:clusterId/questions` | GET | Questions per cluster |
| `GET /api/questions/suggest` | GET | Question search suggestions |
| `GET /api/leaderboard` | GET | Public leaderboard |
| `GET /api/community/posts` | GET | Public post feed |
| `GET /api/community/posts/:id` | GET | Single post + replies |
| `GET /api/community/metrics` | GET | Community metrics |
| `GET /api/community/governance` | GET | Governance dashboard |
| `GET /api/community/token-check` | GET | Pass-holder status check by wallet |

### User-authenticated routes (Privy JWT required)

| Route | Methods | Notes |
|-------|---------|-------|
| `POST /api/ask` | POST | Core Q&A; rate-limited (20/hr auth, 3/24h guest) |
| `POST /api/meditate` | POST | Reflection endpoint; loosely authenticated |
| `POST /api/qa-feedback` | POST | Submit thumbs up/down rating |
| `GET /api/conversations` | GET | Paginated user conversation history |
| `GET /api/conversations/:id` | GET | Single conversation; ownership-gated |
| `POST /api/community/posts` | POST | Create post; requires Acceptance Pass token gate |
| `POST /api/community/posts/:id/vote` | POST | Vote on a post |
| `POST /api/community/posts/:id/flag` | POST | Flag a post |
| `POST /api/community/posts/:id/replies` | POST | Reply to a post |
| `POST /api/community/posts/:id/reactions` | POST | Emoji reaction toggle |

### Admin-only routes (ADMIN_WALLET bearer token)

| Route | Methods | Notes |
|-------|---------|-------|
| `GET /api/admin/qa-analytics` | GET | Q&A usage metrics and feedback summary |
| `GET /api/community/admin/flagged` | GET | All flagged posts with flag counts |
| `GET /api/community/admin/audit-logs` | GET | Paginated moderation audit log |
| `POST /api/community/admin/posts/:id/restore` | POST | Unhide a hidden post |
| `DELETE /api/community/posts/:id` | DELETE | Hard-delete a post and its replies |

### Cron/system routes

| Route | Methods | Notes |
|-------|---------|-------|
| `GET /api/community/embed-posts` | GET/POST | Background embedding job; `CRON_SECRET` auth |

---

## CORS Policy

API routes (`/api/*`) set `Access-Control-Allow-Origin` to the value of `NEXT_PUBLIC_APP_URL` (defaults to `http://localhost:3000` in dev).

- Cross-origin requests from any other origin will be blocked by browsers.
- Server-to-server requests (no `Origin` header) are unaffected by CORS and rely on auth token validation.
- `*` is never used as the allowed origin.

**Environment variable**: `NEXT_PUBLIC_APP_URL=https://your-app.vercel.app`

---

## Security Headers

All routes receive the following headers (configured in `next.config.ts`):

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | Restrictive; allows Privy, Sentry, Supabase, Pinecone, OpenAI |

---

## Input Sanitization

- **Community posts and replies**: HTML is stripped before storage using a sanitization helper.
- **Tag inputs**: Validated against an allowlist; no free-form HTML accepted.
- **`/api/ask` questions**: Trimmed, length-capped at 500 chars, and scanned for prompt-injection patterns (jailbreak keywords). Injection attempts are logged and rejected.
- **All routes**: JSON body parsing errors return `400 INVALID_JSON`. SQL injection is prevented via Supabase's parameterized query client.

---

## Known Limitations

1. **Admin auth is a pre-shared secret** — suitable for Phase 1 internal use. Rotate `ADMIN_WALLET` if compromised. Upgrade to a proper admin auth layer (e.g. magic-link + role table) before exposing admin routes externally.
2. **No middleware-layer auth** — auth is enforced per-route handler, not in a global `middleware.ts`. A misconfigured new route could accidentally be public. Audit every new API route against this document.
3. **Rate limiting is in-memory** — the in-memory rate limiter resets on cold starts. The Supabase-backed fallback is more durable but adds latency. Under very high concurrency, limits may be temporarily exceeded.
4. **Guest Q&A tracked by hashed IP** — IP-based guest tracking can be bypassed with VPNs. This is intentional (soft limit, not hard paywall).
5. **Cron secret has no request signing** — `CRON_SECRET` relies on HTTPS confidentiality. Do not expose cron endpoints publicly.
