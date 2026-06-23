'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_DEPARTMENTS } from '@/lib/auth';
import { deptDisplay } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import DeptCrewStrip from '../supervisor/DeptCrewStrip';

// ── QC Inspector view ─────────────────────────────────────────────────────────
// Rendered in the crew app when a QC delegate enters via /app/crew?qc=1. This is
// the supervisor QcTab list view (status IN ready_for_qc / pending_qc_check,
// grouped by job, with Pass/Fail + the per-part Fail modal) scoped for a QC
// delegate: there is no CabinetScanner, and PASS stamps qc_by with the
// delegate's name (qcName) rather than a supervisor session email.

type QcCabinet = {
  id: string;
  unit_label: string;
  cabinet_number: string | null;
  job_number: string | null;
  room_number: string | null;
  status: string;
  completed_by: string | null;
  qc_notes: string | null;
};
type QcPart = { id: string; part_name: string; assigned_dept: string | null; cabinet_unit_id: string; status: string | null };
type DeptEvent = { part_id: string; to_dept: string | null; created_at: string };

interface Props {
  tenantId: string;
  qcName: string;
  showToast: (msg: string, error?: boolean) => void;
  onExit: () => void;
  jobs?: { job_number: string; job_path?: string | null }[];
  departments?: string[];
}

