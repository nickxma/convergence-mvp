/**
 * Shared webhook signature verification helpers.
 *
 * - verifyVercelSignature: HMAC-SHA1 used by Vercel deploy webhooks
 * - verifyResendSignature: svix-based verification used by Resend email webhooks
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { Webhook } from 'svix';

export type { WebhookVerificationError } from 'svix';

/**
 * Verify a Vercel webhook HMAC-SHA1 signature.
 *
 * Vercel computes: HMAC-SHA1(rawBody, secret) and sends it in `x-vercel-signature`.
 * Returns true only when the computed digest matches the provided signature using
 * constant-time comparison to prevent timing attacks.
 */
export function verifyVercelSignature(
  rawBody: string,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // timingSafeEqual throws if buffers have different lengths
    return false;
  }
}

/**
 * Verify a Resend webhook using svix header-based verification.
 *
 * Validates svix-id, svix-timestamp, and svix-signature headers.
 * Rejects payloads with timestamps older than 5 minutes (svix default).
 * Throws WebhookVerificationError if the signature is invalid or expired.
 */
export function verifyResendSignature(
  rawBody: string,
  headers: { 'svix-id': string; 'svix-timestamp': string; 'svix-signature': string },
  secret: string,
): unknown {
  return new Webhook(secret).verify(rawBody, headers);
}
