import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — InlineIQ',
  description: 'The terms that govern your use of InlineIQ.',
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 40 }}>
    <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 12, marginTop: 0 }}>{title}</h2>
    <div style={{ fontSize: 14, color: 'var(--ink-dim)', lineHeight: 1.75 }}>{children}</div>
  </section>
);

export default function TermsPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)', color: 'var(--ink)', fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>
      {/* Nav */}
      <nav style={{ borderBottom: '1px solid var(--line)', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/" style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)', textDecoration: 'none', letterSpacing: '-0.02em' }}>
          InlineIQ
        </Link>
        <Link href="/login" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>
          Sign in →
        </Link>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 32px 80px' }}>
        <div style={{ marginBottom: 40 }}>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', marginBottom: 8, marginTop: 0 }}>Terms of Service</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>Last updated: June 2026 · Effective date: June 2026</p>
        </div>

        <p style={{ fontSize: 15, color: 'var(--ink-dim)', lineHeight: 1.75, marginBottom: 40 }}>
          These Terms of Service govern your access to and use of InlineIQ. Please read them carefully — by using the service you agree to be bound by them.
        </p>

        <Section title="1. Acceptance of Terms">
          <p>
            By accessing or using InlineIQ you agree to these Terms of Service. If you do not agree, do not use the service.
          </p>
        </Section>

        <Section title="2. Description of Service">
          <p>
            InlineIQ is a shop floor management platform for cabinet and millwork shops. It provides tools for crew tracking, job management, parts tracking, file management, and AI-powered shop floor insights.
          </p>
        </Section>

        <Section title="3. Accounts and Access">
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>Supervisor accounts require registration with a valid email and password.</li>
            <li style={{ marginBottom: 8 }}>Crew members access via invite link — no account required.</li>
            <li style={{ marginBottom: 8 }}>You are responsible for maintaining the security of your account.</li>
            <li style={{ marginBottom: 8 }}>You must notify us immediately of any unauthorized access at <a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal)' }}>hello@inlineiq.app</a>.</li>
          </ul>
        </Section>

        <Section title="4. Subscription and Billing">
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>InlineIQ is offered on a subscription basis.</li>
            <li style={{ marginBottom: 8 }}>Plans are billed monthly.</li>
            <li style={{ marginBottom: 8 }}>A 30-day free trial is available — no credit card required during trial.</li>
            <li style={{ marginBottom: 8 }}>Subscriptions auto-renew unless cancelled.</li>
            <li style={{ marginBottom: 8 }}>Cancellation takes effect at end of current billing period.</li>
            <li style={{ marginBottom: 8 }}>No refunds for partial months.</li>
          </ul>
        </Section>

        <Section title="5. Acceptable Use">
          <p>You agree not to:</p>
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>Use InlineIQ for any unlawful purpose.</li>
            <li style={{ marginBottom: 8 }}>Attempt to gain unauthorized access to any part of the service.</li>
            <li style={{ marginBottom: 8 }}>Upload malicious files or code.</li>
            <li style={{ marginBottom: 8 }}>Resell or sublicense access to InlineIQ.</li>
            <li style={{ marginBottom: 8 }}>Reverse engineer the platform.</li>
          </ul>
        </Section>

        <Section title="6. Data and Privacy">
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>Your shop data belongs to you.</li>
            <li style={{ marginBottom: 8 }}>We do not sell your data to third parties.</li>
            <li style={{ marginBottom: 8 }}>Anonymized data may be used to improve AI features if you opt in.</li>
            <li style={{ marginBottom: 8 }}>See our <Link href="/privacy" style={{ color: 'var(--teal)' }}>Privacy Policy</Link> for full details.</li>
            <li style={{ marginBottom: 8 }}>On cancellation your data is retained for 90 days then permanently deleted.</li>
          </ul>
        </Section>

        <Section title="7. Intellectual Property">
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>InlineIQ and all its features are owned by Jason Morris.</li>
            <li style={{ marginBottom: 8 }}>You retain ownership of all data you upload to InlineIQ.</li>
            <li style={{ marginBottom: 8 }}>You grant InlineIQ a license to store and process your data to provide the service.</li>
          </ul>
        </Section>

        <Section title="8. Limitation of Liability">
          <p>
            InlineIQ is provided as-is. We are not liable for any indirect, incidental, or consequential damages arising from use of the service. Our total liability is limited to the amount you paid in the last 3 months.
          </p>
        </Section>

        <Section title="9. Termination">
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}>We may suspend or terminate accounts that violate these terms.</li>
            <li style={{ marginBottom: 8 }}>You may cancel your account at any time.</li>
            <li style={{ marginBottom: 8 }}>On termination access ends immediately.</li>
          </ul>
        </Section>

        <Section title="10. Changes to Terms">
          <p>
            We may update these terms at any time. We will notify you by email of material changes. Continued use after changes constitutes acceptance.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            Questions about these terms? Contact us at{' '}
            <a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal)', fontWeight: 600 }}>hello@inlineiq.app</a>.
          </p>
        </Section>

        <div style={{ paddingTop: 32, borderTop: '1px solid var(--line)', display: 'flex', gap: 20 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>← Back to home</Link>
          <Link href="/privacy" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>Privacy Policy →</Link>
        </div>
      </main>
    </div>
  );
}
