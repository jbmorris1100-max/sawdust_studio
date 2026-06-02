'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';

// ── Spinner ───────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Inner component (uses useSearchParams — must be wrapped in Suspense) ──────

function JoinInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const tenantId     = searchParams.get('tenant');

  const [shopName, setShopName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!tenantId) { setNotFound(true); setLoading(false); return; }
    supabase
      .from('tenants')
      .select('id, shop_name')
      .eq('id', tenantId)
      .single()
      .then(({ data }) => {
        if (!data) { setNotFound(true); }
        else       { setShopName(data.shop_name); }
        setLoading(false);
      });
  }, [tenantId]);

  function enterAsCrew() {
    if (!tenantId) return;
    try { localStorage.setItem('@inline_join_tenant_id', tenantId); } catch (_) {}
    router.push('/app/crew');
  }

  if (loading) return <Spinner />;

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>

        <LogoMark size={48} />
        <div style={{ marginTop: 8, fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
          inline<b style={{ color: 'var(--teal)' }}>IQ</b>
        </div>

        {notFound ? (
          <div style={{ marginTop: 48, textAlign: 'center', maxWidth: 400 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>Invalid invite link</h2>
            <p style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
              This link may have expired or been revoked. Ask your supervisor to share a new one.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 48, width: '100%', maxWidth: 400, textAlign: 'center' }}>
            <div style={{ background: '#0a0d10', border: '1px solid rgba(94,234,212,0.14)', borderRadius: 20, padding: '36px 28px' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(45,225,201,0.1)', border: '1px solid rgba(45,225,201,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </div>

              <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.3px', marginBottom: 10 }}>
                You&apos;ve been invited to join
              </h2>
              <p style={{ fontSize: 20, fontWeight: 700, color: '#2DE1C9', marginBottom: 8 }}>
                {shopName}
              </p>
              <p style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6, marginBottom: 32 }}>
                on InlineIQ — your shop&apos;s crew operations platform.
              </p>

              <button
                onClick={enterAsCrew}
                style={{
                  width: '100%', background: '#2DE1C9', color: '#001917',
                  border: 'none', borderRadius: 12, padding: '16px',
                  fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                Enter as Crew →
              </button>

              <p style={{ marginTop: 16, fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>
                No account needed. Your supervisor has already set everything up.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Page export (Suspense boundary required for useSearchParams) ──────────────

export default function JoinPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <JoinInner />
    </Suspense>
  );
}
