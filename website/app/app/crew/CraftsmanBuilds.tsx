'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { pushPart, deptDisplay, PART_DEPTS, recomputeCabinet } from '@/lib/partActions';
import {
  getWorkerProject, upsertActiveProject, startProjectSession, pauseWorkerProject,
  clearProject, fmtAccumulated, type ActiveProject,
} from '@/lib/activeProject';
import PushPicker, { type AiMode } from '@/components/PushPicker';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// ── Craftsman builds (crew view) ──────────────────────────────────────────────
// Shows parts pushed to the Craftsman dept (parts.assigned_dept = 'craftsman'),
// grouped by job -> cabinet. Tapping a cabinet opens a FULL-SCREEN work order.
//
// THE TIMER IS ALWAYS MANUAL. Nothing starts a timer on mount, on open, or on
// render. A build only starts when the craftsman taps START BUILD on the open
// cabinet, and only ONE build runs at a time per device. After MIN_PUSH_SECONDS
// the PUSH TO button appears; tapping it freezes the timer, the craftsman picks
// which parts to send and where, and the elapsed time is logged once to
// time_clock so the Reports tab sees the hours.

type CPart = {
  id: string;
  cabinet_unit_id: string;
  job_number: string | null;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  assigned_dept: string | null;
  flag_type: string | null;
  flag_notes: string | null;
};

type CabInfo = { label: string; key: string };
// timeClockId is the live time_clock row opened on START so the supervisor sees
// the build running in real time; null until that insert lands. start is the REAL
// session start (used to log only this session's hours); accumulatedSeconds folds
// in time from earlier paused sessions so the crew display shows the TOTAL.
type ActiveBuild = { unitId: string; start: string; stop: string | null; timeClockId: string | null; accumulatedSeconds: number };

interface Props {
  tenantId: string;
  crewName: string;
  timeClockId: string | null;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
  aiMode?: AiMode;
  // Reports the active build up to the crew home so it can show a "build running"
  // banner while the full-screen work order is collapsed. null = nothing running.
  onActiveBuild?: (info: { label: string; job: string | null } | null) => void;
  // Parent bumps this counter (via the banner "Return" button) to re-open the
  // active build's full-screen work order.
  reopenSignal?: number;
}

const BUILD_KEY = 'craftsman_active_build';
const MIN_PUSH_SECONDS = 2;

function dimLabel(p: CPart): string {
  const parts: string[] = [];
  if (p.width != null)  parts.push(`${p.width}"`);
  if (p.height != null) parts.push(`${p.height}"`);
  if (p.depth != null)  parts.push(`${p.depth}"`);
  return parts.join(' x ');
}
function flagLabel(flagType: string | null): string {
  if (!flagType) return '';
  const s = flagType.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function elapsedSeconds(startISO: string, endISO?: string | null): number {
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(startISO).getTime()) / 1000));
}

const IcoCraft = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

