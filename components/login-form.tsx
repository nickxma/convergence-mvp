'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function LoginForm() {
  const { ready, authenticated, login, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) {
      router.push('/');
    }
  }, [ready, authenticated, router]);

  if (!ready) {
    return (
      <div className="text-sm" style={{ color: '#9c9080' }}>Loading…</div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 text-center">
      {/* Brand */}
      <div className="space-y-1">
        <div
          className="inline-block text-xs font-medium px-3 py-1 rounded-full mb-3"
          style={{ background: '#e8e0d5', color: '#5a6b52' }}
        >
          Paradox of Acceptance
        </div>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
          Convergence
        </h1>
        <p className="text-sm" style={{ color: '#7d8c6e' }}>
          Ask anything about mindfulness.
        </p>
      </div>

      <button
        onClick={login}
        className="w-full rounded-full px-5 py-3 text-sm font-medium text-white transition-colors"
        style={{ background: '#7d8c6e' }}
        onMouseOver={(e) => (e.currentTarget.style.background = '#6b7960')}
        onMouseOut={(e) => (e.currentTarget.style.background = '#7d8c6e')}
      >
        Continue with Email
      </button>

      {authenticated && user && (
        <p className="text-xs" style={{ color: '#9c9080' }}>
          Signed in as {user.email?.address}
        </p>
      )}

      <p className="text-xs" style={{ color: '#b0a898' }}>
        Answers sourced from 760+ hours of mindfulness teachings
      </p>
    </div>
  );
}
