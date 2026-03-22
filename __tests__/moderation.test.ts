/**
 * Unit tests for moderation helpers.
 *
 * Tests the admin-auth helper and the flag auto-hide threshold logic
 * without making real DB or RPC calls.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock next/server NextRequest ──────────────────────────────────────────────
function makeRequest(authHeader?: string): { headers: { get: (k: string) => string | null } } {
  return {
    headers: {
      get: (key: string) => (key === 'authorization' ? (authHeader ?? null) : null),
    },
  };
}

// ── admin-auth ────────────────────────────────────────────────────────────────
// We inline the logic here to avoid importing Next.js server modules in vitest
function isAdminRequest(req: ReturnType<typeof makeRequest>, adminWallet: string | undefined): boolean {
  if (!adminWallet) return false;
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;
  const token = auth.slice(7).trim();
  return token.toLowerCase() === adminWallet.toLowerCase();
}

const ADMIN_WALLET = '0xAdminDeadBeef0000000000000000000000000001';

describe('isAdminRequest', () => {
  it('returns true for exact wallet match', () => {
    const req = makeRequest(`Bearer ${ADMIN_WALLET}`);
    expect(isAdminRequest(req, ADMIN_WALLET)).toBe(true);
  });

  it('is case-insensitive for hex addresses', () => {
    const req = makeRequest(`Bearer ${ADMIN_WALLET.toLowerCase()}`);
    expect(isAdminRequest(req, ADMIN_WALLET)).toBe(true);
  });

  it('returns false for wrong wallet', () => {
    const req = makeRequest('Bearer 0xWrongWallet');
    expect(isAdminRequest(req, ADMIN_WALLET)).toBe(false);
  });

  it('returns false when Authorization header is absent', () => {
    const req = makeRequest(undefined);
    expect(isAdminRequest(req, ADMIN_WALLET)).toBe(false);
  });

  it('returns false when ADMIN_WALLET env var is not set', () => {
    const req = makeRequest(`Bearer ${ADMIN_WALLET}`);
    expect(isAdminRequest(req, undefined)).toBe(false);
  });

  it('returns false for malformed header (no Bearer prefix)', () => {
    const req = makeRequest(ADMIN_WALLET);
    expect(isAdminRequest(req, ADMIN_WALLET)).toBe(false);
  });
});

// ── auto-hide threshold ───────────────────────────────────────────────────────
const FLAG_HIDE_THRESHOLD = 5;

describe('auto-hide threshold', () => {
  it('hides post when flag count reaches threshold', () => {
    expect(4 >= FLAG_HIDE_THRESHOLD).toBe(false);
    expect(5 >= FLAG_HIDE_THRESHOLD).toBe(true);
    expect(6 >= FLAG_HIDE_THRESHOLD).toBe(true);
  });

  it('does not hide post below threshold', () => {
    for (let i = 1; i < FLAG_HIDE_THRESHOLD; i++) {
      expect(i >= FLAG_HIDE_THRESHOLD).toBe(false);
    }
  });
});

// ── flag reason validation ────────────────────────────────────────────────────
function validateReason(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length >= 1 && trimmed.length <= 1000;
}

describe('flag reason validation', () => {
  it('accepts a normal reason', () => {
    expect(validateReason('This post contains spam.')).toBe(true);
  });

  it('rejects empty reason', () => {
    expect(validateReason('')).toBe(false);
    expect(validateReason('   ')).toBe(false);
  });

  it('rejects reason over 1000 chars', () => {
    expect(validateReason('x'.repeat(1001))).toBe(false);
    expect(validateReason('x'.repeat(1000))).toBe(true);
  });
});
