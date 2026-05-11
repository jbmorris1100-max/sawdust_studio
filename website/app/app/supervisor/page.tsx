'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft } from '@/lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrewRow = {
  id: string;
  worker_name: string;
  dept: string;
  clock_in: string;
  status: string | null;
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
  created_at: string;
};

type DamageReport = {
  id: string;
  part_name: string;
  job_id: string | null;
  dept: string | null;
  notes: string | null;
  photo_url: string | null;
  status: string | null;
  created_at: string;
};

type Tab = 'overview' | 'messages' | 'needs' | 'damage';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── UI Components ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TrialBanner({ days }: { days: number }) {
  return (
    <div style={{ position: 'sticky', top: 64, zIndex: 50, background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.25)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}><b>{days} day{days !== 1 ? 's' : ''}</b> left in trial —</span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>Upgrade</Link>
    </div>
  );
}

function Toast({ msg, error }: { msg: string; error?: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      zIndex: 400, background: error ? '#F87171' : '#34D399',
      color: error ? '#fff' : '#001a0d',
      padding: '12px 24px', borderRadius: 10, fontWeight: 700, fontSize: 14,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
    }}>
      {msg}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'open').toLowerCase();
  const map: Record<string, { color: string; bg: string }> = {
    open:     { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    pending:  { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    ordered:  { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
    reviewed: { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
    resolved: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
    received: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
    closed:   { color: '#5F6F6C', bg: 'rgba(95,111,108,0.1)' },
  };
  const st = map[s] ?? map.open;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: st.color, background: st.bg, padding: '3px 8px', borderRadius: 6 }}>
      {s}
    </span>
  );
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11, fontWeight: 700,
        color, background: 'transparent',
        border: `1px solid ${color}40`,
        borderRadius: 6, padding: '3px 10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = color + '18'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupervisorPage() {
  const { loading: sessionLoading, tenant, email } = useSession();

  const [tab,         setTab]         = useState<Tab>('overview');
  const [activeCrew,  setActiveCrew]  = useState<CrewRow[]>([]);
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [needs,       setNeeds]       = useState<InventoryNeed[]>([]);
  const [damage,      setDamage]      = useState<DamageReport[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Per-row action loading — track by id
  const [actioning, setActioning] = useState<Record<string, boolean>>({});

  // Message compose
  const [msgBody,    setMsgBody]    = useState('');
  const [msgDept,    setMsgDept]    = useState('');
  const [sending,    setSending]    = useState(false);

  // Message thread view — null = inbox, string = dept key ('__broadcast__' for null-dept)
  const [openThread, setOpenThread] = useState<string | null>(null);

  // Toast
  const [toast,     setToast]     = useState<{ msg: string; error?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Data load ───────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!tenant) return;
    try {
      const [crewRes, msgRes, needsRes, damageRes] = await Promise.all([
        supabase.from('time_clock').select('id, worker_name, dept, clock_in, status').eq('tenant_id', tenant.id).is('clock_out', null).order('clock_in', { ascending: true }),
        supabase.from('messages').select('id, sender_name, dept, body, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('inventory_needs').select('id, item, dept, job_number, qty, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('damage_reports').select('id, part_name, job_id, dept, notes, photo_url, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (crewRes.data)   setActiveCrew(crewRes.data as CrewRow[]);
      if (msgRes.data)    setMessages(msgRes.data as Message[]);
      if (needsRes.data)  setNeeds(needsRes.data as InventoryNeed[]);
      if (damageRes.data) setDamage(damageRes.data as DamageReport[]);
    } catch (_) {}
    setDataLoading(false);
  }, [tenant]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Realtime subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    if (!tenant) return;
    const tenantId = tenant.id;

    const clockCh = supabase
      .channel('rt-clock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_clock', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as CrewRow & { clock_out: string | null };
          if (!row.clock_out) {
            setActiveCrew((prev) => prev.some((r) => r.id === row.id) ? prev : [...prev, row]);
          }
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as CrewRow & { clock_out: string | null };
          if (row.clock_out) {
            setActiveCrew((prev) => prev.filter((r) => r.id !== row.id));
          } else {
            setActiveCrew((prev) => prev.map((r) => r.id === row.id ? { ...r, ...row } : r));
          }
        } else if (payload.eventType === 'DELETE') {
          setActiveCrew((prev) => prev.filter((r) => r.id !== payload.old.id));
        }
      })
      .subscribe();

    const msgCh = supabase
      .channel('rt-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => prev.some((m) => m.id === payload.new.id) ? prev : [payload.new as Message, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new as Message : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      })
      .subscribe();

    const needsCh = supabase
      .channel('rt-needs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_needs', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setNeeds((prev) => prev.some((n) => n.id === payload.new.id) ? prev : [payload.new as InventoryNeed, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setNeeds((prev) => prev.map((n) => n.id === payload.new.id ? payload.new as InventoryNeed : n));
        } else if (payload.eventType === 'DELETE') {
          setNeeds((prev) => prev.filter((n) => n.id !== payload.old.id));
        }
      })
      .subscribe();

    const damageCh = supabase
      .channel('rt-damage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'damage_reports', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setDamage((prev) => prev.some((d) => d.id === payload.new.id) ? prev : [payload.new as DamageReport, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setDamage((prev) => prev.map((d) => d.id === payload.new.id ? payload.new as DamageReport : d));
        } else if (payload.eventType === 'DELETE') {
          setDamage((prev) => prev.filter((d) => d.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(clockCh);
      supabase.removeChannel(msgCh);
      supabase.removeChannel(needsCh);
      supabase.removeChannel(damageCh);
    };
  }, [tenant]);

  // ── Message send ────────────────────────────────────────────────────────────

  async function handleSendMessage() {
    const body = msgBody.trim();
    // In a thread: dept is fixed to that thread; in inbox: use the dropdown value
    const dept = openThread !== null
      ? (openThread === '__broadcast__' ? null : openThread)
      : (msgDept || null);
    if (!body || sending) return;
    setSending(true);

    const optimistic: Message = {
      id:          `opt-${Date.now()}`,
      sender_name: 'Supervisor',
      dept,
      body,
      created_at:  new Date().toISOString(),
    };
    setMessages((prev) => [optimistic, ...prev]);
    setMsgBody('');

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_name: 'Supervisor',
        dept,
        body,
        tenant_id: tenant!.id,
      }).select('id, sender_name, dept, body, created_at').single();
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? data as Message : m));
      showToast('Message sent ✓');
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setMsgBody(body);
      const msg = err instanceof Error ? err.message : 'Send failed';
      showToast(msg, true);
    } finally {
      setSending(false);
    }
  }

  // ── Message delete ──────────────────────────────────────────────────────────

  async function handleDeleteMessage(id: string) {
    const backup = messages.find((m) => m.id === id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
    try {
      const { error } = await supabase.from('messages').delete().eq('id', id);
      if (error) throw error;
    } catch (err: unknown) {
      if (backup) {
        setMessages((prev) =>
          [backup, ...prev].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        );
      }
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, true);
    }
  }

  // ── Inventory status update ─────────────────────────────────────────────────

  async function handleNeedStatus(id: string, status: string) {
    setActioning((prev) => ({ ...prev, [id]: true }));
    const prev = needs.find((n) => n.id === id);
    setNeeds((ns) => ns.map((n) => n.id === id ? { ...n, status } : n));
    try {
      const { error } = await supabase.from('inventory_needs').update({ status }).eq('id', id);
      if (error) throw error;
      showToast(`Marked as ${status} ✓`);
    } catch (err: unknown) {
      if (prev) setNeeds((ns) => ns.map((n) => n.id === id ? prev : n));
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setActioning((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ── Damage status update ────────────────────────────────────────────────────

  async function handleDamageStatus(id: string, status: string) {
    setActioning((prev) => ({ ...prev, [id]: true }));
    const prev = damage.find((d) => d.id === id);
    setDamage((ds) => ds.map((d) => d.id === id ? { ...d, status } : d));
    try {
      const { error } = await supabase.from('damage_reports').update({ status }).eq('id', id);
      if (error) throw error;
      showToast(`Marked as ${status} ✓`);
    } catch (err: unknown) {
      if (prev) setDamage((ds) => ds.map((d) => d.id === id ? prev : d));
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setActioning((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/');
  };

  if (sessionLoading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);

  const openNeeds  = needs.filter((n)  => !['resolved', 'closed', 'received', 'cancelled'].includes((n.status  ?? 'open').toLowerCase()));
  const openDamage = damage.filter((d) => !['resolved', 'closed'].includes((d.status ?? 'open').toLowerCase()));

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview',  label: 'Overview' },
    { key: 'messages',  label: 'Messages',  count: messages.length },
    { key: 'needs',     label: 'Inventory', count: openNeeds.length },
    { key: 'damage',    label: 'Damage',    count: openDamage.length },
  ];

  // ── Thread computation for Messages tab ────────────────────────────────────
  // Groups messages by dept; null dept = broadcast (__broadcast__ key)
  const threadMap: Record<string, Message[]> = {};
  messages.forEach((msg) => {
    const key = msg.dept ?? '__broadcast__';
    if (!threadMap[key]) threadMap[key] = [];
    threadMap[key].push(msg);
  });
  const msgThreads = Object.entries(threadMap)
    .map(([deptKey, msgs]) => ({
      deptKey,
      label: deptKey === '__broadcast__' ? 'All Departments (Broadcast)' : deptKey,
      count: msgs.length,
      lastMsg: msgs.reduce((l, m) => new Date(m.created_at) > new Date(l.created_at) ? m : l),
    }))
    .sort((a, b) => new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime());

  const openThreadMsgs = openThread
    ? (threadMap[openThread] ?? []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];
  const openThreadLabel = openThread === '__broadcast__' ? 'All Departments' : (openThread ?? '');

  const thStyle: React.CSSProperties = { padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' };
  const tdStyle: React.CSSProperties = { padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' };
  const tdBold:  React.CSSProperties = { ...tdStyle, fontSize: 14, fontWeight: 600, color: 'var(--ink)' };

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', height: 64, display: 'flex', alignItems: 'center', padding: '0 32px', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)', fontSize: 13 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
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
            <button onClick={handleSignOut} className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>Sign out</button>
          </div>
        </div>

        {isTrial && <TrialBanner days={days} />}

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Supervisor Dashboard</div>
              <h2 style={{ fontSize: 28 }}>{tenant?.shop_name}</h2>
              <Link
                href="/app"
                style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, textDecoration: 'none' }}
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                Switch Role
              </Link>
            </div>
            <button onClick={loadAll} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Crew Clocked In',      value: dataLoading ? '—' : String(activeCrew.length),  color: '#2DE1C9' },
              { label: 'Messages',              value: dataLoading ? '—' : String(messages.length),    color: '#5EEAD4' },
              { label: 'Open Inventory Needs',  value: dataLoading ? '—' : String(openNeeds.length),   color: '#FBBF24' },
              { label: 'Open Damage Reports',   value: dataLoading ? '—' : String(openDamage.length),  color: '#F87171' },
            ].map(({ label, value, color }) => (
              <div key={label} className="portal-card" style={{ padding: '20px 24px' }}>
                <div className="portal-stat-value" style={{ color }}>{value}</div>
                <div className="portal-stat-label" style={{ marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 24 }}>
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setOpenThread(null); setMsgBody(''); }}
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600, color: tab === key ? 'var(--teal)' : 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: tab === key ? '2px solid var(--teal)' : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7, transition: 'color 0.15s', fontFamily: 'inherit' }}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: tab === key ? 'rgba(94,234,212,0.15)' : 'rgba(255,255,255,0.06)', color: tab === key ? 'var(--teal)' : 'var(--ink-mute)' }}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Overview tab ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Active Crew — Clocked In Now
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : activeCrew.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No crew currently clocked in.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Name', 'Department', 'Status', 'Clocked In', 'Duration'].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeCrew.map((row) => (
                      <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={tdBold}>{row.worker_name}</td>
                        <td style={tdStyle}>{row.dept}</td>
                        <td style={tdStyle}>{row.status ?? 'active'}</td>
                        <td style={tdStyle}>{formatTime(row.clock_in)}</td>
                        <td style={{ ...tdStyle }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', padding: '3px 8px', borderRadius: 6 }}>{elapsed(row.clock_in)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Messages tab — Inbox ──────────────────────────────────────────── */}
          {tab === 'messages' && openThread === null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Compose new message */}
              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>New Message</div>
                <div style={{ marginBottom: 10 }}>
                  <select
                    className="form-input"
                    value={msgDept}
                    onChange={(e) => setMsgDept(e.target.value)}
                    style={{ width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">All Departments (broadcast)</option>
                    <option value="Production">Production</option>
                    <option value="Assembly">Assembly</option>
                    <option value="Finishing">Finishing</option>
                    <option value="Craftsman">Craftsman</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    className="form-input"
                    placeholder="Type a message to your crew…"
                    value={msgBody}
                    onChange={(e) => setMsgBody(e.target.value)}
                    rows={2}
                    style={{ flex: 1, resize: 'vertical', minHeight: 64 }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage(); }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-end', padding: '12px 20px', opacity: (!msgBody.trim() || sending) ? 0.5 : 1 }}
                    onClick={handleSendMessage}
                    disabled={!msgBody.trim() || sending}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>⌘↵ or Ctrl+Enter to send</div>
              </div>

              {/* Thread list */}
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : msgThreads.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No messages yet. Send the first message above.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {msgThreads.map(({ deptKey, label, count, lastMsg }, i) => (
                    <button
                      key={deptKey}
                      onClick={() => { setOpenThread(deptKey); setMsgBody(''); }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px',
                        background: 'none', border: 'none',
                        borderBottom: i < msgThreads.length - 1 ? '1px solid var(--line)' : 'none',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(94,234,212,0.03)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
                    >
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(94,234,212,0.08)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)' }}>
                            {count}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ color: lastMsg.sender_name === 'Supervisor' ? 'var(--teal)' : 'var(--ink-dim)', fontWeight: 600 }}>{lastMsg.sender_name}:</span>{' '}
                          {lastMsg.body.length > 80 ? lastMsg.body.slice(0, 77) + '…' : lastMsg.body}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0, marginRight: 4 }}>
                        {formatDate(lastMsg.created_at)}
                      </div>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--ink-mute)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Messages tab — Conversation ───────────────────────────────────── */}
          {tab === 'messages' && openThread !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Back + thread header — same style as crew page */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => { setOpenThread(null); setMsgBody(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 13, transition: 'color 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-mute)'; }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Inbox
                </button>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                  {openThreadLabel}
                </span>
              </div>

              {/* Bubble conversation — same structure as crew page */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {openThreadMsgs.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '12px 0' }}>No messages in this thread.</div>
                ) : (
                  openThreadMsgs.map((msg) => {
                    const isSelf = msg.sender_name === 'Supervisor';
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: '12px 14px', borderRadius: 12,
                          background: isSelf ? 'rgba(94,234,212,0.04)' : 'rgba(255,255,255,0.02)',
                          border: isSelf ? '1px solid rgba(94,234,212,0.15)' : '1px solid var(--line)',
                          alignSelf: isSelf ? 'flex-start' : 'flex-end',
                          maxWidth: '82%',
                          opacity: msg.id.startsWith('opt-') ? 0.6 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isSelf ? 'var(--teal)' : 'var(--ink)' }}>
                            {msg.sender_name}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0 }}>
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                        <p style={{ fontSize: 14, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.55 }}>{msg.body}</p>
                        {!msg.id.startsWith('opt-') && (
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                            <ActionBtn label="Delete" color="#F87171" onClick={() => handleDeleteMessage(msg.id)} />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply box — same structure as crew page */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <textarea
                  className="form-input"
                  placeholder={`Reply to ${openThreadLabel}…`}
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  rows={3}
                  style={{ resize: 'none', marginBottom: 10, width: '100%' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage(); }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>⌘↵ to send</span>
                  <button
                    className="btn btn-primary"
                    style={{ opacity: (!msgBody.trim() || sending) ? 0.5 : 1, padding: '8px 20px' }}
                    onClick={handleSendMessage}
                    disabled={!msgBody.trim() || sending}
                  >
                    {sending ? 'Sending…' : 'Reply'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Inventory tab ─────────────────────────────────────────────────── */}
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
                      {['Item', 'Department', 'Job #', 'Qty', 'Date', 'Status', ''].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((n) => {
                      const s = (n.status ?? 'pending').toLowerCase();
                      const isActionable = !['received', 'cancelled'].includes(s);
                      const busy = actioning[n.id];
                      return (
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={tdBold}>{n.item}</td>
                          <td style={tdStyle}>{n.dept ?? '—'}</td>
                          <td style={tdStyle}>{n.job_number ?? '—'}</td>
                          <td style={tdStyle}>{n.qty ?? '—'}</td>
                          <td style={tdStyle}>{formatDate(n.created_at)}</td>
                          <td style={{ ...tdStyle }}><StatusBadge status={n.status} /></td>
                          <td style={{ ...tdStyle, paddingRight: 20 }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {isActionable && s !== 'ordered' && (
                                <ActionBtn label="Mark Ordered" color="#5EEAD4" onClick={() => handleNeedStatus(n.id, 'ordered')} disabled={busy} />
                              )}
                              {isActionable && (
                                <ActionBtn label="Received" color="#34D399" onClick={() => handleNeedStatus(n.id, 'received')} disabled={busy} />
                              )}
                              {isActionable && (
                                <ActionBtn label="Cancel" color="#F87171" onClick={() => handleNeedStatus(n.id, 'cancelled')} disabled={busy} />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Damage tab ────────────────────────────────────────────────────── */}
          {tab === 'damage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : damage.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No damage reports logged.</div>
              ) : (
                damage.map((d) => {
                  const s = (d.status ?? 'open').toLowerCase();
                  const isOpen = !['resolved', 'closed'].includes(s);
                  const busy = actioning[d.id];
                  return (
                    <div key={d.id} className="portal-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{d.part_name}</span>
                            <StatusBadge status={d.status} />
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {d.dept    && <span>{d.dept}</span>}
                            {d.job_id  && <span>Job: {d.job_id}</span>}
                            <span>{formatDate(d.created_at)}</span>
                          </div>
                          {d.notes && (
                            <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '8px 0 0', lineHeight: 1.5 }}>{d.notes}</p>
                          )}
                        </div>
                        {d.photo_url && (
                          <a href={d.photo_url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                            <img src={d.photo_url} alt="damage" style={{ width: 80, height: 60, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)' }} />
                          </a>
                        )}
                      </div>
                      {isOpen && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                          {s !== 'reviewed' && (
                            <ActionBtn label="Mark Reviewed" color="#A78BFA" onClick={() => handleDamageStatus(d.id, 'reviewed')} disabled={busy} />
                          )}
                          <ActionBtn label="Resolve" color="#34D399" onClick={() => handleDamageStatus(d.id, 'resolved')} disabled={busy} />
                          <ActionBtn label="Close" color="#5F6F6C" onClick={() => handleDamageStatus(d.id, 'closed')} disabled={busy} />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </main>
      </div>

      {toast && <Toast msg={toast.msg} error={toast.error} />}
    </>
  );
}
