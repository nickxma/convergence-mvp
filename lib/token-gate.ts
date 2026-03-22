/**
 * Token gate: verify the caller holds at least 1 Acceptance Pass NFT.
 *
 * Contract: AcceptancePass (ERC-1155) deployed on Base (chain 8453).
 * Address from env var ACCEPTANCE_PASS_CONTRACT_ADDRESS.
 * Uses isMember(address) view function — cheaper than a full balanceOf call.
 */
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';

// Minimal ABI — only what we need.
const ACCEPTANCE_PASS_ABI = [
  {
    name: 'isMember',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'memberCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// Lazily created — one client for the process lifetime.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _client: any = null;

function getClient() {
  if (_client) return _client;
  const rpcUrl = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
  _client = createPublicClient({ chain: base, transport: http(rpcUrl) });
  return _client;
}

/**
 * Returns the total number of Acceptance Pass holders from the contract.
 * Returns null if the contract address is not configured or the method is unavailable.
 */
export async function getTotalPassHolders(): Promise<number | null> {
  const contractAddress = process.env.ACCEPTANCE_PASS_CONTRACT_ADDRESS as Address | undefined;
  if (!contractAddress) return null;

  const client = getClient();
  const result = await client.readContract({
    address: contractAddress,
    abi: ACCEPTANCE_PASS_ABI,
    functionName: 'memberCount',
    args: [],
  });
  return Number(result);
}

/**
 * Returns true if `walletAddress` holds at least 1 Acceptance Pass.
 * Throws on configuration errors (missing contract address).
 */
export async function isPassHolder(walletAddress: string): Promise<boolean> {
  const contractAddress = process.env.ACCEPTANCE_PASS_CONTRACT_ADDRESS as Address | undefined;
  if (!contractAddress) {
    throw new Error('ACCEPTANCE_PASS_CONTRACT_ADDRESS is not set');
  }

  const client = getClient();
  const result = await client.readContract({
    address: contractAddress,
    abi: ACCEPTANCE_PASS_ABI,
    functionName: 'isMember',
    args: [walletAddress as Address],
  });
  return result as boolean;
}
