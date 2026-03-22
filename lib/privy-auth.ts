/**
 * Server-side Privy JWT verification.
 * Returns the verified wallet address from the access token, or null on failure.
 */
import { verifyAccessToken } from '@privy-io/node';
import { createRemoteJWKSet } from 'jose';
import type { NextRequest } from 'next/server';

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (_jwks) return _jwks;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is not set');
  _jwks = createRemoteJWKSet(
    new URL(`https://auth.privy.io/api/v1/apps/${appId}/jwks.json`)
  );
  return _jwks;
}

export interface AuthResult {
  walletAddress: string;
  userId: string;
}

/**
 * Verify the Bearer token in the Authorization header and return the wallet address.
 * Returns null if the token is missing or invalid.
 */
export async function verifyRequest(req: NextRequest): Promise<AuthResult | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) return null;

  const token = auth.slice(7).trim();
  if (!token) return null;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return null;

  try {
    const claims = await verifyAccessToken({
      access_token: token,
      app_id: appId,
      verification_key: getJwks(),
    });

    const userId: string = claims.user_id ?? '';
    // user_id is the Privy DID; wallet address comes from the identity token
    // or must be fetched via the Users API. Return userId for now.
    if (!userId) return null;
    // walletAddress is not in the access token claims in the new SDK;
    // callers should use the Users API to resolve wallet from userId if needed.
    return { walletAddress: '', userId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[privy-auth] token verification failed:', msg);
    return null;
  }
}
