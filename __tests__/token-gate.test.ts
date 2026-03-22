/**
 * Unit tests for lib/token-gate.ts
 *
 * We mock viem's createPublicClient so no real RPC call is made.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock viem ────────────────────────────────────────────────────────────────
const mockReadContract = vi.fn();

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ readContract: mockReadContract })),
  };
});

vi.mock('viem/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem/chains')>();
  return { ...actual, base: { id: 8453, name: 'Base' } };
});

// ── Import SUT after mocks ────────────────────────────────────────────────────
import { isPassHolder } from '../lib/token-gate';

const VALID_ADDRESS = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const CONTRACT_ADDRESS = '0x9691107411afb05b81cfde537efc4a00b9b1bb69';

beforeEach(() => {
  vi.resetModules();
  mockReadContract.mockReset();
  process.env.ACCEPTANCE_PASS_CONTRACT_ADDRESS = CONTRACT_ADDRESS;
});

describe('isPassHolder', () => {
  it('returns true when isMember returns true', async () => {
    mockReadContract.mockResolvedValue(true);
    const result = await isPassHolder(VALID_ADDRESS);
    expect(result).toBe(true);
    expect(mockReadContract).toHaveBeenCalledOnce();
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT_ADDRESS,
        functionName: 'isMember',
        args: [VALID_ADDRESS],
      }),
    );
  });

  it('returns false when isMember returns false', async () => {
    mockReadContract.mockResolvedValue(false);
    const result = await isPassHolder(VALID_ADDRESS);
    expect(result).toBe(false);
  });

  it('throws if ACCEPTANCE_PASS_CONTRACT_ADDRESS is not set', async () => {
    delete process.env.ACCEPTANCE_PASS_CONTRACT_ADDRESS;
    await expect(isPassHolder(VALID_ADDRESS)).rejects.toThrow(
      'ACCEPTANCE_PASS_CONTRACT_ADDRESS is not set',
    );
  });

  it('propagates RPC errors', async () => {
    mockReadContract.mockRejectedValue(new Error('RPC timeout'));
    await expect(isPassHolder(VALID_ADDRESS)).rejects.toThrow('RPC timeout');
  });

  it('passes the wallet address as-is to the contract', async () => {
    mockReadContract.mockResolvedValue(true);
    const checksummed = '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12';
    await isPassHolder(checksummed);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ args: [checksummed] }),
    );
  });
});
