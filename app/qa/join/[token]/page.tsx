import type { Metadata } from 'next';
import { JoinSessionClient } from './join-session-client';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata: Metadata = {
  title: 'Join Session — Convergence',
  description: 'Join a shared Q&A exploration session.',
};

export default async function JoinSessionPage({ params }: PageProps) {
  const { token } = await params;
  return <JoinSessionClient token={token} />;
}
