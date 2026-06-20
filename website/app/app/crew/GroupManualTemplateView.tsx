'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';
import {
  getWorkerProject, startProjectSession, pauseWorkerProject, clearProject,
  fmtAccumulated, type ActiveProject,
} from '@/lib/activeProject';
import PushPicker, { type AiMode } from '@/components/PushPicker';
import { pushPart, deptDisplay, maybeNotifyJobQc } from '@/lib/partActions';
import JobPartsDrillDown from './JobPartsDrillDown';

// ── Group-Manual template (new) ──────────────────────────────────────────────
// The 'group_manual' tracking template: the crew member picks a JOB, sees all its
// cabinets, multi-selects some/all, and runs ONE session over the whole selection
// (one time_clock-backed session + crew_active_projects row, Pause/Resume, the
// global one-project-per-worker rule). On COMPLETE the dept's completion_behavior
// applies exactly as the Cabinet template:
//   auto_route_to_qc — send every selected cabinet to QC.
//   push_picker      — open PushPicker; push every selected cabinet's parts onward.
//
// The crew_active_projects model anchors a single representative cabinet for the
// one-per-worker rule + hours; the full cabinet selection is persisted to
// localStorage for the session (device-local; the timer/pause/resume themselves
// follow the worker cross-device via crew_active_projects).

type GMCabinet = { id: string; label: string; cabinet_number: string | null; roomNumber: string | null; status: string | null; partCount: number };
type CompletionBehavior = 'auto_route_to_qc' | 'push_picker' | null;
type Session = { jobNumber: string | null; jobPath: string; cabinetIds: string[]; label: string };

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

