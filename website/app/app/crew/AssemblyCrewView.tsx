'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';
import {
  getWorkerProject, upsertActiveProject, startProjectSession, pauseWorkerProject,
  clearProject, fmtAccumulated, type ActiveProject,
} from '@/lib/activeProject';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// The Assembly department's home view. Parts pushed to assembly, grouped by
// job -> cabinet (folder accordion). Each cabinet has START and MARK COMPLETE.
//
// START logs a clock_in to time_clock (dept = Assembly) — multiple crew can have
// a build running on different cabinets at once, each its own row. MARK COMPLETE
// stops that timer (clock_out + total_hours), records who finished it, and flips
// the cabinet to 'pending_qc_check' — it does NOT send anything to QC on its own.
//
// A per-cabinet QC button only appears once the WHOLE job is assembled (every
// cabinet marked complete and no parts left upstream). Tapping QC flips the
// cabinet to ready_for_qc; when every cabinet in the job is ready, the supervisor
// gets a single "Job ready for QC" notification.

type AsmPart = {
  id: string;
  part_name: string;
  cabinet_unit_id: string;
  job_number: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  assigned_dept: string | null;
  status: string | null;
};

type CabInfo = { label: string; key: string; status: string | null; completedBy: string | null };
// One running assembly build on this device, keyed by cabinet id.
type ActiveBuild = { timeClockId: string; start: string };

interface Props {
  tenantId: string;
  crewName?: string;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
}

const BUILDS_KEY = 'assembly_active_builds';
// Cabinet has been marked complete (or beyond) — START/COMPLETE are done.
const DONE_CAB_STATUSES = ['pending_qc_check', 'ready_for_qc', 'complete'];

