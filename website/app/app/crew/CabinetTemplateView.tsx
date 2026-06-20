'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';
import {
  getWorkerProject, upsertActiveProject, startProjectSession, pauseWorkerProject,
  clearProject, fmtAccumulated, type ActiveProject,
} from '@/lib/activeProject';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import PushPicker, { type AiMode } from '@/components/PushPicker';
import { pushPart, deptDisplay, PART_DEPTS, recomputeCabinet, maybeNotifyJobQc } from '@/lib/partActions';

// ── Cabinet template (generalized from AssemblyCrewView) ─────────────────────
// The 'cabinet' tracking template: parts grouped by job → room → cabinet, each
// cabinet with START / PAUSE / COMPLETE on one cabinet at a time (multiple crew,
// each its own time_clock row). Previously hardcoded to dept 'assembly'; now
// config-driven by deptName + completion_behavior:
//   'auto_route_to_qc' — COMPLETE sends the cabinet straight to QC (exactly as
//                        Assembly does today).
//   'push_picker'      — COMPLETE stops the timer and opens the existing PushPicker
//                        so the crew choose where the cabinet's parts go (the old
//                        Craftsman per-cabinet behavior, before Group-Manual).
// The job→room→cabinet→part folder structure here is the universal spec drill-down
// for this template (each cabinet expands to its parts' full specs).

type AsmPart = {
  id: string; part_name: string; cabinet_unit_id: string; job_number: string | null;
  material: string | null; width: number | null; height: number | null; depth: number | null;
  assigned_dept: string | null; status: string | null; qc_notes: string | null; qc_failed: boolean | null;
};
type CabInfo = { label: string; key: string; status: string | null; completedBy: string | null; roomNumber: string | null };
type ActiveBuild = { timeClockId: string; start: string };
type LongPressedAsmPart = { part: AsmPart; cabinetId: string; label: string } | null;
type CompletionBehavior = 'auto_route_to_qc' | 'push_picker' | null;

interface Props {
  tenantId: string;
  deptId: string;
  deptName: string;
  completionBehavior?: CompletionBehavior;
  crewName?: string;
  aiMode?: AiMode;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
}

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
function roomLabel(roomNumber: string | null): string {
  if (!roomNumber) return 'General';
  return `Room ${roomNumber}`;
}