function fmtHours(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

// Room folder label — matches FinishingView: null room_number → 'General'.
function roomLabel(roomNumber: string | null): string {
  if (!roomNumber) return 'General';
  return `Room ${roomNumber}`;
}

// Group a job's cabinets by room, named rooms first and 'General'/no-room last
// (same ordering convention as FinishingView.roomsForJob).
function roomsForCabs(cabs: QcCabinet[]): { roomNumber: string | null; cabs: QcCabinet[] }[] {
  const byRoom: Record<string, QcCabinet[]> = {};
  cabs.forEach((c) => { const rk = c.room_number ?? '__noroom__'; (byRoom[rk] ??= []).push(c); });
  return Object.entries(byRoom)
    .sort(([a], [b]) => {
      if (a === '__noroom__') return 1;
      if (b === '__noroom__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([rk, cs]) => ({ roomNumber: rk === '__noroom__' ? null : rk, cabs: cs }));
}

export default function QcInspectorView({ tenantId, qcName, showToast, onExit, jobs = [], departments }: Props) {
  const depts = departments && departments.length ? departments : DEFAULT_DEPARTMENTS;
  const [cabs, setCabs] = useState<QcCabinet[]>([]);
  const [partsByCab, setPartsByCab] = useState<Record<string, QcPart[]>>({});
  const [deptTime, setDeptTime] = useState<Record<string, Record<string, number>>>({});
  // job_number → job_path map for labels. Seeded from the prop, refreshed in load().
  const [jobMeta, setJobMeta] = useState<{ job_number: string; job_path?: string | null }[]>(jobs);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // FAIL modal.
  const [failCab, setFailCab] = useState<QcCabinet | null>(null);
  const [failDept, setFailDept] = useState(depts[0] ?? 'Production');
  const [failNotes, setFailNotes] = useState('');
  const [failBusy, setFailBusy] = useState(false);
  const [failSelectedParts, setFailSelectedParts] = useState<Record<string, boolean>>({});

  const jobLabel = useCallback((jobNumber: string | null) => {
    if (!jobNumber) return 'No Job';
    const j = jobMeta.find((x) => x.job_number === jobNumber);
    return (j?.job_path || `Job ${jobNumber}`).split('/').map((s) => s.trim()).join(' / ');
  }, [jobMeta]);

  const load = useCallback(async () => {
    try {
      const { data: cabRows } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, cabinet_number, job_number, room_number, status, completed_by, qc_notes')
        .eq('tenant_id', tenantId)
        // pending_qc_check = assembly marked it done, awaiting the crew's QC tap;
        // ready_for_qc = QC tapped, ready to act. Show both so cabinets appear the
        // moment assembly completes them.
        .in('status', ['ready_for_qc', 'pending_qc_check'])
        .order('completed_at', { ascending: true });
      const list = (cabRows as QcCabinet[] | null) ?? [];
      setCabs(list);

      const cabIds = list.map((c) => c.id);
      const pByCab: Record<string, QcPart[]> = {};
      const dTime: Record<string, Record<string, number>> = {};
      if (cabIds.length > 0) {
        const [{ data: pr }, { data: ev }] = await Promise.all([
          supabase.from('parts').select('id, part_name, assigned_dept, cabinet_unit_id, status').in('cabinet_unit_id', cabIds).eq('tenant_id', tenantId),
          supabase.from('part_dept_events').select('part_id, to_dept, created_at, cabinet_unit_id').in('cabinet_unit_id', cabIds).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
        ]);
        ((pr as QcPart[] | null) ?? []).forEach((p) => { (pByCab[p.cabinet_unit_id] ??= []).push(p); });

        // Time per dept = sum over each part of (next event − this event), credited
        // to the dept the part was in for that span.
        const evByCab: Record<string, Record<string, DeptEvent[]>> = {};
        ((ev as (DeptEvent & { cabinet_unit_id: string })[] | null) ?? []).forEach((e) => {
          ((evByCab[e.cabinet_unit_id] ??= {})[e.part_id] ??= []).push(e);
        });
        for (const cabId of cabIds) {
          const perDept: Record<string, number> = {};
          const byPart = evByCab[cabId] ?? {};
          for (const events of Object.values(byPart)) {
            for (let i = 0; i < events.length - 1; i++) {
              const span = new Date(events[i + 1].created_at).getTime() - new Date(events[i].created_at).getTime();
              const d = (events[i].to_dept || '').toLowerCase();
              if (d && span > 0) perDept[d] = (perDept[d] ?? 0) + span;
            }
          }
          dTime[cabId] = perDept;
        }
      }

      // Craftsman & Assembly: dwell time (arrival→departure) over-counts idle
      // queue-waiting as work. Overwrite those two depts with REAL active time
      // summed from time_clock (gated by a human Start/Pause/Resume). Production
      // and Finishing keep their dwell-time values untouched.
      if (cabIds.length > 0) {
        const { data: tcRows } = await supabase
          .from('time_clock')
          .select('cabinet_unit_id, status, total_hours, clock_in, clock_out')
          .in('cabinet_unit_id', cabIds)
          .in('status', ['craftsman_build', 'assembly_work']);
        const realMs: Record<string, Record<string, number>> = {};
        ((tcRows as { cabinet_unit_id: string | null; status: string | null; total_hours: number | null; clock_in: string; clock_out: string | null }[] | null) ?? []).forEach((row) => {
          if (!row.cabinet_unit_id) return;
          const dept = row.status === 'craftsman_build' ? 'craftsman' : 'assembly';
          // total_hours may be null on a still-open session (clock_out null) —
          // fall back to live elapsed so an in-progress build still shows time.
          const hours = row.total_hours ?? Math.max(0, (Date.now() - new Date(row.clock_in).getTime()) / 3600000);
          const ms = hours * 3600000;
          ((realMs[row.cabinet_unit_id] ??= {})[dept] = (realMs[row.cabinet_unit_id]?.[dept] ?? 0) + ms);
        });
        for (const cabId of Object.keys(realMs)) {
          for (const dept of Object.keys(realMs[cabId])) {
            (dTime[cabId] ??= {})[dept] = realMs[cabId][dept];
          }
        }
      }
      setPartsByCab(pByCab);
      setDeptTime(dTime);

      // Job labels — fetch job_path for the jobs in the queue (best-effort; the
      // column may not exist pre-migration). Delegate context has no jobs state.
      const jobNums = Array.from(new Set(list.map((c) => c.job_number).filter(Boolean))) as string[];
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase
            .from('jobs').select('job_number, job_path')
            .eq('tenant_id', tenantId).in('job_number', jobNums);
          const fetched = (jrows as { job_number: string; job_path: string | null }[] | null) ?? [];
          if (fetched.length > 0) setJobMeta(fetched);
        } catch { /* job_path column optional */ }
      }
    } catch { /* tables optional */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-qc-delegate')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  // PASS — complete the cabinet (and the job once every cabinet is done).
  async function pass(cab: QcCabinet) {
    if (busy) return;
    setBusy(cab.id);
    const now = new Date().toISOString();
    // Stamp who signed off QC — the delegate's name (no auth session here).
    const qcBy = qcName;
    try {
      await supabase.from('parts').update({ status: 'complete', assigned_dept: 'complete', qc_failed: false, qc_notes: null }).eq('cabinet_unit_id', cab.id).eq('tenant_id', tenantId);
      const { error } = await supabase.from('cabinet_units').update({ status: 'complete', assigned_dept: 'complete', completed_at: now, qc_notes: null, qc_by: qcBy, qc_at: now }).eq('id', cab.id).eq('tenant_id', tenantId);
      if (error) throw error;

      // Job rollup — if every cabinet in the job is complete, complete the job.
      if (cab.job_number) {
        const { data } = await supabase.from('cabinet_units').select('status').eq('tenant_id', tenantId).eq('job_number', cab.job_number);
        const rows = (data as { status: string | null }[] | null) ?? [];
        if (rows.length > 0 && rows.every((r) => (r.status || '').toLowerCase() === 'complete')) {
          try { await supabase.from('jobs').update({ status: 'complete' }).eq('tenant_id', tenantId).eq('job_number', cab.job_number); } catch { /* best-effort */ }
          try { await supabase.from('jobs').update({ completed_at: now }).eq('tenant_id', tenantId).eq('job_number', cab.job_number); } catch { /* column optional */ }
          sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Job complete', body: `Job ${jobLabel(cab.job_number)} passed QC and is complete`, url: '/app/supervisor' });
        }
      }
      setCabs((prev) => prev.filter((c) => c.id !== cab.id));
      showToast(`${cab.unit_label} passed QC`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not pass cabinet', true);
    } finally {
      setBusy(null);
    }
  }

  // OVERRIDE — manually push a legacy 'pending_qc_check' cabinet to ready_for_qc
  // without requiring a crew QC tap. New completions go straight to ready_for_qc;
  // this handles cabinets stranded in the old two-step flow.
  async function sendToQcOverride(cab: QcCabinet) {
    if (busy) return;
    setBusy(cab.id);
    try {
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc' })
        .eq('id', cab.id).eq('tenant_id', tenantId);
      if (error) throw error;
      try { await supabase.from('parts').update({ assigned_dept: 'qc' }).eq('cabinet_unit_id', cab.id).eq('tenant_id', tenantId).eq('assigned_dept', 'assembly'); } catch { /* best-effort */ }
      setCabs((prev) => prev.map((c) => c.id === cab.id ? { ...c, status: 'ready_for_qc' } : c));
      showToast(`${cab.unit_label} moved to QC`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not move cabinet to QC', true);
    } finally {
      setBusy(null);
    }
  }

  function openFail(cab: QcCabinet) {
    setFailCab(cab);
    setFailDept(depts[0] ?? 'Production');
    setFailNotes('');
    setFailSelectedParts({});
  }

  // FAIL — route the cabinet back to a chosen dept with required notes.
  async function submitFail() {
    if (!failCab || failBusy) return;
    if (!failNotes.trim()) { showToast('Notes are required', true); return; }
    setFailBusy(true);
    const destLower = failDept.toLowerCase();
    const allParts = partsByCab[failCab.id] ?? [];
    const selectedIds = Object.keys(failSelectedParts).filter((id) => failSelectedParts[id]);
    const isPartial = selectedIds.length > 0 && selectedIds.length < allParts.length;
    const partsToFail = isPartial ? allParts.filter((p) => selectedIds.includes(p.id)) : allParts;
    const partsToHold = isPartial ? allParts.filter((p) => !selectedIds.includes(p.id)) : [];
    try {
      if (partsToFail.length > 0) {
        const isGoingToProduction = destLower === 'production';
        await supabase.from('parts')
          .update({
            assigned_dept: destLower,
            status: 'pending',
            qc_notes: failNotes.trim(),
            qc_failed: true,
            // Reset cut state so rework parts appear as uncut in the production cut list
            ...(isGoingToProduction ? { checked: false, production_status: 'not_cut' } : {}),
          })
          .in('id', partsToFail.map((p) => p.id))
          .eq('tenant_id', tenantId);
      }
      if (partsToHold.length > 0) {
        await supabase.from('parts')
          .update({ assigned_dept: 'qc', status: 'qc_hold' })
          .in('id', partsToHold.map((p) => p.id))
          .eq('tenant_id', tenantId);
      }
      if (isPartial) {
        const { error } = await supabase.from('cabinet_units')
          .update({ qc_notes: failNotes.trim(), assigned_dept: 'qc' })
          .eq('id', failCab.id).eq('tenant_id', tenantId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('cabinet_units')
          .update({ status: 'in_progress', assigned_dept: destLower, qc_notes: failNotes.trim() })
          .eq('id', failCab.id).eq('tenant_id', tenantId);
        if (error) throw error;
      }
      try {
        if (partsToFail.length > 0) {
          await supabase.from('part_dept_events').insert(partsToFail.map((p) => ({
            tenant_id: tenantId, part_id: p.id, cabinet_unit_id: failCab!.id,
            job_number: failCab!.job_number, from_dept: 'qc', to_dept: destLower, worker_name: 'Supervisor',
          })));
        }
      } catch { /* best-effort */ }
      sendNotify({
        tenant_id: tenantId, target: 'crew', dept_target: deptDisplay(destLower),
        title: `QC kickback to ${deptDisplay(destLower)}`,
        body: `${failCab.unit_label}${failCab.job_number ? ` — ${jobLabel(failCab.job_number)}` : ''}: ${failNotes.trim()}`,
        url: '/app/crew',
      });
      if (!isPartial) {
        setCabs((prev) => prev.filter((c) => c.id !== failCab!.id));
        showToast(`${failCab.unit_label} sent back to ${failDept}`);
      } else {
        showToast(`${selectedIds.length} part${selectedIds.length === 1 ? '' : 's'} sent back to ${failDept}`);
        void load();
      }
      setFailCab(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not fail cabinet', true);
    } finally {
      setFailBusy(false);
    }
  }

  // Group cabinets by job.
  const groups: Record<string, QcCabinet[]> = {};
  cabs.forEach((c) => { (groups[c.job_number ?? '__nojob__'] ??= []).push(c); });
  const jobKeys = Object.keys(groups).sort((a, b) => jobLabel(a === '__nojob__' ? null : a).localeCompare(jobLabel(b === '__nojob__' ? null : b)));

  const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'rgba(5,6,8,0.92)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
        <span style={{ color: 'var(--teal)', display: 'flex' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>QC Inspector</div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qcName}</div>
        </div>
        <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', padding: '6px 10px' }}>
          Exit
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px', maxWidth: 640, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 16 }}>
          <DeptCrewStrip tenantId={tenantId} dept="QC" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Quality Control</div>
          {cabs.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(45,225,201,0.14)', color: 'var(--teal)' }}>{cabs.length} waiting</span>}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading QC queue…</div>
        ) : cabs.length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--ink-mute)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nothing waiting for QC</div>
            <div style={{ fontSize: 12.5 }}>Cabinets crew send to QC will appear here.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {jobKeys.map((jk) => (
              <div key={jk}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)', marginBottom: 10 }}>{jobLabel(jk === '__nojob__' ? null : jk)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {roomsForCabs(groups[jk]).map((room) => (
                    <div key={room.roomNumber ?? '__noroom__'}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-mute)', marginBottom: 8, paddingLeft: 2 }}>{roomLabel(room.roomNumber)}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {room.cabs.map((cab) => {
                    const parts = partsByCab[cab.id] ?? [];
                    const times = deptTime[cab.id] ?? {};
                    const isBusy = busy === cab.id;
                    return (
                      <div key={cab.id} style={card}>
                        {cab.qc_notes && (
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)', marginBottom: 12 }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                            <span style={{ fontSize: 13, color: '#F87171', lineHeight: 1.5 }}>{cab.qc_notes}</span>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{cab.unit_label}</span>
                          {(() => {
                            const ready = (cab.status || '').toLowerCase() === 'ready_for_qc';
                            return (
                              <>
                                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: ready ? 'rgba(45,225,201,0.14)' : 'rgba(251,191,36,0.14)', color: ready ? 'var(--teal)' : '#FBBF24' }}>
                                  {ready ? 'Ready for QC' : 'Awaiting QC tap'}
                                </span>
                                {!ready && (
                                  <button onClick={() => void sendToQcOverride(cab)} disabled={isBusy}
                                    title="Move this cabinet to QC without a crew tap"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(45,225,201,0.1)', border: '1px solid rgba(45,225,201,0.35)', color: 'var(--teal)', cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                    Send to QC
                                  </button>
                                )}
                              </>
                            );
                          })()}
                          <ViewDrawingsButton tenantId={tenantId} jobNumber={cab.job_number} cabinetKey={cab.cabinet_number || cab.unit_label || ''} compact />
                          {cab.completed_by && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>Completed by {cab.completed_by}</span>}
                        </div>

                        {/* Parts + final dept */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                          {parts.map((p) => {
                            const isHeld = (p.status || '') === 'qc_hold';
                            return (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: isHeld ? 0.5 : 1 }}>
                                <span style={{ flex: 1, minWidth: 0, color: isHeld ? 'var(--ink-mute)' : 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</span>
                                {isHeld
                                  ? <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(139,165,160,0.15)', color: '#8BA5A0', flexShrink: 0 }}>Held</span>
                                  : <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{deptDisplay(p.assigned_dept || '')}</span>
                                }
                              </div>
                            );
                          })}
                        </div>

                        {/* Time in each dept */}
                        {Object.keys(times).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                            {Object.entries(times).map(([d, ms]) => (
                              <span key={d} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: 'var(--bg-2, #11151a)', color: 'var(--ink-mute)' }}>
                                {deptDisplay(d)} · {fmtHours(ms)}
                              </span>
                            ))}
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: 8 }}>
                          <button onClick={() => void pass(cab)} disabled={isBusy}
                            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: isBusy ? 'wait' : 'pointer' }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            {isBusy ? 'Saving…' : 'Pass'}
                          </button>
                          <button onClick={() => openFail(cab)} disabled={isBusy}
                            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#F87171', cursor: isBusy ? 'wait' : 'pointer' }}>
                            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            Fail
                          </button>
                        </div>
                      </div>
                    );
                  })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* FAIL modal */}
      {failCab && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget && !failBusy) setFailCab(null); }}>
          <div style={{ background: '#0a0d10', borderRadius: 16, border: '1px solid var(--line-strong)', padding: 28, width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 16, maxHeight: '85vh', overflowY: 'auto' }}>
            <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: 17, fontWeight: 700 }}>Fail — {failCab.unit_label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 2 }}>
                Select parts to rework (leave all unchecked to fail the entire cabinet):
              </div>
              {(partsByCab[failCab.id] ?? []).map((p) => {
                const selected = !!failSelectedParts[p.id];
                return (
                  <button key={p.id} onClick={() => setFailSelectedParts((s) => ({ ...s, [p.id]: !s[p.id] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: selected ? 'rgba(248,113,113,0.08)' : 'var(--bg-1)', border: `1px solid ${selected ? 'rgba(248,113,113,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, border: `1px solid ${selected ? '#F87171' : 'var(--line-strong)'}`, background: selected ? 'rgba(248,113,113,0.25)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {selected && <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </span>
                    <span style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0 }}>{deptDisplay(p.assigned_dept || '')}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Send back to</label>
              <select value={failDept} onChange={(e) => setFailDept(e.target.value)}
                style={{ background: 'var(--bg-1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit' }}>
                {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Notes <span style={{ color: '#F87171' }}>*</span></label>
              <textarea rows={3} value={failNotes} onChange={(e) => setFailNotes(e.target.value)} placeholder="What needs to be fixed…"
                style={{ background: 'var(--bg-1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setFailCab(null)} disabled={failBusy}
                style={{ background: 'var(--bg-1)', color: 'var(--ink-mute)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => void submitFail()} disabled={failBusy || !failNotes.trim()}
                style={{ background: failBusy || !failNotes.trim() ? 'rgba(248,113,113,0.4)' : '#F87171', color: '#1a0606', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: failBusy || !failNotes.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {failBusy ? 'Sending…' : (() => {
                  const n = Object.values(failSelectedParts).filter(Boolean).length;
                  return n > 0 ? `Fail ${n} Part${n === 1 ? '' : 's'}` : 'Fail Entire Cabinet';
                })()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
