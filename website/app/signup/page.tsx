'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Nav, Footer, BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  );
}

const PERKS = [
  'Full supervisor + crew apps',
  'QR scan + automatic time tracking',
  'AI Morning Brief from day one',
  'No credit card required',
];

export default function SignupPage() {
  const router = useRouter();
  const [shop,     setShop]     = useState('');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [notice,   setNotice]   = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);

    try {
      // 1. Create Supabase auth user
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, company_name: shop } },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      const userId = data.user?.id;

      // 2. Create tenant row (use anon key — RLS allows insert when owner_user_id matches)
      //    Done before redirect so /app can always find the tenant
      if (userId) {
        const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const slug = shop.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        await supabase.from('tenants').insert({
          shop_name:           shop,
          slug,
          erp_type:            'none',
          owner_email:         email,
          owner_user_id:       userId,
          subscription_status: 'trial',
          trial_ends_at:       trialEndsAt,
        });
      }

      // 3. Redirect or show email-confirmation notice
      if (data.session) {
        // Email confirmation disabled → immediate session
        router.replace('/app');
      } else {
        setNotice('Check your email to confirm your account, then sign in.');
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Nav />
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 20px' }}>
          <div className="signup-grid">
            {/* Left — value prop */}
            <div style={{ paddingTop: 8 }}>
              <LogoMark size={40} />
              <h2 style={{ marginTop: 20, fontSize: 30, lineHeight: 1.15 }}>
                Start your free<br /><span style={{ color: 'var(--teal)' }}>30-day trial.</span>
              </h2>
              <p style={{ marginTop: 16, fontSize: 16, lineHeight: 1.65 }}>
                Get the full InlineIQ system in your shop today. Every scan, every minute, every dollar — tracked from the moment crew walks in.
              </p>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 14, marginTop: 32 }}>
                {PERKS.map((p) => (
                  <li key={p} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: 'var(--ink-dim)' }}>
                    <span style={{ color: 'var(--teal)', flexShrink: 0 }}><CheckIcon /></span>
                    {p}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 40, padding: '20px', background: 'rgba(94,234,212,0.04)', border: '1px solid var(--line)', borderRadius: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--teal-dim)', marginBottom: 8 }}>After your trial</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
                  $399 <span style={{ fontSize: 14, color: 'var(--ink-mute)', fontWeight: 400 }}>/ shop / month</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Unlimited crew. One flat price.</div>
              </div>
            </div>

            {/* Right — form */}
            <div style={{
              background: 'var(--bg-1)', border: '1px solid var(--line-strong)',
              borderRadius: 16, padding: '32px 28px',
              display: 'flex', flexDirection: 'column', gap: 20,
            }}>
              <div>
                <h3 style={{ fontSize: 18 }}>Create your account</h3>
                <p style={{ fontSize: 13, marginTop: 4 }}>No credit card. Cancel anytime.</p>
              </div>

              {notice && (
                <div style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(94,234,212,0.06)', border: '1px solid var(--line-strong)',
                  fontSize: 13, color: 'var(--teal)',
                }}>
                  {notice}
                </div>
              )}

              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="form-field">
                  <label className="form-label" htmlFor="shop">Shop name</label>
                  <input
                    id="shop" className="form-input" type="text"
                    placeholder="e.g. Morris Custom Woodworks"
                    value={shop} onChange={(e) => setShop(e.target.value)} required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="name">Your name</label>
                  <input
                    id="name" className="form-input" type="text"
                    placeholder="Jake Morris"
                    value={name} onChange={(e) => setName(e.target.value)}
                    autoComplete="name" required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="email">Work email</label>
                  <input
                    id="email" className="form-input" type="email"
                    placeholder="jake@yourshop.com"
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" required
                  />
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="password">Password</label>
                  <input
                    id="password" className="form-input" type="password"
                    placeholder="8+ characters"
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password" minLength={8} required
                  />
                </div>

                {error && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.2)',
                    fontSize: 13, color: 'var(--danger)',
                  }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit" className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginTop: 8, opacity: loading ? 0.7 : 1 }}
                  disabled={loading}
                >
                  {loading ? 'Creating account…' : 'Start free trial'}
                </button>

                <p style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.55 }}>
                  By creating an account you agree to our{' '}
                  <a href="#" style={{ color: 'var(--teal-dim)' }}>Terms</a>{' '}and{' '}
                  <a href="#" style={{ color: 'var(--teal-dim)' }}>Privacy Policy</a>.
                </p>
              </form>

              <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)', paddingTop: 4, borderTop: '1px solid var(--line)' }}>
                Already have an account?{' '}
                <Link href="/login" style={{ color: 'var(--teal)', fontWeight: 600 }}>Sign in</Link>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    </>
  );
}