export default function CabinetTemplateView({
  tenantId, deptName, completionBehavior, crewName = '', aiMode = 'learn',
  showToast, isClockedIn = true, onRequireClock,
}: Props) {
  const deptKey = deptName.toLowerCase();
  // Cabinet depts with no explicit completion behavior fall back to the picker.
  const behavior: CompletionBehavior = completionBehavior ?? 'push_picker';
  // localStorage key for in-progress builds — namespaced per department.
  const BUILDS_KEY = `cabinet_builds_${deptKey}`;
  // Push destinations: canonical part-depts minus this one (mirrors Assembly).
  const PUSH_DEPTS = PART_DEPTS.filter((d) => d.toLowerCase() !== deptKey);

  const [parts, setParts] = useState<AsmPart[]>([]);
  const [cabInfo, setCabInfo] = useState<Record<string, CabInfo>>({});
  const [cabsByJob, setCabsByJob] = useState<Record<string, string[]>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [busyCab, setBusyCab] = useState<string | null>(null);
  const [longPressedAsmPart, setLongPressedAsmPart] = useState<LongPressedAsmPart>(null);
  const asmLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asmLongPressFired = useRef(false);
  const [builds, setBuilds] = useState<Record<string, ActiveBuild>>({});
  const [pausedProject, setPausedProject] = useState<ActiveProject | null>(null);
  const buildsRef = useRef<Record<string, ActiveBuild>>({});
  useEffect(() => { buildsRef.current = builds; }, [builds]);
  const [, setTick] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Record<string, { part: AsmPart; cabinetId: string }>>({});
  const [expandedCabs, setExpandedCabs] = useState<Record<string, boolean>>({});
  // Open push picker on COMPLETE for push_picker depts.
  const [pushPickerCab, setPushPickerCab] = useState<{ cabinetId: string; jobNumber: string | null; label: string; parts: AsmPart[] } | null>(null);
  const [undoState, setUndoState] = useState<{
    label: string; toDept: string; fromDept: string;
    parts: { partId: string; cabinetUnitId: string; partName: string; jobNumber: string | null }[];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  useEffect(() => {
    try { const r = localStorage.getItem(BUILDS_KEY); if (r) setBuilds(JSON.parse(r) as Record<string, ActiveBuild>); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [BUILDS_KEY]);
  const persistBuilds = useCallback((next: Record<string, ActiveBuild>) => {
    setBuilds(next);
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, [BUILDS_KEY]);

  useEffect(() => {
    if (Object.keys(builds).length === 0) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [builds]);

  const load = useCallback(async () => {
    try {
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, material, width, height, depth, assigned_dept, status, qc_notes, qc_failed')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', deptKey)
        .neq('status', 'complete')
        .limit(1000);
      let asm = (partRows as AsmPart[] | null) ?? [];
      if (activeJobNums) asm = asm.filter((p) => !p.job_number || activeJobNums!.has(p.job_number));
      setParts(asm);

      const cabIds = Array.from(new Set(asm.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const jobNums = Array.from(new Set(asm.map((p) => p.job_number).filter(Boolean))) as string[];
      const info: Record<string, CabInfo> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number, room_number, status, completed_by').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null; room_number: string | null; status: string | null; completed_by: string | null }[] | null) ?? []).forEach((c) => {
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '', status: c.status, completedBy: c.completed_by, roomNumber: c.room_number };
        });
      }

      const visibleCabs: Record<string, string[]> = {};
      const WORKFLOW_CAB_STATUSES = ['pending', 'in_assembly', 'building'];
      if (jobNums.length > 0) {
        const { data: jobCabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number, room_number, status, completed_by, job_number')
          .eq('tenant_id', tenantId).eq('assigned_dept', deptKey).in('job_number', jobNums).limit(1000);
        type CabRow = { id: string; unit_label: string | null; cabinet_number: string | null; room_number: string | null; status: string | null; completed_by: string | null; job_number: string | null };
        const cabRowsByJob: Record<string, CabRow[]> = {};
        ((jobCabs as CabRow[] | null) ?? []).forEach((c) => {
          if (c.job_number) (cabRowsByJob[c.job_number] ??= []).push(c);
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '', status: c.status, completedBy: c.completed_by, roomNumber: c.room_number };
        });
        for (const jn of jobNums) {
          const cs = cabRowsByJob[jn] ?? [];
          visibleCabs[jn] = cs.filter((c) => WORKFLOW_CAB_STATUSES.includes((c.status || '').toLowerCase())).map((c) => c.id);
        }
      }
      setCabInfo(info);
      setCabsByJob(visibleCabs);

      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { map[j.job_number] = j.job_path || `Job ${j.job_number}`; });
          setJobPaths(map);
        } catch { /* best-effort */ }
      }

      const proj = await getWorkerProject(tenantId, crewName);
      setPausedProject(proj && proj.status === 'paused' && proj.dept === deptKey ? proj : null);
      if (proj && proj.status === 'active' && proj.dept === deptKey && proj.time_clock_id && !buildsRef.current[proj.cabinet_unit_id]) {
        persistBuilds({ ...buildsRef.current, [proj.cabinet_unit_id]: { timeClockId: proj.time_clock_id, start: proj.session_start ?? new Date().toISOString() } });
      }
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId, crewName, deptKey, persistBuilds]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-cabinet-${deptKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, deptKey, load]);

  useEffect(() => {
    let inFlight = false;
    const iv = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => { inFlight = false; });
    }, 15000);
    return () => clearInterval(iv);
  }, [load]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

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
    const ids = Array.from(new Set([...(cabsByJob[jobNumber] ?? []), ...Object.keys(groups)]));
    return ids.map((cabinetId) => ({ cabinetId, parts: groups[cabinetId] ?? [] }));
  };

  const roomsForJob = (jobNumber: string) => {
    const byRoom: Record<string, { cabinetId: string; parts: AsmPart[] }[]> = {};
    cabinetsForJob(jobNumber).forEach((c) => {
      const rk = cabInfo[c.cabinetId]?.roomNumber ?? '__noroom__';
      (byRoom[rk] ??= []).push(c);
    });
    return Object.entries(byRoom)
      .sort(([a], [b]) => {
        if (a === '__noroom__') return 1;
        if (b === '__noroom__') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([rk, cabs]) => ({ roomNumber: rk === '__noroom__' ? null : rk, cabs }));
  };

  async function startBuild(cabinetId: string, jobNumber: string | null, label: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (builds[cabinetId]) return;
    const now = new Date().toISOString();
    try {
      const { data, error } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || deptName, dept: deptName,
        clock_in: now, date: now.split('T')[0], status: `${deptKey}_work`,
        notes: `${deptDisplay(deptKey)}: ${label}`, job_number: jobNumber,
        cabinet_unit_id: cabinetId,
      }).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      persistBuilds({ ...builds, [cabinetId]: { timeClockId: id, start: now } });
      try {
        await supabase.from('shift_events').insert({
          tenant_id: tenantId, time_clock_id: id, worker_name: crewName || deptName,
          event_type: `${deptKey}_work`, dept: deptName,
          metadata: { unit_label: label, job_number: jobNumber, cabinet_unit_id: cabinetId },
        });
      } catch { /* shift event best-effort */ }
      void upsertActiveProject({
        tenantId, workerName: crewName, dept: deptKey, cabinetUnitId: cabinetId,
        unitLabel: label, jobNumber, timeClockId: id, sessionStart: now, accumulatedSeconds: 0,
      });
      // assembly_started_at is an assembly-specific column; only set it for assembly.
      if (deptKey === 'assembly') {
        try { await supabase.from('cabinet_units').update({ assembly_started_at: now }).eq('id', cabinetId).eq('tenant_id', tenantId).is('assembly_started_at', null); } catch { /* best-effort */ }
      } else {
        try { await supabase.from('cabinet_units').update({ status: 'building' }).eq('id', cabinetId).eq('tenant_id', tenantId); } catch { /* best-effort */ }
      }
      showToast('Build started');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start build', true);
    }
  }

  async function pauseBuild(cabinetId: string, label: string) {
    const b = builds[cabinetId];
    if (b) { const next = { ...builds }; delete next[cabinetId]; persistBuilds(next); }
    const res = await pauseWorkerProject(tenantId, crewName);
    if (res) showToast(`${label} paused — ${fmtAccumulated(res.accumulated)} logged`);
    void load();
  }

  async function resumeFromQueue(proj: ActiveProject) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    const { timeClockId: id, sessionStart } = await startProjectSession({
      tenantId, workerName: crewName, dept: deptKey, cabinetUnitId: proj.cabinet_unit_id,
      unitLabel: proj.unit_label, jobNumber: proj.job_number, accumulatedSeconds: proj.accumulated_seconds ?? 0,
    });
    if (id) persistBuilds({ ...builds, [proj.cabinet_unit_id]: { timeClockId: id, start: sessionStart } });
    setPausedProject(null);
    showToast(`${proj.unit_label} resumed`);
  }

  // Stop + log a cabinet's running build timer (shared by both completion paths).
  function stopBuildTimer(cabinetId: string, now: string) {
    const b = builds[cabinetId];
    if (!b) return;
    const totalHours = Math.max(0, (Date.now() - new Date(b.start).getTime()) / 3600000);
    void supabase.from('time_clock').update({ clock_out: now, total_hours: Math.round(totalHours * 100) / 100 }).eq('id', b.timeClockId).then(() => {}, () => {});
    const next = { ...builds }; delete next[cabinetId]; persistBuilds(next);
  }

  async function clearCabinetProject(cabinetId: string) {
    if (pausedProject?.cabinet_unit_id === cabinetId) setPausedProject(null);
    try {
      const proj = await getWorkerProject(tenantId, crewName);
      if (proj && proj.cabinet_unit_id === cabinetId) await clearProject(tenantId, crewName);
    } catch { /* best-effort */ }
  }

  // COMPLETE — behavior depends on the department's completion_behavior.
  async function completeCabinet(cabinetId: string, jobNumber: string | null, label: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (busyCab) return;
    setBusyCab(cabinetId);
    const now = new Date().toISOString();
    try {
      stopBuildTimer(cabinetId, now);

      if (behavior === 'push_picker') {
        // Don't route — let the crew pick the destination via PushPicker.
        const cabParts = parts.filter((p) => p.cabinet_unit_id === cabinetId);
        setPushPickerCab({ cabinetId, jobNumber, label, parts: cabParts });
        return;
      }

      // auto_route_to_qc — exactly Assembly's behavior.
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc', completed_by: crewName || deptName })
        .eq('id', cabinetId).eq('tenant_id', tenantId);
      if (error) throw error;
      try { await supabase.from('parts').update({ assigned_dept: 'qc' }).eq('cabinet_unit_id', cabinetId).eq('tenant_id', tenantId).eq('assigned_dept', deptKey); } catch { /* best-effort */ }
      await clearCabinetProject(cabinetId);
      if (jobNumber) { try { await maybeNotifyJobQc(tenantId, jobNumber, jobLabel(jobNumber)); } catch { /* best-effort */ } }
      sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Cabinet ready for QC', body: `${label}${jobNumber ? ` — Job ${jobNumber}` : ''} is ready for QC`, url: '/app/supervisor' });
      setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cabinetId));
      showToast(`${label} sent to QC`);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete cabinet', true);
    } finally {
      setBusyCab(null);
    }
  }

  // push_picker complete: PushPicker already moved the representative part; move
  // the rest of this cabinet's parts to the same dept, mark it complete, reset.
  async function finishCabinetPush(toDept: string) {
    const cab = pushPickerCab;
    if (!cab) return;
    const rep = cab.parts[0];
    const pushed = cab.parts.map((p) => ({ partId: p.id, cabinetUnitId: p.cabinet_unit_id, partName: p.part_name, jobNumber: p.job_number }));
    for (const p of cab.parts) {
      if (rep && p.id === rep.id) continue;
      try {
        await pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: deptKey, toDept, workerName: crewName, timeClockId: null });
      } catch { /* best-effort per part */ }
    }
    try { await supabase.from('cabinet_units').update({ status: 'complete' }).eq('id', cab.cabinetId).eq('tenant_id', tenantId); } catch { /* best-effort */ }
    await clearCabinetProject(cab.cabinetId);
    setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cab.cabinetId));
    showUndoToast(cab.label, toDept, deptKey, pushed);
    setPushPickerCab(null);
    void load();
  }

  async function pushAsmPart(part: AsmPart, toDept: string) {
    setLongPressedAsmPart(null);
    try {
      await pushPart({ tenantId, partId: part.id, partName: part.part_name, cabinetUnitId: part.cabinet_unit_id, jobNumber: part.job_number, fromDept: deptKey, toDept, workerName: crewName, timeClockId: null });
      setParts((prev) => prev.filter((p) => p.id !== part.id));
      showUndoToast(part.part_name, toDept, deptKey, [{ partId: part.id, cabinetUnitId: part.cabinet_unit_id, partName: part.part_name, jobNumber: part.job_number }]);
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Push failed', true);
    }
  }

  function showUndoToast(
    label: string, toDept: string, fromDept: string,
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
        await pushPart({ tenantId, partId: p.partId, partName: p.partName, cabinetUnitId: p.cabinetUnitId, jobNumber: p.jobNumber, fromDept: u.toDept, toDept: u.fromDept, workerName: crewName, timeClockId: null });
      } catch { /* best-effort per part */ }
    }
    showToast(`Undone — parts returned to ${deptDisplay(u.fromDept)}`);
    void load();
  }

  async function pushSelectedAsmParts(toDept: string) {
    const items = Object.values(selectedParts);
    if (items.length === 0) return;
    const pushResults = await Promise.allSettled(items.map(({ part }) =>
      pushPart({ tenantId, partId: part.id, partName: part.part_name, cabinetUnitId: part.cabinet_unit_id, jobNumber: part.job_number, fromDept: deptKey, toDept, workerName: crewName, timeClockId: null })
    ));
    const failedCount = pushResults.filter((r) => r.status === 'rejected').length;
    if (failedCount > 0) showToast(`${failedCount} part${failedCount === 1 ? '' : 's'} failed to push — try again`, true);
    const uniqueCabIds = [...new Set(items.map((i) => i.cabinetId))];
    await Promise.all(uniqueCabIds.map((id) => recomputeCabinet(tenantId, id).catch(() => {})));
    showUndoToast(
      `${items.length} part${items.length === 1 ? '' : 's'}`, toDept, deptKey,
      items.map((i) => ({ partId: i.part.id, cabinetUnitId: i.cabinetId, partName: i.part.part_name, jobNumber: i.part.job_number })),
    );
    const pushedIds = new Set(items.map((i) => i.part.id));
    setParts((prev) => prev.filter((p) => !pushedIds.has(p.id)));
    setSelectedParts({});
    setSelectMode(false);
    void load();
  }

  const btnBase: React.CSSProperties = {
    flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7,
    padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
  };

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{deptDisplay(deptKey)}</div>
        {!loading && jobOptions.length > 0 && (
          <button
            onClick={() => { if (selectMode) { setSelectMode(false); setSelectedParts({}); } else { setSelectMode(true); } }}
            style={{ marginLeft: 'auto', padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: selectMode ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', border: `1px solid ${selectMode ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.5)'}`, color: selectMode ? '#F87171' : '#FBBF24', cursor: 'pointer' }}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading {deptDisplay(deptKey).toLowerCase()} queue…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>Nothing to build yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Parts pushed to {deptDisplay(deptKey)} will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobOptions.map((j) => {
            const open = selectedJob === j.jobNumber;
            const rooms = open ? roomsForJob(j.jobNumber) : [];
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
                    {rooms.map((room) => {
                      const rk = `${j.jobNumber}::${room.roomNumber ?? '__noroom__'}`;
                      const roomOpen = expandedRoom === rk;
                      const roomPartCount = room.cabs.reduce((n, c) => n + c.parts.length, 0);
                      return (
                        <div key={rk} style={{ borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                          <button onClick={() => setExpandedRoom(roomOpen ? null : rk)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: roomOpen ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{roomLabel(room.roomNumber)}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{roomPartCount} part{roomPartCount === 1 ? '' : 's'}</span>
                          </button>
                          {roomOpen && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '10px 12px 12px', borderTop: '1px solid var(--line)' }}>
                    {room.cabs.map((c) => {
                      const info = cabInfo[c.cabinetId] ?? { label: 'Cabinet', key: '', status: null, completedBy: null, roomNumber: null };
                      const busy = busyCab === c.cabinetId;
                      const jobNumber = c.parts[0]?.job_number ?? (j.jobNumber === '__nojob__' ? null : j.jobNumber);
                      const build = builds[c.cabinetId];
                      const isComplete = DONE_CAB_STATUSES.includes((info.status || '').toLowerCase());
                      const paused = pausedProject?.cabinet_unit_id === c.cabinetId ? pausedProject : null;
                      const expanded = !!expandedCabs[c.cabinetId];
                      const selCount = c.parts.filter((p) => selectedParts[p.id]).length;
                      const allSel = c.parts.length > 0 && selCount === c.parts.length;
                      const someSel = selCount > 0 && !allSel;
                      const toggleCabinetSelection = () => {
                        setSelectedParts((s) => {
                          const n = { ...s };
                          if (allSel) c.parts.forEach((p) => { delete n[p.id]; });
                          else c.parts.forEach((p) => { n[p.id] = { part: p, cabinetId: c.cabinetId }; });
                          return n;
                        });
                      };
                      return (
                        <div key={c.cabinetId} style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: `1px solid ${build ? 'rgba(45,225,201,0.4)' : 'var(--line)'}` }}>
                          <button
                            onClick={() => {
                              if (selectMode) {
                                toggleCabinetSelection();
                                setExpandedCabs((e) => ({ ...e, [c.cabinetId]: true }));
                              } else {
                                setExpandedCabs((e) => ({ ...e, [c.cabinetId]: !e[c.cabinetId] }));
                              }
                            }}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, marginBottom: expanded ? 12 : 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                          >
                            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: expanded ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</span>
                            {build && (
                              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--teal)', display: 'inline-block', animation: 'asmPulse 1.4s ease-in-out infinite' }} />
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-mute)' }}>{c.parts.length} part{c.parts.length === 1 ? '' : 's'}</span>
                            {selectMode && (
                              <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${allSel ? 'var(--teal)' : someSel ? 'rgba(251,191,36,0.8)' : 'var(--line-strong)'}`, background: allSel ? 'var(--teal)' : someSel ? 'rgba(251,191,36,0.25)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {allSel && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                              </span>
                            )}
                          </button>
                          {expanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                            {c.parts.map((p) => {
                              const selected = !!selectedParts[p.id];
                              return (
                              <div key={p.id}
                                onPointerDown={selectMode ? undefined : () => { asmLongPressFired.current = false; asmLongPressTimer.current = setTimeout(() => { asmLongPressFired.current = true; setLongPressedAsmPart({ part: p, cabinetId: c.cabinetId, label: info.label }); }, 500); }}
                                onPointerUp={selectMode ? undefined : () => { if (asmLongPressTimer.current) clearTimeout(asmLongPressTimer.current); }}
                                onPointerLeave={selectMode ? undefined : () => { if (asmLongPressTimer.current) clearTimeout(asmLongPressTimer.current); }}
                                onPointerCancel={selectMode ? undefined : () => { if (asmLongPressTimer.current) clearTimeout(asmLongPressTimer.current); }}
                                onClick={selectMode ? () => { setSelectedParts((s) => { const n = { ...s }; if (n[p.id]) delete n[p.id]; else n[p.id] = { part: p, cabinetId: c.cabinetId }; return n; }); } : undefined}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, userSelect: 'none', touchAction: 'manipulation', cursor: selectMode ? 'pointer' : 'default' }}>
                                {selectMode && (
                                  <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: `1px solid ${selected ? 'var(--teal)' : 'var(--line-strong)'}`, background: selected ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {selected && <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </span>
                                )}
                                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partDisplay(p)}</span>
                                {p.qc_failed && p.qc_notes && (
                                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', marginTop: 4, width: '100%' }}>
                                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                    <span style={{ fontSize: 12, color: '#F87171', lineHeight: 1.4 }}>QC: {p.qc_notes}</span>
                                  </div>
                                )}
                                <ViewDrawingsButton tenantId={tenantId} jobNumber={p.job_number} cabinetKey={info.key} compact />
                              </div>
                              );
                            })}
                          </div>
                          )}

                          {expanded && (isComplete ? (
                            <>
                              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 10 }}>
                                {info.completedBy ? `Completed by ${info.completedBy}` : 'Completed'}
                              </div>
                              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--teal)' }}>{behavior === 'auto_route_to_qc' ? 'Sent to QC' : 'Complete'}</div>
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
                          ) : c.parts.length > 0 ? (
                            <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                              <button
                                onClick={() => void startBuild(c.cabinetId, jobNumber, info.label)}
                                disabled={!!build}
                                style={{ ...btnBase, flex: 1, minWidth: 0,
                                  background: build ? 'var(--bg-1)' : 'rgba(96,165,250,0.14)',
                                  border: `1px solid ${build ? 'var(--line)' : 'rgba(96,165,250,0.4)'}`,
                                  color: build ? 'var(--ink-mute)' : '#60A5FA',
                                  cursor: build ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                Start
                              </button>
                              {build && (
                                <button
                                  onClick={() => void pauseBuild(c.cabinetId, info.label)}
                                  title="Pause this build"
                                  aria-label="Pause this build"
                                  style={{ ...btnBase, flex: '0 0 auto', width: 48, gap: 0, padding: '11px 12px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24', cursor: 'pointer' }}
                                >
                                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
                                </button>
                              )}
                              <button
                                onClick={() => void completeCabinet(c.cabinetId, jobNumber, info.label)}
                                disabled={busy}
                                style={{ ...btnBase, flex: 1, minWidth: 0,
                                  background: 'rgba(45,225,201,0.14)',
                                  border: '1px solid rgba(45,225,201,0.4)',
                                  color: 'var(--teal)',
                                  cursor: busy ? 'wait' : 'pointer',
                                }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                {busy ? 'Working…' : behavior === 'auto_route_to_qc' ? 'QC' : 'Complete'}
                              </button>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--ink-mute)', padding: '4px 0' }}>
                              No parts in {deptDisplay(deptKey).toLowerCase()}
                            </div>
                          ))}
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
              </div>
            );
          })}
        </div>
      )}

      {/* push_picker completion — choose where this cabinet's parts go */}
      {pushPickerCab && pushPickerCab.parts[0] && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPushPickerCab(null); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{pushPickerCab.label} complete</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: -6 }}>Choose where this cabinet&apos;s {pushPickerCab.parts.length} part{pushPickerCab.parts.length === 1 ? '' : 's'} go:</div>
            <PushPicker
              tenantId={tenantId}
              partId={pushPickerCab.parts[0].id}
              partName={pushPickerCab.parts[0].part_name}
              cabinetUnitId={pushPickerCab.cabinetId}
              jobNumber={pushPickerCab.jobNumber}
              currentDept={deptKey}
              workerName={crewName}
              timeClockId={null}
              aiMode={aiMode}
              onPushed={(toDept) => void finishCabinetPush(toDept)}
              onToast={showToast}
            />
            <button onClick={() => setPushPickerCab(null)}
              style={{ alignSelf: 'center', background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Long-press part push sheet */}
      {longPressedAsmPart && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setLongPressedAsmPart(null); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{longPressedAsmPart.part.part_name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 2 }}>{longPressedAsmPart.label}</div>
            {PUSH_DEPTS.map((d) => (
              <button key={d} onClick={() => void pushAsmPart(longPressedAsmPart.part, d)}
                style={{ width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '14px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>
                Push to {deptDisplay(d)}
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Multi-select push bar */}
      {selectMode && Object.keys(selectedParts).length > 0 && (() => {
        const n = Object.keys(selectedParts).length;
        return (
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1500, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)', marginBottom: 10 }}>Push {n} part{n === 1 ? '' : 's'} to:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PUSH_DEPTS.map((d) => (
                <button key={d} onClick={() => void pushSelectedAsmParts(d)}
                  style={{ flex: 1, minWidth: 0, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '13px 12px', borderRadius: 12, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
                  {deptDisplay(d)}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Undo toast — reverse the last push within 8s */}
      {undoState && (
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
      )}
      <style>{`@keyframes asmPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
    </div>
  );
}
