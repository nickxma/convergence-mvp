/**
 * Unit tests for lib/webhook-verify.ts
 *
 * Covers HMAC-SHA1 (Vercel) and svix/standardwebhooks (Resend) verification.
 */
import { describe, it, expect } from 'vitest';
import { createHmac } from 'crypto';
import { Webhook } from 'svix';
import { verifyVercelSignature, verifyResendSignature } from '../lib/webhook-verify';

// ── Vercel HMAC-SHA1 ──────────────────────────────────────────────────────────

describe('verifyVercelSignature', () => {
  const secret = 'test-webhook-secret';
  const body = '{"type":"deployment.succeeded","payload":{"deployment":{"id":"dpl_test"}}}';

  function sign(b: string, s: string) {
    return createHmac('sha1', s).update(b).digest('hex');
  }

  it('returns true for a valid signature', () => {
    expect(verifyVercelSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it('returns false for a tampered body', () => {
    const sig = sign(body, secret);
    expect(verifyVercelSignature(body + ' ', sig, secret)).toBe(false);
  });

  it('returns false for an invalid signature string', () => {
    expect(verifyVercelSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('returns false for a different secret', () => {
    const sig = sign(body, 'other-secret');
    expect(verifyVercelSignature(body, sig, secret)).toBe(false);
  });

  it('returns false for an empty signature', () => {
    expect(verifyVercelSignature(body, '', secret)).toBe(false);
  });

  it('uses constant-time comparison (no throw on length mismatch)', () => {
    // timingSafeEqual would throw if we didn't catch mismatched buffer lengths
    expect(() => verifyVercelSignature(body, 'short', secret)).not.toThrow();
    expect(verifyVercelSignature(body, 'short', secret)).toBe(false);
  });
});

// ── Resend svix verification ──────────────────────────────────────────────────

// svix requires a base64-encoded secret (or whsec_ prefix + base64)
const RESEND_SECRET = Buffer.from('test-resend-signing-secret-32b!!').toString('base64');

function makeResendHeaders(body: string, secret: string, opts?: { ageMs?: number }) {
  const wh = new Webhook(secret);
  const msgId = `msg_${Date.now()}`;
  const timestamp = new Date(Date.now() - (opts?.ageMs ?? 0));
  const sig = wh.sign(msgId, timestamp, body);
  const tsStr = Math.floor(timestamp.getTime() / 1000).toString();
  return {
    'svix-id': msgId,
    'svix-timestamp': tsStr,
    'svix-signature': sig,
  };
}

describe('verifyResendSignature', () => {
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'em_test' } });

  it('does not throw for a valid signature with current timestamp', () => {
    const headers = makeResendHeaders(body, RESEND_SECRET);
    expect(() => verifyResendSignature(body, headers, RESEND_SECRET)).not.toThrow();
  });

  it('returns the parsed payload on success', () => {
    const headers = makeResendHeaders(body, RESEND_SECRET);
    const result = verifyResendSignature(body, headers, RESEND_SECRET);
    expect(result).toBeTruthy();
  });

  it('throws for an invalid signature', () => {
    const headers = {
      'svix-id': 'msg_fake',
      'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
      'svix-signature': 'v1,invalidsignaturevalue',
    };
    expect(() => verifyResendSignature(body, headers, RESEND_SECRET)).toThrow();
  });

  it('throws for a signature signed with a different secret', () => {
    const wrongSecret = Buffer.from('wrong-secret-key-32-bytes-exactly').toString('base64');
    const headers = makeResendHeaders(body, wrongSecret);
    expect(() => verifyResendSignature(body, headers, RESEND_SECRET)).toThrow();
  });

  it('throws for an expired timestamp (> 5 minutes old)', () => {
    // Sign with a timestamp 10 minutes in the past
    const headers = makeResendHeaders(body, RESEND_SECRET, { ageMs: 10 * 60 * 1000 });
    expect(() => verifyResendSignature(body, headers, RESEND_SECRET)).toThrow();
  });

  it('throws for a tampered body', () => {
    const headers = makeResendHeaders(body, RESEND_SECRET);
    expect(() =>
      verifyResendSignature(body + ' extra', headers, RESEND_SECRET),
    ).toThrow();
  });
});
