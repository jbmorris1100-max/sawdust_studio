import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — InlineIQ',
  description: 'How InlineIQ collects, stores, and protects your data.',
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section style={{ marginBottom: 40 }}>
    <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', marginBottom: 12, marginTop: 0 }}>{title}</h2>
    <div style={{ fontSize: 14, color: 'var(--ink-dim)', lineHeight: 1.75 }}>{children}</div>
  </section>
);

export default function PrivacyPage() {
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
          <h1 style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', marginBottom: 8, marginTop: 0 }}>Privacy Policy</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: 0 }}>Last updated: May 12, 2026</p>
        </div>

        <p style={{ fontSize: 15, color: 'var(--ink-dim)', lineHeight: 1.75, marginBottom: 40 }}>
          InlineIQ is built for shop floor teams. We take data privacy seriously — your shop&apos;s data belongs to you, and we only collect what is necessary to make the product work.
        </p>

        <Section title="What data InlineIQ collects">
          <p>When you create an account and use InlineIQ, we collect and store:</p>
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Account information</strong> — your email address and the name of your shop.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Shop floor data</strong> — time clock records, crew names, job numbers, parts logs, damage reports, inventory needs, messages, SOPs, and job drawings. This data is entered by you and your crew and is used solely to power the InlineIQ dashboard and AI features.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Device tokens</strong> — Expo push notification tokens to deliver notifications to crew members on their devices.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Usage metadata</strong> — standard server logs (timestamps, IP addresses, error traces) for debugging and reliability.</li>
          </ul>
          <p>We do not collect payment information directly — payments are handled by Stripe, which has its own privacy policy.</p>
        </Section>

        <Section title="How tenant data is isolated">
          <p>
            Every InlineIQ shop is a separate <em>tenant</em>. Each data record in our database is tagged with a <code style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>tenant_id</code> that ties it to your shop only. Application-level filters ensure that one shop&apos;s data is never accessible to another shop.
          </p>
          <p style={{ marginTop: 10 }}>
            Supervisors authenticate with a username and password (via Supabase Auth). Crew members access the mobile app using a shop-specific code that resolves only to that shop&apos;s tenant. No crew member can access another shop&apos;s data — even if they know the URL.
          </p>
        </Section>

        <Section title="Anonymized data sharing (opt-in only)">
          <p>
            InlineIQ offers an optional data sharing program to help improve AI features across all shops. <strong style={{ color: 'var(--ink)' }}>This is strictly opt-in — it is OFF by default.</strong> You can enable or disable it at any time from the Integrations tab in your supervisor dashboard.
          </p>
          <p style={{ marginTop: 10 }}>When you opt in, InlineIQ may collect <strong style={{ color: 'var(--ink)' }}>anonymized, aggregate statistics</strong> such as:</p>
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 6 }}>Average hours per shift</li>
            <li style={{ marginBottom: 6 }}>QC pass/fail rates by department</li>
            <li style={{ marginBottom: 6 }}>Most common damage report categories</li>
            <li style={{ marginBottom: 6 }}>Common inventory needs by category</li>
            <li style={{ marginBottom: 6 }}>Peak productivity hours (time-of-day patterns)</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            <strong style={{ color: '#F87171' }}>The following data is NEVER included in anonymized sharing:</strong>
          </p>
          <ul style={{ paddingLeft: 20, margin: '10px 0', color: 'var(--ink-dim)' }}>
            <li style={{ marginBottom: 6 }}>Worker names</li>
            <li style={{ marginBottom: 6 }}>Job numbers or job names</li>
            <li style={{ marginBottom: 6 }}>Your company name</li>
            <li style={{ marginBottom: 6 }}>Message content</li>
            <li style={{ marginBottom: 6 }}>Photos or uploaded files</li>
            <li style={{ marginBottom: 6 }}>Any information that could identify your shop or your customers</li>
          </ul>
          <p style={{ marginTop: 10 }}>
            Anonymized data is stored in a separate database table with no link back to any individual tenant. It cannot be reverse-engineered to identify your shop.
          </p>
        </Section>

        <Section title="How to opt out">
          <p>
            If you have opted in to data sharing and wish to opt out, navigate to <strong style={{ color: 'var(--ink)' }}>Supervisor Dashboard → Integrations</strong> and toggle off &quot;Share anonymized data.&quot; The change takes effect immediately — no future data will be submitted. Historical anonymized records (which contain no identifying information) remain in the aggregate dataset.
          </p>
          <p style={{ marginTop: 10 }}>
            To delete your account and all associated data, email us at <a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal)' }}>hello@inlineiq.app</a>.
          </p>
        </Section>

        <Section title="Data retention">
          <p>
            Your shop data is retained for as long as your account is active. If you cancel your subscription, your data is retained for 90 days before being permanently deleted. You may request earlier deletion by contacting us.
          </p>
        </Section>

        <Section title="Third-party services">
          <p>InlineIQ uses the following third-party services:</p>
          <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Supabase</strong> — database and authentication hosting. Your data is stored on Supabase infrastructure in the United States.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Anthropic (Claude)</strong> — AI model used for the morning brief and AI Assist features. When you generate a brief, shop data (crew, open issues, recent logs) is sent to Anthropic&apos;s API. Anthropic does not use API inputs to train its models by default. See <a href="https://www.anthropic.com/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)' }}>Anthropic&apos;s privacy policy</a>.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Expo</strong> — used for push notifications on iOS and Android. Device tokens are stored with your crew record to route notifications.</li>
            <li style={{ marginBottom: 8 }}><strong style={{ color: 'var(--ink)' }}>Stripe</strong> — payment processing. InlineIQ never sees or stores your full card number.</li>
          </ul>
        </Section>

        <Section title="Contact">
          <p>
            Questions about this policy or your data? Email us at{' '}
            <a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal)', fontWeight: 600 }}>hello@inlineiq.app</a>.
            We&apos;ll respond within 2 business days.
          </p>
        </Section>

        <div style={{ paddingTop: 32, borderTop: '1px solid var(--line)', display: 'flex', gap: 20 }}>
          <Link href="/" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>← Back to home</Link>
          <Link href="/signup" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>Sign up →</Link>
        </div>
      </main>
    </div>
  );
}
