'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

// ── Types ───────────────────────────────────────────────────────────────────

type SubStatus = 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired' | null;

type AdminTenant = {
  id: string;
  shop_name: string | null;
  owner_email: string | null;
  subscription_status: SubStatus;
  trial_ends_at: string | null;
  created_at: string;
  plan: string | null;
  planLabel: string;
  billingPeriod: 'Monthly' | 'Annual' | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  lastActive: string | null;
  crewCount: number;
  jobCount: number;
  clockCount: number;
  daysSinceSignup: number;
};

type Kpis = {
  totalShops: number;
  activeTrials: number;
  expiredTrials: number;
  activePaid: number;
  cancelled: number;
  mrr: number;
};

type ActivityEvent = { ts: string; shop: string; event: string };

type ChurnRow = {
  id: string;
  shop_name: string | null;
  trial_ends_at: string | null;
  clockCount: number;
};

type Health = {
  supabaseConnected: boolean;
  buckets: { name: string }[];
  tableCounts: {
    time_clock: number | null;
    messages: number | null;
    parts: number | null;
    cabinet_units: number | null;
  };
};

type AdminData = {
  kpis: Kpis;
  tenants: AdminTenant[];
  activity: ActivityEvent[];
  churnRisk: ChurnRow[];
  health: Health;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const mins = Math.floor(abs / 60000);
  const hours = Math.floor(abs / 3600000);
  const days = Math.floor(abs / 86400000);
  let label: string;
  if (mins < 1) label = 'just now';
  else if (mins < 60) label = `${mins} min${mins !== 1 ? 's' : ''}`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? 's' : ''}`;
  else label = `${days} day${days !== 1 ? 's' : ''}`;
  if (mins < 1) return label;
  return future ? `in ${label}` : `${label} ago`;
}

function trialDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ── Icons (thin-stroke SVG) ──────────────────────────────────────────────────

const ico = (path: React.ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const IcoShops = ico(<><path d="M3 9l1-5h16l1 5" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>);
const IcoTrial = ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const IcoExpired = ico(<><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>);
const IcoPaid = ico(<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></>);
const IcoCancel = ico(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>);
const IcoMrr = ico(<><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>);
const IcoWarn = ico(<><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></>);
const IcoCheck = ico(<><path d="M20 6L9 17l-5-5" /></>);
const IcoDb = ico(<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></>);
const IcoBucket = ico(<><path d="M5 8l1.5 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8L19 8" /><path d="M3 8h18" /><path d="M9 8V5a3 3 0 0 1 6 0v3" /></>);

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  trial:     { label: 'Trial',     color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
  active:    { label: 'Active',    color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
  past_due:  { label: 'Past Due',  color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
  expired:   { label: 'Expired',   color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
  cancelled: { label: 'Cancelled', color: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' },
};

// Plan badge palette — Operations stands out from Shop/Trial.
const PLAN_BADGE: Record<string, { color: string; bg: string }> = {
  Operations: { color: '#C4B5FD', bg: 'rgba(167,139,250,0.14)' },
  Shop:       { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
  Trial:      { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
  Cancelled:  { color: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' },
  Expired:    { color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
};

function StatusBadge({ tenant }: { tenant: AdminTenant }) {
  // Trial that has lapsed reads as "Expired" even if status column still says trial.
  let key = tenant.subscription_status ?? 'trial';
  if (key === 'trial') {
    const d = trialDays(tenant.trial_ends_at);
    if (d === null || d < 0) key = 'expired';
  }
  const meta = STATUS_META[key] ?? STATUS_META.trial;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: meta.color, background: meta.bg, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap' }}>
      {meta.label}
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--line-strong)', borderRadius: 12,
      padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)' }}>
        <span style={{ color: 'var(--teal)' }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: accent ?? 'var(--teal)', lineHeight: 1 }}>{value}</div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Panel({ title, icon, right, children }: { title: string; icon?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--bg-1)', border: '1px solid var(--line-strong)', borderRadius: 12, padding: '20px 22px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {icon && <span style={{ color: 'var(--teal)' }}>{icon}</span>}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [extending, setExtending] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Auth gate ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session || !session.user.email) { router.replace('/login'); return; }
      if (!adminEmail || session.user.email.toLowerCase() !== adminEmail.toLowerCase()) {
        router.replace('/login');
        return;
      }
      setToken(session.access_token);
      setAuthed(true);
    });
  }, [router]);

  // ── Data load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch('/app/api/admin', { headers: { authorization: `Bearer ${token}` } });
      const json = await res.json() as AdminData & { error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData(json);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (authed && token) void load(); }, [authed, token, load]);

  // ── Extend trial ──────────────────────────────────────────────────────────────
  const extendTrial = useCallback(async (tenantId: string) => {
    if (!token) return;
    setExtending((p) => ({ ...p, [tenantId]: true }));
    try {
      const res = await fetch('/app/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ tenantId, action: 'extend_trial' }),
      });
      const json = await res.json() as { ok?: boolean; trial_ends_at?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setData((prev) => prev ? {
        ...prev,
        tenants: prev.tenants.map((t) => t.id === tenantId ? { ...t, trial_ends_at: json.trial_ends_at ?? t.trial_ends_at, subscription_status: 'trial' } : t),
        churnRisk: prev.churnRisk.filter((c) => c.id !== tenantId),
      } : prev);
      showToast('Trial extended by 30 days');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Extend failed');
    } finally {
      setExtending((p) => ({ ...p, [tenantId]: false }));
    }
  }, [token, showToast]);

  if (!authed) return <Spinner />;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)', fontFamily: 'var(--font-display, system-ui, sans-serif)' }}>
      {/* Top bar */}
      <header style={{ borderBottom: '1px solid var(--line)', padding: '14px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/" style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)', textDecoration: 'none', letterSpacing: '-0.02em' }}>InlineIQ</Link>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.08em', border: '1px solid var(--line-strong)', borderRadius: 5, padding: '2px 7px' }}>Admin</span>
        </div>
        <button
          onClick={() => { setLoading(true); void load(); }}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--teal)', background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Refresh
        </button>
      </header>

      <main style={{ maxWidth: 1240, margin: '0 auto', padding: '28px 28px 80px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>Platform Overview</h1>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', margin: '6px 0 0' }}>Owner dashboard — all shops across InlineIQ.</p>
        </div>

        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.25)', color: 'var(--danger)', fontSize: 13, marginBottom: 24 }}>
            {error}
          </div>
        )}

        {loading && !data ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 14 }}>Loading platform data…</div>
        ) : data ? (
          <>
            {/* ── KPI row ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 28 }}>
              <KpiCard icon={IcoShops} label="Total Shops" value={String(data.kpis.totalShops)} />
              <KpiCard icon={IcoTrial} label="Active Trials" value={String(data.kpis.activeTrials)} accent="#FBBF24" />
              <KpiCard icon={IcoExpired} label="Expired Trials" value={String(data.kpis.expiredTrials)} accent="#F87171" />
              <KpiCard icon={IcoPaid} label="Active Paid" value={String(data.kpis.activePaid)} />
              <KpiCard icon={IcoCancel} label="Cancelled" value={String(data.kpis.cancelled)} accent="#8BA5A0" />
              <KpiCard icon={IcoMrr} label="MRR" value={`$${data.kpis.mrr}`} />
            </div>

            {/* ── Churn risk ── */}
            {data.churnRisk.length > 0 && (
              <section style={{ background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 12, padding: '20px 22px', marginBottom: 24 }}>
                <h2 style={{ fontSize: 15, fontWeight: 700, color: '#F87171', margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#F87171' }}>{IcoWarn}</span>
                  Churn Risk
                </h2>
                <p style={{ fontSize: 12, color: 'var(--ink-mute)', margin: '0 0 16px' }}>Trials expiring within 7 days with fewer than 5 clock-ins — most likely to churn without intervention.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.churnRisk.map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 9, flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{c.shop_name ?? 'Unknown shop'}</span>
                        <span style={{ fontSize: 12, color: '#F87171' }}>expires {fmtDate(c.trial_ends_at)}</span>
                        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{c.clockCount} clock-in{c.clockCount !== 1 ? 's' : ''}</span>
                      </div>
                      <button
                        onClick={() => void extendTrial(c.id)}
                        disabled={extending[c.id]}
                        style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', background: 'transparent', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 6, padding: '5px 12px', cursor: extending[c.id] ? 'wait' : 'pointer', opacity: extending[c.id] ? 0.5 : 1, fontFamily: 'inherit' }}
                      >
                        {extending[c.id] ? 'Extending…' : 'Extend Trial'}
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 24, alignItems: 'start' }} className="admin-grid">
              {/* ── Tenant list ── */}
              <div>
                <Panel title="Tenants" icon={IcoShops} right={<span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{data.tenants.length} total</span>}>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 760 }}>
                      <thead>
                        <tr style={{ textAlign: 'left', color: 'var(--ink-mute)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          <th style={{ padding: '0 10px 10px 0', fontWeight: 600 }}>Shop</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Plan</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Status</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Billing</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Trial / Next Bill</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Age</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600 }}>Last Active</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600, textAlign: 'right' }}>Crew</th>
                          <th style={{ padding: '0 10px 10px', fontWeight: 600, textAlign: 'right' }}>Jobs</th>
                          <th style={{ padding: '0 0 10px 10px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.tenants.map((t) => {
                          const isTrial = (t.subscription_status ?? 'trial') === 'trial';
                          const planMeta = PLAN_BADGE[t.planLabel] ?? PLAN_BADGE.Trial;
                          // Trial → trial end; paid → next billing (current_period_end).
                          const dateCell = isTrial ? fmtDate(t.trial_ends_at) : fmtDate(t.current_period_end);
                          return (
                            <tr key={t.id} style={{ borderTop: '1px solid var(--line)' }}>
                              <td style={{ padding: '12px 10px 12px 0' }}>
                                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{t.shop_name ?? 'Unknown shop'}</div>
                                <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{t.owner_email ?? '—'}</div>
                              </td>
                              <td style={{ padding: '12px 10px' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: planMeta.color, background: planMeta.bg, padding: '3px 9px', borderRadius: 6, whiteSpace: 'nowrap' }}>{t.planLabel}</span>
                              </td>
                              <td style={{ padding: '12px 10px' }}><StatusBadge tenant={t} /></td>
                              <td style={{ padding: '12px 10px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>{t.billingPeriod ?? '—'}</td>
                              <td style={{ padding: '12px 10px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>{dateCell}</td>
                              <td style={{ padding: '12px 10px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>{t.daysSinceSignup}d</td>
                              <td style={{ padding: '12px 10px', color: 'var(--ink-dim)', whiteSpace: 'nowrap' }}>{relative(t.lastActive)}</td>
                              <td style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--ink-dim)' }}>{t.crewCount}</td>
                              <td style={{ padding: '12px 10px', textAlign: 'right', color: 'var(--ink-dim)' }}>{t.jobCount}</td>
                              <td style={{ padding: '12px 0 12px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <div style={{ display: 'inline-flex', gap: 6 }}>
                                  <button
                                    onClick={() => void extendTrial(t.id)}
                                    disabled={extending[t.id]}
                                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 6, padding: '4px 9px', cursor: extending[t.id] ? 'wait' : 'pointer', opacity: extending[t.id] ? 0.5 : 1, fontFamily: 'inherit' }}
                                  >
                                    {extending[t.id] ? '…' : 'Extend Trial'}
                                  </button>
                                  <button
                                    disabled
                                    title="Coming soon"
                                    style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', background: 'transparent', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 9px', cursor: 'not-allowed', opacity: 0.5, fontFamily: 'inherit' }}
                                  >
                                    View
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                        {data.tenants.length === 0 && (
                          <tr><td colSpan={10} style={{ padding: '24px 0', textAlign: 'center', color: 'var(--ink-mute)' }}>No tenants yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              {/* ── Right column: activity + health ── */}
              <div>
                <Panel title="Activity Feed" icon={IcoTrial}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {data.activity.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No recent activity.</div>}
                    {data.activity.map((e, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i === 0 ? 'none' : '1px solid var(--line)' }}>
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)', minWidth: 74, flexShrink: 0, paddingTop: 1 }}>{relative(e.ts)}</span>
                        <span style={{ fontSize: 13, color: 'var(--ink-dim)', minWidth: 0 }}>
                          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{e.shop}</span>
                          {' — '}{e.event}
                        </span>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel title="Platform Health" icon={IcoDb}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <span style={{ color: '#34D399', display: 'inline-flex' }}>{IcoCheck}</span>
                    <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>Supabase connection: <strong style={{ color: '#34D399' }}>Connected</strong></span>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Storage Buckets</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                    {data.health.buckets.length === 0 && <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No buckets found.</span>}
                    {data.health.buckets.map((b) => (
                      <div key={b.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-dim)' }}>
                        <span style={{ color: 'var(--teal)', display: 'inline-flex' }}>{IcoBucket}</span>
                        {b.name}
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Row Counts</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {([
                      ['time_clock', data.health.tableCounts.time_clock],
                      ['messages', data.health.tableCounts.messages],
                      ['parts', data.health.tableCounts.parts],
                      ['cabinet_units', data.health.tableCounts.cabinet_units],
                    ] as [string, number | null][]).map(([name, count]) => (
                      <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
                        <span style={{ color: 'var(--ink-dim)', fontFamily: 'var(--font-mono, monospace)' }}>{name}</span>
                        <span style={{ color: 'var(--teal)', fontWeight: 700 }}>{count === null ? '—' : count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </Panel>
              </div>
            </div>
          </>
        ) : null}
      </main>

      {toast && (
        <div style={{ position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 400, background: '#34D399', color: '#001a0d', padding: '12px 24px', borderRadius: 10, fontWeight: 700, fontSize: 14, boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
          {toast}
        </div>
      )}

      <style>{`@media (max-width: 900px) { .admin-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
