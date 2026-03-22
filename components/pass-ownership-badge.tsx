'use client';

/**
 * PassOwnershipBadge — shows whether a wallet holds an Acceptance Pass NFT.
 * When hasPass is true, renders a badge linking to the block explorer.
 *
 * Contract address should be replaced with the real Acceptance Pass contract
 * on Arbitrum when available.
 */

const ACCEPTANCE_PASS_CONTRACT = process.env.NEXT_PUBLIC_ACCEPTANCE_PASS_CONTRACT ?? '';
const ARBISCAN_BASE = 'https://arbiscan.io/token';
const OPENSEA_BASE = 'https://opensea.io/assets/arbitrum';

interface PassOwnershipBadgeProps {
  wallet: string;
  hasPass: boolean;
}

export function PassOwnershipBadge({ wallet, hasPass }: PassOwnershipBadgeProps) {
  if (!hasPass) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
        style={{ background: '#f0ece3', color: '#9c9080', border: '1px solid #e0d8cc' }}
      >
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 0 1 0 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a3 3 0 0 1 0-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375Z" />
        </svg>
        No Acceptance Pass
      </span>
    );
  }

  const explorerUrl = ACCEPTANCE_PASS_CONTRACT
    ? `${ARBISCAN_BASE}/${ACCEPTANCE_PASS_CONTRACT}?a=${wallet}`
    : `${OPENSEA_BASE}/${ACCEPTANCE_PASS_CONTRACT}/${wallet}`;

  return (
    <a
      href={explorerUrl || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-opacity hover:opacity-80"
      style={{ background: '#d4e6cc', color: '#3d4f38', border: '1px solid #b8ccb0' }}
      title="View on Arbiscan"
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" />
      </svg>
      Acceptance Pass holder
      <svg className="w-2.5 h-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    </a>
  );
}
