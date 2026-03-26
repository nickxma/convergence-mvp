import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Saved Answers',
  description: 'Your saved mindfulness Q&A answers from Convergence, organized for easy review and reference.',
  openGraph: {
    title: 'Saved Answers — Convergence',
    description: 'Your saved mindfulness Q&A answers from Convergence, organized for easy review and reference.',
    type: 'website',
  },
};

export default function SavedLayout({ children }: { children: React.ReactNode }) {
  return children;
}
