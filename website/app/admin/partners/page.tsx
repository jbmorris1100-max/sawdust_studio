'use client';
import Link from 'next/link';
import { useState, useEffect, useCallback, useRef } from 'react';
import { LogoMark } from '@/components/shared';

// ── Partner admin panel ──────────────────────────────────────────────────────
// Self-contained page: its own HMAC login (no Supabase session), then a panel to
// create partner accounts and manage existing ones. Every API call sends
// Authorization: Bearer <token>; the server routes verify it before any DB work.

const BG = '#050608';
const TEAL = '#2DE1C9';
const TEAL_SOFT = '#5EEAD4';
const TOKEN_KEY = 'admin_token';

type Partner = {
  id: string;
  shop_name: string | null;
  owner_email: string | null;
  plan: string | null;
  subscription_status: string | null;
  is_partner: boolean | null;
  partner_discount: number | null;
  partner_trial_ends_at: string | null;
  trial_ends_at: string | null;
  created_at: string;
};

const TRIAL_MONTHS = [3, 6, 9];
const DISCOUNTS = [0, 10, 15, 20, 25];

// ── Token helpers (client-side expiry check only — no secret) ─────────────────
function tokenExp(token: string): number | null {
  try {
    const body = token.split('.')[0];
    const b64 = body.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(body.length / 4) * 4, '=');
    const json = JSON.parse(atob(b64)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp : null;
  } catch {
    return null;
  }
}
function tokenValid(token: string | null): boolean {
  if (!token) return false;
  const exp = tokenExp(token);
  return exp != null && exp * 1000 > Date.now();
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function planLabel(plan: string | null): string {
  if (!plan) return '—';
  if (plan.startsWith('operations')) return 'Operations';
  if (plan.startsWith('shop')) return 'Shop';
  return plan;
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputSt: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '11px 13px', borderRadius: 10,
  background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)', color: '#E2E8F0',
  fontSize: 14, fontFamily: 'inherit', outline: 'none',
};
const labelSt: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#8BA5A0', marginBottom: 6, display: 'block' };
const cardSt: React.CSSProperties = { background: '#0a0d12', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: 24 };

function PrimaryButton({ children, onClick, disabled, type = 'button' }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean; type?: 'button' | 'submit' }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '13px', borderRadius: 11, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: disabled ? 'rgba(45,225,201,0.3)' : TEAL, border: 'none', color: '#04201c', cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {children}
    </button>
  );
}

