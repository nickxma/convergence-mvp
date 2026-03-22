/**
 * Unit tests for POST /api/subscriptions/cancel-survey
 *
 * Tests cover:
 *  - Auth rejection (no token)
 *  - Body validation (missing fields, invalid reason)
 *  - userId/token mismatch
 *  - Successful insertion with and without Stripe key
 *  - Stripe MRR computation (monthly vs annual)
 *  - DB errors returned as 502
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from '../app/api/subscriptions/cancel-survey/route';
import { NextRequest } from 'next/server';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/privy-auth', () => ({
  verifyRequest: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { verifyRequest } from '@/lib/privy-auth';
import { supabase } from '@/lib/supabase';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/subscriptions/cancel-survey', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function mockAuth(userId = 'did:privy:test-user') {
  vi.mocked(verifyRequest).mockResolvedValue({ userId, walletAddress: '0xabc' });
}

function mockSupabaseInsert(result: { data?: unknown; error?: { message: string } | null }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  vi.mocked(supabase.from).mockReturnValue({ insert } as ReturnType<typeof supabase.from>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

describe('POST /api/subscriptions/cancel-survey', () => {
  describe('auth', () => {
    it('returns 401 when no auth token', async () => {
      vi.mocked(verifyRequest).mockResolvedValue(null);
      const res = await POST(makeRequest({ userId: 'u1', reason: 'price', subscriptionId: 's1' }));
      expect(res.status).toBe(401);
    });
  });

  describe('body validation', () => {
    it('returns 400 for invalid JSON', async () => {
      mockAuth();
      const req = new NextRequest('http://localhost/api/subscriptions/cancel-survey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 when userId is missing', async () => {
      mockAuth();
      const res = await POST(makeRequest({ reason: 'price', subscriptionId: 's1' }));
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toMatch(/userId/);
    });

    it('returns 400 when reason is missing', async () => {
      mockAuth('u1');
      const res = await POST(makeRequest({ userId: 'u1', subscriptionId: 's1' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 when subscriptionId is missing', async () => {
      mockAuth('u1');
      const res = await POST(makeRequest({ userId: 'u1', reason: 'price' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for an unrecognised reason', async () => {
      mockAuth('u1');
      const res = await POST(makeRequest({ userId: 'u1', reason: 'bad_reason', subscriptionId: 's1' }));
      expect(res.status).toBe(400);
      const json = await res.json() as { error: string };
      expect(json.error).toMatch(/reason/i);
    });
  });

  describe('authorization', () => {
    it('returns 403 when userId in body does not match token', async () => {
      mockAuth('did:privy:token-user');
      const res = await POST(makeRequest({ userId: 'did:privy:different-user', reason: 'price', subscriptionId: 's1' }));
      expect(res.status).toBe(403);
    });
  });

  describe('successful insertion (no Stripe)', () => {
    it('inserts row and returns 200 with id and null mrrLost', async () => {
      mockAuth('did:privy:u1');
      mockSupabaseInsert({ data: { id: 'churn-id-1', mrr_lost: null }, error: null });

      const res = await POST(makeRequest({
        userId: 'did:privy:u1',
        reason: 'not_using',
        subscriptionId: 'sub_123',
      }));

      expect(res.status).toBe(200);
      const json = await res.json() as { id: string; mrrLost: unknown };
      expect(json.id).toBe('churn-id-1');
      expect(json.mrrLost).toBeNull();
    });

    it('accepts all valid reason codes', async () => {
      const validReasons = ['price', 'missing_feature', 'not_using', 'switching', 'other'];
      for (const reason of validReasons) {
        mockAuth('did:privy:u1');
        mockSupabaseInsert({ data: { id: 'cid', mrr_lost: null }, error: null });
        const res = await POST(makeRequest({ userId: 'did:privy:u1', reason, subscriptionId: 'sub_1' }));
        expect(res.status).toBe(200, `Expected 200 for reason=${reason}`);
      }
    });
  });

  describe('MRR computation via Stripe', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
    });

    it('computes mrr_lost for a monthly subscription', async () => {
      mockAuth('did:privy:u1');
      mockSupabaseInsert({ data: { id: 'cid', mrr_lost: 19.99 }, error: null });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: {
            data: [{ price: { unit_amount: 1999, recurring: { interval: 'month' } } }],
          },
        }),
      }));

      const res = await POST(makeRequest({
        userId: 'did:privy:u1',
        reason: 'price',
        subscriptionId: 'sub_monthly',
      }));

      expect(res.status).toBe(200);
      const json = await res.json() as { mrrLost: number };
      expect(json.mrrLost).toBe(19.99);

      vi.unstubAllGlobals();
    });

    it('divides annual price by 12 for mrr_lost', async () => {
      mockAuth('did:privy:u1');
      // $120/year → $10/month MRR
      mockSupabaseInsert({ data: { id: 'cid', mrr_lost: 10 }, error: null });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          items: {
            data: [{ price: { unit_amount: 12000, recurring: { interval: 'year' } } }],
          },
        }),
      }));

      const res = await POST(makeRequest({
        userId: 'did:privy:u1',
        reason: 'switching',
        subscriptionId: 'sub_annual',
      }));

      expect(res.status).toBe(200);
      const json = await res.json() as { mrrLost: number };
      expect(json.mrrLost).toBe(10);

      vi.unstubAllGlobals();
    });

    it('inserts null mrr_lost when Stripe returns non-ok', async () => {
      mockAuth('did:privy:u1');
      mockSupabaseInsert({ data: { id: 'cid', mrr_lost: null }, error: null });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));

      const res = await POST(makeRequest({
        userId: 'did:privy:u1',
        reason: 'other',
        subscriptionId: 'sub_gone',
      }));

      expect(res.status).toBe(200);
      const json = await res.json() as { mrrLost: unknown };
      expect(json.mrrLost).toBeNull();

      vi.unstubAllGlobals();
    });
  });

  describe('DB errors', () => {
    it('returns 502 on supabase insert error', async () => {
      mockAuth('did:privy:u1');
      mockSupabaseInsert({ data: undefined, error: { message: 'unique violation' } });

      const res = await POST(makeRequest({
        userId: 'did:privy:u1',
        reason: 'price',
        subscriptionId: 'sub_1',
      }));

      expect(res.status).toBe(502);
    });
  });
});
