'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { QAInterface } from '@/components/qa-interface';

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && !authenticated) {
      router.push('/login');
    }
  }, [ready, authenticated, router]);

  if (!ready || !authenticated) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div>
          <span className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
            Convergence
          </span>
          <span
            className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: '#e8e0d5', color: '#7d8c6e' }}
          >
            beta
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs" style={{ color: '#9c9080' }}>
            {user?.email?.address}
          </span>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{ borderColor: '#e0d8cc', color: '#7d8c6e' }}
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Q&A */}
      <div className="flex-1 overflow-hidden">
        <QAInterface />
      </div>
    </div>
  );
}
