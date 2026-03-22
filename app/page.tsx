'use client';

import { usePrivy } from '@privy-io/react-auth';
import { useTheme } from '@/lib/theme-context';

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="flex items-center justify-center w-8 h-8 rounded-full border transition-colors flex-shrink-0"
      style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
    >
      {theme === 'dark' ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
        </svg>
      )}
    </button>
  );
}

export default function LandingPage() {
  const { authenticated, login } = usePrivy();

  return (
    <div className="flex flex-col min-h-full" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      {/* Nav */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
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
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {authenticated ? (
            <a
              href="/qa"
              className="text-sm px-4 py-2 rounded-full font-medium transition-colors"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Open Q&amp;A
            </a>
          ) : (
            <button
              onClick={login}
              className="text-sm px-4 py-2 rounded-full font-medium transition-colors"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 py-20 md:py-32">
        <div className="max-w-2xl mx-auto space-y-6">
          <div
            className="inline-block text-xs font-medium px-3 py-1 rounded-full"
            style={{ background: 'var(--bg-chip)', color: 'var(--sage-mid)' }}
          >
            Paradox of Acceptance
          </div>
          <h1
            className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight"
            style={{ color: 'var(--sage-dark)' }}
          >
            Ask anything about meditation.
            <br />
            <span style={{ color: 'var(--sage)' }}>Get answers from Sam Harris.</span>
          </h1>
          <p
            className="text-base md:text-lg leading-relaxed max-w-lg mx-auto"
            style={{ color: 'var(--text-warm)' }}
          >
            Answers drawn from 1,100+ Waking Up transcripts — guided meditations, conversations with
            scientists and philosophers, and years of daily practice recordings.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <a
              href="/qa"
              className="w-full sm:w-auto text-sm px-6 py-3 rounded-full font-medium transition-colors inline-block"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Try it free — no wallet required
            </a>
            <a
              href="/qa"
              className="text-sm"
              style={{ color: 'var(--sage)' }}
            >
              See how it works ↓
            </a>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-lg font-semibold text-center mb-12"
            style={{ color: 'var(--sage-dark)' }}
          >
            How it works
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
            {[
              {
                step: '01',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                  </svg>
                ),
                title: 'Search the corpus',
                desc: 'Your question is matched semantically against 1,100+ indexed transcripts from the Waking Up library.',
              },
              {
                step: '02',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
                  </svg>
                ),
                title: 'AI synthesizes an answer',
                desc: 'Relevant passages are retrieved and synthesized into a clear, grounded answer — no hallucinations.',
              },
              {
                step: '03',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                ),
                title: 'Cite source passages',
                desc: 'Every answer links to the exact transcript excerpts. Expand sources to read what was actually said.',
              },
            ].map(({ step, icon, title, desc }) => (
              <div key={step} className="space-y-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ background: 'var(--sage-bg)', color: 'var(--sage)' }}
                >
                  {icon}
                </div>
                <div className="text-xs font-mono font-semibold" style={{ color: 'var(--sage-pale)' }}>
                  {step}
                </div>
                <h3 className="text-sm font-semibold" style={{ color: 'var(--sage-dark)' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Example Q&A */}
      <section
        className="px-6 py-16 border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-sidebar)' }}
      >
        <div className="max-w-2xl mx-auto">
          <h2
            className="text-lg font-semibold text-center mb-8"
            style={{ color: 'var(--sage-dark)' }}
          >
            See it in action
          </h2>

          {/* Example question bubble */}
          <div className="mb-4">
            <div
              className="ml-auto max-w-sm rounded-2xl px-4 py-3 text-sm"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              What does Sam Harris say about the nature of the self?
            </div>
          </div>

          {/* Example answer bubble */}
          <div
            className="rounded-2xl px-5 py-5 text-sm leading-relaxed mb-4"
            style={{ background: 'var(--bg-surface)', color: 'var(--text)' }}
          >
            <p style={{ marginBottom: '0.75rem' }}>
              Harris argues that the sense of being a self — the feeling that there is a &ldquo;you&rdquo; looking
              out from behind your eyes — is itself an appearance in consciousness rather than its
              source. When you look for the self, you find only sensations, thoughts, and awareness
              itself.
            </p>
            <p>
              In meditation, this can be investigated directly: rather than trying to quiet the mind,
              you simply notice that thoughts arise on their own, without a thinker producing them.
              The insight is that consciousness is already free of the self you thought you were.
            </p>
          </div>

          {/* Citation snippet */}
          <div
            className="rounded-xl px-4 py-3 text-xs"
            style={{
              background: 'var(--bg-input)',
              borderLeft: '2px solid var(--source-border)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-start gap-2">
              <span className="font-mono flex-shrink-0 mt-0.5" style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                [1]
              </span>
              <div>
                <p className="font-semibold mb-0.5" style={{ color: 'var(--sage-mid)' }}>
                  Waking Up — The Path of Meditation
                </p>
                <p className="leading-relaxed" style={{ color: 'var(--text-warm)' }}>
                  &ldquo;The feeling that you call &lsquo;I&rsquo; is just another appearance in consciousness, like
                  a sound or a sensation. It has no more reality than that — and yet when you see
                  this clearly, everything changes.&rdquo;
                </p>
              </div>
            </div>
          </div>

          <div className="text-center mt-8">
            <a
              href="/qa"
              className="inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-full font-medium"
              style={{ background: 'var(--sage)', color: '#fff' }}
            >
              Ask your own question
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="px-6 py-12 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { stat: '1,100+', label: 'transcripts indexed' },
              { stat: '10K+', label: 'questions answered' },
              { stat: 'Free', label: 'to try — no wallet' },
            ].map(({ stat, label }) => (
              <div key={label} className="space-y-1">
                <div className="text-2xl font-semibold" style={{ color: 'var(--sage-dark)' }}>
                  {stat}
                </div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Knowledge Commons CTA */}
      <section
        className="px-6 py-16 border-t"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-sidebar)' }}
      >
        <div className="max-w-2xl mx-auto text-center space-y-4">
          <div
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
            style={{ background: 'var(--bg-chip)', color: 'var(--sage-mid)' }}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
            </svg>
            Knowledge Commons
          </div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--sage-dark)' }}>
            Join the conversation.
          </h2>
          <p className="text-sm leading-relaxed max-w-md mx-auto" style={{ color: 'var(--text-warm)' }}>
            Discuss insights with other practitioners. Share questions, bookmark answers, and explore
            the collective understanding of the Waking Up community.
          </p>
          <a
            href="/community"
            className="inline-flex items-center gap-2 text-sm px-5 py-2.5 rounded-full border font-medium transition-colors"
            style={{ borderColor: 'var(--source-border)', color: 'var(--sage-dark)', background: 'var(--bg-input)' }}
          >
            Explore the community
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </a>
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
          <nav className="flex items-center gap-5">
            <a href="/about" className="text-xs transition-colors" style={{ color: 'var(--text-muted)' }}>
              About
            </a>
            <a href="/privacy" className="text-xs transition-colors" style={{ color: 'var(--text-muted)' }}>
              Privacy
            </a>
            <a
              href="https://twitter.com/quiet_drift"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              Twitter
            </a>
            <a href="/qa" className="text-xs transition-colors" style={{ color: 'var(--sage)' }}>
              Try it free →
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
