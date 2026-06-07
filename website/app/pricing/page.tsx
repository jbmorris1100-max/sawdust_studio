'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Nav, Footer, BgLayers } from '@/components/shared';
import { supabase } from '@/lib/supabase';

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

type Billing = 'monthly' | 'annual';
type Tier = 'starter' | 'shop' | 'operations';

type PlanCard = {
  name: string;
  tier: Tier;
  monthly: number | null;       // null = free
  annual: number | null;        // per-month price when billed annually
  badge?: string;
  featured?: boolean;
  desc: string;
  features: string[];
};

const PLANS: PlanCard[] = [
  {
    name: 'Starter',
    tier: 'starter',
    monthly: null,
    annual: null,
    desc: 'Get the full system in your shop for a month. No credit card.',
    features: [
      'Up to 3 crew members',
      'Basic job tracking',
      'Crew clock in/out',
      'Messages',
    ],
  },
  {
    name: 'Shop',
    tier: 'shop',
    monthly: 599,
    annual: 499,
    badge: 'Most Popular',
    featured: true,
    desc: 'The full InlineIQ system for a working production shop.',
    features: [
      'Up to 15 crew members',
      'Full job & parts tracking',
      'Assembly scan with AI',
      'ERP imports (Cabinet Vision, Mozaik, Microvellum, Innergy)',
      'AI assist & autonomous modes',
      'Push notifications',
      'Plans & SOPs',
      'Reports & labor costing',
      '30-day free trial',
    ],
  },
  {
    name: 'Operations',
    tier: 'operations',
    monthly: 799,
    annual: 665,
    badge: 'Best Value',
    desc: 'For multi-location operators that need autonomous AI and API access.',
    features: [
      'Everything in Shop, plus:',
      'Unlimited crew members',
      'Multi-location support',
      'InlineIQ API access (coming soon)',
      'Priority support',
      'Advanced analytics',
      '30-day free trial',
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
    a: 'Full access to everything in the Shop plan for 30 days. Your card is saved when you start so service continues seamlessly, but you are not charged until the trial ends. Cancel anytime before then.',
  },
  {
    q: 'Can crew use the app without smartphones?',
    a: 'Crew need a phone for scanning. Most shops find crew already have them. We support Android and iOS. Shared devices work fine.',
  },
  {
    q: 'Does InlineIQ connect to our existing software?',
    a: 'The Shop and Operations plans include ERP imports (Cabinet Vision, Mozaik, Microvellum, Innergy). Operations adds API access. Native integrations with QuickBooks and Jobber are on the roadmap.',
  },
  {
    q: 'How long does setup take?',
    a: "Most shops are scanning parts on day one. Full onboarding — crew QR codes, job numbers, SOPs — typically takes less than a week. We'll help.",
  },
];

export default function PricingPage() {
  const router = useRouter();
  const [billing, setBilling] = useState<Billing>('monthly');
  const [busy, setBusy] = useState<Tier | null>(null);
  const [error, setError] = useState('');

  // Start-trial handler. Logged out → /signup carrying the selection. Logged in
  // → create a Checkout session and redirect to Stripe.
  const startTrial = async (tier: Tier) => {
    setError('');
    if (tier === 'starter') {
      router.push('/signup');
      return;
    }
    setBusy(tier);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push(`/signup?plan=${tier}&billing=${billing}`);
        return;
      }

      // Find the tenant for this user, then open Checkout.
      const { data: tenant } = await supabase
        .from('tenants')
        .select('id')
        .eq('owner_user_id', session.user.id)
        .single();
      if (!tenant) {
        router.push(`/signup?plan=${tier}&billing=${billing}`);
        return;
      }

      const res = await fetch('/app/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tier, billing, tenant_id: tenant.id }),
      });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not start checkout');
      window.location.assign(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(null);
    }
  };

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
                No per-seat math. Add every supervisor, every crew member, every department — one flat price for the whole floor.
              </p>

              {/* Monthly / Annual toggle */}
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 32, padding: 4, background: 'var(--bg-1)', border: '1px solid var(--line-strong)', borderRadius: 999 }}>
                {(['monthly', 'annual'] as Billing[]).map((b) => (
                  <button
                    key={b}
                    onClick={() => setBilling(b)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
                      padding: '8px 18px', borderRadius: 999, border: 'none',
                      background: billing === b ? 'var(--teal)' : 'transparent',
                      color: billing === b ? '#001917' : 'var(--ink-mute)',
                      transition: 'all 0.15s',
                    }}
                  >
                    {b === 'monthly' ? 'Monthly' : 'Annual'}
                    {b === 'annual' && (
                      <span style={{
                        fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                        color: billing === b ? '#001917' : 'var(--teal)',
                        background: billing === b ? 'rgba(0,25,23,0.12)' : 'rgba(94,234,212,0.12)',
                        borderRadius: 999, padding: '2px 8px',
                      }}>
                        Save 2 months
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {error && (
            <div className="container" style={{ maxWidth: 560 }}>
              <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 13, color: 'var(--danger)', textAlign: 'center' }}>
                {error}
              </div>
            </div>
          )}

          {/* Pricing cards */}
          <section className="section" style={{ paddingTop: 40 }}>
            <div className="container">
              <div className="price-grid">
                {PLANS.map((t) => {
                  const price = billing === 'annual' ? t.annual : t.monthly;
                  const isBusy = busy === t.tier;
                  return (
                    <div key={t.name} className={`price-card${t.featured ? ' featured' : ''}`}>
                      {t.badge && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -8 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase',
                            color: '#001917', background: '#2DE1C9', borderRadius: 999, padding: '3px 14px',
                          }}>
                            {t.badge}
                          </span>
                        </div>
                      )}
                      <div className="price-name">{t.name}</div>
                      <div>
                        <div className="price-amount">
                          {price !== null
                            ? <><b>${price}</b><span>/ mo{billing === 'annual' ? ', billed annually' : ''}</span></>
                            : <b>Free</b>
                          }
                        </div>
                        {price === null && <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Free for 30 days — then choose a plan</div>}
                        <p className="price-desc" style={{ marginTop: 10 }}>{t.desc}</p>
                      </div>
                      <button
                        onClick={() => void startTrial(t.tier)}
                        disabled={isBusy}
                        className={`btn ${t.featured ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ justifyContent: 'center', width: '100%', opacity: isBusy ? 0.7 : 1, cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                      >
                        {isBusy ? 'Starting…' : 'Start free trial'}
                      </button>
                      <ul className="price-features">
                        {t.features.map((f) => (
                          <li key={f}>
                            <span style={{ color: 'var(--teal)', flexShrink: 0 }}><CheckIcon /></span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)', marginTop: 32 }}>
                All paid plans include a 30-day free trial. Card saved at signup; first charge after the trial.
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
                30-day free trial. Bring one supervisor and one crew member — we&rsquo;ll have them scanning before lunch.
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
