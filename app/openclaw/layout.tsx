import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'OpenClaw',
  description: 'Play OpenClaw — an online claw machine where you can win real prizes. Browse available machines, join queues, and claim your winnings.',
  openGraph: {
    title: 'OpenClaw — Convergence',
    description: 'Play OpenClaw — an online claw machine where you can win real prizes. Browse available machines, join queues, and claim your winnings.',
    type: 'website',
  },
};

export default function OpenClawLayout({ children }: { children: React.ReactNode }) {
  return children;
}
