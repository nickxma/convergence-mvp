import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Conversation',
  description: 'Continue your mindfulness Q&A conversation on Convergence.',
  openGraph: {
    title: 'Conversation — Convergence',
    description: 'Continue your mindfulness Q&A conversation on Convergence.',
    type: 'website',
  },
};

export default function ConversationLayout({ children }: { children: React.ReactNode }) {
  return children;
}
