'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tenant } from '@/lib/auth';

// ── Types ───────────────────────────────────────────────────────────────────

type CrewMember = {
  id: string;
  tenant_id: string;
  name: string;
  department: string | null;
  role: string | null;
  status: string | null;
  joined_at: string | null;
  last_active: string | null;
  notes: string | null;
  hourly_rate: number | null;
};

interface Props {
  tenant: Tenant;
  departments: string[];
  showToast: (msg: string, error?: boolean) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never clocked in';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'just now';
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 30)  return `${days} day${days !== 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const ROLE_META: Record<string, { label: string; color: string; bg: string }> = {
  crew:       { label: 'Crew',       color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
  lead:       { label: 'Lead',       color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  supervisor: { label: 'Supervisor', color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
};

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'crew',       label: 'Crew' },
  { value: 'lead',       label: 'Lead' },
  { value: 'supervisor', label: 'Supervisor' },
];

// ── Icons (thin-stroke SVG) ───────────────────────────────────────────────────

const CrewIcon = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const CopyIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);
const ShareIcon = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

// ── Component ─────────────────────────────────────────────────────────────────

export default function CrewTab({ tenant, departments, showToast }: Props) {
  const [members,   setMembers]   = useState<CrewMember[]>([]);
  const [loading,   setLoading]   = useState(true);
  // name (lowercased) → most recent clock_in, derived from time_clock.
  const [lastClock, setLastClock] = useState<Record<string, string>>({});

  const [copied, setCopied] = useState(false);

  // Add modal
  const [showAdd,  setShowAdd]  = useState(false);
  const [addName,  setAddName]  = useState('');
  const [addDept,  setAddDept]  = useState('');
  const [addRole,  setAddRole]  = useState('crew');
  const [addRate,  setAddRate]  = useState('');
  const [addNotes, setAddNotes] = useState('');
  const [addSaving, setAddSaving] = useState(false);

  // Per-card UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editName,   setEditName]   = useState('');
  const [editDept,   setEditDept]   = useState('');
  const [editRole,   setEditRole]   = useState('crew');
  const [editRate,   setEditRate]   = useState('');
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [actioning, setActioning] = useState<Record<string, boolean>>({});

  const inviteUrl = `https://inlineiq.app/join?tenant=${tenant.id}`;

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('crew_members')
        .select('id, tenant_id, name, department, role, status, joined_at, last_active, notes, hourly_rate')
        .eq('tenant_id', tenant.id)
        .order('name', { ascending: true });
      if (error) throw error;
      setMembers((data ?? []) as CrewMember[]);
    } catch (_) {
      showToast('Could not load crew', true);
    }
    // Most-recent clock_in per worker name — drives "last active" + "never clocked in".
    try {
      const { data } = await supabase
        .from('time_clock')
        .select('worker_name, clock_in')
        .eq('tenant_id', tenant.id)
        .order('clock_in', { ascending: false })
        .limit(5000);
      const map: Record<string, string> = {};
      for (const r of (data ?? []) as { worker_name: string | null; clock_in: string | null }[]) {
        if (!r.worker_name || !r.clock_in) continue;
        const key = r.worker_name.toLowerCase();
        if (!map[key]) map[key] = r.clock_in; // rows arrive newest-first
      }
      setLastClock(map);
    } catch (_) { /* time_clock may be empty */ }
    setLoading(false);
  }, [tenant.id, showToast]);

  useEffect(() => { void load(); }, [load]);

  // ── Realtime — list updates as crew clock in / are edited ────────────────────
  useEffect(() => {
    const ch = supabase
      .channel('rt-crew-members')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_members', filter: `tenant_id=eq.${tenant.id}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as CrewMember;
          setMembers((prev) => prev.some((m) => m.id === row.id) ? prev : [...prev, row]);
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as CrewMember;
          setMembers((prev) => prev.map((m) => m.id === row.id ? row : m));
        } else if (payload.eventType === 'DELETE') {
          setMembers((prev) => prev.filter((m) => m.id !== (payload.old as { id: string }).id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant.id]);

  // ── Last active for a member (max of crew_members.last_active + time_clock) ──
  function memberLastActive(m: CrewMember): string | null {
    const fromClock = lastClock[m.name.toLowerCase()] ?? null;
    if (m.last_active && fromClock) return m.last_active > fromClock ? m.last_active : fromClock;
    return m.last_active ?? fromClock;
  }
  function hasEverClockedIn(m: CrewMember): boolean {
    return !!memberLastActive(m);
  }

  // ── Invite link actions ───────────────────────────────────────────────────────
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) { showToast('Could not copy link', true); }
  }

  // ── Add member ────────────────────────────────────────────────────────────────
  function openAdd() {
    setAddName(''); setAddDept(departments[0] ?? ''); setAddRole('crew'); setAddRate(''); setAddNotes('');
    setShowAdd(true);
  }

  async function handleAdd() {
    const name = addName.trim();
    if (!name || addSaving) return;
    setAddSaving(true);
    try {
      const rate = addRate.trim() === '' ? null : Number(addRate);
      const { data, error } = await supabase
        .from('crew_members')
        .insert({
          tenant_id:   tenant.id,
          name,
          department:  addDept || null,
          role:        addRole,
          status:      'active',
          hourly_rate: (rate != null && !Number.isNaN(rate)) ? rate : null,
          notes:       addNotes.trim() || null,
        })
        .select('id, tenant_id, name, department, role, status, joined_at, last_active, notes, hourly_rate')
        .single();
      if (error) throw error;
      // Optimistic insert (realtime will dedupe).
      const row = data as CrewMember;
      setMembers((prev) => prev.some((m) => m.id === row.id) ? prev : [...prev, row]);
      setShowAdd(false);
      showToast('Crew member added');
    } catch (_) {
      showToast('Could not add crew member', true);
    } finally {
      setAddSaving(false);
    }
  }

  // ── Edit member ─────────────────────────────────────────────────────────────
  function startEdit(m: CrewMember) {
    setEditingId(m.id);
    setEditName(m.name);
    setEditDept(m.department ?? '');
    setEditRole(m.role ?? 'crew');
    setEditRate(m.hourly_rate != null ? String(m.hourly_rate) : '');
  }

  async function saveEdit(m: CrewMember) {
    const name = editName.trim();
    if (!name || actioning[m.id]) return;
    setActioning((p) => ({ ...p, [m.id]: true }));
    try {
      const rate = editRate.trim() === '' ? null : Number(editRate);
      const patch = { name, department: editDept || null, role: editRole, hourly_rate: (rate != null && !Number.isNaN(rate)) ? rate : null };
      const { error } = await supabase.from('crew_members').update(patch).eq('id', m.id).eq('tenant_id', tenant.id);
      if (error) throw error;
      setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, ...patch } : x));
      setEditingId(null);
      showToast('Crew member updated');
    } catch (_) {
      showToast('Could not update crew member', true);
    } finally {
      setActioning((p) => ({ ...p, [m.id]: false }));
    }
  }

  // ── Deactivate / reactivate ───────────────────────────────────────────────────
  async function setStatus(m: CrewMember, status: 'active' | 'inactive') {
    if (actioning[m.id]) return;
    setActioning((p) => ({ ...p, [m.id]: true }));
    try {
      const { error } = await supabase.from('crew_members').update({ status }).eq('id', m.id).eq('tenant_id', tenant.id);
      if (error) throw error;
      setMembers((prev) => prev.map((x) => x.id === m.id ? { ...x, status } : x));
      showToast(status === 'active' ? 'Crew member reactivated' : 'Crew member deactivated');
    } catch (_) {
      showToast('Could not update status', true);
    } finally {
      setActioning((p) => ({ ...p, [m.id]: false }));
    }
  }

  // ── Remove (only when never clocked in — otherwise deactivate) ────────────────
  async function remove(m: CrewMember) {
    if (actioning[m.id]) return;
    setActioning((p) => ({ ...p, [m.id]: true }));
    try {
      const { error } = await supabase.from('crew_members').delete().eq('id', m.id).eq('tenant_id', tenant.id);
      if (error) throw error;
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
      setConfirmRemoveId(null);
      showToast('Crew member removed');
    } catch (_) {
      showToast('Could not remove crew member', true);
    } finally {
      setActioning((p) => ({ ...p, [m.id]: false }));
    }
  }

  // ── Grouping by department ──────────────────────────────────────────────────
  const groups: { dept: string; members: CrewMember[] }[] = (() => {
    const map: Record<string, CrewMember[]> = {};
    for (const m of members) {
      const key = m.department || 'Unassigned';
      (map[key] ??= []).push(m);
    }
    // Order known departments first, then any extras, then Unassigned last.
    const order = [...departments, ...Object.keys(map).filter((k) => k !== 'Unassigned' && !departments.includes(k))];
    const result: { dept: string; members: CrewMember[] }[] = [];
    for (const d of order) if (map[d]) result.push({ dept: d, members: map[d] });
    if (map['Unassigned']) result.push({ dept: 'Unassigned', members: map['Unassigned'] });
    return result;
  })();

  const totalCount = members.length;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>Crew</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{totalCount} member{totalCount !== 1 ? 's' : ''}</span>
          <button className="btn btn-primary" style={{ fontSize: 13, padding: '8px 16px' }} onClick={openAdd}>
            + Add Crew Member
          </button>
        </div>
      </div>

      {/* Invite link card */}
      <div className="portal-card" style={{ border: '1px solid var(--line-strong)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>
          Crew Invite Link
        </div>
        <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>
          Share this link with new crew members — they tap it and they&apos;re straight in. No account needed.
        </p>
        <div style={{
          background: 'var(--bg)', border: '1px solid rgba(45,225,201,0.3)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 12,
        }}>
          <span style={{ fontSize: 13, color: 'var(--teal)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
            {inviteUrl}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            style={{ flex: '1 1 160px', justifyContent: 'center', gap: 8, background: copied ? '#34D399' : undefined }}
            onClick={copyLink}
          >
            <CopyIcon /> {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`Join our shop on InlineIQ: ${inviteUrl}`)}`}
            target="_blank" rel="noopener noreferrer"
            className="btn btn-ghost"
            style={{ flex: '1 1 160px', justifyContent: 'center', gap: 8, textDecoration: 'none', color: 'var(--teal)' }}
          >
            <ShareIcon /> Share via WhatsApp
          </a>
        </div>
      </div>

      {/* Crew list / empty state */}
      {loading ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-mute)', fontSize: 14 }}>Loading crew…</div>
      ) : totalCount === 0 ? (
        <div className="portal-card" style={{ textAlign: 'center', padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(45,225,201,0.08)', border: '1px solid var(--line-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}>
            <CrewIcon size={26} />
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>No crew members yet</div>
          <p style={{ fontSize: 13, color: 'var(--ink-mute)', maxWidth: 320, lineHeight: 1.6, margin: 0 }}>
            Add your first crew member or share the invite link.
          </p>
          <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={openAdd}>+ Add Crew Member</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {groups.map(({ dept, members: deptMembers }) => (
            <div key={dept}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 10 }}>
                {dept} <span style={{ color: 'var(--teal)' }}>· {deptMembers.length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deptMembers.map((m) => {
                  const inactive  = m.status === 'inactive';
                  const role      = (m.role ?? 'crew').toLowerCase();
                  const roleMeta  = ROLE_META[role] ?? ROLE_META.crew;
                  const expanded  = expandedId === m.id;
                  const editing   = editingId === m.id;
                  const clockedIn = hasEverClockedIn(m);
                  const busy      = actioning[m.id];
                  return (
                    <div key={m.id} className="portal-card" style={{ padding: 0, opacity: inactive ? 0.55 : 1 }}>
                      {/* Card head — tap to expand actions */}
                      <button
                        onClick={() => { setExpandedId(expanded ? null : m.id); setEditingId(null); setConfirmRemoveId(null); }}
                        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{m.name}</span>
                            {m.department && (
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)' }}>{m.department}</span>
                            )}
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: roleMeta.bg, color: roleMeta.color }}>{roleMeta.label}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: inactive ? '#8BA5A0' : '#34D399', flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
                              {inactive ? 'Inactive' : 'Active'} · {relativeTime(memberLastActive(m))}
                            </span>
                          </div>
                        </div>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
                          <polyline points="6 9 12 15 18 9"/>
                        </svg>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Remove ${m.name}`}
                          onClick={(e) => { e.stopPropagation(); setExpandedId(m.id); setConfirmRemoveId(m.id); }}
                          style={{ width: 28, height: 28, flexShrink: 0, borderRadius: '50%', background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.5)', color: '#F87171', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                        >
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </span>
                      </button>

                      {/* Expanded actions */}
                      {expanded && (
                        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--line)' }}>
                          {editing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14 }}>
                              <input className="form-input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Name" />
                              <select className="form-input" value={editDept} onChange={(e) => setEditDept(e.target.value)} style={{ cursor: 'pointer' }}>
                                <option value="">No department</option>
                                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                                {editDept && !departments.includes(editDept) && <option value={editDept}>{editDept}</option>}
                              </select>
                              <select className="form-input" value={editRole} onChange={(e) => setEditRole(e.target.value)} style={{ cursor: 'pointer' }}>
                                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                              </select>
                              {/* Hourly Rate — supervisor only, never sent to crew-facing queries */}
                              <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Hourly Rate (supervisor only)</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 15, color: 'var(--ink-dim)', fontWeight: 600 }}>$</span>
                                  <input
                                    className="form-input"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    placeholder="0.00"
                                    value={editRate}
                                    onChange={(e) => setEditRate(e.target.value)}
                                    style={{ flex: 1 }}
                                  />
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 5 }}>Never visible to crew members</div>
                              </div>
                              <div style={{ display: 'flex', gap: 10 }}>
                                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setEditingId(null)}>Cancel</button>
                                <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', opacity: (!editName.trim() || busy) ? 0.5 : 1 }} onClick={() => void saveEdit(m)} disabled={!editName.trim() || busy}>
                                  {busy ? 'Saving…' : 'Save'}
                                </button>
                              </div>
                            </div>
                          ) : confirmRemoveId === m.id ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 14 }}>
                              <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: 0 }}>
                                Remove <b style={{ color: 'var(--ink)' }}>{m.name}</b>? This permanently deletes their record.
                              </p>
                              <div style={{ display: 'flex', gap: 10 }}>
                                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setConfirmRemoveId(null)}>Cancel</button>
                                <button
                                  className="btn btn-ghost"
                                  style={{ flex: 1, justifyContent: 'center', color: '#F87171', borderColor: 'rgba(248,113,113,0.3)', opacity: busy ? 0.5 : 1 }}
                                  onClick={() => void remove(m)}
                                  disabled={busy}
                                >
                                  {busy ? 'Removing…' : 'Remove'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 14 }}>
                              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px' }} onClick={() => startEdit(m)}>Edit</button>
                              {inactive ? (
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px', color: '#34D399', borderColor: 'rgba(52,211,153,0.3)', opacity: busy ? 0.5 : 1 }} onClick={() => void setStatus(m, 'active')} disabled={busy}>
                                  Reactivate
                                </button>
                              ) : (
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px', opacity: busy ? 0.5 : 1 }} onClick={() => void setStatus(m, 'inactive')} disabled={busy}>
                                  Deactivate
                                </button>
                              )}
              {/* Crew with clock-in history can be deactivated (preserves records)
                  but not hard-removed; the rest show a Remove button. */}
                              {!clockedIn && (
                                <button className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 14px', color: '#F87171', borderColor: 'rgba(248,113,113,0.3)' }} onClick={() => setConfirmRemoveId(m.id)}>
                                  Remove
                                </button>
                              )}
                            </div>
                          )}
                          {m.notes && !editing && confirmRemoveId !== m.id && (
                            <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '12px 0 0', lineHeight: 1.5 }}>{m.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Crew Member modal */}
      {showAdd && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={() => !addSaving && setShowAdd(false)}>
          <div className="portal-card" style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Add Crew Member</h3>
              <button onClick={() => !addSaving && setShowAdd(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2, display: 'flex' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Name <span style={{ color: '#F87171' }}>*</span></label>
              <input className="form-input" value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. Mike, Sarah" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Department</label>
              <select className="form-input" value={addDept} onChange={(e) => setAddDept(e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="">No department</option>
                {departments.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Role</label>
              <select className="form-input" value={addRole} onChange={(e) => setAddRole(e.target.value)} style={{ cursor: 'pointer' }}>
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>

            {/* Hourly Rate — supervisor only, never sent to crew-facing queries */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Hourly Rate <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(supervisor only)</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, color: 'var(--ink-dim)', fontWeight: 600 }}>$</span>
                <input
                  className="form-input"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={addRate}
                  onChange={(e) => setAddRate(e.target.value)}
                  style={{ flex: 1 }}
                />
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Never visible to crew members</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Notes <span style={{ color: 'var(--ink-mute)', fontWeight: 400 }}>(optional)</span></label>
              <textarea className="form-input" rows={2} value={addNotes} onChange={(e) => setAddNotes(e.target.value)} placeholder="Any notes about this crew member" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
            </div>

            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', opacity: (!addName.trim() || addSaving) ? 0.5 : 1 }}
              onClick={() => void handleAdd()}
              disabled={!addName.trim() || addSaving}
            >
              {addSaving ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
