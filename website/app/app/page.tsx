'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import type { Tenant } from '@/lib/auth';
import { isTenantExpired, trialDaysLeft } from '@/lib/auth';


function TrialBanner({ days }: { days: number }) {
  return (
    <div style={{
      position: 'sticky', top: 64, zIndex: 50,
      background: 'rgba(251,191,36,0.06)',
      borderBottom: '1px solid rgba(251,191,36,0.25)',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round">
        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}>
        <b>{days} day{days !== 1 ? 's' : ''} remaining</b> in your free trial —
      </span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>
        Upgrade now
      </Link>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#050608',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '2px solid rgba(94,234,212,0.2)',
        borderTopColor: '#5EEAD4',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function AppPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tenant,  setTenant]  = useState<Tenant | null>(null);
  const [email,   setEmail]   = useState('');

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/login'); return; }

      setEmail(session.user.email ?? '');

      const { data } = await supabase
        .from('tenants')
        .select('*')
        .eq('owner_user_id', session.user.id)
        .single();

      if (!data) { router.replace('/signup'); return; }

      if (isTenantExpired(data as Tenant)) { router.replace('/pricing'); return; }

      setTenant(data as Tenant);
      setLoading(false);
    }
    init();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (loading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days    = trialDaysLeft(tenant?.trial_ends_at ?? null);

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Sticky nav bar */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
          height: 64, display: 'flex', alignItems: 'center', padding: '0 32px',
          justifyContent: 'space-between',
        }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
            <LogoMark size={22} />
            inline<b style={{ color: 'var(--teal)' }}>IQ</b>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{email}</span>
            <button
              onClick={handleSignOut}
              className="btn btn-ghost"
              style={{ fontSize: 13, padding: '8px 16px' }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Trial banner */}
        {isTrial && <TrialBanner days={days} />}

        {/* Main content */}
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px 24px' }}>
          <div style={{ width: '100%', maxWidth: 560, textAlign: 'center' }}>
            <LogoMark size={56} />

            <h2 style={{ marginTop: 24, fontSize: 32 }}>
              Welcome to{' '}
              <span style={{ color: 'var(--teal)' }}>{tenant?.shop_name}</span>
            </h2>
            <p style={{ marginTop: 12, fontSize: 16 }}>
              {isTrial
                ? `Your free trial runs until ${new Date(tenant!.trial_ends_at!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.`
                : 'Your subscription is active.'}
            </p>

            {/* Launch buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 48 }}>
              <a
                href="/app/crew"
                className="app-role-card"
              >
                <div className="app-role-icon" style={{ background: 'rgba(45,225,201,0.1)', color: '#2DE1C9' }}>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginTop: 14 }}>I'm Crew</div>
                <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5 }}>
                  Log inventory, scan parts, report damage
                </div>
              </a>

              <a
                href="/app/supervisor"
                className="app-role-card"
                style={{ borderColor: 'rgba(167,139,250,0.2)' }}
              >
                <div className="app-role-icon" style={{ background: 'rgba(167,139,250,0.1)', color: '#A78BFA' }}>
                  <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                </div>
                <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--ink)', marginTop: 14 }}>I'm Supervisor</div>
                <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5 }}>
                  Monitor crew, manage inventory, view reports
                </div>
              </a>
            </div>

            <p style={{ marginTop: 24, fontSize: 13, color: 'var(--ink-mute)' }}>
              Use the mobile app for the full experience.{' '}
              <a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal-dim)' }}>Get setup help</a>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