function dimText(p: AsmPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}
function partDisplay(p: AsmPart): string {
  const bits = [p.part_name];
  const d = dimText(p);
  if (d) bits.push(d);
  if (p.material) bits.push(p.material);
  return bits.join(' — ');
}
export default function AssemblyCrewView({ tenantId, crewName = '', showToast, isClockedIn = true, onRequireClock }: Props) {
  const [parts, setParts] = useState<AsmPart[]>([]);
  const [cabInfo, setCabInfo] = useState<Record<string, CabInfo>>({});
  // Cabinets to show per job, sourced from cabinet_units (every cabinet still in
  // the assembly workflow — pending / in_assembly / pending_qc_check) so a
  // cabinet marked complete stays visible with its QC button.
  const [cabsByJob, setCabsByJob] = useState<Record<string, string[]>>({});
  // jobAssembled[jobNumber] = every cabinet in the job is marked complete and no
  // part is still upstream — the gate for showing the QC button.
  const [jobAssembled, setJobAssembled] = useState<Record<string, boolean>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [busyCab, setBusyCab] = useState<string | null>(null);
  // Running builds on this device (cabinet id -> build). Persisted so a reload
  // does not lose the timer.
  const [builds, setBuilds] = useState<Record<string, ActiveBuild>>({});
  // The worker's single paused project (one per user, across the whole app).
  const [pausedProject, setPausedProject] = useState<ActiveProject | null>(null);
  const buildsRef = useRef<Record<string, ActiveBuild>>({});
  useEffect(() => { buildsRef.current = builds; }, [builds]);
  const [, setTick] = useState(0);

  useEffect(() => {
    try { const r = localStorage.getItem(BUILDS_KEY); if (r) setBuilds(JSON.parse(r) as Record<string, ActiveBuild>); } catch { /* ignore */ }
  }, []);
  const persistBuilds = useCallback((next: Record<string, ActiveBuild>) => {
    setBuilds(next);
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  // Live tick while any build runs.
  useEffect(() => {
    if (Object.keys(builds).length === 0) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [builds]);

  const load = useCallback(async () => {
    try {
      // Active jobs only — completed jobs disappear from every crew view.
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, material, width, height, depth, assigned_dept, status')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'assembly')
        .neq('status', 'complete')
        .limit(600);
      let asm = (partRows as AsmPart[] | null) ?? [];
      if (activeJobNums) asm = asm.filter((p) => !p.job_number || activeJobNums!.has(p.job_number));
      setParts(asm);

      const cabIds = Array.from(new Set(asm.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const jobNums = Array.from(new Set(asm.map((p) => p.job_number).filter(Boolean))) as string[];
      const info: Record<string, CabInfo> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number, status, completed_by').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null; status: string | null; completed_by: string | null }[] | null) ?? []).forEach((c) => {
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '', status: c.status, completedBy: c.completed_by };
        });
      }

      // QC gate: per job, every cabinet must be marked complete and no part may
      // remain in an upstream working dept (production/craftsman/finishing).
      const assembled: Record<string, boolean> = {};
      // Cabinets to render per job — every cabinet still in the assembly workflow
      // (pending / in_assembly / pending_qc_check), regardless of their parts'
      // status, so a cabinet marked complete stays visible for its QC button.
      const visibleCabs: Record<string, string[]> = {};
      const WORKFLOW_CAB_STATUSES = ['pending', 'in_assembly', 'pending_qc_check'];
      if (jobNums.length > 0) {
        const [{ data: jobParts }, { data: jobCabs }] = await Promise.all([
          supabase.from('parts').select('assigned_dept, status, job_number').eq('tenant_id', tenantId).in('job_number', jobNums),
          supabase.from('cabinet_units').select('id, unit_label, cabinet_number, status, completed_by, job_number').eq('tenant_id', tenantId).in('job_number', jobNums),
        ]);
        const partsByJob: Record<string, { assigned_dept: string | null; status: string | null }[]> = {};
        ((jobParts as { assigned_dept: string | null; status: string | null; job_number: string | null }[] | null) ?? []).forEach((p) => {
          if (p.job_number) (partsByJob[p.job_number] ??= []).push(p);
        });
        type CabRow = { id: string; unit_label: string | null; cabinet_number: string | null; status: string | null; completed_by: string | null; job_number: string | null };
        const cabRowsByJob: Record<string, CabRow[]> = {};
        ((jobCabs as CabRow[] | null) ?? []).forEach((c) => {
          if (c.job_number) (cabRowsByJob[c.job_number] ??= []).push(c);
          // Enrich cabInfo with the full cabinet row (status + completedBy).
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '', status: c.status, completedBy: c.completed_by };
        });
        for (const jn of jobNums) {
          const ps = partsByJob[jn] ?? [];
          const cs = cabRowsByJob[jn] ?? [];
          const noneUpstream = ps.length > 0 && ps.every((p) => {
            const d = (p.assigned_dept || 'production').toLowerCase();
            return p.status === 'complete' || (d !== 'production' && d !== 'craftsman' && d !== 'finishing');
          });
          const allCabsDone = cs.length > 0 && cs.every((c) => DONE_CAB_STATUSES.includes((c.status || '').toLowerCase()));
          assembled[jn] = noneUpstream && allCabsDone;
          visibleCabs[jn] = cs.filter((c) => WORKFLOW_CAB_STATUSES.includes((c.status || '').toLowerCase())).map((c) => c.id);
        }
      }
      setCabInfo(info);
      setCabsByJob(visibleCabs);
      setJobAssembled(assembled);

      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { map[j.job_number] = j.job_path || `Job ${j.job_number}`; });
          setJobPaths(map);
        } catch { /* best-effort */ }
      }

      // The worker's single project — paused badge, or an active project this
      // device doesn't know about yet (resumed from the clock-in prompt elsewhere).
      const proj = await getWorkerProject(tenantId, crewName);
      setPausedProject(proj && proj.status === 'paused' && proj.dept === 'assembly' ? proj : null);
      if (proj && proj.status === 'active' && proj.dept === 'assembly' && proj.time_clock_id && !buildsRef.current[proj.cabinet_unit_id]) {
        persistBuilds({ ...buildsRef.current, [proj.cabinet_unit_id]: { timeClockId: proj.time_clock_id, start: proj.session_start ?? new Date().toISOString() } });
      }
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId, crewName, persistBuilds]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-assembly-crew')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  const jobLabel = (jobNumber: string | null) =>
    jobNumber ? (jobPaths[jobNumber] ? jobPaths[jobNumber].split('/').map((s) => s.trim()).join(' / ') : `Job ${jobNumber}`) : 'No Job';

  const jobOptions = useMemo(() => {
    const set = new Map<string, string>();
    parts.forEach((p) => { const jn = p.job_number ?? '__nojob__'; if (!set.has(jn)) set.set(jn, jobLabel(p.job_number)); });
    return Array.from(set.entries()).map(([jobNumber, label]) => ({ jobNumber, label })).sort((a, b) => a.label.localeCompare(b.label));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, jobPaths]);

  useEffect(() => {
    if (!selectedJob) return;
    if (!jobOptions.some((j) => j.jobNumber === selectedJob)) setSelectedJob('');
  }, [jobOptions, selectedJob]);

  const cabinetsForJob = (jobNumber: string) => {
    const groups: Record<string, AsmPart[]> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      (groups[p.cabinet_unit_id] ??= []).push(p);
    });
    // Union every cabinet still in the assembly workflow (from cabinet_units) with
    // any cabinet that still has assembly parts — so a completed cabinet awaiting
    // QC remains on screen even once its parts have moved on.
    const ids = Array.from(new Set([...(cabsByJob[jobNumber] ?? []), ...Object.keys(groups)]));
    return ids.map((cabinetId) => ({ cabinetId, parts: groups[cabinetId] ?? [] }));
  };

  // START — open a clock_in row for this cabinet's build. Manual; multiple
  // cabinets can run at once on different rows.
  async function startBuild(cabinetId: string, jobNumber: string | null, label: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (builds[cabinetId]) return;
    // One project per user — a paused project must be resumed before starting new work.
    if (pausedProject) { showToast('Resume your paused project first', true); return; }
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || 'Assembly', dept: 'Assembly',
        clock_in: now, date: now.split('T')[0], status: 'assembly_work',
        notes: `Assembly: ${label}`, job_number: jobNumber,
      }).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      persistBuilds({ ...builds, [cabinetId]: { timeClockId: id, start: now } });
      // Track as the worker's active project (one per user, follows them).
      void upsertActiveProject({
        tenantId, workerName: crewName, dept: 'assembly', cabinetUnitId: cabinetId,
        unitLabel: label, jobNumber, timeClockId: id, sessionStart: now, accumulatedSeconds: 0,
      });
      try { await supabase.from('cabinet_units').update({ assembly_started_at: now }).eq('id', cabinetId).eq('tenant_id', tenantId).is('assembly_started_at', null); } catch { /* best-effort */ }
      showToast('Build started');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start build', true);
    }
  }

  // PAUSE — close the live session (logging its hours), fold into accumulated, and
  // drop back to the queue with a Paused badge. One project per user.
  async function pauseBuild(cabinetId: string, label: string) {
    const b = builds[cabinetId];
    if (b) { const next = { ...builds }; delete next[cabinetId]; persistBuilds(next); }
    const res = await pauseWorkerProject(tenantId, crewName);
    if (res) showToast(`${label} paused — ${fmtAccumulated(res.accumulated)} logged`);
    void load();
  }

  // RESUME — open a fresh session for the paused cabinet.
  async function resumeFromQueue(proj: ActiveProject) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    const { timeClockId: id, sessionStart } = await startProjectSession({
      tenantId, workerName: crewName, dept: 'assembly', cabinetUnitId: proj.cabinet_unit_id,
      unitLabel: proj.unit_label, jobNumber: proj.job_number, accumulatedSeconds: proj.accumulated_seconds ?? 0,
    });
    if (id) persistBuilds({ ...builds, [proj.cabinet_unit_id]: { timeClockId: id, start: sessionStart } });
    setPausedProject(null);
    showToast(`${proj.unit_label} resumed`);
  }

  // MARK COMPLETE — stop this cabinet's timer, record who finished it, and flip
  // the cabinet to pending_qc_check. Never triggers QC on its own.
  async function markComplete(cabinetId: string, label: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (busyCab) return;
    setBusyCab(cabinetId);
    const now = new Date().toISOString();
    try {
      const b = builds[cabinetId];
      if (b) {
        const totalHours = Math.max(0, (Date.now() - new Date(b.start).getTime()) / 3600000);
        try {
          await supabase.from('time_clock').update({ clock_out: now, total_hours: Math.round(totalHours * 100) / 100 }).eq('id', b.timeClockId);
        } catch { /* best-effort */ }
        const next = { ...builds }; delete next[cabinetId]; persistBuilds(next);
      }
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'pending_qc_check', completed_by: crewName || 'Assembly' })
        .eq('id', cabinetId).eq('tenant_id', tenantId);
      if (error) throw error;
      // Assembly work for this cabinet is done — clear it as the active project,
      // but only if THIS cabinet is the one being tracked (one project per user).
      if (pausedProject?.cabinet_unit_id === cabinetId) setPausedProject(null);
      try {
        const proj = await getWorkerProject(tenantId, crewName);
        if (proj && proj.cabinet_unit_id === cabinetId) await clearProject(tenantId, crewName);
      } catch { /* best-effort */ }
      showToast(`${label} marked complete`);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete cabinet', true);
    } finally {
      setBusyCab(null);
    }
  }

  // QC — send this cabinet to the supervisor's QC gate. Only callable once the
  // whole job is assembled. Fires the job notification once every cabinet is in.
  async function sendToQc(cabinetId: string, jobNumber: string | null, label: string) {
    if (busyCab) return;
    setBusyCab(cabinetId);
    try {
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc' })
        .eq('id', cabinetId).eq('tenant_id', tenantId);
      if (error) throw error;
      // Move this cabinet's parts out of assembly so the QC tab shows their final dept.
      try { await supabase.from('parts').update({ assigned_dept: 'qc' }).eq('cabinet_unit_id', cabinetId).eq('tenant_id', tenantId).eq('assigned_dept', 'assembly'); } catch { /* best-effort */ }

      // If every cabinet in the job is now ready_for_qc / complete, notify once.
      if (jobNumber) {
        try {
          const { data } = await supabase.from('cabinet_units').select('status').eq('tenant_id', tenantId).eq('job_number', jobNumber);
          const rows = (data as { status: string | null }[] | null) ?? [];
          const allReady = rows.length > 0 && rows.every((r) => ['ready_for_qc', 'complete'].includes((r.status || '').toLowerCase()));
          if (allReady) {
            const body = `Job ${jobLabel(jobNumber)} is ready for QC`;
            sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Job ready for QC', body, url: '/app/supervisor' });
            try { await supabase.from('notifications').insert({ tenant_id: tenantId, target_type: 'supervisor', title: 'Job ready for QC', body, url: '/app/supervisor' }); } catch { /* bell best-effort */ }
          }
        } catch { /* best-effort */ }
      }
      setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cabinetId));
      showToast(`${label} sent to QC`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send to QC', true);
    } finally {
      setBusyCab(null);
    }
  }

  const btnBase: React.CSSProperties = {
    flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7,
    padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  };

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Assembly</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading assembly queue…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>Nothing to assemble yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Parts pushed to Assembly will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobOptions.map((j) => {
            const open = selectedJob === j.jobNumber;
            const cabs = open ? cabinetsForJob(j.jobNumber) : [];
            const count = parts.filter((p) => (p.job_number ?? '__nojob__') === j.jobNumber).length;
            const canQc = !!jobAssembled[j.jobNumber];
            return (
              <div key={j.jobNumber} style={{ borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <button onClick={() => setSelectedJob(open ? '' : j.jobNumber)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.label}</span>
                  {canQc && <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: 'rgba(45,225,201,0.14)', color: 'var(--teal)' }}>Ready for QC</span>}
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{count} part{count === 1 ? '' : 's'}</span>
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
                    {cabs.map((c) => {
                      const info = cabInfo[c.cabinetId] ?? { label: 'Cabinet', key: '', status: null, completedBy: null };
                      const busy = busyCab === c.cabinetId;
                      const jobNumber = c.parts[0]?.job_number ?? (j.jobNumber === '__nojob__' ? null : j.jobNumber);
                      const build = builds[c.cabinetId];
                      const isComplete = DONE_CAB_STATUSES.includes((info.status || '').toLowerCase());
                      const paused = pausedProject?.cabinet_unit_id === c.cabinetId ? pausedProject : null;
                      const blockedByPaused = !!pausedProject && !paused;
                      return (
                        <div key={c.cabinetId} style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: `1px solid ${build ? 'rgba(45,225,201,0.4)' : 'var(--line)'}` }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</span>
                            {/* Active-build indicator — pulsing dot only. The crew
                                never sees a clock; the elapsed time is logged to
                                time_clock and shown only to the supervisor. */}
                            {build && (
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block', animation: 'asmPulse 1.4s ease-in-out infinite' }} />
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-mute)' }}>{c.parts.length} part{c.parts.length === 1 ? '' : 's'}</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                            {c.parts.map((p) => (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partDisplay(p)}</span>
                                <ViewDrawingsButton tenantId={tenantId} jobNumber={p.job_number} cabinetKey={info.key} compact />
                              </div>
                            ))}
                          </div>

                          {/* A complete cabinet shows no Start/Complete — only its
                              status and (once the whole job is assembled) the QC
                              button. An in-progress cabinet shows Start + Complete. */}
                          {isComplete ? (
                            <>
                              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 10 }}>
                                {info.completedBy ? `Completed by ${info.completedBy}` : 'Completed'}
                              </div>
                              {(info.status || '').toLowerCase() === 'ready_for_qc' ? (
                                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--teal)' }}>Sent to QC</div>
                              ) : canQc ? (
                                <button
                                  onClick={() => void sendToQc(c.cabinetId, jobNumber, info.label)}
                                  disabled={busy}
                                  style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: busy ? 'wait' : 'pointer' }}
                                >
                                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                                  {busy ? 'Sending…' : 'Send to QC'}
                                </button>
                              ) : (
                                <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>Waiting for the rest of the job to finish assembly</div>
                              )}
                            </>
                          ) : paused ? (
                            <>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>Paused</span>
                                <span style={{ fontSize: 12.5, color: '#FBBF24' }}>{fmtAccumulated(paused.accumulated_seconds ?? 0)} logged</span>
                              </div>
                              <button
                                onClick={() => void resumeFromQueue(paused)}
                                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                                Resume
                              </button>
                            </>
                          ) : (
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => void startBuild(c.cabinetId, jobNumber, info.label)}
                                disabled={!!build || blockedByPaused}
                                title={blockedByPaused ? 'Resume your paused project first' : undefined}
                                style={{ ...btnBase,
                                  background: (build || blockedByPaused) ? 'var(--bg-1)' : 'rgba(96,165,250,0.14)',
                                  border: `1px solid ${(build || blockedByPaused) ? 'var(--line)' : 'rgba(96,165,250,0.4)'}`,
                                  color: (build || blockedByPaused) ? 'var(--ink-mute)' : '#60A5FA',
                                  cursor: (build || blockedByPaused) ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                Start
                              </button>
                              {build && (
                                <button
                                  onClick={() => void pauseBuild(c.cabinetId, info.label)}
                                  title="Pause this build"
                                  style={{ ...btnBase, flex: '0 0 auto', padding: '11px 16px',
                                    background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24', cursor: 'pointer' }}
                                >
                                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
                                  Pause
                                </button>
                              )}
                              <button
                                onClick={() => void markComplete(c.cabinetId, info.label)}
                                disabled={busy}
                                style={{ ...btnBase,
                                  background: 'rgba(45,225,201,0.14)',
                                  border: '1px solid rgba(45,225,201,0.4)',
                                  color: 'var(--teal)',
                                  cursor: busy ? 'wait' : 'pointer',
                                }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                {busy ? 'Saving…' : 'Mark Complete'}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{`@keyframes asmPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
    </div>
  );
}
