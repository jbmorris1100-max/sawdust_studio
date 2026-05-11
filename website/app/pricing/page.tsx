'use client';
import Link from 'next/link';
import { Nav, Footer, BgLayers } from '@/components/shared';

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  );
}

function ArrowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}

const PRICING = [
  {
    name: 'Starter',
    priceLabel: 'Free',
    period: '30-day trial',
    featured: false,
    desc: 'Get the full system in your shop for a month. No credit card.',
    cta: 'Start 30-day free trial',
    ctaHref: '/signup',
    features: [
      'Full crew + supervisor apps',
      'Scan + automatic time tracking',
      'Damage & inventory reports',
      'Email support',
      'Convert anytime',
    ],
  },
  {
    name: 'Shop',
    price: 399,
    period: 'per shop / month',
    featured: true,
    desc: 'The full InlineIQ system for a working production shop.',
    cta: 'Start free trial',
    ctaHref: '/signup',
    features: [
      'Unlimited crew per shop',
      'AI Part Identification',
      'AI Morning Brief',
      'Job Costing Intelligence',
      'Crew messaging + SOPs',
      'Priority support',
    ],
  },
  {
    name: 'Operations',
    price: 599,
    period: 'per shop / month',
    featured: false,
    desc: 'For multi-shop operators and custom-fab businesses that need more.',
    cta: 'Talk to sales',
    ctaHref: 'mailto:hello@inlineiq.app',
    features: [
      'Everything in Shop',
      'Multi-shop rollouts',
      'API + ERP integrations',
      'Custom AI tuning',
      'Dedicated success manager',
      'SSO + audit logs',
    ],
  },
];

const FAQ = [
  {
    q: 'What counts as one "shop"?',
    a: 'One physical production facility with any number of crew members and supervisors. Multi-location businesses need one plan per shop, or upgrade to Operations.',
  },
  {
    q: 'How does the 30-day trial work?',
    a: 'Full access to everything in the Shop plan for 30 days. No credit card required to start. At day 30, choose a plan or your data is kept for 90 days while you decide.',
  },
  {
    q: 'Can crew use the app without smartphones?',
    a: 'Crew need a phone for scanning. Most shops find crew already have them. We support Android and iOS. Shared devices work fine.',
  },
  {
    q: 'Does InlineIQ connect to our existing software?',
    a: 'The Operations plan includes API and ERP integrations. Shop plan exports CSV for job costing. Native integrations with QuickBooks and Jobber are on the roadmap.',
  },
  {
    q: 'How long does setup take?',
    a: "Most shops are scanning parts on day one. Full onboarding — crew QR codes, job numbers, SOPs — typically takes less than a week. We'll help.",
  },
];

export default function PricingPage() {
  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Nav />
        <main>
          {/* Header */}
          <section style={{ padding: '80px 0 20px', textAlign: 'center' }}>
            <div className="container">
              <span className="eyebrow">Pricing</span>
              <h1 style={{ marginTop: 16, fontSize: 'clamp(36px,5vw,64px)' }}>
                One price per shop.<br /><span style={{ color: 'var(--teal)' }}>Unlimited crew.</span>
              </h1>
              <p style={{ marginTop: 20, fontSize: 18, maxWidth: 540, margin: '20px auto 0' }}>
                No per-seat math. Add every supervisor, every crew member, every department — one flat monthly price for the whole floor.
              </p>
            </div>
          </section>

          {/* Pricing cards */}
          <section className="section" style={{ paddingTop: 60 }}>
            <div className="container">
              <div className="price-grid">
                {PRICING.map((t) => (
                  <div key={t.name} className={`price-card${t.featured ? ' featured' : ''}`}>
                    {t.featured && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -8 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
                          color: '#001917', background: '#2DE1C9', borderRadius: 999, padding: '3px 14px',
                        }}>
                          Most Popular
                        </span>
                      </div>
                    )}
                    <div className="price-name">{t.name}</div>
                    <div>
                      <div className="price-amount">
                        {t.price
                          ? <><b>${t.price}</b><span>/ {t.period}</span></>
                          : <b>{t.priceLabel}</b>
                        }
                      </div>
                      {!t.price && <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>{t.period}</div>}
                      <p className="price-desc" style={{ marginTop: 10 }}>{t.desc}</p>
                    </div>
                    <Link
                      href={t.ctaHref}
                      className={`btn ${t.featured ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ justifyContent: 'center' }}
                    >
                      {t.cta}
                    </Link>
                    <ul className="price-features">
                      {t.features.map((f) => (
                        <li key={f}>
                          <span style={{ color: 'var(--teal)', flexShrink: 0 }}><CheckIcon /></span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)', marginTop: 32 }}>
                All plans include a 30-day free trial. No credit card required to start.
              </p>
            </div>
          </section>

          {/* FAQ */}
          <section className="section" style={{ paddingTop: 0 }}>
            <div className="container" style={{ maxWidth: 720 }}>
              <div className="section-head" style={{ marginBottom: 48 }}>
                <span className="eyebrow">FAQ</span>
                <h2 style={{ marginTop: 12 }}>Common questions</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {FAQ.map((item, i) => (
                  <div key={i} style={{
                    padding: '24px 0',
                    borderBottom: '1px solid var(--line)',
                    borderTop: i === 0 ? '1px solid var(--line)' : 'none',
                  }}>
                    <h4 style={{ fontSize: 16, marginBottom: 10 }}>{item.q}</h4>
                    <p style={{ fontSize: 14, lineHeight: 1.65 }}>{item.a}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Final CTA */}
          <section className="final">
            <div className="container">
              <span className="eyebrow">Keep your shop sharp</span>
              <h2 style={{ marginTop: 18 }}>
                Connect your floor to your business{' '}
                <span className="text-teal">in under a week.</span>
              </h2>
              <p style={{ marginTop: 16, marginBottom: 36 }}>
                30-day free trial. No credit card. Bring one supervisor and one crew member — we'll have them scanning before lunch.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
                <Link href="/signup" className="btn btn-primary">
                  Start free trial <ArrowIcon />
                </Link>
                <a href="mailto:hello@inlineiq.app" className="btn btn-ghost">Book a demo</a>
              </div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    </>
  );
}
