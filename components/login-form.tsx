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
      <div className="text-sm text-zinc-400">Loading...</div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
        <p className="text-sm text-zinc-500">
          Sign in to access the mindfulness knowledge platform
        </p>
      </div>

      <button
        onClick={login}
        className="w-full rounded-full bg-[#7d8c6e] px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-[#6b7960]"
      >
        Continue with Email
      </button>

      {authenticated && user && (
        <p className="text-center text-xs text-zinc-400">
          Signed in as {user.email?.address}
        </p>
      )}
    </div>
  );
}
