import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Leaderboard',
  description: 'See the top prize winners on Convergence OpenClaw. Track rankings by all time, this week, or this month.',
  openGraph: {
    title: 'Leaderboard — Convergence',
    description: 'See the top prize winners on Convergence OpenClaw. Track rankings by all time, this week, or this month.',
    type: 'website',
  },
};

export default function LeaderboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
