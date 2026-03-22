/**
 * Admin authentication helper.
 *
 * Admin endpoints require: Authorization: Bearer <ADMIN_WALLET>
 * ADMIN_WALLET is set via environment variable (never hard-coded).
 *
 * Phase 1 — simple wallet-as-secret pattern. Suitable for internal tooling
 * until a proper admin auth layer is added.
 */
import type { NextRequest } from 'next/server';

/**
 * Returns true if the request carries a valid admin bearer token.
 * The token must equal the ADMIN_WALLET env var (case-insensitive for hex).
 */
export function isAdminRequest(req: NextRequest): boolean {
  const adminWallet = process.env.ADMIN_WALLET;
  if (!adminWallet) return false;

  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return false;

  const token = auth.slice(7).trim();
  return token.toLowerCase() === adminWallet.toLowerCase();
}

/**
 * Extracts the bearer token (admin wallet address) from the Authorization header.
 * Does not validate against ADMIN_WALLET — call isAdminRequest first.
 */
export function getAdminWallet(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;
  const token = auth.slice(7).trim();
  return token || null;
}
