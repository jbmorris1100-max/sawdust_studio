'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_DEPARTMENTS } from '@/lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

type CabinetUnit = {
  id: string;
  tenant_id: string;
  job_id: string | null;
  job_number: string | null;
  room_number: string | null;
  cabinet_number: string | null;
  unit_label: string;
  status: string;
  flagged_reason: string | null;
  completed_at: string | null;
  created_at: string;
  assigned_dept: string | null;
  is_split: boolean | null;
  split_from_id: string | null;
  parent_unit_id: string | null;
};

type AssemblyPart = {
  id: string;
  cabinet_unit_id: string;
  job_number: string | null;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  status: string;
  checked_at: string | null;
  checked_by: string | null;
  flag_type: string | null;
  flag_notes: string | null;
  scan_value: string | null;
  created_at: string;
};

type Job = {
  id: string;
  job_number: string;
  job_name: string | null;
  status: string;
  job_path?: string | null;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
  departments?: string[];
}

// ── SVG icons (thin stroke, no emoji) ─────────────────────────────────────────

const IcoCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IcoDamaged = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IcoMissing = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="8" y1="12" x2="16" y2="12"/>
  </svg>
);
const IcoWrong = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IcoPending = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
  </svg>
);
const IcoFlag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
    <line x1="4" y1="22" x2="4" y2="15"/>
  </svg>
);
// Thin-stroke right chevron — rotates 90° when its branch is expanded.
const IcoChevron = ({ open, size = 16 }: { open: boolean; size?: number }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
  >
    <polyline points="9 6 15 12 9 18"/>
  </svg>
);
// Filled teal checkmark — part complete.
const IcoCheckFilled = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="#5EEAD4" stroke="#04201c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" fill="#5EEAD4" stroke="none"/>
    <polyline points="17 9 10.5 15.5 7 12" fill="none"/>
  </svg>
);
// Teal ring — part in assembly.
const IcoRing = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Production pipeline status for a cabinet unit:
//   not_cut/pending → grey · cutting → amber · cut → teal · in_assembly → blue · complete → green · flagged → red
function statusMeta(status: string): { label: string; color: string; bg: string; border: string } {
  switch (status) {
    case 'complete':    return { label: 'Complete',    color: '#34D399', bg: 'rgba(52,211,153,0.1)',   border: 'rgba(52,211,153,0.25)' };
    case 'finishing':   return { label: 'Finishing',   color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.3)'  };
    case 'building':    return { label: 'Building',    color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.25)' };
    case 'in_assembly': return { label: 'In Assembly', color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',   border: 'rgba(96,165,250,0.25)' };
    case 'cut':         return { label: 'Cut',         color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)',   border: 'rgba(94,234,212,0.25)' };
    case 'cutting':     return { label: 'Cutting',     color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',   border: 'rgba(251,191,36,0.3)'  };
    case 'flagged':     return { label: 'Flagged',     color: '#F87171', bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' };
    default:            return { label: 'Not Cut',     color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)',   border: 'rgba(95,111,108,0.2)' };
  }
}

function partStatusIcon(status: string, flagType: string | null) {
  if (flagType === 'damaged')    return <span style={{ color: '#F87171', display: 'flex' }}><IcoDamaged /></span>;
  if (flagType === 'missing')    return <span style={{ color: '#FBBF24', display: 'flex' }}><IcoMissing /></span>;
  if (flagType === 'wrong_part') return <span style={{ color: '#F87171', display: 'flex' }}><IcoWrong /></span>;
  if (status === 'complete')     return <span style={{ display: 'flex' }}><IcoCheckFilled /></span>;          // filled teal check
  if (status === 'in_assembly')  return <span style={{ display: 'flex' }}><IcoRing /></span>;                 // teal ring
  if (status === 'checked' || status === 'cut') return <span style={{ color: '#5EEAD4', display: 'flex' }}><IcoCheck /></span>; // teal check
  return <span style={{ color: '#5F6F6C', display: 'flex' }}><IcoPending /></span>;                            // empty circle
}

// One-line status summary like "0 cut · 0 in assembly · 13 pending" for a group of units.
function statusSummary(us: CabinetUnit[]): string {
  const cut     = us.filter((u) => u.status === 'cut').length;
  const inAsm   = us.filter((u) => u.status === 'in_assembly').length;
  const pending = us.filter((u) => u.status === 'pending' || u.status === 'not_cut' || u.status === 'cutting' || !u.status).length;
  const segs = [`${cut} cut`, `${inAsm} in assembly`, `${pending} pending`];
  const complete = us.filter((u) => u.status === 'complete').length;
  const flagged  = us.filter((u) => u.status === 'flagged').length;
  if (complete > 0) segs.push(`${complete} complete`);
  if (flagged > 0)  segs.push(`${flagged} flagged`);
  return segs.join(' · ');
}

// Fraction (0–1) of units in a group that are complete — drives the group progress bar.
function groupProgress(us: CabinetUnit[]): number {
  if (us.length === 0) return 0;
  return us.filter((u) => u.status === 'complete').length / us.length;
}

// Shared style for an expandable drill-down row. indent: px of left padding added per level.
function rowStyle(indent: number, flagged: boolean, divider: boolean): CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 11,
    padding: '13px 20px', paddingLeft: 20 + indent,
    background: flagged ? 'rgba(248,113,113,0.035)' : 'none',
    border: 'none',
    borderTop: divider ? '1px solid var(--line)' : 'none',
    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)',
  };
}

