'use client';

import { usePrivy } from '@privy-io/react-auth';
import { QAInterface } from '@/components/qa-interface';
import { LandingPage } from '@/components/landing-page';

export default function Home() {
  const { ready, authenticated, logout, user } = usePrivy();

  // Show nothing while Privy initialises — avoids layout flash
  if (!ready) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
      </div>
    );
  }

  if (!authenticated) {
    return <LandingPage />;
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#faf8f3' }}>
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
            style={{ background: '#e8e0d5', color: '#7d8c6e' }}
          >
            beta
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 ml-4">
          <span className="hidden sm:block text-xs truncate max-w-[180px]" style={{ color: '#9c9080' }}>
            {user?.email?.address}
          </span>
          <button
            onClick={logout}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors flex-shrink-0"
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

      {/* Footer */}
      <footer
        className="flex items-center justify-center px-5 py-2.5 border-t flex-shrink-0"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <span className="text-xs" style={{ color: '#b0a898' }}>
          Convergence · Paradox of Acceptance
        </span>
      </footer>
    </div>
  );
}
