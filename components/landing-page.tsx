'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useTheme } from '@/lib/theme-context';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {theme === 'dark' ? (
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
        </svg>
      )}
    </button>
  );
}

export function LandingPage() {
  const { login } = usePrivy();

  return (
    <div className="flex flex-col min-h-full" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Nav */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight" style={{ color: 'var(--sage-dark)' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: 'var(--bg-chip)', color: 'var(--sage)' }}
          >
            beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={login}
            className="text-sm px-4 py-2 rounded-full font-medium transition-colors"
            style={{ background: 'var(--sage)', color: '#fff' }}
            onMouseOver={(e) => (e.currentTarget.style.background = 'var(--sage-hover)')}
            onMouseOut={(e) => (e.currentTarget.style.background = 'var(--sage)')}
          >
            Sign in
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 md:py-32">
        <div className="max-w-2xl mx-auto space-y-6">
          <div
            className="inline-block text-xs font-medium px-3 py-1 rounded-full mb-2"
            style={{ background: 'var(--bg-chip)', color: 'var(--sage-mid)' }}
          >
            Paradox of Acceptance
          </div>
          <h1
            className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight"
            style={{ color: 'var(--sage-dark)' }}
          >
            Ask anything about
            <br />
            mindfulness.
          </h1>
          <p
            className="text-base md:text-lg leading-relaxed max-w-md mx-auto"
            style={{ color: 'var(--sage)' }}
          >
            Answers sourced from 760+ hours of guided meditations, teachings, and conversations
            from leading mindfulness teachers.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={login}
              className="w-full sm:w-auto text-sm px-6 py-3 rounded-full font-medium transition-colors"
              style={{ background: 'var(--sage)', color: '#fff' }}
              onMouseOver={(e) => (e.currentTarget.style.background = 'var(--sage-hover)')}
              onMouseOut={(e) => (e.currentTarget.style.background = 'var(--sage)')}
            >
              Get started — it&apos;s free
            </button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-lg font-semibold text-center mb-10"
            style={{ color: 'var(--sage-dark)' }}
          >
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                step: '01',
                title: 'Sign in',
                desc: 'Create a free account with just your email. No passwords — powered by embedded web3 wallets.',
              },
              {
                step: '02',
                title: 'Ask a question',
                desc: "Type any question about meditation, consciousness, philosophy, or mindfulness practice.",
              },
              {
                step: '03',
                title: 'Get sourced answers',
                desc: 'Receive answers grounded in actual transcript excerpts. Expand sources to read the original context.',
              },
            ].map(({ step, title, desc }) => (
              <div key={step} className="space-y-2">
                <div className="text-xs font-mono font-semibold" style={{ color: 'var(--source-border)' }}>
                  {step}
                </div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--sage)' }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* About */}
      <section
        className="px-6 py-16 border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-sidebar)' }}
      >
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--sage-dark)' }}>
            About
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
            Convergence is a knowledge tool for people who take mindfulness seriously. It uses
            retrieval-augmented generation (RAG) to search and synthesize answers from a curated
            archive of 760+ hours of content — guided meditations, teachings, and conversations
            with scientists and philosophers.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
            Every answer cites its sources. You can read the exact transcript passages that
            informed the response. No hallucinations, no invented teachings — only what was
            actually said.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
            Built by{' '}
            <span style={{ color: 'var(--sage-mid)' }}>Paradox of Acceptance</span> — a project at the
            intersection of mindfulness, AI, and crypto-native infrastructure.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="px-6 py-8 border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
      >
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--sage-dark)' }}>
              Convergence
            </span>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              · Paradox of Acceptance
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#about"
              className="text-xs transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--sage-mid)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              About
            </a>
            <a
              href="https://github.com/nickxma/convergence-mvp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--sage-mid)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            >
              GitHub
            </a>
            <button
              onClick={login}
              className="text-xs transition-colors"
              style={{ color: 'var(--sage)' }}
              onMouseOver={(e) => (e.currentTarget.style.color = 'var(--sage-mid)')}
              onMouseOut={(e) => (e.currentTarget.style.color = 'var(--sage)')}
            >
              Sign in →
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
