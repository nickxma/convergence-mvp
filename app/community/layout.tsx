import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Community',
  description: 'Join the Convergence community. Share insights, ask questions, and connect with others on the path of mindfulness and contemplative practice.',
  openGraph: {
    title: 'Community — Convergence',
    description: 'Join the Convergence community. Share insights, ask questions, and connect with others on the path of mindfulness and contemplative practice.',
    type: 'website',
  },
};

export default function CommunityLayout({ children }: { children: React.ReactNode }) {
  return children;
}
