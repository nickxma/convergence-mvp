'use client';

import { useState, useEffect, useCallback, type CSSProperties } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useRouter } from 'next/navigation';

export default function EmbedSettingsPage() {
  const { ready, authenticated, user } = usePrivy();
  const router = useRouter();
  const walletAddress = user?.wallet?.address ?? null;

  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Config knobs
  const [siteId, setSiteId] = useState('my-site');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [placeholder, setPlaceholder] = useState('');
  const [maxHeight, setMaxHeight] = useState('600');
  const [copied, setCopied] = useState(false);

  // Redirect unauthenticated users
  useEffect(() => {
    if (ready && !authenticated) router.replace('/');
  }, [ready, authenticated, router]);

  // Verify admin access using the wallet-as-secret pattern (same as admin/page.tsx)
  const verifyAdmin = useCallback(async (wallet: string) => {
    try {
      const res = await fetch('/api/admin/qa-analytics', {
        headers: { Authorization: `Bearer ${wallet}` },
        cache: 'no-store',
      });
      if (res.status === 403 || res.status === 401) {
        setError('Access denied. Admin credentials required.');
        return;
      }
      setAuthed(true);
    } catch {
      setError('Network error verifying access.');
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (walletAddress) verifyAdmin(walletAddress);
  }, [walletAddress, verifyAdmin]);

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

  const buildSnippet = () => {
    const attrs: string[] = [`src="${appUrl}/embed/widget.js"`];
    if (siteId) attrs.push(`data-site-id="${siteId}"`);
    if (placeholder) attrs.push(`data-placeholder="${placeholder}"`);
    if (theme !== 'light') attrs.push(`data-theme="${theme}"`);
    if (maxHeight !== '600') attrs.push(`data-max-height="${maxHeight}"`);
    return `<script ${attrs.join('\n       ')}></script>`;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildSnippet());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the pre element text
    }
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg-input)',
    color: 'var(--text)',
    fontSize: '0.875rem',
    boxSizing: 'border-box',
  };

  if (!ready || (!authed && !error)) {
    return (
      <div style={{ padding: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '2rem', color: 'var(--error-text)', fontSize: '0.875rem' }}>
        {error}
      </div>
    );
  }

  const previewUrl = `/embed/ask?theme=${theme}${placeholder ? `&placeholder=${encodeURIComponent(placeholder)}` : ''}`;

  return (
    <div
      style={{
        padding: '2rem',
        maxWidth: '760px',
        margin: '0 auto',
        color: 'var(--text)',
        fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 0.375rem' }}>
          Embed Settings
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', margin: 0 }}>
          Embed the Q&amp;A widget on any external page — GitHub Pages, landing pages, bio links.
        </p>
      </div>

      {/* Live preview */}
      <section style={{ marginBottom: '2rem' }}>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            margin: '0 0 0.75rem',
          }}
        >
          Preview
        </h2>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: '8px',
            overflow: 'hidden',
            background: 'var(--bg-surface)',
          }}
        >
          <iframe
            key={previewUrl}
            src={previewUrl}
            style={{ width: '100%', height: '180px', border: 0, display: 'block' }}
            title="Widget preview"
          />
        </div>
      </section>

      {/* Configuration */}
      <section style={{ marginBottom: '2rem' }}>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            margin: '0 0 0.75rem',
          }}
        >
          Configure
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-warm)' }}
            >
              Site ID
            </span>
            <input
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              placeholder="my-site"
              style={inputStyle}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)' }}>
              Identifier for analytics tracking
            </span>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-warm)' }}
            >
              Theme
            </span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}
              style={inputStyle}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-warm)' }}
            >
              Placeholder text
            </span>
            <input
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              placeholder="Ask anything about mindfulness…"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{ fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-warm)' }}
            >
              Max height (px)
            </span>
            <input
              type="number"
              value={maxHeight}
              onChange={(e) => setMaxHeight(e.target.value)}
              min="200"
              max="1200"
              style={inputStyle}
            />
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-faint)' }}>
              Iframe height cap; auto-resizes below this
            </span>
          </label>
        </div>
      </section>

      {/* Embed snippet */}
      <section>
        <h2
          style={{
            fontSize: '0.875rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-muted)',
            margin: '0 0 0.75rem',
          }}
        >
          Embed Code
        </h2>
        <div style={{ position: 'relative' }}>
          <pre
            style={{
              margin: 0,
              padding: '1rem 3.5rem 1rem 1rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '0.8125rem',
              overflowX: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              color: 'var(--text)',
              lineHeight: 1.6,
            }}
          >
            {buildSnippet()}
          </pre>
          <button
            onClick={handleCopy}
            style={{
              position: 'absolute',
              top: '0.5rem',
              right: '0.5rem',
              padding: '0.25rem 0.625rem',
              background: copied ? 'var(--celebration-bg)' : 'var(--bg)',
              border: `1px solid ${copied ? 'var(--celebration-border)' : 'var(--border)'}`,
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: copied ? 'var(--celebration-text)' : 'var(--text-muted)',
              fontFamily: 'inherit',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <p
          style={{
            marginTop: '0.625rem',
            fontSize: '0.75rem',
            color: 'var(--text-faint)',
          }}
        >
          Paste this snippet anywhere in the{' '}
          <code style={{ fontFamily: 'var(--font-geist-mono, monospace)' }}>&lt;body&gt;</code>{' '}
          of your HTML page. The widget loads asynchronously and injects an iframe.
        </p>
      </section>

      {/* Usage notes */}
      <section
        style={{
          marginTop: '2rem',
          padding: '1rem',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          fontSize: '0.8125rem',
          color: 'var(--text-warm)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--text)' }}>
          Rate limits
        </strong>
        Unauthenticated visitors get <strong>3 questions per day</strong> (resets at UTC midnight).
        Authenticated users follow their subscription limits.
      </section>
    </div>
  );
}