// Colored label for a department badge on split child tickets.
function deptMeta(dept: string | null): { label: string; color: string } {
  switch ((dept ?? '').toLowerCase()) {
    case 'craftsman':  return { label: 'Craftsman',  color: '#5EEAD4' };
    case 'assembly':   return { label: 'Assembly',   color: '#60A5FA' };
    case 'finishing':  return { label: 'Finishing',  color: '#FBBF24' };
    case 'production': return { label: 'Production', color: '#8BA5A0' };
    default:           return { label: dept || 'Unassigned', color: '#8BA5A0' };
  }
}

// Thin full-width progress bar shown on Job / Room rows.
function ProgressBar({ value, flagged }: { value: number; flagged: boolean }) {
  return (
    <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 6 }}>
      <div style={{ height: '100%', width: `${Math.round(value * 100)}%`, background: flagged ? '#F87171' : value >= 1 ? '#34D399' : '#5EEAD4', borderRadius: 2, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// LEVEL 4 — the parts list for one cabinet/ticket. Shared by normal cabinets and
// split child tickets.
function PartsList({ parts }: { parts: AssemblyPart[] }) {
  if (parts.length === 0) {
    return <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', padding: '8px 0' }}>No parts loaded for this unit.</div>;
  }
  return (
    <>
      {parts.map((part) => (
        <div key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{partStatusIcon(part.status, part.flag_type)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: part.flag_type ? '#F87171' : 'var(--ink)' }}>
              {part.part_name}
              {part.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{part.quantity}</span>}
            </div>
            {(dimLabel(part) || part.material) && (
              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                {dimLabel(part)}{part.material ? (dimLabel(part) ? ` · ${part.material}` : part.material) : ''}
              </div>
            )}
            {part.flag_type && (
              <div style={{ fontSize: 11, color: '#F87171', marginTop: 2 }}>
                {part.flag_type.replace('_', ' ')}{part.flag_notes ? ` — ${part.flag_notes}` : ''}
              </div>
            )}
            {part.checked_by && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>by {part.checked_by}</div>}
          </div>
          {part.flag_type && <span style={{ color: '#F87171', flexShrink: 0, display: 'flex' }}><IcoFlag /></span>}
        </div>
      ))}
    </>
  );
}

function dimLabel(p: AssemblyPart): string {
  const parts: string[] = [];
  if (p.width)  parts.push(`${p.width}"`);
  if (p.height) parts.push(`${p.height}"`);
  if (p.depth)  parts.push(`${p.depth}"`);
  return parts.join(' x ');
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AssemblyTab({ tenantId, showToast, departments, jobs }: Props) {
  const deptOptions = departments && departments.length ? departments : DEFAULT_DEPARTMENTS;
  const [units,       setUnits]       = useState<CabinetUnit[]>([]);
  const [allParts,    setAllParts]    = useState<AssemblyPart[]>([]);
  const [loading,     setLoading]     = useState(true);
  // Drill-down expansion — only one branch open per level (Job → Room → Cabinet → Parts).
  const [expandedJob,  setExpandedJob]  = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);  // key: `${jobKey}::${roomKey}`
  const [expandedCab,  setExpandedCab]  = useState<string | null>(null);  // cabinet unit id
  const [expandedChild, setExpandedChild] = useState<string | null>(null); // split child ticket id

  // Message team state
  const [msgUnitId,  setMsgUnitId]  = useState<string | null>(null);
  const [msgBody,    setMsgBody]    = useState('');
  const [msgDept,    setMsgDept]    = useState('Assembly');
  const [msgSending, setMsgSending] = useState(false);

  // ── Data load ──────────────────────────────────────────────────────────────

  const [migrationNeeded, setMigrationNeeded] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [unitsRes, partsRes] = await Promise.all([
        supabase.from('cabinet_units').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('parts').select('*').eq('tenant_id', tenantId).order('part_name'),
      ]);
      // Detect "relation does not exist" — assembly_tracking.sql not yet run
      const missingTable =
        (unitsRes.error && (unitsRes.error as { code?: string }).code === '42P01') ||
        (partsRes.error  && (partsRes.error  as { code?: string }).code === '42P01');
      if (missingTable) {
        setMigrationNeeded(true);
        setLoading(false);
        return;
      }
      if (unitsRes.data) setUnits(unitsRes.data as CabinetUnit[]);
      if (partsRes.data) setAllParts(partsRes.data as AssemblyPart[]);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Load failed', true);
    }
    setLoading(false);
  }, [tenantId, showToast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const unitsCh = supabase.channel('rt-cabinet-units')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setUnits((prev) => prev.some((u) => u.id === payload.new.id) ? prev : [payload.new as CabinetUnit, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setUnits((prev) => prev.map((u) => u.id === payload.new.id ? payload.new as CabinetUnit : u));
        } else if (payload.eventType === 'DELETE') {
          setUnits((prev) => prev.filter((u) => u.id !== payload.old.id));
        }
      })
      .subscribe();

    const partsCh = supabase.channel('rt-assembly-parts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setAllParts((prev) => prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new as AssemblyPart]);
        } else if (payload.eventType === 'UPDATE') {
          setAllParts((prev) => prev.map((p) => p.id === payload.new.id ? payload.new as AssemblyPart : p));
        } else if (payload.eventType === 'DELETE') {
          setAllParts((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(unitsCh);
      supabase.removeChannel(partsCh);
    };
  }, [tenantId]);

  // ── Message team ──────────────────────────────────────────────────────────

  function openMsgModal(unit: CabinetUnit) {
    const parts = allParts.filter((p) => p.cabinet_unit_id === unit.id && p.flag_type);
    const firstFlag = parts[0];
    const preBody = firstFlag
      ? `Cabinet ${unit.cabinet_number || unit.unit_label} flagged — ${firstFlag.part_name}: ${(firstFlag.flag_type ?? '').replace('_', ' ')}. Please advise.`
      : `Cabinet ${unit.cabinet_number || unit.unit_label} needs attention. Please advise.`;
    setMsgUnitId(unit.id);
    setMsgBody(preBody);
    setMsgDept('Assembly');
  }

  // Message both depts that share a split cabinet.
  function openSplitMsgModal(parent: CabinetUnit, depts: string[]) {
    const baseLabel = parent.unit_label.replace(/ \((Craftsman|Box)\)$/i, '');
    setMsgUnitId(parent.id);
    setMsgBody(`${baseLabel} is split across ${depts.join(' and ')}. Please coordinate so all pieces finish together.`);
    setMsgDept('');
  }

  async function handleSendMsg() {
    if (!msgBody.trim() || msgSending || !msgUnitId) return;
    setMsgSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        sender_name: 'Supervisor',
        dept:        msgDept || null,
        body:        msgBody.trim(),
        tenant_id:   tenantId,
      });
      if (error) throw error;
      setMsgUnitId(null);
      showToast('Message sent');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Send failed', true);
    } finally {
      setMsgSending(false);
    }
  }

  // ── Computed data ──────────────────────────────────────────────────────────

  const unitParts = (unitId: string) => allParts.filter((p) => p.cabinet_unit_id === unitId);

  // Human label for a job_number, resolved from the jobs table (Client / Room path).
  const jobLabelFor = (jobNumber: string): string => {
    const j = (jobs ?? []).find((x) => x.job_number === jobNumber);
    if (j) {
      if (j.job_path && j.job_path.trim()) return j.job_path.split('/').map((s) => s.trim()).filter(Boolean).join(' / ');
      if (j.job_name && j.job_name.trim()) return j.job_name.trim();
    }
    return jobNumber === 'No Job' ? 'No Job' : `Job ${jobNumber}`;
  };

  // Cabinets sorted flagged-first (flagged float to the top of every room group), then newest.
  const sortCabs = (list: CabinetUnit[]) =>
    [...list].sort((a, b) => {
      if (a.status === 'flagged' && b.status !== 'flagged') return -1;
      if (b.status === 'flagged' && a.status !== 'flagged') return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  // Split-ticket children (split_from_id set) are nested under their parent, not
  // shown as standalone cabinets. Map parentId → child tickets.
  const childrenByParent: Record<string, CabinetUnit[]> = {};
  units.forEach((u) => {
    if (u.split_from_id) {
      if (!childrenByParent[u.split_from_id]) childrenByParent[u.split_from_id] = [];
      childrenByParent[u.split_from_id].push(u);
    }
  });

  // LEVEL 1 — group top-level units by job_number (null → "No Job"); children excluded.
  const byJob: Record<string, CabinetUnit[]> = {};
  units.forEach((u) => {
    if (u.split_from_id) return; // nested under its parent
    const k = u.job_number || 'No Job';
    if (!byJob[k]) byJob[k] = [];
    byJob[k].push(u);
  });
  // Jobs with any flagged cabinet float to the top, then alphabetical by label.
  const jobKeys = Object.keys(byJob).sort((a, b) => {
    const af = byJob[a].some((u) => u.status === 'flagged');
    const bf = byJob[b].some((u) => u.status === 'flagged');
    if (af !== bf) return af ? -1 : 1;
    return jobLabelFor(a).localeCompare(jobLabelFor(b));
  });

  // LEVEL 2 — within a job, group by room_number (null → "General").
  const roomsForJob = (jobUnits: CabinetUnit[]): [string, CabinetUnit[]][] => {
    const byRoom: Record<string, CabinetUnit[]> = {};
    jobUnits.forEach((u) => {
      const rk = u.room_number || 'General';
      if (!byRoom[rk]) byRoom[rk] = [];
      byRoom[rk].push(u);
    });
    return Object.keys(byRoom)
      .sort((a, b) => {
        const af = byRoom[a].some((u) => u.status === 'flagged');
        const bf = byRoom[b].some((u) => u.status === 'flagged');
        if (af !== bf) return af ? -1 : 1;
        if (a === 'General') return 1;
        if (b === 'General') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map((rk) => [rk, sortCabs(byRoom[rk])] as [string, CabinetUnit[]]);
  };

  const flaggedUnits = units.filter((u) => u.status === 'flagged');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`@keyframes flagPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* ── Migration needed banner ─────────────────────────────────────── */}
      {migrationNeeded && (
        <div style={{
          padding: '18px 20px', borderRadius: 12,
          background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.3)',
          display: 'flex', gap: 14, alignItems: 'flex-start',
        }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#FBBF24', marginBottom: 4 }}>
              Run assembly_tracking.sql to enable this feature
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
              The <code style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>cabinet_units</code> and{' '}
              <code style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: 4 }}>parts</code> tables
              do not exist yet. Open the Supabase SQL Editor and run{' '}
              <strong>supabase/assembly_tracking.sql</strong> from this repo.
            </div>
          </div>
        </div>
      )}

      {/* ── Flagged cabinets banner ─────────────────────────────────────── */}
      {!loading && flaggedUnits.length > 0 && (
        <div style={{ padding: '12px 18px', borderRadius: 12, background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.3)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F87171', flexShrink: 0, animation: 'flagPulse 1.5s ease-in-out infinite' }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>
            {flaggedUnits.length} cabinet{flaggedUnits.length !== 1 ? 's' : ''} flagged
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
            {flaggedUnits.slice(0, 4).map((u) => u.cabinet_number || u.unit_label).join(', ')}
            {flaggedUnits.length > 4 ? '…' : ''}
          </span>
        </div>
      )}

      {/* ── Drill-down: Jobs → Rooms → Cabinets → Parts ──────────────────── */}
      {loading ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading assembly data…</div>
      ) : units.length === 0 ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          No cabinet units yet. Upload a CSV cut list in the <strong style={{ color: 'var(--ink-dim)' }}>Plans</strong> tab to get started.
        </div>
      ) : (
        <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
          {jobKeys.map((jobKey, ji) => {
            const jobUnits   = byJob[jobKey];
            const jobOpen    = expandedJob === jobKey;
            const rooms      = roomsForJob(jobUnits);
            const jobFlagged = jobUnits.some((u) => u.status === 'flagged');
            return (
              <div key={jobKey} style={{ borderTop: ji > 0 ? '1px solid var(--line)' : 'none' }}>

                {/* LEVEL 1 — Job */}
                <button onClick={() => { setExpandedJob(jobOpen ? null : jobKey); setExpandedRoom(null); setExpandedCab(null); }} style={rowStyle(0, jobFlagged, false)}>
                  <IcoChevron open={jobOpen} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{jobLabelFor(jobKey)}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{jobUnits.length} unit{jobUnits.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>{statusSummary(jobUnits)}</div>
                    <ProgressBar value={groupProgress(jobUnits)} flagged={jobFlagged} />
                  </div>
                </button>

                {/* LEVEL 2 — Rooms */}
                {jobOpen && rooms.map(([roomKey, roomUnits]) => {
                  const roomId      = `${jobKey}::${roomKey}`;
                  const roomOpen    = expandedRoom === roomId;
                  const roomFlagged = roomUnits.some((u) => u.status === 'flagged');
                  return (
                    <div key={roomId}>
                      <button onClick={() => { setExpandedRoom(roomOpen ? null : roomId); setExpandedCab(null); }} style={rowStyle(16, roomFlagged, true)}>
                        <IcoChevron open={roomOpen} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{roomKey === 'General' ? 'General' : `Room ${roomKey}`}</span>
                            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{roomUnits.length} unit{roomUnits.length !== 1 ? 's' : ''}</span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>{statusSummary(roomUnits)}</div>
                          <ProgressBar value={groupProgress(roomUnits)} flagged={roomFlagged} />
                        </div>
                      </button>

                      {/* LEVEL 3 — Cabinets */}
                      {roomOpen && roomUnits.map((unit) => {
                        const parts        = unitParts(unit.id);
                        const total        = parts.length;
                        const cabOpen      = expandedCab === unit.id;
                        const isFlagged    = unit.status === 'flagged';
                        const flaggedParts = parts.filter((p) => p.flag_type);
                        const children     = childrenByParent[unit.id] ?? [];
                        const isSplit      = children.length > 0;

                        // ── Split parent: original (Craftsman) + child box ticket(s) ──
                        if (isSplit) {
                          const members      = [unit, ...children];
                          const allComplete  = members.every((m) => m.status === 'complete');
                          const memberDepts  = Array.from(new Set(members.map((m) => deptMeta(m.assigned_dept).label)));
                          const baseLabel    = unit.unit_label.replace(/ \((Craftsman|Box)\)$/i, '');
                          return (
                            <div key={unit.id} style={{ borderLeft: '3px solid #A78BFA' }}>
                              <button onClick={() => { setExpandedCab(cabOpen ? null : unit.id); setExpandedChild(null); }} style={rowStyle(32, false, true)}>
                                <IcoChevron open={cabOpen} />
                                <span style={{ color: '#A78BFA', display: 'flex', flexShrink: 0 }}>
                                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg>
                                </span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{unit.cabinet_number ? `${unit.cabinet_number} — ${baseLabel}` : baseLabel}</span>
                                  <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 10 }}>{members.length} tickets</span>
                                </div>
                                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '2px 7px', borderRadius: 20, color: '#A78BFA', background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(167,139,250,0.3)', flexShrink: 0 }}>SPLIT</span>
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, flexShrink: 0, color: allComplete ? '#34D399' : '#FBBF24', background: allComplete ? 'rgba(52,211,153,0.1)' : 'rgba(251,191,36,0.1)', border: `1px solid ${allComplete ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.3)'}` }}>
                                  {allComplete ? 'Complete' : 'Partial'}
                                </span>
                              </button>

                              {cabOpen && (
                                <div style={{ padding: '4px 20px 14px 51px', background: 'rgba(255,255,255,0.015)' }}>
                                  {members.map((m) => {
                                    const mParts    = unitParts(m.id);
                                    const dm        = deptMeta(m.assigned_dept);
                                    const msm       = statusMeta(m.status);
                                    const childOpen = expandedChild === m.id;
                                    return (
                                      <div key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <button onClick={() => setExpandedChild(childOpen ? null : m.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)' }}>
                                          <IcoChevron open={childOpen} size={13} />
                                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: dm.color, background: `${dm.color}22`, flexShrink: 0 }}>{dm.label}</span>
                                          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mParts.length} part{mParts.length !== 1 ? 's' : ''}</span>
                                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: msm.color, background: msm.bg, border: `1px solid ${msm.border}`, flexShrink: 0 }}>{msm.label}</span>
                                        </button>
                                        {childOpen && <div style={{ paddingLeft: 22, paddingBottom: 8 }}><PartsList parts={mParts} /></div>}
                                      </div>
                                    );
                                  })}
                                  <button onClick={() => openSplitMsgModal(unit, memberDepts)}
                                    style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                    Message Team
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        }

                        // ── Normal cabinet ──
                        const sm = statusMeta(unit.status);
                        return (
                          <div key={unit.id} style={{ borderLeft: isFlagged ? '3px solid #F87171' : '3px solid transparent' }}>
                            <button onClick={() => setExpandedCab(cabOpen ? null : unit.id)} style={rowStyle(32, isFlagged, true)}>
                              <IcoChevron open={cabOpen} />
                              {isFlagged && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#F87171', flexShrink: 0, animation: 'flagPulse 1.5s ease-in-out infinite' }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                                  {unit.cabinet_number ? `${unit.cabinet_number} — ${unit.unit_label}` : unit.unit_label}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 10 }}>{total} part{total !== 1 ? 's' : ''}</span>
                              </div>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: sm.color, background: sm.bg, border: `1px solid ${sm.border}`, flexShrink: 0 }}>
                                {sm.label}
                              </span>
                            </button>

                            {/* LEVEL 4 — Parts */}
                            {cabOpen && (
                              <div style={{ padding: '4px 20px 14px 51px', background: 'rgba(255,255,255,0.015)' }}>
                                <PartsList parts={parts} />

                                {/* Message Team for flagged cabinet */}
                                {isFlagged && (
                                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                                    {flaggedParts.length > 0 && (
                                      <div style={{ marginBottom: 10 }}>
                                        {flaggedParts.map((p) => (
                                          <div key={p.id} style={{ fontSize: 12, color: '#F87171', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                            <IcoFlag />
                                            {p.part_name}: {(p.flag_type ?? '').replace('_', ' ')}
                                            {p.flag_notes ? ` — ${p.flag_notes}` : ''}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    <button
                                      onClick={() => openMsgModal(unit)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#F87171', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                                    >
                                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                      </svg>
                                      Message Team
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Message Team Modal ────────────────────────────────────────────── */}
      {msgUnitId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setMsgUnitId(null); }}
        >
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 480, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Message Team</div>
              <button onClick={() => setMsgUnitId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Department</label>
              <select
                className="form-input"
                value={msgDept}
                onChange={(e) => setMsgDept(e.target.value)}
                style={{ width: '100%', cursor: 'pointer' }}
              >
                <option value="">All Departments</option>
                {deptOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Message</label>
              <textarea
                className="form-input"
                value={msgBody}
                onChange={(e) => setMsgBody(e.target.value)}
                rows={4}
                style={{ width: '100%', resize: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setMsgUnitId(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => { void handleSendMsg(); }}
                disabled={!msgBody.trim() || msgSending}
                style={{ flex: 2, justifyContent: 'center', opacity: (!msgBody.trim() || msgSending) ? 0.5 : 1 }}
              >
                {msgSending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
