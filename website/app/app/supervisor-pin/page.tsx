'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { BgLayers, LogoMark } from '@/components/shared';
import type { Tenant } from '@/lib/auth';
import { isTenantExpired } from '@/lib/auth';

const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;
const TRUST_KEY = (tenantId: string) => `sup_trust_${tenantId}`;
const DEVICE_KEY = 'sup_device_id';

function getOrCreateDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'unknown';
  }
}

export default function SupervisorPinPage() {
  const router = useRouter();
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [lockTick, setLockTick] = useState(0);
  const [trustDevice, setTrustDevice] = useState(true);
  const [firstTime, setFirstTime] = useState(false);
  const [confirmPin, setConfirmPin] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Lockout countdown
  useEffect(() => {
    if (!lockedUntil) return;
    const iv = setInterval(() => {
      setLockTick((t) => t + 1);
      if (Date.now() >= lockedUntil) {
        setLockedUntil(null);
        setAttempts(0);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [lockedUntil]);

  const secondsLeft = lockedUntil ? Math.ceil((lockedUntil - Date.now()) / 1000) : 0;

  const init = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.replace('/login'); return; }

    const { data } = await supabase.from('tenants')
      .select('*').eq('owner_user_id', session.user.id).single();
    if (!data) { router.replace('/signup'); return; }
    if (isTenantExpired(data as Tenant)) { router.replace('/pricing'); return; }

    const t = data as Tenant;
    setTenant(t);
    // Persist tenant id so the supervisor page trust gate can resolve the trust
    // token key on the next navigation (prevents a PIN ↔ supervisor redirect loop).
    try { localStorage.setItem('sup_last_tenant', t.id); } catch { /* ignore */ }

    // Check trusted device first
    try {
      const deviceId = getOrCreateDeviceId();
      const stored = localStorage.getItem(TRUST_KEY(t.id));
      if (stored) {
        const res = await fetch('/app/api/supervisor-auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: t.id, action: 'check-token', token: stored, deviceId }),
        });
        const { ok } = await res.json() as { ok: boolean };
        if (ok) { router.replace('/app/supervisor'); return; }
        // Token invalid/expired — clear it
        localStorage.removeItem(TRUST_KEY(t.id));
      }
    } catch { /* fall through to PIN entry */ }

    // No PIN set yet — first time setup
    if (!t.supervisor_pin) setFirstTime(true);

    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [router]);

  useEffect(() => { void init(); }, [init]);

  async function handleSubmit() {
    if (!tenant || verifying || !!lockedUntil) return;
    const value = firstTime && confirmStep ? confirmPin : pin;
    if (value.length < 4) { setError('PIN must be at least 4 digits'); return; }

    // First-time: confirm step
    if (firstTime && !confirmStep) {
      setConfirmStep(true);
      setError('');
      setTimeout(() => inputRef.current?.focus(), 100);
      return;
    }

    // First-time: confirm mismatch
    if (firstTime && confirmStep && pin !== confirmPin) {
      triggerShake('PINs do not match — try again');
      setConfirmPin('');
      setConfirmStep(false);
      return;
    }

    setVerifying(true);
    setError('');
    try {
      const deviceId = getOrCreateDeviceId();
      const res = await fetch('/app/api/supervisor-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: tenant.id,
          action: 'verify',
          pin: firstTime ? pin : pin,
          deviceId,
        }),
      });
      const data = await res.json() as { ok: boolean; token?: string; error?: string; firstTime?: boolean };
      if (data.ok && data.token) {
        if (trustDevice) {
          try { localStorage.setItem(TRUST_KEY(tenant.id), data.token); } catch { /* ignore */ }
        }
        router.replace('/app/supervisor');
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= MAX_ATTEMPTS) {
          setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000);
          triggerShake(`Too many attempts — wait ${LOCKOUT_SECONDS}s`);
        } else {
          triggerShake(`Incorrect PIN — ${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts === 1 ? '' : 's'} left`);
        }
        setPin('');
        if (firstTime) { setConfirmPin(''); setConfirmStep(false); }
      }
    } catch {
      setError('Network error — try again');
    } finally {
      setVerifying(false);
    }
  }

  function triggerShake(msg: string) {
    setError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <>
      <BgLayers />
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
      `}</style>
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
          <LogoMark size={44} />

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 8 }}>
              {firstTime ? (confirmStep ? 'Confirm your PIN' : 'Create Supervisor PIN') : 'Supervisor Access'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
              {firstTime
                ? confirmStep
                  ? 'Enter the same PIN again to confirm'
                  : 'Set a PIN to protect the supervisor dashboard. Share it with leads and managers.'
                : `Enter the PIN for ${tenant?.shop_name ?? 'your shop'}`}
            </div>
          </div>

          {/* PIN input */}
          <div style={{ width: '100%', animation: shake ? 'shake 0.4s ease-in-out' : 'none' }}>
            <input
              ref={inputRef}
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={8}
              value={firstTime && confirmStep ? confirmPin : pin}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '');
                if (firstTime && confirmStep) setConfirmPin(val);
                else setPin(val);
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSubmit(); }}
              placeholder="••••"
              disabled={!!lockedUntil || verifying}
              style={{
                width: '100%', textAlign: 'center', fontSize: 32, letterSpacing: '0.3em',
                padding: '18px', borderRadius: 14, border: `1px solid ${error ? 'rgba(248,113,113,0.5)' : 'var(--line-strong)'}`,
                background: 'var(--bg-1)', color: 'var(--ink)', fontFamily: 'inherit',
                outline: 'none', boxSizing: 'border-box',
              }}
            />
            {error && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#F87171', textAlign: 'center' }}>{error}</div>
            )}
            {lockedUntil && (
              <div style={{ marginTop: 8, fontSize: 13, color: '#FBBF24', textAlign: 'center' }}>
                Try again in {secondsLeft}s
                <span style={{ display: 'none' }}>{lockTick}</span>
              </div>
            )}
          </div>

          {/* Trust device toggle — shown after first correct PIN */}
          {!firstTime && (
            <button
              onClick={() => setTrustDevice((v) => !v)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
            >
              <span style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${trustDevice ? 'var(--teal)' : 'var(--line-strong)'}`, background: trustDevice ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {trustDevice && <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Trust this device for 30 days</span>
            </button>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={verifying || !!lockedUntil || (firstTime && confirmStep ? confirmPin.length < 4 : pin.length < 4)}
            style={{
              width: '100%', padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 800,
              fontFamily: 'inherit', border: 'none', cursor: verifying || !!lockedUntil ? 'not-allowed' : 'pointer',
              background: verifying || !!lockedUntil ? 'var(--bg-1)' : '#2DE1C9',
              color: verifying || !!lockedUntil ? 'var(--ink-mute)' : '#04201c',
              opacity: (firstTime && confirmStep ? confirmPin.length < 4 : pin.length < 4) ? 0.5 : 1,
            }}
          >
            {verifying ? 'Verifying…' : firstTime ? (confirmStep ? 'Set PIN' : 'Continue') : 'Enter'}
          </button>

          <a href="/app" style={{ fontSize: 13, color: 'var(--ink-mute)', textDecoration: 'none' }}>
            ← Back to role select
          </a>
        </div>
      </div>
    </>
  );
}
