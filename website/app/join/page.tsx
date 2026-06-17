'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';

type CrewMember = { id: string; name: string; department: string | null; initial_pin: string | null };
type Step = 'pick' | 'pin' | 'webauthn-register' | 'webauthn-auth' | 'done' | 'qc-pin';

const SESSION_KEY = (tenantId: string) => `crew_session_${tenantId}`;
const CREW_ID_KEY = (tenantId: string) => `crew_member_id_${tenantId}`;

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function JoinInner() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const tenantId     = searchParams.get('tenant') ?? '';
  // When role=qc, the picker leads to a QC-delegate PIN screen instead of the
  // normal crew PIN/biometric flow — a delegate inspects cabinets at /app/crew?qc=1.
  const role         = searchParams.get('role') ?? '';

  const [shopName,   setShopName]   = useState<string | null>(null);
  const [notFound,   setNotFound]   = useState(false);
  const [loading,    setLoading]    = useState(true);
  const [crew,       setCrew]       = useState<CrewMember[]>([]);
  const [step,       setStep]       = useState<Step>('pick');
  const [selected,   setSelected]   = useState<CrewMember | null>(null);
  const [pin,        setPin]        = useState('');
  const [pinError,   setPinError]   = useState('');
  const [shake,      setShake]      = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [regToken,   setRegToken]   = useState('');
  const [deviceName] = useState('');
  // QC-delegate PIN entry (role=qc).
  const [qcPin,      setQcPin]      = useState('');

  const triggerShake = (msg: string) => {
    setPinError(msg);
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  const enterCrew = useCallback((crewMemberId: string, sessionToken: string) => {
    try {
      localStorage.setItem('crew_tenant_id', tenantId);
      localStorage.setItem('@inline_join_tenant_id', tenantId);
      localStorage.setItem(SESSION_KEY(tenantId), sessionToken);
      localStorage.setItem(CREW_ID_KEY(tenantId), crewMemberId);
    } catch { /* ignore */ }
    router.push('/app/crew');
  }, [tenantId, router]);

  // Load tenant + check for existing session
  useEffect(() => {
    if (!tenantId) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data } = await supabase.from('tenants')
        .select('id, shop_name').eq('id', tenantId).single();
      if (!data) { setNotFound(true); setLoading(false); return; }
      setShopName(data.shop_name);

      // Check existing session — but never auto-resume for QC delegates, who
      // must always go through the name picker + QC PIN even on a device with a
      // valid crew session.
      if (role !== 'qc') {
        try {
          const sessionToken  = localStorage.getItem(SESSION_KEY(tenantId));
          const crewMemberId  = localStorage.getItem(CREW_ID_KEY(tenantId));
          if (sessionToken && crewMemberId) {
            const res = await fetch('/app/api/crew-auth', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ action: 'verify-session', tenantId, crewMemberId, sessionToken }),
            });
            const { ok } = await res.json() as { ok: boolean };
            if (ok) { router.push('/app/crew'); return; }
            localStorage.removeItem(SESSION_KEY(tenantId));
          }
        } catch { /* fall through to join flow */ }
      }

      // Load active crew members for picker
      const { data: crewData } = await supabase
        .from('crew_members')
        .select('id, name, department, initial_pin')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('name');
      setCrew((crewData as CrewMember[] | null) ?? []);
      setLoading(false);
    })();
  }, [tenantId, router]);

  // User picks their name
  function selectMember(m: CrewMember) {
    setSelected(m);
    setPin('');
    setPinError('');
    // QC delegates skip the crew PIN/biometric flow — they authenticate against
    // a delegate PIN issued by the supervisor.
    if (role === 'qc') {
      setQcPin('');
      setStep('qc-pin');
      return;
    }
    // Check if this device already has a WebAuthn credential for this member
    // by attempting auth-options — if credentials exist, go straight to biometric
    setBusy(true);
    fetch('/app/api/crew-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'auth-options', tenantId, crewMemberId: m.id }),
    }).then(async (res) => {
      const data = await res.json() as { ok?: boolean; error?: string };
      if (res.ok && !data.error) {
        // Credentials exist — go to biometric auth
        setStep('webauthn-auth');
      } else {
        // No credentials yet — go to PIN entry for first-time setup
        setStep('pin');
      }
    }).catch(() => { setStep('pin'); })
    .finally(() => setBusy(false));
  }

  // PIN submission — verify then get WebAuthn registration options
  async function submitPin() {
    if (!selected || !pin || busy) return;
    if (pin.length < 4) { triggerShake('PIN must be at least 4 digits'); return; }
    setBusy(true);
    setPinError('');
    try {
      const res = await fetch('/app/api/crew-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'verify-pin', tenantId, crewMemberId: selected.id, pin }),
      });
      const data = await res.json() as { ok: boolean; registrationToken?: string; sessionToken?: string; error?: string };
      if (!data.ok) { triggerShake(data.error ?? 'Incorrect PIN'); setPin(''); setBusy(false); return; }
      setRegToken(data.registrationToken ?? '');
      // Store the PIN session token now — used if crew skip biometric setup
      if (data.sessionToken) {
        try {
          localStorage.setItem(SESSION_KEY(tenantId), data.sessionToken);
          localStorage.setItem(CREW_ID_KEY(tenantId), selected.id);
          localStorage.setItem('crew_tenant_id', tenantId);
          localStorage.setItem('@inline_join_tenant_id', tenantId);
        } catch { /* ignore */ }
      }
      setStep('webauthn-register');
    } catch { triggerShake('Network error — try again'); }
    finally { setBusy(false); }
  }

  // QC-delegate PIN — validate against an active qc_delegates row, then enter the
  // crew app in QC inspector mode.
  async function submitQcPin() {
    if (!selected || busy) return;
    if (qcPin.length < 4) { triggerShake('PIN must be 4 digits'); return; }
    setBusy(true);
    setPinError('');
    try {
      const { data, error } = await supabase
        .from('qc_delegates')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('active', true)
        .eq('pin', qcPin)
        .limit(1);
      if (error) throw error;
      if (!data || data.length === 0) { triggerShake('Incorrect PIN'); setQcPin(''); setBusy(false); return; }
      try {
        localStorage.setItem('qc_delegate_name', selected.name);
        localStorage.setItem('crew_tenant_id', tenantId);
      } catch { /* ignore */ }
      setStep('done');
      setTimeout(() => router.push('/app/crew?qc=1'), 600);
    } catch {
      triggerShake('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  // WebAuthn registration (first time on this device)
  async function registerBiometric() {
    if (!selected || !regToken || busy) return;
    setBusy(true);
    try {
      // Get registration options from server
      const optRes = await fetch('/app/api/crew-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reg-options', tenantId, crewMemberId: selected.id, registrationToken: regToken }),
      });
      if (!optRes.ok) throw new Error('Could not get registration options');
      const options = await optRes.json();

      // Start WebAuthn registration (triggers Face ID / Touch ID)
      const credential = await startRegistration({ optionsJSON: options });

      // Verify with server and get session token
      const verRes = await fetch('/app/api/crew-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'reg-verify',
          tenantId,
          crewMemberId: selected.id,
          registrationToken: regToken,
          credential: JSON.stringify(credential),
          deviceName: deviceName || navigator.userAgent.slice(0, 50),
        }),
      });
      const verData = await verRes.json() as { ok: boolean; sessionToken?: string; error?: string };
      if (!verData.ok || !verData.sessionToken) throw new Error(verData.error ?? 'Registration failed');
      setStep('done');
      setTimeout(() => enterCrew(selected.id, verData.sessionToken!), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Registration failed';
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        setPinError('Face ID was cancelled — try again');
      } else {
        setPinError(msg);
      }
      setStep('pin'); // fall back to PIN
    } finally { setBusy(false); }
  }

  // WebAuthn authentication (returning device)
  async function authenticateBiometric() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const optRes = await fetch('/app/api/crew-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'auth-options', tenantId, crewMemberId: selected.id }),
      });
      if (!optRes.ok) throw new Error('Could not get auth options');
      const options = await optRes.json();

      const credential = await startAuthentication({ optionsJSON: options });

      const verRes = await fetch('/app/api/crew-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'auth-verify',
          tenantId,
          crewMemberId: selected.id,
          credential: JSON.stringify(credential),
        }),
      });
      const verData = await verRes.json() as { ok: boolean; sessionToken?: string; error?: string };
      if (!verData.ok || !verData.sessionToken) throw new Error(verData.error ?? 'Authentication failed');
      setStep('done');
      setTimeout(() => enterCrew(selected.id, verData.sessionToken!), 800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Authentication failed';
      if (msg.includes('NotAllowedError') || msg.includes('cancelled')) {
        // User cancelled — offer PIN fallback
        setStep('pin');
        setPinError('Face ID cancelled — enter your PIN instead');
      } else if (msg.includes('inactive')) {
        setPinError('Your account has been deactivated — contact your supervisor');
      } else {
        setPinError(msg);
        setStep('pin');
      }
    } finally { setBusy(false); }
  }

  if (loading) return <Spinner />;

  return (
    <>
      <BgLayers />
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}
      `}</style>
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
        <LogoMark size={44} />
        <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
          inline<b style={{ color: 'var(--teal)' }}>IQ</b>
        </div>

        {notFound ? (
          <div style={{ marginTop: 48, textAlign: 'center', maxWidth: 400 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--ink)', marginBottom: 10 }}>Invalid invite link</h2>
            <p style={{ fontSize: 14, color: 'var(--ink-mute)', lineHeight: 1.6 }}>
              This link may have expired or been revoked. Ask your supervisor for a new one.
            </p>
          </div>
        ) : (
          <div style={{ marginTop: 40, width: '100%', maxWidth: 380 }}>
            <div style={{ background: '#0a0d10', border: '1px solid rgba(94,234,212,0.14)', borderRadius: 20, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Shop name */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 14, color: 'var(--ink-mute)', marginBottom: 4 }}>Signing in to</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#2DE1C9' }}>{shopName}</div>
              </div>

              {/* Step: pick name */}
              {step === 'pick' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', textAlign: 'center' }}>Who are you?</div>
                  {crew.length === 0 ? (
                    <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)', padding: '20px 0' }}>
                      No crew members set up yet. Ask your supervisor to add you.
                    </div>
                  ) : (
                    crew.map((m) => (
                      <button key={m.id} onClick={() => !busy && selectMember(m)} disabled={busy}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left', opacity: busy ? 0.7 : 1 }}>
                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(45,225,201,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15, fontWeight: 700, color: '#2DE1C9' }}>
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{m.name}</div>
                          {m.department && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{m.department}</div>}
                        </div>
                        {!m.initial_pin && (
                          <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.14)', color: '#FBBF24', flexShrink: 0 }}>No PIN</span>
                        )}
                        {busy && <div style={{ marginLeft: 'auto', width: 16, height: 16, borderRadius: '50%', border: '2px solid rgba(45,225,201,0.2)', borderTopColor: '#2DE1C9', animation: 'spin 0.7s linear infinite' }} />}
                      </button>
                    ))
                  )}
                </div>
              )}

              {/* Step: PIN entry */}
              {(step === 'pin') && selected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <button onClick={() => { setStep('pick'); setSelected(null); setPinError(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', padding: 0, alignSelf: 'flex-start' }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Back
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Hi, {selected.name.split(' ')[0]}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Enter your PIN to continue</div>
                  </div>
                  <div style={{ animation: shake ? 'shake 0.4s ease-in-out' : 'none' }}>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={8}
                      value={pin}
                      onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitPin(); }}
                      placeholder="••••"
                      autoFocus
                      style={{ width: '100%', textAlign: 'center', fontSize: 28, letterSpacing: '0.3em', padding: '16px', borderRadius: 12, border: `1px solid ${pinError ? 'rgba(248,113,113,0.5)' : 'var(--line-strong)'}`, background: 'var(--bg-1)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                    {pinError && <div style={{ marginTop: 8, fontSize: 12, color: '#F87171', textAlign: 'center' }}>{pinError}</div>}
                  </div>
                  <button onClick={() => void submitPin()} disabled={pin.length < 4 || busy}
                    style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', border: 'none', background: pin.length < 4 || busy ? 'var(--bg-1)' : '#2DE1C9', color: pin.length < 4 || busy ? 'var(--ink-mute)' : '#04201c', cursor: pin.length < 4 || busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? 'Checking…' : 'Continue'}
                  </button>
                </div>
              )}

              {/* Step: QC Delegate PIN */}
              {step === 'qc-pin' && selected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <button onClick={() => { setStep('pick'); setSelected(null); setPinError(''); setQcPin(''); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', padding: 0, alignSelf: 'flex-start' }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Back
                  </button>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>QC Delegate PIN</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>Enter the PIN your supervisor gave you</div>
                  </div>
                  <div style={{ animation: shake ? 'shake 0.4s ease-in-out' : 'none' }}>
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={4}
                      value={qcPin}
                      onChange={(e) => { setQcPin(e.target.value.replace(/\D/g, '')); setPinError(''); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitQcPin(); }}
                      placeholder="••••"
                      autoFocus
                      style={{ width: '100%', textAlign: 'center', fontSize: 28, letterSpacing: '0.3em', padding: '16px', borderRadius: 12, border: `1px solid ${pinError ? 'rgba(248,113,113,0.5)' : 'var(--line-strong)'}`, background: 'var(--bg-1)', color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
                    />
                    {pinError && <div style={{ marginTop: 8, fontSize: 12, color: '#F87171', textAlign: 'center' }}>{pinError}</div>}
                  </div>
                  <button onClick={() => void submitQcPin()} disabled={qcPin.length < 4 || busy}
                    style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', border: 'none', background: qcPin.length < 4 || busy ? 'var(--bg-1)' : '#2DE1C9', color: qcPin.length < 4 || busy ? 'var(--ink-mute)' : '#04201c', cursor: qcPin.length < 4 || busy ? 'not-allowed' : 'pointer' }}>
                    {busy ? 'Checking…' : 'Continue'}
                  </button>
                </div>
              )}

              {/* Step: WebAuthn registration */}
              {step === 'webauthn-register' && selected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Set up Face ID</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.6 }}>
                      Register your face or fingerprint so you can sign in instantly next time — no PIN needed.
                    </div>
                  </div>
                  {pinError && <div style={{ fontSize: 12, color: '#F87171' }}>{pinError}</div>}
                  <button onClick={() => void registerBiometric()} disabled={busy}
                    style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', border: 'none', background: busy ? 'var(--bg-1)' : '#2DE1C9', color: busy ? 'var(--ink-mute)' : '#04201c', cursor: busy ? 'wait' : 'pointer' }}>
                    {busy ? 'Setting up…' : 'Set Up Face ID / Touch ID'}
                  </button>
                  <button
                    onClick={() => router.push('/app/crew')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: 0 }}>
                    Skip — use PIN every time
                  </button>
                </div>
              )}

              {/* Step: WebAuthn authentication */}
              {step === 'webauthn-auth' && selected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center' }}>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>Welcome back, {selected.name.split(' ')[0]}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Use Face ID or Touch ID to sign in</div>
                  </div>
                  {pinError && <div style={{ fontSize: 12, color: '#F87171' }}>{pinError}</div>}
                  <button onClick={() => void authenticateBiometric()} disabled={busy}
                    style={{ width: '100%', padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', border: 'none', background: busy ? 'var(--bg-1)' : '#2DE1C9', color: busy ? 'var(--ink-mute)' : '#04201c', cursor: busy ? 'wait' : 'pointer' }}>
                    {busy ? 'Verifying…' : 'Sign In with Face ID'}
                  </button>
                  <button onClick={() => { setStep('pin'); setPinError(''); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'inherit', padding: 0 }}>
                    Use PIN instead
                  </button>
                </div>
              )}

              {/* Step: done */}
              {step === 'done' && (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                    <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#2DE1C9' }}>Signed in!</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Taking you to the app…</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <JoinInner />
    </Suspense>
  );
}
