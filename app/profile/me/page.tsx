'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * /profile/me — redirects the logged-in user to their wallet profile page.
 * If not authenticated, redirects to the login page.
 */
export default function MeProfileRedirect() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;

    if (!authenticated) {
      router.replace('/login');
      return;
    }

    const wallet = user?.wallet?.address;
    if (wallet) {
      router.replace(`/profile/${wallet}`);
    } else {
      // Privy user without an embedded wallet yet — fall back to the
      // classic profile page which handles wallet-less users gracefully.
      router.replace('/profile');
    }
  }, [ready, authenticated, user, router]);

  return (
    <div className="flex flex-1 items-center justify-center" style={{ background: '#faf8f3' }}>
      <div className="text-sm" style={{ color: '#9c9080' }}>
        Loading…
      </div>
    </div>
  );
}