export default function CraftsmanBuilds({ tenantId, crewName, timeClockId, showToast, isClockedIn = true, onRequireClock, aiMode = 'learn', onActiveBuild, reopenSignal }: Props) {
  const [parts, setParts] = useState<CPart[]>([]);
  const [cabInfo, setCabInfo] = useState<Record<string, CabInfo>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  // Full-screen open cabinet.
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);
  // The one active build on this device (null = nothing running).
  const [build, setBuild] = useState<ActiveBuild | null>(null);
  const buildRef = useRef<ActiveBuild | null>(null);
  // The worker's paused project (one per user, across the whole app), if any.
  const [pausedProject, setPausedProject] = useState<ActiveProject | null>(null);
  // Which parts are selected for the push (all default).
  const [pushSel, setPushSel] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0);
  // Queue-level multi-select: pick whole cabinets and push them all at once.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedCabs, setSelectedCabs] = useState<Set<string>>(new Set());
  // Undo toast — reverse the last push within 8s.
  const [undoState, setUndoState] = useState<{
    label: string;
    toDept: string;
    fromDept: string;
    parts: { partId: string; cabinetUnitId: string; partName: string; jobNumber: string | null }[];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, cabinet_unit_id, job_number, part_name, material, width, height, depth, quantity, assigned_dept, flag_type, flag_notes')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'craftsman')
        .neq('status', 'complete')
        .limit(600);
      let cps = (partRows as CPart[] | null) ?? [];
      if (activeJobNums) cps = cps.filter((p) => !p.job_number || activeJobNums!.has(p.job_number));
      setParts(cps);

      const cabIds = Array.from(new Set(cps.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const info: Record<string, CabInfo> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase.from('cabinet_units').select('id, unit_label, cabinet_number').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null }[] | null) ?? []).forEach((c) => {
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '' };
        });
      }
      setCabInfo(info);

      const jobNums = Array.from(new Set(cps.map((p) => p.job_number).filter(Boolean))) as string[];
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { map[j.job_number] = j.job_path || `Job ${j.job_number}`; });
          setJobPaths(map);
        } catch { /* best-effort */ }
      }

      // The worker's single project (paused badge / cross-device active build).
      const proj = await getWorkerProject(tenantId, crewName);
      setPausedProject(proj && proj.status === 'paused' && proj.dept === 'craftsman' ? proj : null);
      // Adopt an active craftsman project this device doesn't yet know about (e.g.
      // resumed from the clock-in prompt elsewhere) so the build view reflects it.
      if (proj && proj.status === 'active' && proj.dept === 'craftsman' && !buildRef.current) {
        const adopted: ActiveBuild = {
          unitId: proj.cabinet_unit_id, start: proj.session_start ?? new Date().toISOString(),
          stop: null, timeClockId: proj.time_clock_id, accumulatedSeconds: proj.accumulated_seconds ?? 0,
        };
        persistBuild(adopted);
        setOpenUnitId(proj.cabinet_unit_id);
      }
    } catch { /* leave existing state */ }
    setLoading(false);
  }, [tenantId, crewName]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-craftsman-builds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  useEffect(() => {
    let inFlight = false;
    const iv = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => { inFlight = false; });
    }, 15000);
    return () => clearInterval(iv);
  }, [load]);

  // Restore an in-progress build after a reload (only restores, never starts).
  useEffect(() => {
    try {
      const r = localStorage.getItem(BUILD_KEY);
      if (r) { const v = JSON.parse(r) as ActiveBuild; setBuild(v); buildRef.current = v; setOpenUnitId(v.unitId); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { buildRef.current = build; }, [build]);

  // Report the active build up to the crew home (banner) while collapsed.
  useEffect(() => {
    if (!onActiveBuild) return;
    if (build && !openUnitId) {
      const label = cabInfo[build.unitId]?.label ?? 'Craftsman build';
      const job = parts.find((p) => p.cabinet_unit_id === build.unitId)?.job_number ?? null;
      onActiveBuild({ label, job });
    } else {
      onActiveBuild(null);
    }
  }, [build, openUnitId, cabInfo, parts, onActiveBuild]);

  // Re-open the active build's work order when the parent bumps reopenSignal.
  const reopenSeen = useRef(reopenSignal);
  useEffect(() => {
    if (reopenSignal === undefined || reopenSignal === reopenSeen.current) return;
    reopenSeen.current = reopenSignal;
    if (buildRef.current?.unitId) setOpenUnitId(buildRef.current.unitId);
  }, [reopenSignal]);

  useEffect(() => {
    if (!build || build.stop) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [build]);

  function persistBuild(next: ActiveBuild | null) {
    setBuild(next);
    buildRef.current = next;
    try {
      if (next) localStorage.setItem(BUILD_KEY, JSON.stringify(next));
      else localStorage.removeItem(BUILD_KEY);
    } catch { /* ignore */ }
  }

  async function startBuild(cabinetId: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (build) return; // one active build at a time
    // One project per user — a paused project must be resumed before starting new work.
    if (pausedProject) { showToast('Resume your paused project first', true); return; }
    const start = new Date().toISOString();
    const cab = cabInfo[cabinetId];
    const jobNumber = parts.find((p) => p.cabinet_unit_id === cabinetId)?.job_number ?? null;
    // Start the build instantly in the UI, then open a live time_clock row (no
    // clock_out) so the supervisor's Craftsman Build Activity panel shows it
    // running in real time. The row id is stored on the build for the close.
    persistBuild({ unitId: cabinetId, start, stop: null, timeClockId: null, accumulatedSeconds: 0 });
    let liveRowId: string | null = null;
    try {
      const { data, error } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || 'Craftsman', dept: 'Craftsman',
        clock_in: start, date: start.split('T')[0], status: 'craftsman_build',
        notes: `Build: ${cab?.label ?? 'Cabinet'}`, job_number: jobNumber,
      }).select('id').single();
      if (error) throw error;
      liveRowId = (data as { id: string }).id;
      const b = buildRef.current;
      if (b && b.unitId === cabinetId) persistBuild({ ...b, timeClockId: liveRowId });
    } catch { /* live row best-effort; finishUnitBuild still logs hours on push */ }
    // Track this as the worker's active project (one per user, follows them) —
    // ALWAYS, even when the live time_clock insert failed, so dept switches and
    // clock-outs find it in crew_active_projects and pause/notify correctly.
    await upsertActiveProject({
      tenantId, workerName: crewName, dept: 'craftsman', cabinetUnitId: cabinetId,
      unitLabel: cab?.label ?? 'Cabinet', jobNumber, timeClockId: liveRowId, sessionStart: start, accumulatedSeconds: 0,
    });
    // Flip the cabinet to 'building' so the supervisor's Craftsman tab shows the
    // "Building" status badge (CraftsmanTab.statusMeta maps 'building' → blue).
    try {
      await supabase.from('cabinet_units')
        .update({ status: 'building' })
        .eq('id', cabinetId)
        .eq('tenant_id', tenantId);
    } catch { /* best-effort */ }
    // The craftsman cuts/shapes as part of the build, so THIS cabinet's parts
    // become cut the moment the build timer starts (the production→craftsman push
    // deliberately did NOT mark them cut — see pushPart). Scoped to this cabinet's
    // craftsman parts only. Best-effort: never blocks the timer from starting.
    try {
      await supabase.from('parts')
        .update({ production_status: 'cut', cut_by: crewName || null, cut_at: start })
        .eq('cabinet_unit_id', cabinetId)
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'craftsman');
    } catch { /* best-effort */ }
  }

  // Collapse the full-screen work order back to the queue WITHOUT pausing.
  // The timer and active project keep running — crew can navigate freely.
  // Only the Pause button pauses; clock-out and dept-switch pause via page.tsx.
  function collapseToQueue() {
    setOpenUnitId(null);
    setPushSel({});
    void load();
  }

  // PAUSE — close the live session (logging its hours), fold it into the project's
  // accumulated time, drop back to the queue with a Paused badge. One per user.
  async function pauseBuild(cabinetId: string) {
    const b = buildRef.current;
    if (!b || b.unitId !== cabinetId) return;
    persistBuild(null);
    setPushSel({});
    setOpenUnitId(null);
    const res = await pauseWorkerProject(tenantId, crewName);
    if (res) showToast(`Build paused — ${fmtAccumulated(res.accumulated)} logged`);
    void load();
  }

  // RESUME — open a fresh session and re-enter the build view showing total time.
  async function resumeFromQueue(proj: ActiveProject) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    const accum = proj.accumulated_seconds ?? 0;
    const { timeClockId: id, sessionStart } = await startProjectSession({
      tenantId, workerName: crewName, dept: 'craftsman', cabinetUnitId: proj.cabinet_unit_id,
      unitLabel: proj.unit_label, jobNumber: proj.job_number, accumulatedSeconds: accum,
    });
    persistBuild({ unitId: proj.cabinet_unit_id, start: sessionStart, stop: null, timeClockId: id, accumulatedSeconds: accum });
    setPausedProject(null);
    setOpenUnitId(proj.cabinet_unit_id);
    try { await supabase.from('cabinet_units').update({ status: 'building' }).eq('id', proj.cabinet_unit_id).eq('tenant_id', tenantId); } catch { /* best-effort */ }
  }
  function readyToPush(cabinetId: string, cabParts: CPart[]) {
    const b = buildRef.current;
    if (!b || b.unitId !== cabinetId || b.stop) return;
    // Default: every part selected.
    const sel: Record<string, boolean> = {};
    cabParts.forEach((p) => { sel[p.id] = true; });
    setPushSel(sel);
    persistBuild({ ...b, stop: new Date().toISOString() });
  }
  function resumeBuild(cabinetId: string) {
    const b = buildRef.current;
    if (!b || b.unitId !== cabinetId) return;
    persistBuild({ ...b, start: new Date(Date.now() - elapsedSeconds(b.start, b.stop) * 1000).toISOString(), stop: null });
  }

  // After PushPicker moved the representative part, move the rest of the SELECTED
  // parts to the same dept, log the build duration once, then reset.
  async function finishUnitBuild(cabinetId: string, allParts: CPart[], representativeId: string, toDept: string) {
    const b = buildRef.current;
    const jobNumber = allParts[0]?.job_number ?? null;
    // Every selected part (including the representative PushPicker already moved)
    // goes into the undo set so the whole push can be reversed.
    const pushedParts = allParts
      .filter((p) => pushSel[p.id])
      .map((p) => ({ partId: p.id, cabinetUnitId: p.cabinet_unit_id, partName: p.part_name, jobNumber: p.job_number }));
    for (const p of allParts) {
      if (p.id === representativeId || !pushSel[p.id]) continue;
      try {
        await pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: 'craftsman', toDept, workerName: crewName, timeClockId });
      } catch { /* best-effort */ }
    }
    if (b && b.unitId === cabinetId) {
      const stop = b.stop ?? new Date().toISOString();
      const durationMin = Math.round((new Date(stop).getTime() - new Date(b.start).getTime()) / 60000);
      if (b.timeClockId) {
        // Close the live row the supervisor has been watching — never insert a new one.
        void supabase.from('time_clock')
          .update({ clock_out: stop, total_hours: Math.max(0, durationMin) / 60 })
          .eq('id', b.timeClockId).then(() => {}, () => {});
      } else if (durationMin > 0) {
        // No live row (the START insert failed) — log once now so Reports sees the hours.
        const cab = cabInfo[cabinetId];
        void supabase.from('time_clock').insert({
          tenant_id: tenantId, worker_name: crewName || 'Craftsman', dept: 'Craftsman',
          clock_in: b.start, clock_out: stop, date: stop.split('T')[0],
          total_hours: durationMin / 60, status: 'craftsman_build',
          notes: `Build: ${cab?.label ?? 'Cabinet'}`, job_number: jobNumber,
        }).then(() => {}, () => {});
      }
    }
    // The craftsman has pushed this cabinet's parts on — mark it complete so the
    // supervisor's Craftsman tab shows the green "Complete" status badge.
    try {
      const { error: cabErr } = await supabase.from('cabinet_units')
        .update({ status: 'complete' })
        .eq('id', cabinetId)
        .eq('tenant_id', tenantId);
      if (cabErr) throw cabErr;
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Cabinet status update failed', true);
    }
    // The project is done — remove it so it no longer shows as active/paused.
    void clearProject(tenantId, crewName);
    persistBuild(null);
    setPushSel({});
    // If every part on the cabinet was pushed, the cabinet leaves the queue.
    const remaining = allParts.some((p) => !pushSel[p.id]);
    setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cabinetId || (remaining && !pushSel[p.id])));
    if (!remaining) setOpenUnitId(null);
    if (pushedParts.length > 0) {
      const cab = cabInfo[cabinetId];
      showUndoToast(cab?.label ?? 'Cabinet', toDept, 'craftsman', pushedParts);
    }
  }

  function showUndoToast(
    label: string,
    toDept: string,
    fromDept: string,
    parts: { partId: string; cabinetUnitId: string; partName: string; jobNumber: string | null }[],
  ) {
    if (undoState) clearTimeout(undoState.timer);
    const timer = setTimeout(() => { setUndoState(null); }, 8000);
    setUndoState({ label, toDept, fromDept, parts, timer });
  }

  async function handleUndo() {
    if (!undoState) return;
    clearTimeout(undoState.timer);
    const u = undoState;
    setUndoState(null);
    for (const p of u.parts) {
      try {
        await pushPart({ tenantId, partId: p.partId, partName: p.partName, cabinetUnitId: p.cabinetUnitId, jobNumber: p.jobNumber, fromDept: u.toDept, toDept: u.fromDept, workerName: crewName, timeClockId });
      } catch { /* best-effort per part */ }
    }
    showToast(`Undone — parts returned to ${deptDisplay(u.fromDept)}`);
    void load();
  }

  // Push every part across the selected cabinets to one dept at once.
  async function pushSelectedCraftsman(toDept: string) {
    const cabIds = Array.from(selectedCabs);
    if (cabIds.length === 0) return;
    const idSet = new Set(cabIds);
    // Flatten to the parts being pushed across the selected cabinets.
    const toPush = parts.filter((p) => idSet.has(p.cabinet_unit_id));
    const pushed = toPush.map((p) => ({ partId: p.id, cabinetUnitId: p.cabinet_unit_id, partName: p.part_name, jobNumber: p.job_number }));
    // Push all parts in parallel.
    const pushResults = await Promise.allSettled(toPush.map((p) =>
      pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: 'craftsman', toDept, workerName: crewName, timeClockId })
    ));
    const failedCount = pushResults.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) {
      showToast(`${failedCount} part${failedCount === 1 ? '' : 's'} failed to push — try again`, true);
    }
    // Recompute each unique cabinet once.
    const uniqueCabIds = [...new Set(toPush.map((p) => p.cabinet_unit_id))];
    await Promise.all(uniqueCabIds.map((id) => recomputeCabinet(tenantId, id).catch(() => {})));
    showUndoToast(`${cabIds.length} cabinet${cabIds.length === 1 ? '' : 's'}`, toDept, 'craftsman', pushed);
    setSelectedCabs(new Set());
    setSelectMode(false);
    setParts((prev) => prev.filter((p) => !idSet.has(p.cabinet_unit_id)));
    void load();
  }

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

  // If the active build's cabinet no longer has craftsman parts, clear it.
  useEffect(() => {
    if (!build || loading) return;
    if (!parts.some((p) => p.cabinet_unit_id === build.unitId)) persistBuild(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, build, loading]);

  // If the open cabinet no longer exists, close the full screen.
  useEffect(() => {
    if (!openUnitId || loading) return;
    if (!parts.some((p) => p.cabinet_unit_id === openUnitId)) setOpenUnitId(null);
  }, [parts, openUnitId, loading]);

  const cabinetsForJob = (jobNumber: string) => {
    const groups: Record<string, CPart[]> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      (groups[p.cabinet_unit_id] ??= []).push(p);
    });
    return Object.entries(groups).map(([cabinetId, cp]) => ({ cabinetId, parts: cp }));
  };

  // Undo toast — rendered in both the work-order and queue views (fixed, zIndex 2000).
  const undoToast = undoState ? (
    <div style={{ position: 'fixed', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: 16, right: 16, zIndex: 2000, background: '#0a0f0e', border: '1px solid rgba(45,225,201,0.35)', borderRadius: 14, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{undoState.label}</div>
        <div style={{ fontSize: 12, color: 'var(--teal)' }}>Sent to {deptDisplay(undoState.toDept)}</div>
      </div>
      <button onClick={() => void handleUndo()}
        style={{ background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.4)', color: '#F87171', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
        Undo
      </button>
      <button onClick={() => { clearTimeout(undoState.timer); setUndoState(null); }} aria-label="Dismiss"
        style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', display: 'flex', padding: 4 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  ) : null;

  // ── Full-screen work order ─────────────────────────────────────────────────
  if (openUnitId) {
    const cabParts = parts.filter((p) => p.cabinet_unit_id === openUnitId);
    const info = cabInfo[openUnitId] ?? { label: 'Cabinet', key: '' };
    const isBuilding = build?.unitId === openUnitId;
    const isPushing = isBuilding && !!build?.stop;
    const anotherActive = !!build && build.unitId !== openUnitId;
    const elapsed = build && isBuilding ? elapsedSeconds(build.start, build.stop) : 0;
    // Display TOTAL = time from earlier (paused) sessions + this live session.
    const totalElapsed = (build?.accumulatedSeconds ?? 0) + elapsed;
    const canPush = totalElapsed >= MIN_PUSH_SECONDS;
    const representative = cabParts.find((p) => pushSel[p.id]) ?? cabParts[0];
    const jobNumber = cabParts[0]?.job_number ?? null;
    // Progress bar — pure visual fill on a 1-hour scale, no endpoint/estimate.
    const fillPct = Math.min(100, (totalElapsed / 3600) * 100);

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'max(env(safe-area-inset-top), 16px)' }}>
        {/* Header — sits below the safe area; back + label/job on the left, View Drawings on the right */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button onClick={collapseToQueue} title={undefined}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', flexShrink: 0 }} aria-label="Back">
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)' }}>{info.label}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{jobLabel(jobNumber)}</div>
            </div>
          </div>
          <div style={{ flexShrink: 0 }}>
            <ViewDrawingsButton tenantId={tenantId} jobNumber={jobNumber} cabinetKey={info.key} compact={false} />
          </div>
        </div>

        {/* Work order — every part's full spec, always expanded */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cabParts.map((p) => {
            const dims = dimLabel(p);
            const flagged = !!p.flag_type || !!p.flag_notes;
            const selectable = isPushing;
            const on = !!pushSel[p.id];
            return (
              <div key={p.id} onClick={selectable ? () => setPushSel((s) => ({ ...s, [p.id]: !s[p.id] })) : undefined}
                style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, background: 'var(--bg-1)', border: `1px solid ${flagged ? 'rgba(248,113,113,0.35)' : selectable && on ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, cursor: selectable ? 'pointer' : 'default' }}>
                {selectable && (
                  <span style={{ width: 22, height: 22, flexShrink: 0, marginTop: 2, borderRadius: 6, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </span>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 17, fontWeight: 800, color: flagged ? '#F87171' : 'var(--ink)' }}>{p.part_name}</span>
                    {p.quantity > 1 && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(94,234,212,0.12)', color: 'var(--teal)' }}>Qty {p.quantity}</span>}
                  </div>
                  {dims && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 3 3 21"/><path d="M3 8V3h5"/><path d="M21 16v5h-5"/></svg>
                      <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink-dim)', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.01em' }}>{dims}</span>
                    </div>
                  )}
                  {p.material && <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 5 }}><span style={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: 10.5 }}>Material</span>{' · '}{p.material}</div>}
                  {flagged && (
                    <div style={{ fontSize: 12.5, color: '#F87171', marginTop: 6, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span>{[flagLabel(p.flag_type), p.flag_notes].filter(Boolean).join(' — ')}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom controls */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 16px', paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
          {!isBuilding ? (
            pausedProject?.cabinet_unit_id === openUnitId ? (
              <button onClick={() => void resumeFromQueue(pausedProject)}
                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                Resume Build — {fmtAccumulated(pausedProject.accumulated_seconds ?? 0)} logged
              </button>
            ) : (() => {
              const blockedByPaused = !!pausedProject;
              const disabled = anotherActive || blockedByPaused;
              return (
                <button onClick={() => void startBuild(openUnitId)} disabled={disabled}
                  title={blockedByPaused ? 'Resume your paused project first' : anotherActive ? 'Finish your current build first' : undefined}
                  style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 800, fontFamily: 'inherit', background: disabled ? 'var(--bg-1)' : '#60A5FA', border: 'none', color: disabled ? 'var(--ink-mute)' : '#041020', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                  {blockedByPaused ? 'Resume your paused project first' : anotherActive ? 'Another build in progress' : 'Start Build'}
                </button>
              );
            })()
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Progress bar only — the crew never sees a clock; the timer runs
                  silently and is visible only to the supervisor. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isPushing ? 'var(--ink-mute)' : '#60A5FA', display: 'inline-block', animation: isPushing ? 'none' : 'craftPulse 1.4s ease-in-out infinite' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-mute)' }}>{isPushing ? 'Build paused' : 'Building…'}</span>
              </div>
              <div style={{ height: 8, borderRadius: 20, background: 'var(--bg-1)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${fillPct}%`, background: isPushing ? 'var(--ink-mute)' : '#60A5FA', transition: 'width 1s linear' }} />
              </div>

              {!isPushing ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => readyToPush(openUnitId, cabParts)} disabled={!canPush}
                    title={!canPush ? 'Let the build run first' : undefined}
                    style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: canPush ? '#2DE1C9' : 'var(--bg-1)', border: `1px solid ${canPush ? '#2DE1C9' : 'var(--line)'}`, color: canPush ? '#04201c' : 'var(--ink-mute)', cursor: canPush ? 'pointer' : 'not-allowed' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    Push To
                  </button>
                  <button onClick={() => void pauseBuild(openUnitId)} title="Pause this build"
                    style={{ justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '15px 18px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24', cursor: 'pointer' }}>
                    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
                    Pause
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>Select parts above, then choose where they go:</div>
                  {representative && (
                    <PushPicker
                      tenantId={tenantId}
                      partId={representative.id}
                      partName={representative.part_name}
                      cabinetUnitId={representative.cabinet_unit_id}
                      jobNumber={representative.job_number}
                      currentDept="craftsman"
                      workerName={crewName}
                      timeClockId={timeClockId}
                      aiMode={aiMode}
                      onPushed={(toDept) => void finishUnitBuild(openUnitId, cabParts, representative.id, toDept)}
                      onToast={showToast}
                    />
                  )}
                  <button onClick={() => resumeBuild(openUnitId)}
                    style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', padding: '2px 0', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
                    Keep building
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {undoToast}
      </div>
    );
  }

  // ── Queue view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: 'var(--teal)', display: 'flex' }}><IcoCraft /></span>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Craftsman Builds</div>
        {!loading && jobOptions.length > 0 && (
          <button
            onClick={() => { if (selectMode) { setSelectMode(false); setSelectedCabs(new Set()); } else { setSelectMode(true); } }}
            style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: selectMode ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', border: `1px solid ${selectMode ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.5)'}`, color: selectMode ? '#F87171' : '#FBBF24', cursor: 'pointer' }}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading builds…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>No active work assigned</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Custom parts routed to Craftsman will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobOptions.map((j) => {
            const open = selectedJob === j.jobNumber;
            const cabs = open ? cabinetsForJob(j.jobNumber) : [];
            const count = parts.filter((p) => (p.job_number ?? '__nojob__') === j.jobNumber).length;
            return (
              <div key={j.jobNumber} style={{ borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <button onClick={() => setSelectedJob(open ? '' : j.jobNumber)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{count} part{count === 1 ? '' : 's'}</span>
                </button>
                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
                    {cabs.map((c) => {
                      const info = cabInfo[c.cabinetId] ?? { label: 'Cabinet', key: '' };
                      const building = build?.unitId === c.cabinetId;
                      const paused = pausedProject?.cabinet_unit_id === c.cabinetId ? pausedProject : null;
                      if (paused) {
                        return (
                          <div key={c.cabinetId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid rgba(251,191,36,0.4)' }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</span>
                                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>Paused</span>
                              </div>
                              <div style={{ fontSize: 12.5, color: '#FBBF24', marginTop: 2 }}>{fmtAccumulated(paused.accumulated_seconds ?? 0)} logged</div>
                            </div>
                            <button onClick={() => void resumeFromQueue(paused)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer', flexShrink: 0 }}>
                              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                              Resume
                            </button>
                          </div>
                        );
                      }
                      const blocked = !!pausedProject;
                      const selected = selectedCabs.has(c.cabinetId);
                      return (
                        <button key={c.cabinetId}
                          onClick={() => {
                            if (selectMode) {
                              setSelectedCabs((s) => { const n = new Set(s); if (n.has(c.cabinetId)) n.delete(c.cabinetId); else n.add(c.cabinetId); return n; });
                              return;
                            }
                            if (blocked) { showToast('Resume your paused project first', true); return; }
                            setOpenUnitId(c.cabinetId);
                          }}
                          title={blocked && !selectMode ? 'Resume your paused project first' : undefined}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 12, background: 'var(--bg-1)', border: `1px solid ${selectMode && selected ? 'var(--teal)' : building ? 'rgba(96,165,250,0.4)' : 'var(--line)'}`, cursor: (blocked && !selectMode) ? 'not-allowed' : 'pointer', opacity: (blocked && !selectMode) ? 0.55 : 1, fontFamily: 'inherit', textAlign: 'left' }}>
                          {selectMode && (
                            <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${selected ? 'var(--teal)' : 'var(--line-strong)'}`, background: selected ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {selected && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                            </span>
                          )}
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2 }}>{c.parts.length} part{c.parts.length === 1 ? '' : 's'}{building ? ' · building now' : ''}</div>
                          </div>
                          {building && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#60A5FA', display: 'inline-block', animation: 'craftPulse 1.4s ease-in-out infinite' }} />}
                          {!selectMode && <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Multi-select push bar */}
      {selectMode && selectedCabs.size > 0 && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1500, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)', marginBottom: 10 }}>Push {selectedCabs.size} cabinet{selectedCabs.size === 1 ? '' : 's'} to:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PART_DEPTS.filter((d) => d.toLowerCase() !== 'craftsman').map((d) => (
              <button key={d} onClick={() => void pushSelectedCraftsman(d)}
                style={{ flex: 1, minWidth: 0, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '13px 12px', borderRadius: 12, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
                {deptDisplay(d)}
              </button>
            ))}
          </div>
        </div>
      )}

      {undoToast}
      <style>{`@keyframes craftPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
    </div>
  );
}
