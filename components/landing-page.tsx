'use client';

import { useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function LandingPage() {
  const { login } = usePrivy();
  const [showSources, setShowSources] = useState(false);

  return (
    <div className="flex flex-col min-h-full" style={{ background: '#faf8f3', color: '#2c2c2c' }}>
      {/* Nav */}
      <header
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-tight" style={{ color: '#3d4f38' }}>
            Convergence
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded-full"
            style={{ background: '#e8e0d5', color: '#7d8c6e' }}
          >
            beta
          </span>
        </div>
        <button
          onClick={login}
          className="text-sm px-4 py-2 rounded-full font-medium transition-colors"
          style={{ background: '#7d8c6e', color: '#fff' }}
          onMouseOver={(e) => (e.currentTarget.style.background = '#6b7960')}
          onMouseOut={(e) => (e.currentTarget.style.background = '#7d8c6e')}
        >
          Sign in
        </button>
      </header>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 md:py-32">
        <div className="max-w-2xl mx-auto space-y-6">
          <div
            className="inline-block text-xs font-medium px-3 py-1 rounded-full mb-2"
            style={{ background: '#e8e0d5', color: '#5a6b52' }}
          >
            Paradox of Acceptance
          </div>
          <h1
            className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight"
            style={{ color: '#3d4f38' }}
          >
            Ask anything about
            <br />
            mindfulness.
          </h1>
          <p
            className="text-base md:text-lg leading-relaxed max-w-md mx-auto"
            style={{ color: '#7d8c6e' }}
          >
            Answers drawn from 9,500+ documents across nine curated sources — ancient texts, contemporary teachings, and peer-reviewed science.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              onClick={login}
              className="w-full sm:w-auto text-sm px-6 py-3 rounded-full font-medium transition-colors"
              style={{ background: '#7d8c6e', color: '#fff' }}
              onMouseOver={(e) => (e.currentTarget.style.background = '#6b7960')}
              onMouseOut={(e) => (e.currentTarget.style.background = '#7d8c6e')}
            >
              Get started — it&apos;s free
            </button>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="px-6 py-16 border-t" style={{ borderColor: '#e0d8cc' }}>
        <div className="max-w-3xl mx-auto">
          <h2
            className="text-lg font-semibold text-center mb-10"
            style={{ color: '#3d4f38' }}
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
                <div className="text-xs font-mono font-semibold" style={{ color: '#b8ccb0' }}>
                  {step}
                </div>
                <h3 className="text-sm font-semibold" style={{ color: '#3d4f38' }}>
                  {title}
                </h3>
                <p className="text-sm leading-relaxed" style={{ color: '#7d8c6e' }}>
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
        style={{ borderColor: '#e0d8cc', background: '#f5f0e8' }}
      >
        <div className="max-w-2xl mx-auto space-y-4">
          <h2 className="text-lg font-semibold" style={{ color: '#3d4f38' }}>
            About
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: '#5c5248' }}>
            Convergence is a research tool for people who take mindfulness seriously. It searches
            and synthesizes answers from a curated corpus of 9,500+ documents and 37 million+
            words — spanning Theravada and Tibetan Buddhist traditions, contemplative philosophy,
            and peer-reviewed science.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#5c5248' }}>
            Every answer cites its sources. You can read the exact passages that informed the
            response. No hallucinations, no invented teachings — only what was actually said or
            written.
          </p>
          <div>
            <button
              onClick={() => setShowSources(!showSources)}
              className="text-sm font-medium flex items-center gap-1.5"
              style={{ color: '#5a6b52' }}
            >
              <span style={{ display: 'inline-block', transition: 'transform 0.2s', transform: showSources ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
              {showSources ? 'Hide sources' : 'View sources'}
            </button>
            {showSources && (
              <ul className="mt-3 space-y-1.5 text-xs leading-relaxed" style={{ color: '#5c5248' }}>
                <li><strong>SuttaCentral</strong> — 4,816 documents (Pali Canon, early Buddhist texts)</li>
                <li><strong>Lotsawa House</strong> — 2,224 documents (Tibetan Buddhist texts)</li>
                <li><strong>Access to Insight</strong> — 1,621 documents (Theravada texts, Pali Canon + commentary)</li>
                <li><strong>PMC (PubMed Central)</strong> — 585 peer-reviewed papers on mindfulness and contemplative science</li>
                <li><strong>Project Gutenberg</strong> — 127 classic contemplative texts</li>
                <li><strong>dhammatalks.org</strong> — 90 books (Thanissaro Bhikkhu)</li>
                <li><strong>Wikisource</strong> — 13 public domain contemplative texts</li>
                <li><strong>Dharma Seed</strong> — 7 talks (with explicit permission)</li>
                <li><strong>Internet Archive</strong> — 5 pre-1928 public domain texts</li>
              </ul>
            )}
          </div>
          <p className="text-sm leading-relaxed" style={{ color: '#5c5248' }}>
            Built by{' '}
            <span style={{ color: '#5a6b52' }}>Paradox of Acceptance</span> — a project at the
            intersection of mindfulness, AI, and crypto-native infrastructure.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer
        className="px-6 py-8 border-t"
        style={{ borderColor: '#e0d8cc', background: '#faf8f3' }}
      >
        <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: '#3d4f38' }}>
              Convergence
            </span>
            <span className="text-xs" style={{ color: '#b0a898' }}>
              · Paradox of Acceptance
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#about"
              className="text-xs transition-colors"
              style={{ color: '#9c9080' }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#5a6b52')}
              onMouseOut={(e) => (e.currentTarget.style.color = '#9c9080')}
            >
              About
            </a>
            <a
              href="https://paradoxofacceptance.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-colors"
              style={{ color: '#9c9080' }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#5a6b52')}
              onMouseOut={(e) => (e.currentTarget.style.color = '#9c9080')}
            >
              Paradox of Acceptance ↗
            </a>
            <a
              href="https://github.com/nickxma/convergence-mvp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs transition-colors"
              style={{ color: '#9c9080' }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#5a6b52')}
              onMouseOut={(e) => (e.currentTarget.style.color = '#9c9080')}
            >
              GitHub
            </a>
            <button
              onClick={login}
              className="text-xs transition-colors"
              style={{ color: '#7d8c6e' }}
              onMouseOver={(e) => (e.currentTarget.style.color = '#5a6b52')}
              onMouseOut={(e) => (e.currentTarget.style.color = '#7d8c6e')}
            >
              Sign in →
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
