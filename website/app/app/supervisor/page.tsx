'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft } from '@/lib/auth';

type CrewRow = {
  id: string;
  employee_name: string;
  dept: string;
  clock_in: string;
  job_name: string | null;
  work_order_id: string | null;
};

type Message = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
};

type InventoryNeed = {
  id: string;
  item: string;
  dept: string | null;
  job_number: string | null;
  qty: number | null;
  status: string | null;
};

type DamageReport = {
  id: string;
  part_name: string;
  job_id: string | null;
  dept: string | null;
  notes: string | null;
  status: string | null;
};

type Tab = 'overview' | 'messages' | 'needs' | 'damage';

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
        <b>{days} day{days !== 1 ? 's' : ''}</b> left in trial —
      </span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>
        Upgrade
      </Link>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function elapsed(clockIn: string) {
  const ms = Date.now() - new Date(clockIn).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'open').toLowerCase();
  const styles: Record<string, { color: string; bg: string }> = {
    open:     { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    pending:  { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    ordered:  { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
    resolved: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
    closed:   { color: '#5F6F6C', bg: 'rgba(95,111,108,0.1)' },
  };
  const st = styles[s] ?? styles.open;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
      color: st.color, background: st.bg,
      padding: '3px 8px', borderRadius: 6,
    }}>
      {s}
    </span>
  );
}

export default function SupervisorPage() {
  const { loading: sessionLoading, tenant, email } = useSession();
  const [tab, setTab] = useState<Tab>('overview');
  const [activeCrew, setActiveCrew] = useState<CrewRow[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [needs, setNeeds] = useState<InventoryNeed[]>([]);
  const [damage, setDamage] = useState<DamageReport[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    async function load() {
      const [crewRes, msgRes, needsRes, damageRes] = await Promise.all([
        supabase
          .from('time_clock')
          .select('id, employee_name, dept, clock_in, job_name, work_order_id')
          .eq('tenant_id', tenant!.id)
          .is('clock_out', null)
          .order('clock_in', { ascending: true }),
        supabase
          .from('messages')
          .select('id, sender_name, dept, body, created_at')
          .eq('tenant_id', tenant!.id)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('inventory_needs')
          .select('id, item, dept, job_number, qty, status')
          .eq('tenant_id', tenant!.id)
          .order('id', { ascending: false })
          .limit(20),
        supabase
          .from('damage_reports')
          .select('id, part_name, job_id, dept, notes, status')
          .eq('tenant_id', tenant!.id)
          .order('id', { ascending: false })
          .limit(20),
      ]);
      if (crewRes.data) setActiveCrew(crewRes.data as CrewRow[]);
      if (msgRes.data) setMessages(msgRes.data as Message[]);
      if (needsRes.data) setNeeds(needsRes.data as InventoryNeed[]);
      if (damageRes.data) setDamage(damageRes.data as DamageReport[]);
      setDataLoading(false);
    }
    load();
  }, [tenant]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/');
  };

  if (sessionLoading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);

  const openNeeds = needs.filter((n) => !['resolved', 'closed'].includes((n.status ?? 'open').toLowerCase()));
  const openDamage = damage.filter((d) => !['resolved', 'closed'].includes((d.status ?? 'open').toLowerCase()));

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'messages',  label: 'Messages',  count: messages.length },
    { key: 'needs',     label: 'Inventory', count: openNeeds.length },
    { key: 'damage',    label: 'Damage',    count: openDamage.length },
  ];

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
          height: 64, display: 'flex', alignItems: 'center', padding: '0 32px',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)', fontSize: 13 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              Back
            </Link>
            <span style={{ color: 'var(--line-strong)' }}>|</span>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
              <LogoMark size={22} />
              inline<b style={{ color: 'var(--teal)' }}>IQ</b>
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>
              Sign out
            </button>
          </div>
        </div>

        {isTrial && <TrialBanner days={days} />}

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Supervisor Dashboard</div>
            <h2 style={{ fontSize: 28 }}>{tenant?.shop_name}</h2>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Crew Clocked In', value: dataLoading ? '—' : String(activeCrew.length), color: '#2DE1C9' },
              { label: 'Open Messages', value: dataLoading ? '—' : String(messages.length), color: '#5EEAD4' },
              { label: 'Open Inventory Needs', value: dataLoading ? '—' : String(openNeeds.length), color: '#FBBF24' },
              { label: 'Open Damage Reports', value: dataLoading ? '—' : String(openDamage.length), color: '#F87171' },
            ].map(({ label, value, color }) => (
              <div key={label} className="portal-card" style={{ padding: '20px 24px' }}>
                <div className="portal-stat-value" style={{ color }}>{value}</div>
                <div className="portal-stat-label" style={{ marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--line)', paddingBottom: 0 }}>
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  padding: '10px 18px',
                  fontSize: 13, fontWeight: 600,
                  color: tab === key ? 'var(--teal)' : 'var(--ink-mute)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: tab === key ? '2px solid var(--teal)' : '2px solid transparent',
                  marginBottom: -1,
                  display: 'flex', alignItems: 'center', gap: 7,
                  transition: 'color 0.15s',
                }}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, lineHeight: 1,
                    padding: '2px 6px', borderRadius: 20,
                    background: tab === key ? 'rgba(94,234,212,0.15)' : 'rgba(255,255,255,0.06)',
                    color: tab === key ? 'var(--teal)' : 'var(--ink-mute)',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab: Overview — active crew table */}
          {tab === 'overview' && (
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Active Crew
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : activeCrew.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No crew currently clocked in.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Name', 'Department', 'Job', 'Clocked In', 'Duration'].map((h) => (
                        <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeCrew.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '12px 20px', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{row.employee_name}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{row.dept}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{row.job_name ?? '—'}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{formatTime(row.clock_in)}</td>
                        <td style={{ padding: '12px 20px' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', padding: '3px 8px', borderRadius: 6 }}>
                            {elapsed(row.clock_in)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: Messages */}
          {tab === 'messages' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : messages.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No messages yet.</div>
              ) : messages.map((msg) => (
                <div key={msg.id} className="portal-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{msg.sender_name}</span>
                      {msg.dept && <span style={{ fontSize: 12, color: 'var(--ink-mute)', marginLeft: 8 }}>{msg.dept}</span>}
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>{formatDate(msg.created_at)} {formatTime(msg.created_at)}</span>
                  </div>
                  <p style={{ fontSize: 14, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.55 }}>{msg.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tab: Inventory Needs */}
          {tab === 'needs' && (
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Inventory Needs
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : needs.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No inventory needs logged.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Item', 'Department', 'Job #', 'Qty', 'Status'].map((h) => (
                        <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((n) => (
                      <tr key={n.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '12px 20px', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{n.item}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{n.dept ?? '—'}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{n.job_number ?? '—'}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{n.qty ?? '—'}</td>
                        <td style={{ padding: '12px 20px' }}><StatusBadge status={n.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: Damage Reports */}
          {tab === 'damage' && (
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Damage Reports
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : damage.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No damage reports logged.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Part', 'Department', 'Job', 'Notes', 'Status'].map((h) => (
                        <th key={h} style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {damage.map((d) => (
                      <tr key={d.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '12px 20px', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{d.part_name}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{d.dept ?? '—'}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' }}>{d.job_id ?? '—'}</td>
                        <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)', maxWidth: 280 }}>
                          <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.notes ?? '—'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 20px' }}><StatusBadge status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
