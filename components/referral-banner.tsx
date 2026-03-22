'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const COOKIE_NAME = 'ref';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function setRefCookie(code: string) {
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(code)}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`;
}

/**
 * ReferralBanner — shown when a visitor lands with ?ref=<code> in the URL.
 * Stores the code in a cookie so it survives to wallet connect.
 * Renders a dismissible banner offering 5 free questions.
 */
export function ReferralBanner() {
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const code = searchParams.get('ref');
    if (!code || !/^[\w\-]{4,16}$/.test(code)) return;

    setRefCookie(code);
    setVisible(true);
  }, [searchParams]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
      style={{ background: '#eef4ea', borderBottom: '1px solid #c8dcbe', color: '#3d5c34' }}
    >
      <span>
        You&rsquo;ve been invited &mdash; enjoy{' '}
        <strong>5 free questions</strong> instead of 3.
      </span>
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss banner"
        className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-colors"
        style={{ color: '#5a7a50' }}
      >
        <svg aria-hidden="true" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