// ── Login (locked state) ──────────────────────────────────────────────────────
function LoginForm({ onUnlock }: { onUnlock: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/admin/partners/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 401) { setError('Invalid credentials'); return; }
      const json = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !json.ok || !json.token) { setError(json.error ?? 'Sign in failed'); return; }
      try { sessionStorage.setItem(TOKEN_KEY, json.token); } catch { /* ignore */ }
      onUnlock(json.token);
    } catch {
      setError('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: BG, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginBottom: 4 }}>
          <LogoMark size={26} />
          <span style={{ fontSize: 20, fontWeight: 800, color: '#E2E8F0', letterSpacing: '-0.02em' }}>inline<b style={{ color: TEAL }}>IQ</b></span>
        </div>
        <div style={{ ...cardSt, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#E2E8F0', textAlign: 'center' }}>Admin Access</h1>
          <div>
            <label style={labelSt}>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} style={inputSt} />
          </div>
          <div>
            <label style={labelSt}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} style={inputSt} />
          </div>
          {error && <div style={{ fontSize: 13, color: '#F87171', textAlign: 'center' }}>{error}</div>}
          <PrimaryButton onClick={() => void submit()} disabled={busy || !username.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign In'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

// ── Status badge for a partner row ────────────────────────────────────────────
function statusMeta(p: Partner): { label: string; color: string; bg: string } {
  if (p.is_partner === false) return { label: 'Deactivated', color: '#F87171', bg: 'rgba(248,113,113,0.12)' };
  const ends = p.partner_trial_ends_at ? new Date(p.partner_trial_ends_at).getTime() : null;
  if (ends != null && ends < Date.now()) return { label: 'Trial expired', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' };
  return { label: 'Trial active', color: TEAL_SOFT, bg: 'rgba(94,234,212,0.12)' };
}

// ── Create section ────────────────────────────────────────────────────────────
function CreatePartner({ token, onCreated, onAuthFail }: { token: string; onCreated: () => void; onAuthFail: () => void }) {
  const [shopName, setShopName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [trialMonths, setTrialMonths] = useState(9);
  const [discount, setDiscount] = useState(25);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setOk(null); setErr(null);
    if (!shopName.trim()) { setErr('Shop name is required'); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('A valid email is required'); return; }
    if (password.length < 8) { setErr('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setErr('Passwords do not match'); return; }
    setBusy(true);
    try {
      const res = await fetch('/admin/partners/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopName, email, password, trialMonths, discount }),
      });
      if (res.status === 401) { onAuthFail(); return; }
      const json = (await res.json()) as { ok?: boolean; email?: string; error?: string };
      if (!res.ok || !json.ok) { setErr(json.error ?? 'Could not create account'); return; }
      setOk(`Account created — ${json.email} can now log in at inlineiq.app`);
      setShopName(''); setEmail(''); setPassword(''); setConfirm('');
      onCreated();
    } catch {
      setErr('Network error — try again');
    } finally {
      setBusy(false);
    }
  }

  const selectSt: React.CSSProperties = { ...inputSt, cursor: 'pointer' };

  return (
    <section style={{ ...cardSt, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#E2E8F0' }}>Create Partner Account</h2>

      <div>
        <label style={labelSt}>Shop Name *</label>
        <input value={shopName} onChange={(e) => setShopName(e.target.value)} style={inputSt} />
      </div>
      <div>
        <label style={labelSt}>Email *</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputSt} />
      </div>
      <div>
        <label style={labelSt}>Password * (min 8 characters)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} style={{ ...inputSt, flex: 1 }} />
          <button type="button" onClick={() => setShowPw((v) => !v)}
            style={{ flexShrink: 0, padding: '0 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: '#0d1117', color: '#8BA5A0', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            {showPw ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      <div>
        <label style={labelSt}>Confirm Password *</label>
        <input type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} style={inputSt} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label style={labelSt}>Trial length</label>
          <select value={trialMonths} onChange={(e) => setTrialMonths(Number(e.target.value))} style={selectSt}>
            {TRIAL_MONTHS.map((m) => <option key={m} value={m}>{m} months</option>)}
          </select>
        </div>
        <div>
          <label style={labelSt}>Lifetime discount</label>
          <select value={discount} onChange={(e) => setDiscount(Number(e.target.value))} style={selectSt}>
            {DISCOUNTS.map((d) => <option key={d} value={d}>{d}%</option>)}
          </select>
        </div>
      </div>

      {ok && <div style={{ padding: '11px 14px', borderRadius: 10, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.4)', color: '#34D399', fontSize: 13 }}>{ok}</div>}
      {err && <div style={{ padding: '11px 14px', borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.35)', color: '#F87171', fontSize: 13 }}>{err}</div>}

      <PrimaryButton onClick={() => void submit()} disabled={busy}>
        {busy ? 'Creating…' : 'Create Partner Account'}
      </PrimaryButton>
    </section>
  );
}

// ── Extend-trial modal ────────────────────────────────────────────────────────
function ExtendModal({ partner, onClose, onSave, busy }: { partner: Partner; onClose: () => void; onSave: (iso: string) => void; busy: boolean }) {
  const seed = (() => {
    const base = partner.partner_trial_ends_at && new Date(partner.partner_trial_ends_at).getTime() > Date.now()
      ? new Date(partner.partner_trial_ends_at) : new Date();
    base.setMonth(base.getMonth() + 3);
    return base.toISOString().slice(0, 10);
  })();
  const [date, setDate] = useState(seed);
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...cardSt, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#E2E8F0' }}>Extend Trial — {partner.shop_name ?? 'Partner'}</h3>
        <div>
          <label style={labelSt}>New trial end date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputSt} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#8BA5A0', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={() => date && onSave(new Date(`${date}T12:00:00`).toISOString())} disabled={busy || !date}
            style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: TEAL, color: '#04201c', fontSize: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Revoke confirm modal ──────────────────────────────────────────────────────
function RevokeModal({ partner, onClose, onConfirm, busy }: { partner: Partner; onClose: () => void; onConfirm: () => void; busy: boolean }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ ...cardSt, width: '100%', maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#E2E8F0' }}>Revoke partner status?</h3>
        <p style={{ margin: 0, fontSize: 13, color: '#8BA5A0', lineHeight: 1.6 }}>
          {partner.shop_name ?? 'This partner'} will lose partner status and move to the standard trial flow. This does not delete their account.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onClose} disabled={busy}
            style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'transparent', color: '#8BA5A0', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy}
            style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', background: '#F87171', color: '#1a0606', fontSize: 14, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Manage section ────────────────────────────────────────────────────────────
function ManagePartners({ token, refreshKey, onAuthFail }: { token: string; refreshKey: number; onAuthFail: () => void }) {
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [extendFor, setExtendFor] = useState<Partner | null>(null);
  const [revokeFor, setRevokeFor] = useState<Partner | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/admin/partners/list', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) { onAuthFail(); return; }
      const json = (await res.json()) as { ok?: boolean; partners?: Partner[]; error?: string };
      if (!res.ok || !json.ok) { setErr(json.error ?? 'Failed to load partners'); return; }
      setPartners(json.partners ?? []);
      setErr(null);
    } catch {
      setErr('Network error loading partners');
    }
  }, [token, onAuthFail]);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const patch = useCallback(async (tenantId: string, body: Record<string, unknown>): Promise<boolean> => {
    setRowBusy((p) => ({ ...p, [tenantId]: true }));
    try {
      const res = await fetch('/admin/partners/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId, ...body }),
      });
      if (res.status === 401) { onAuthFail(); return false; }
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { showToast(json.error ?? 'Update failed'); return false; }
      return true;
    } catch {
      showToast('Network error');
      return false;
    } finally {
      setRowBusy((p) => ({ ...p, [tenantId]: false }));
    }
  }, [token, onAuthFail, showToast]);

  async function changeDiscount(p: Partner, value: number) {
    const ok = await patch(p.id, { partner_discount: value });
    if (ok) {
      setPartners((prev) => prev ? prev.map((x) => x.id === p.id ? { ...x, partner_discount: value } : x) : prev);
      showToast('Discount updated');
    }
  }
  async function saveExtend(iso: string) {
    if (!extendFor) return;
    const ok = await patch(extendFor.id, { partner_trial_ends_at: iso });
    if (ok) {
      setPartners((prev) => prev ? prev.map((x) => x.id === extendFor.id ? { ...x, partner_trial_ends_at: iso } : x) : prev);
      showToast('Trial extended');
      setExtendFor(null);
    }
  }
  async function confirmRevoke() {
    if (!revokeFor) return;
    const ok = await patch(revokeFor.id, { is_partner: false });
    if (ok) {
      setPartners((prev) => prev ? prev.filter((x) => x.id !== revokeFor.id) : prev);
      showToast('Partner revoked');
      setRevokeFor(null);
    }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '0 12px 10px 0', fontSize: 11, fontWeight: 600, color: '#8BA5A0', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '12px 12px 12px 0', fontSize: 13, color: '#C7D2D0', verticalAlign: 'middle', whiteSpace: 'nowrap' };

  return (
    <section style={{ ...cardSt, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#E2E8F0' }}>Manage Existing Partners</h2>
        <span style={{ fontSize: 12, color: '#8BA5A0' }}>{partners?.length ?? 0} partner{(partners?.length ?? 0) === 1 ? '' : 's'}</span>
      </div>

      <div style={{ overflowX: 'auto', padding: '8px 24px 24px' }}>
        {err && <div style={{ padding: '12px 0', color: '#F87171', fontSize: 13 }}>{err}</div>}
        {!partners ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#8BA5A0', fontSize: 14 }}>Loading…</div>
        ) : partners.length === 0 ? (
          <div style={{ padding: '32px 0', textAlign: 'center', color: '#8BA5A0', fontSize: 14 }}>No partner accounts yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 880 }}>
            <thead>
              <tr>
                <th style={th}>Shop Name</th>
                <th style={th}>Email</th>
                <th style={th}>Plan</th>
                <th style={th}>Trial Ends</th>
                <th style={th}>Discount</th>
                <th style={th}>Status</th>
                <th style={{ ...th, textAlign: 'right', paddingRight: 0 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => {
                const meta = statusMeta(p);
                const busy = !!rowBusy[p.id];
                return (
                  <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                    <td style={{ ...td, color: '#E2E8F0', fontWeight: 700 }}>{p.shop_name ?? 'Unknown'}</td>
                    <td style={td}>{p.owner_email ?? '—'}</td>
                    <td style={td}>{planLabel(p.plan)}</td>
                    <td style={td}>{fmtDate(p.partner_trial_ends_at)}</td>
                    <td style={td}>
                      <select value={p.partner_discount ?? 0} disabled={busy}
                        onChange={(e) => void changeDiscount(p, Number(e.target.value))}
                        style={{ padding: '5px 8px', borderRadius: 7, background: '#0d1117', border: '1px solid rgba(255,255,255,0.12)', color: '#C7D2D0', fontSize: 12.5, fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer' }}>
                        {DISCOUNTS.map((d) => <option key={d} value={d}>{d}%</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: '3px 9px', borderRadius: 6 }}>{meta.label}</span>
                    </td>
                    <td style={{ ...td, textAlign: 'right', paddingRight: 0 }}>
                      <div style={{ display: 'inline-flex', gap: 6 }}>
                        <button onClick={() => setExtendFor(p)} disabled={busy}
                          style={{ fontSize: 11, fontWeight: 700, color: TEAL_SOFT, background: 'transparent', border: '1px solid rgba(94,234,212,0.35)', borderRadius: 6, padding: '5px 10px', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>Extend Trial</button>
                        <button onClick={() => setRevokeFor(p)} disabled={busy}
                          style={{ fontSize: 11, fontWeight: 700, color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.35)', borderRadius: 6, padding: '5px 10px', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>Revoke</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {extendFor && <ExtendModal partner={extendFor} busy={!!rowBusy[extendFor.id]} onClose={() => setExtendFor(null)} onSave={(iso) => void saveExtend(iso)} />}
      {revokeFor && <RevokeModal partner={revokeFor} busy={!!rowBusy[revokeFor.id]} onClose={() => setRevokeFor(null)} onConfirm={() => void confirmRevoke()} />}

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 200, background: '#34D399', color: '#001a0d', padding: '12px 24px', borderRadius: 10, fontWeight: 700, fontSize: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>{toast}</div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PartnerAdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Restore a valid token from sessionStorage so a refresh skips the login.
  useEffect(() => {
    let stored: string | null = null;
    try { stored = sessionStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
    if (tokenValid(stored)) setToken(stored);
    else { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } }
    setReady(true);
  }, []);

  const lock = useCallback(() => {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
    setToken(null);
  }, []);

  if (!ready) return <div style={{ minHeight: '100vh', background: BG }} />;
  if (!token) return <LoginForm onUnlock={setToken} />;

  return (
    <div style={{ minHeight: '100vh', background: BG, color: '#E2E8F0', fontFamily: 'var(--font-display, system-ui, sans-serif)' }}>
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: BG, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoMark size={22} />
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>inline<b style={{ color: TEAL }}>IQ</b></span>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8BA5A0', textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, padding: '2px 7px' }}>Partners</span>
        </div>
        <button onClick={lock}
          style={{ fontSize: 12, fontWeight: 600, color: '#8BA5A0', background: 'transparent', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
          Sign out
        </button>
      </header>

      <main style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 24px 80px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Partner Accounts</h1>
          <p style={{ fontSize: 13, color: '#8BA5A0', margin: '6px 0 0' }}>Create and manage partner shops with extended trials and lifetime discounts.</p>
        </div>

        <CreatePartner token={token} onCreated={() => setRefreshKey((k) => k + 1)} onAuthFail={lock} />
        <ManagePartners token={token} refreshKey={refreshKey} onAuthFail={lock} />
      </main>
    </div>
  );
}
