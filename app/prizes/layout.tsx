import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Prizes',
  description: 'Browse the prize catalog for Convergence OpenClaw. See what you can win and track your claimed prizes.',
  openGraph: {
    title: 'Prizes — Convergence',
    description: 'Browse the prize catalog for Convergence OpenClaw. See what you can win and track your claimed prizes.',
    type: 'website',
  },
};

export default function PrizesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
