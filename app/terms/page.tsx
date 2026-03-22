import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — Convergence',
  description: 'Terms governing use of Convergence and Paradox of Acceptance.',
};

export default function TermsPage() {
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <main
        id="main-content"
        style={{
          maxWidth: '680px',
          margin: '0 auto',
          padding: '4rem 1.5rem 6rem',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: '2.5rem' }}>
          <a
            href="/"
            style={{
              fontSize: '0.8125rem',
              color: 'var(--sage)',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              marginBottom: '1.5rem',
            }}
          >
            ← Convergence
          </a>
          <p
            style={{
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
              marginBottom: '0.5rem',
              fontFamily: 'var(--font-geist-mono), monospace',
            }}
          >
            Last updated: March 22, 2025
          </p>
          <h1
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: '2rem',
              fontWeight: '600',
              lineHeight: '1.25',
              color: 'var(--sage-dark)',
              margin: '0',
            }}
          >
            Terms of Service
          </h1>
          <p style={{ marginTop: '1rem', color: 'var(--text-warm)', lineHeight: '1.7' }}>
            These Terms of Service govern your use of Convergence (convergence.paradoxofacceptance.xyz)
            and paradoxofacceptance.xyz, operated by Paradox of Acceptance. By using our services, you
            agree to these terms.
          </p>
        </div>

        <div style={{ lineHeight: '1.75', color: 'var(--text)' }}>
          <Section title="Acceptance of Terms">
            <p>
              By accessing or using our services, you confirm that you are at least 13 years of age
              and agree to be bound by these terms. If you do not agree, do not use our services.
            </p>
          </Section>

          <Section title="Description of Services">
            <p>
              Convergence is an AI-powered Q&amp;A tool grounded in transcripts from the Waking Up
              library, operated by Paradox of Acceptance. Paradox of Acceptance provides additional
              tools, essays, and resources for meditators. We may update, expand, or discontinue
              features at any time.
            </p>
          </Section>

          <Section title="Accounts and Access">
            <ul>
              <li>
                You may use basic features without an account. Token-gated and community features require
                connecting a compatible crypto wallet.
              </li>
              <li>
                You are responsible for maintaining the security of your wallet and any credentials
                associated with your account.
              </li>
              <li>
                We reserve the right to suspend or terminate access for violations of these terms or
                for conduct that harms other users or the platform.
              </li>
            </ul>
          </Section>

          <Section title="Acceptable Use">
            <p>You agree not to:</p>
            <ul>
              <li>Use our services for any unlawful purpose or in violation of any applicable law.</li>
              <li>
                Attempt to gain unauthorized access to any part of our systems, other users&rsquo;
                accounts, or underlying infrastructure.
              </li>
              <li>Scrape, crawl, or systematically extract data from our services without permission.</li>
              <li>Submit content that is abusive, harassing, defamatory, or infringes third-party rights.</li>
              <li>
                Attempt to circumvent token-gating mechanisms or access controls.
              </li>
              <li>Interfere with or disrupt the integrity or performance of our services.</li>
            </ul>
          </Section>

          <Section title="User Content">
            <p>
              Content you submit to community features (posts, replies, questions) remains yours.
              By submitting content, you grant us a non-exclusive, royalty-free license to display,
              store, and transmit it as part of operating the service. You represent that you have the
              right to submit any content you post and that it does not violate third-party rights.
            </p>
            <p>
              We may remove content that violates these terms or that we determine, in our sole
              discretion, is harmful to the community.
            </p>
          </Section>

          <Section title="Intellectual Property">
            <p>
              All content produced by us — including but not limited to essays, UI design, AI-generated
              answers, and curation of the corpus — is owned by Paradox of Acceptance or its licensors.
              You may not reproduce, distribute, or create derivative works without our prior written consent.
            </p>
            <p>
              The underlying Waking Up transcripts remain the property of their respective owners.
              Our use is for the purpose of indexing and answering questions; we do not claim ownership
              of that source material.
            </p>
          </Section>

          <Section title="AI-Generated Answers">
            <p>
              Answers provided by Convergence are generated by AI based on indexed transcripts. They are
              intended for informational and exploratory purposes only. We do not guarantee accuracy,
              completeness, or fitness for any particular purpose. Do not rely on answers from Convergence
              for medical, legal, financial, or other professional advice.
            </p>
          </Section>

          <Section title="Token-Gated Features">
            <p>
              Access to certain features requires holding a qualifying token or NFT. We do not guarantee
              continuous availability of gated features and reserve the right to modify access criteria
              with reasonable notice. Token ownership does not confer any equity, ownership, or
              governance rights in Paradox of Acceptance.
            </p>
          </Section>

          <Section title="Disclaimer of Warranties">
            <p>
              Our services are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind,
              express or implied, including but not limited to merchantability, fitness for a particular
              purpose, or non-infringement. We do not warrant that our services will be uninterrupted,
              error-free, or free of harmful components.
            </p>
          </Section>

          <Section title="Limitation of Liability">
            <p>
              To the maximum extent permitted by applicable law, Paradox of Acceptance shall not be
              liable for any indirect, incidental, special, consequential, or punitive damages arising
              from your use of or inability to use our services, even if advised of the possibility of
              such damages.
            </p>
          </Section>

          <Section title="Changes to These Terms">
            <p>
              We may update these terms at any time. We will indicate the date of the latest revision
              at the top of this page. Continued use of our services after changes constitutes your
              acceptance of the updated terms.
            </p>
          </Section>

          <Section title="Governing Law">
            <p>
              These terms are governed by the laws of the State of California, United States, without
              regard to conflict of law principles. Any disputes shall be resolved in the courts of
              competent jurisdiction in California.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these terms? Reach us at{' '}
              <a href="mailto:legal@paradoxofacceptance.xyz" style={{ color: 'var(--sage)' }}>
                legal@paradoxofacceptance.xyz
              </a>
              .
            </p>
          </Section>
        </div>

        <div
          style={{
            marginTop: '3rem',
            paddingTop: '1.5rem',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: '1.5rem',
          }}
        >
          <a href="/privacy" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Privacy Policy
          </a>
          <a href="/terms" style={{ fontSize: '0.8125rem', color: 'var(--sage)', fontWeight: 500 }}>
            Terms of Service
          </a>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: '2rem' }}>
      <h2
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: '1.125rem',
          fontWeight: '600',
          color: 'var(--sage-dark)',
          marginBottom: '0.75rem',
          marginTop: '0',
        }}
      >
        {title}
      </h2>
      <div
        style={{
          fontSize: '0.9375rem',
          color: 'var(--text-warm)',
          lineHeight: '1.75',
        }}
      >
        {children}
      </div>
    </section>
  );
}