export default function GroupManualTemplateView({
  tenantId, deptName, completionBehavior, crewName = '', aiMode = 'learn',
  showToast, isClockedIn = true, onRequireClock,
}: Props) {
  const deptKey = deptName.toLowerCase();
  const behavior: CompletionBehavior = completionBehavior ?? 'push_picker';
  const SESSION_KEY = `groupmanual_session_${deptKey}`;

  const [cabsByJob, setCabsByJob] = useState<Record<string, GMCabinet[]>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Picker state
  const [pickJob, setPickJob] = useState<string | null>(null);
  const [selectedCabs, setSelectedCabs] = useState<Set<string>>(new Set());

  // Session state
  const [session, setSession] = useState<Session | null>(null);
  const [pausedProject, setPausedProject] = useState<ActiveProject | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushPickerOpen, setPushPickerOpen] = useState(false);
  const [, setTick] = useState(0);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const readStoredSession = useCallback((): Session | null => {
    try { const r = localStorage.getItem(SESSION_KEY); return r ? (JSON.parse(r) as Session) : null; } catch { return null; }
  }, [SESSION_KEY]);
  const writeStoredSession = useCallback((s: Session | null) => {
    try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }, [SESSION_KEY]);

  const jobLabelFor = useCallback((jobNumber: string | null) =>
    jobNumber ? (jobPaths[jobNumber] ? jobPaths[jobNumber].split('/').map((s) => s.trim()).join(' / ') : `Job ${jobNumber}`) : 'No Job', [jobPaths]);

  const load = useCallback(async () => {
    try {
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, cabinet_unit_id, job_number')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', deptKey)
        .neq('status', 'complete')
        .limit(2000);
      let pRows = (partRows as { id: string; cabinet_unit_id: string; job_number: string | null }[] | null) ?? [];
      if (activeJobNums) pRows = pRows.filter((p) => !p.job_number || activeJobNums!.has(p.job_number));

      const countByCab: Record<string, number> = {};
      pRows.forEach((p) => { countByCab[p.cabinet_unit_id] = (countByCab[p.cabinet_unit_id] ?? 0) + 1; });
      const cabIds = Object.keys(countByCab);

      const byJob: Record<string, GMCabinet[]> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number, room_number, status, job_number').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null; room_number: string | null; status: string | null; job_number: string | null }[] | null) ?? []).forEach((c) => {
          const jn = c.job_number ?? '__nojob__';
          (byJob[jn] ??= []).push({ id: c.id, label: c.unit_label || c.cabinet_number || 'Cabinet', cabinet_number: c.cabinet_number, roomNumber: c.room_number, status: c.status, partCount: countByCab[c.id] ?? 0 });
        });
      }
      // Stable cabinet order within each job.
      Object.values(byJob).forEach((arr) => arr.sort((a, b) => (a.cabinet_number || a.label).localeCompare(b.cabinet_number || b.label, undefined, { numeric: true })));
      setCabsByJob(byJob);

      const jobNums = Object.keys(byJob).filter((j) => j !== '__nojob__');
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { map[j.job_number] = j.job_path || `Job ${j.job_number}`; });
          setJobPaths(map);
        } catch { /* best-effort */ }
      }

      // Restore session / paused project for this worker + dept.
      const proj = await getWorkerProject(tenantId, crewName);
      if (proj && proj.dept === deptKey && proj.status === 'active') {
        if (!sessionRef.current) {
          const stored = readStoredSession();
          if (stored && stored.jobNumber === proj.job_number) {
            setSession(stored);
          } else {
            // Cross-device or lost selection — reconstruct from all this job's cabinets.
            const jobCabs = byJob[proj.job_number ?? '__nojob__'] ?? [];
            setSession({ jobNumber: proj.job_number, jobPath: jobLabelFor(proj.job_number), cabinetIds: jobCabs.map((c) => c.id), label: proj.unit_label });
          }
        }
        setPausedProject(null);
      } else if (proj && proj.dept === deptKey && proj.status === 'paused') {
        setPausedProject(proj);
        setSession(null);
      } else {
        setPausedProject(null);
      }
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId, deptKey, crewName, readStoredSession, jobLabelFor]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-groupmanual-${deptKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, deptKey, load]);

  // Live tick while a session runs (pulsing dot only — crew never sees a clock).
  useEffect(() => {
    if (!session) return;
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [session]);

  const jobOptions = useMemo(() =>
    Object.keys(cabsByJob)
      .map((jobNumber) => ({ jobNumber, label: jobLabelFor(jobNumber === '__nojob__' ? null : jobNumber), count: cabsByJob[jobNumber].length }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  [cabsByJob, jobLabelFor]);

  // ── Start a manual session over the selected cabinets ────────────────────────
  async function startSession(jobNumber: string | null, jobPath: string, cabinetIds: string[]) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (cabinetIds.length === 0) { showToast('Select at least one cabinet', true); return; }
    if (busy) return;
    setBusy(true);
    try {
      // Global one-project-per-worker rule — never clobber another open project.
      const existing = await getWorkerProject(tenantId, crewName);
      if (existing) {
        showToast(existing.status === 'paused' ? 'Resume your paused project first' : 'Finish your current project first', true);
        return;
      }
      const rep = cabinetIds[0];
      const label = `${jobPath} — ${cabinetIds.length} cabinet${cabinetIds.length === 1 ? '' : 's'}`;
      await startProjectSession({ tenantId, workerName: crewName, dept: deptKey, cabinetUnitId: rep, unitLabel: label, jobNumber, accumulatedSeconds: 0 });
      // Flag the selected cabinets as building for supervisor visibility.
      try { await supabase.from('cabinet_units').update({ status: 'building' }).in('id', cabinetIds).eq('tenant_id', tenantId); } catch { /* best-effort */ }
      const s: Session = { jobNumber, jobPath, cabinetIds, label };
      writeStoredSession(s);
      setSession(s);
      setPausedProject(null);
      setSelectedCabs(new Set());
      setPickJob(null);
      showToast('Session started');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start session', true);
    } finally {
      setBusy(false);
    }
  }

  async function pauseSession() {
    if (!session || busy) return;
    setBusy(true);
    try {
      const res = await pauseWorkerProject(tenantId, crewName);
      writeStoredSession(null);
      setSession(null);
      if (res) showToast(`Paused — ${fmtAccumulated(res.accumulated)} logged`);
      void load();
    } finally {
      setBusy(false);
    }
  }

  async function resumeSession(proj: ActiveProject) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (busy) return;
    setBusy(true);
    try {
      const stored = readStoredSession();
      const jobCabs = cabsByJob[proj.job_number ?? '__nojob__'] ?? [];
      const cabinetIds = stored && stored.jobNumber === proj.job_number ? stored.cabinetIds : jobCabs.map((c) => c.id);
      await startProjectSession({
        tenantId, workerName: crewName, dept: deptKey, cabinetUnitId: proj.cabinet_unit_id,
        unitLabel: proj.unit_label, jobNumber: proj.job_number, accumulatedSeconds: proj.accumulated_seconds ?? 0,
      });
      const s: Session = { jobNumber: proj.job_number, jobPath: jobLabelFor(proj.job_number), cabinetIds, label: proj.unit_label };
      writeStoredSession(s);
      setSession(s);
      setPausedProject(null);
      showToast('Session resumed');
    } finally {
      setBusy(false);
    }
  }

  // Close + log the active session's time_clock row, then delete the project.
  async function endSessionTimer() {
    const proj = await getWorkerProject(tenantId, crewName);
    if (proj && proj.status === 'active' && proj.time_clock_id) {
      const now = new Date().toISOString();
      const sessionSeconds = proj.session_start ? Math.max(0, Math.floor((Date.now() - new Date(proj.session_start).getTime()) / 1000)) : 0;
      try { await supabase.from('time_clock').update({ clock_out: now, total_hours: Math.round((sessionSeconds / 3600) * 100) / 100 }).eq('id', proj.time_clock_id); } catch { /* best-effort */ }
    }
    await clearProject(tenantId, crewName);
  }

  // Fetch every part in the session's selected cabinets that's still in this dept.
  async function sessionParts(): Promise<{ id: string; part_name: string; cabinet_unit_id: string; job_number: string | null }[]> {
    const s = sessionRef.current;
    if (!s || s.cabinetIds.length === 0) return [];
    const { data } = await supabase
      .from('parts').select('id, part_name, cabinet_unit_id, job_number')
      .in('cabinet_unit_id', s.cabinetIds).eq('tenant_id', tenantId).eq('assigned_dept', deptKey);
    return (data as { id: string; part_name: string; cabinet_unit_id: string; job_number: string | null }[] | null) ?? [];
  }

  // COMPLETE — apply the dept's completion_behavior across the whole selection.
  async function completeSession() {
    if (!session || busy) return;
    if (behavior === 'push_picker') { setPushPickerOpen(true); return; }
    // auto_route_to_qc
    setBusy(true);
    const s = session;
    const now = new Date().toISOString();
    try {
      await endSessionTimer();
      await Promise.allSettled(s.cabinetIds.map(async (cabId) => {
        await supabase.from('parts')
          .update({ assigned_dept: 'qc', checked: true, checked_at: now, checked_by: crewName || null })
          .eq('cabinet_unit_id', cabId).eq('tenant_id', tenantId).eq('assigned_dept', deptKey);
        await supabase.from('cabinet_units')
          .update({ status: 'ready_for_qc', assigned_dept: 'qc', completed_by: crewName || deptName })
          .eq('id', cabId).eq('tenant_id', tenantId);
      }));
      if (s.jobNumber) { try { await maybeNotifyJobQc(tenantId, s.jobNumber, jobLabelFor(s.jobNumber)); } catch { /* best-effort */ } }
      sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Cabinets ready for QC', body: `${s.jobPath} — ${s.cabinetIds.length} cabinet${s.cabinetIds.length === 1 ? '' : 's'}`, url: '/app/supervisor' });
      writeStoredSession(null);
      setSession(null);
      showToast('Sent to QC');
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete', true);
    } finally {
      setBusy(false);
    }
  }

  // push_picker complete — PushPicker moved the representative part; move the rest
  // of the selection's parts to the same dept, mark cabinets complete, reset.
  async function finishSessionPush(toDept: string) {
    const s = sessionRef.current;
    if (!s) return;
    setBusy(true);
    try {
      const all = await sessionParts();
      const rep = all[0];
      await endSessionTimer();
      for (const p of all) {
        if (rep && p.id === rep.id) continue;
        try { await pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: deptKey, toDept, workerName: crewName, timeClockId: null }); } catch { /* best-effort per part */ }
      }
      try { await supabase.from('cabinet_units').update({ status: 'complete' }).in('id', s.cabinetIds).eq('tenant_id', tenantId); } catch { /* best-effort */ }
      writeStoredSession(null);
      setSession(null);
      setPushPickerOpen(false);
      showToast(`Pushed to ${deptDisplay(toDept)}`);
      void load();
    } finally {
      setBusy(false);
    }
  }

  // The representative part for the PushPicker (first part across the selection).
  const [repPart, setRepPart] = useState<{ id: string; part_name: string; cabinet_unit_id: string; job_number: string | null } | null>(null);
  useEffect(() => {
    if (!pushPickerOpen) { setRepPart(null); return; }
    void (async () => { const all = await sessionParts(); setRepPart(all[0] ?? null); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushPickerOpen]);

  // ── Full-screen session view ─────────────────────────────────────────────────
  if (session) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#070a0c', display: 'flex', flexDirection: 'column' }}>
        <style>{`@keyframes gmPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>{session.cabinetIds.length} cabinet{session.cabinetIds.length === 1 ? '' : 's'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session.jobPath}</div>
          </div>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2DE1C9', flexShrink: 0, animation: 'gmPulse 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-mute)' }}>Working…</span>
        </div>

        {/* Spec verification — drill into the selected cabinets' parts. */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 18px 140px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 10 }}>Cabinets in this session</div>
          <JobPartsDrillDown tenantId={tenantId} cabinetUnitIds={session.cabinetIds} defaultOpen />
        </div>

        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderTop: '1px solid var(--line)', padding: '14px 18px calc(14px + env(safe-area-inset-bottom))', background: '#070a0c', display: 'flex', gap: 10 }}>
          <button onClick={() => void pauseSession()} disabled={busy}
            style={{ justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '14px 18px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.4)', color: '#FBBF24', cursor: busy ? 'wait' : 'pointer' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></svg>
            Pause
          </button>
          <button onClick={() => void completeSession()} disabled={busy}
            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: busy ? 'wait' : 'pointer' }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {busy ? 'Working…' : behavior === 'auto_route_to_qc' ? 'Complete → QC' : 'Complete'}
          </button>
        </div>

        {pushPickerOpen && repPart && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={(e) => { if (e.target === e.currentTarget && !busy) setPushPickerOpen(false); }}>
            <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Session complete</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: -6 }}>Choose where these {session.cabinetIds.length} cabinet{session.cabinetIds.length === 1 ? '' : 's'} go:</div>
              <PushPicker
                tenantId={tenantId}
                partId={repPart.id}
                partName={repPart.part_name}
                cabinetUnitId={repPart.cabinet_unit_id}
                jobNumber={repPart.job_number}
                currentDept={deptKey}
                workerName={crewName}
                timeClockId={null}
                aiMode={aiMode}
                onPushed={(toDept) => void finishSessionPush(toDept)}
                onToast={showToast}
              />
              <button onClick={() => setPushPickerOpen(false)} disabled={busy}
                style={{ alignSelf: 'center', background: 'none', border: 'none', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer', padding: '4px 0' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Picker / queue view ───────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: 32 }}>
      <style>{`@keyframes gmPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M3 7h6"/><path d="M3 12h6"/><path d="M3 17h9"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{deptDisplay(deptKey)}</div>
      </div>

      {/* Resume banner */}
      {pausedProject && (
        <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid rgba(251,191,36,0.4)' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Paused session</span>
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>Paused</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#FBBF24', marginTop: 2 }}>{pausedProject.unit_label} · {fmtAccumulated(pausedProject.accumulated_seconds ?? 0)} logged</div>
          </div>
          <button onClick={() => void resumeSession(pausedProject)} disabled={busy}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 10, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: busy ? 'wait' : 'pointer', flexShrink: 0 }}>
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
            Resume
          </button>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>No active work assigned</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Parts routed to {deptDisplay(deptKey)} will appear here. Pick a job, choose cabinets, and start a session.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobOptions.map((j) => {
            const open = pickJob === j.jobNumber;
            const cabs = cabsByJob[j.jobNumber] ?? [];
            const selInJob = cabs.filter((c) => selectedCabs.has(c.id)).length;
            const allSel = cabs.length > 0 && selInJob === cabs.length;
            return (
              <div key={j.jobNumber} style={{ borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <button onClick={() => { setPickJob(open ? null : j.jobNumber); setSelectedCabs(new Set()); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{j.count} cabinet{j.count === 1 ? '' : 's'}</span>
                </button>

                {open && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-mute)' }}>{selInJob}/{cabs.length} selected</span>
                      <button onClick={() => setSelectedCabs(allSel ? new Set() : new Set(cabs.map((c) => c.id)))}
                        style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                        {allSel ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                    {cabs.map((c) => {
                      const on = selectedCabs.has(c.id);
                      return (
                        <button key={c.id} onClick={() => setSelectedCabs((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: on ? 'rgba(45,225,201,0.06)' : 'var(--bg-1)', border: `1px solid ${on ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{c.label}</div>
                            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{c.roomNumber ? `Room ${c.roomNumber} · ` : ''}{c.partCount} part{c.partCount === 1 ? '' : 's'}</div>
                          </div>
                        </button>
                      );
                    })}
                    <button
                      onClick={() => void startSession(j.jobNumber === '__nojob__' ? null : j.jobNumber, j.label, cabs.filter((c) => selectedCabs.has(c.id)).map((c) => c.id))}
                      disabled={busy || selInJob === 0 || !!pausedProject}
                      title={pausedProject ? 'Resume your paused session first' : undefined}
                      style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: (selInJob === 0 || pausedProject) ? 'var(--bg-1)' : '#2DE1C9', border: (selInJob === 0 || pausedProject) ? '1px solid var(--line)' : 'none', color: (selInJob === 0 || pausedProject) ? 'var(--ink-mute)' : '#04201c', cursor: (busy || selInJob === 0 || pausedProject) ? 'not-allowed' : 'pointer' }}>
                      <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                      {pausedProject ? 'Resume paused session first' : `Start Session${selInJob > 0 ? ` (${selInJob})` : ''}`}
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
}
