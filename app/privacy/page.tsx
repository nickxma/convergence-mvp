import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Convergence',
  description: 'How Convergence collects, uses, and protects your data.',
};

export default function PrivacyPage() {
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
            Privacy Policy
          </h1>
          <p style={{ marginTop: '1rem', color: 'var(--text-warm)', lineHeight: '1.7' }}>
            Paradox of Acceptance operates Convergence (convergence.paradoxofacceptance.xyz) and paradoxofacceptance.xyz.
            This policy explains what information we collect, how we use it, and your rights.
          </p>
        </div>

        <div style={{ lineHeight: '1.75', color: 'var(--text)' }}>
          <Section title="Information We Collect">
            <p>We collect the following categories of information:</p>
            <ul>
              <li>
                <strong>Wallet addresses.</strong> When you connect a crypto wallet, we store your public wallet address to identify your account and gate access to token-holder features.
              </li>
              <li>
                <strong>Email addresses.</strong> If you subscribe to the Paradox of Acceptance newsletter or create an account with an email, we store your address to send communications and manage your account.
              </li>
              <li>
                <strong>Usage data.</strong> We collect information about how you interact with our products — pages visited, questions asked, features used, and session metadata — to improve the product.
              </li>
              <li>
                <strong>Authentication data.</strong> When you sign in, we may store session tokens and authentication state to keep you logged in.
              </li>
            </ul>
          </Section>

          <Section title="How We Use Your Information">
            <ul>
              <li>To authenticate your account and verify token-gated access.</li>
              <li>To personalize your experience and remember your preferences.</li>
              <li>To send newsletter issues and product updates (email subscribers only).</li>
              <li>To analyze usage patterns and improve the product.</li>
              <li>To detect and prevent abuse or unauthorized access.</li>
              <li>To comply with legal obligations.</li>
            </ul>
            <p>We do not sell your personal data to third parties.</p>
          </Section>

          <Section title="Third-Party Services">
            <p>We use the following services, each of which may process your data under their own privacy policies:</p>
            <ul>
              <li>
                <strong>Privy</strong> (<a href="https://privy.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>privy.io</a>) — wallet-based authentication and user account management.
              </li>
              <li>
                <strong>Supabase</strong> (<a href="https://supabase.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>supabase.com</a>) — database and storage for user data, Q&amp;A history, and community content.
              </li>
              <li>
                <strong>Vercel</strong> (<a href="https://vercel.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>vercel.com</a>) — hosting and infrastructure. Vercel may log request metadata including IP addresses.
              </li>
              <li>
                <strong>Plausible Analytics</strong> (<a href="https://plausible.io" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>plausible.io</a>) — privacy-friendly, cookie-free analytics. No personal identifiers are collected.
              </li>
              <li>
                <strong>Resend</strong> (<a href="https://resend.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>resend.com</a>) — transactional and newsletter email delivery.
              </li>
              <li>
                <strong>OpenAI</strong> (<a href="https://openai.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--sage)' }}>openai.com</a>) — AI-powered question answering. Questions you ask may be sent to OpenAI&rsquo;s API for processing. We do not send personally identifiable information to OpenAI unless you include it in your question.
              </li>
            </ul>
          </Section>

          <Section title="Cookies and Local Storage">
            <p>
              We use browser local storage to remember your theme preference (light or dark mode) and authentication state. We do not use advertising or tracking cookies.
              Plausible Analytics is configured without cookies.
            </p>
          </Section>

          <Section title="Data Retention">
            <p>
              We retain your account data as long as your account is active. If you request deletion, we will remove your personal data from our systems within 30 days, except where retention is required by law.
            </p>
          </Section>

          <Section title="Your Rights">
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul>
              <li>Access the personal data we hold about you.</li>
              <li>Request correction of inaccurate data.</li>
              <li>Request deletion of your data.</li>
              <li>Unsubscribe from email communications at any time using the unsubscribe link in any email.</li>
              <li>Withdraw consent where processing is based on consent.</li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:privacy@paradoxofacceptance.xyz" style={{ color: 'var(--sage)' }}>
                privacy@paradoxofacceptance.xyz
              </a>
              .
            </p>
          </Section>

          <Section title="Children">
            <p>
              Our services are not directed at children under 13. We do not knowingly collect personal data from children. If you believe we have inadvertently collected such data, please contact us and we will promptly delete it.
            </p>
          </Section>

          <Section title="Changes to This Policy">
            <p>
              We may update this policy periodically. When we do, we will update the &ldquo;last updated&rdquo; date at the top of this page. Continued use of our services after changes constitutes acceptance of the updated policy.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions or concerns? Reach us at{' '}
              <a href="mailto:privacy@paradoxofacceptance.xyz" style={{ color: 'var(--sage)' }}>
                privacy@paradoxofacceptance.xyz
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
          <a href="/privacy" style={{ fontSize: '0.8125rem', color: 'var(--sage)', fontWeight: 500 }}>
            Privacy Policy
          </a>
          <a href="/terms" style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
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
