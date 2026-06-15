'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { colorToHex, pushPart, deptDisplay, PART_DEPTS, recomputeCabinet, maybeNotifyJobQc, notifyDeptWork } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// ── Finishing department view ─────────────────────────────────────────────────
// Production-style UX: Job → Room → Cabinet → Parts hierarchy.
// Multiple rooms can run simultaneously (spray booth batch work).
// One timer per room session. Select at room / cabinet / part level.
// Push goes to any dept per selection; QC closes the room.

type FinishSpec = {
  id: string;
  job_number: string;
  job_path: string | null;
  cabinet_color: string | null;
  cabinet_finish: string | null;
  sheen: string | null;
  paint_type: string | null;
  primer: string | null;
  stain_color: string | null;
  door_style: string | null;
  door_color: string | null;
  door_finish: string | null;
  edge_banding_color: string | null;
  edge_banding_type: string | null;
  special_notes: string | null;
  room_overrides: Record<string, Record<string, string>> | null;
  spec_file_url: string | null;
  spec_file_name: string | null;
};

type FinishPart = {
  id: string;
  part_name: string;
  cabinet_unit_id: string;
  job_number: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  cabinetLabel: string;
  cabinetKey: string;
  roomNumber: string | null;
  jobPath: string;
};

// roomKey: `${jobNumber}::${roomNumber ?? '__noroom__'}`
type RoomTimer = { timeClockId: string | null; start: string };

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  crewName?: string;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
  onActiveTimerCount?: (count: number) => void;
}

const PUSH_DEPTS = PART_DEPTS.filter((d) => d.toLowerCase() !== 'finishing');

const FINISH_TIMERS_KEY = 'finishing_room_timers';

const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };
const rowLabel: React.CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 };
const rowVal: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink)', fontWeight: 600 };

const ColorChip = ({ color }: { color: string | null }) => (
  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, background: colorToHex(color), border: '1px solid rgba(255,255,255,0.18)', display: 'inline-block' }} />
);

function dimText(p: FinishPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}

function roomKey(jobNumber: string | null, roomNumber: string | null): string {
  return `${jobNumber ?? '__nojob__'}::${roomNumber ?? '__noroom__'}`;
}

function roomLabel(roomNumber: string | null): string {
  if (!roomNumber) return 'General';
  return `Room ${roomNumber}`;
}

export default function FinishingView({ tenantId, showToast, crewName = '', isClockedIn = true, onRequireClock, onActiveTimerCount }: Props) {
  const [specs, setSpecs] = useState<FinishSpec[]>([]);
  const [parts, setParts] = useState<FinishPart[]>([]);
  const [loading, setLoading] = useState(true);

  // Job folder expand state
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  // Room folder expand state — only one room open per job in the queue view
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  // Cabinet expand state within a room
  const [expandedCabs, setExpandedCabs] = useState<Record<string, boolean>>({});

  // Full-screen room work view: { jobNumber, roomNumber }
  const [openRoom, setOpenRoom] = useState<{ jobNumber: string | null; roomNumber: string | null; jobPath: string } | null>(null);

  // Active timers per room: roomKey → RoomTimer
  const [roomTimers, setRoomTimers] = useState<Record<string, RoomTimer>>(() => {
    try {
      const stored = localStorage.getItem(FINISH_TIMERS_KEY);
      return stored ? (JSON.parse(stored) as Record<string, RoomTimer>) : {};
    } catch { return {}; }
  });
  const roomTimersRef = useRef<Record<string, RoomTimer>>({});
  useEffect(() => { roomTimersRef.current = roomTimers; }, [roomTimers]);

  useEffect(() => {
    onActiveTimerCount?.(Object.keys(roomTimers).length);
  }, [roomTimers, onActiveTimerCount]);

  // On mount: close any orphaned time_clock rows from a previous session.
  // If the crew reloads mid-spray the timer state is restored from localStorage
  // but the time_clock rows may still be open. Close them now with the real
  // elapsed time so supervisor hour reports stay accurate.
  useEffect(() => {
    const stored = roomTimersRef.current;
    if (Object.keys(stored).length === 0) return;
    void (async () => {
      const now = new Date().toISOString();
      for (const timer of Object.values(stored)) {
        if (!timer.timeClockId) continue;
        try {
          const totalHours = Math.max(0, (new Date(now).getTime() - new Date(timer.start).getTime()) / 3600000);
          await supabase.from('time_clock')
            .update({ clock_out: now, total_hours: Math.round(totalHours * 100) / 100 })
            .eq('id', timer.timeClockId)
            .is('clock_out', null);
        } catch { /* best-effort */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selection: partId → true (works across cabinets/rooms in full-screen view)
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [selectMode, setSelectMode] = useState(false);

  // Push destination picker state (for selected parts)
  const [pushBusy, setPushBusy] = useState(false);
  const [qcBusy, setQcBusy] = useState(false);

  // Spec file viewer
  const [specFile, setSpecFile] = useState<ViewerFile | null>(null);

  const load = useCallback(async () => {
    try {
      let activeJobNums: string[] | null = null;
      try {
        const { data: jrows } = await supabase
          .from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = ((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number);
      } catch { /* jobs table optional */ }

      const { data: specRows } = await supabase
        .from('finish_specs').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false });
      let specList = (specRows as FinishSpec[] | null) ?? [];
      if (activeJobNums && activeJobNums.length > 0) {
        const set = new Set(activeJobNums);
        specList = specList.filter((s) => set.has(s.job_number));
      }
      setSpecs(specList);

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, material, width, height, depth, status')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'finishing')
        .neq('status', 'complete')
        .limit(1000);
      const pRows = (partRows as { id: string; part_name: string; cabinet_unit_id: string; job_number: string | null; material: string | null; width: number | null; height: number | null; depth: number | null; status: string | null }[] | null) ?? [];

      const cabIds = Array.from(new Set(pRows.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const cabMap: Record<string, { label: string; key: string; roomNumber: string | null }> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number, room_number').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null; room_number: string | null }[] | null) ?? []).forEach((c) => {
          cabMap[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '', roomNumber: c.room_number };
        });
      }

      const jobNums = Array.from(new Set(pRows.map((p) => p.job_number).filter(Boolean))) as string[];
      const jobPathMap: Record<string, string> = {};
      specList.forEach((s) => { if (s.job_path) jobPathMap[s.job_number] = s.job_path; });
      const missing = jobNums.filter((n) => !jobPathMap[n]);
      if (missing.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', missing);
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { jobPathMap[j.job_number] = j.job_path || `Job ${j.job_number}`; });
        } catch { /* best-effort */ }
      }

      const mappedParts: FinishPart[] = pRows.map((p) => {
        const cab = cabMap[p.cabinet_unit_id] ?? { label: 'Cabinet', key: '', roomNumber: null };
        return {
          id: p.id, part_name: p.part_name, cabinet_unit_id: p.cabinet_unit_id, job_number: p.job_number,
          material: p.material, width: p.width, height: p.height, depth: p.depth,
          cabinetLabel: cab.label, cabinetKey: cab.key, roomNumber: cab.roomNumber,
          jobPath: (p.job_number && jobPathMap[p.job_number]) || (p.job_number ? `Job ${p.job_number}` : 'Unassigned'),
        };
      });
      setParts(mappedParts);
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-finishing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finish_specs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

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

  // ── Data helpers ───────────────────────────────────────────────────────────

  const jobOptions = useMemo(() => {
    const map: Record<string, string> = {};
    parts.forEach((p) => { const jn = p.job_number ?? '__nojob__'; if (!map[jn]) map[jn] = p.jobPath; });
    return Object.entries(map)
      .map(([jobNumber, jobPath]) => ({ jobNumber, label: jobPath.split('/').map((s) => s.trim()).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [parts]);

  // Parts for a job grouped by room, then by cabinet — sorted by room number
  const roomsForJob = useCallback((jobNumber: string) => {
    const byRoom: Record<string, FinishPart[]> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      const rk = p.roomNumber ?? '__noroom__';
      (byRoom[rk] ??= []).push(p);
    });
    return Object.entries(byRoom)
      .sort(([a], [b]) => {
        if (a === '__noroom__') return 1;
        if (b === '__noroom__') return -1;
        return a.localeCompare(b, undefined, { numeric: true });
      })
      .map(([rk, rParts]) => {
        const byCAb: Record<string, FinishPart[]> = {};
        rParts.forEach((p) => { (byCAb[p.cabinet_unit_id] ??= []).push(p); });
        const cabinets = Object.entries(byCAb).map(([cabinetId, cParts]) => ({
          cabinetId, label: cParts[0].cabinetLabel, key: cParts[0].cabinetKey, parts: cParts,
        }));
        return { roomNumber: rk === '__noroom__' ? null : rk, parts: rParts, cabinets };
      });
  }, [parts]);

  const specForJob = useCallback((jobNumber: string | null) =>
    jobNumber ? specs.find((s) => s.job_number === jobNumber) ?? null : null, [specs]);

  // Merge job-level spec with room overrides
  function effectiveSpec(spec: FinishSpec | null, roomNumber: string | null): FinishSpec | null {
    if (!spec) return null;
    if (!roomNumber || !spec.room_overrides) return spec;
    // Match the supervisor's free-text room key against the cabinet's room_number.
    // Try: exact match, "Room N" format, then case-insensitive on either.
    const candidates = [
      roomNumber,
      `Room ${roomNumber}`,
    ];
    const overrideEntries = Object.entries(spec.room_overrides);
    let overrides: Record<string, string> = {};
    // First pass: exact match
    for (const c of candidates) {
      if (spec.room_overrides[c]) { overrides = spec.room_overrides[c]; break; }
    }
    // Second pass: case-insensitive match
    if (Object.keys(overrides).length === 0) {
      const lower = candidates.map((c) => c.toLowerCase());
      for (const [key, val] of overrideEntries) {
        if (lower.includes(key.trim().toLowerCase())) { overrides = val; break; }
      }
    }
    if (Object.keys(overrides).length === 0) return spec;
    return {
      ...spec,
      cabinet_color: overrides['Cabinet Color'] ?? spec.cabinet_color,
      door_color: overrides['Door Color'] ?? spec.door_color,
      sheen: overrides['Sheen'] ?? spec.sheen,
      cabinet_finish: overrides['Finish'] ?? spec.cabinet_finish,
      special_notes: overrides['Notes'] ?? spec.special_notes,
    };
  }

  // ── Timer helpers ──────────────────────────────────────────────────────────

  async function startRoomTimer(jobNumber: string | null, roomNumber: string | null, jobPath: string) {
    const rk = roomKey(jobNumber, roomNumber);
    if (roomTimersRef.current[rk]) return; // already running
    const now = new Date().toISOString();
    const label = `${roomLabel(roomNumber)} — ${jobPath.split('/').map((s) => s.trim()).join(' / ')}`;
    try {
      const { data } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || 'Finishing', dept: 'Finishing',
        clock_in: now, date: now.split('T')[0], status: 'finishing_work',
        notes: `Finishing: ${label}`, job_number: jobNumber,
      }).select('id').single();
      const id = (data as { id: string } | null)?.id ?? null;
      const next = { ...roomTimersRef.current, [rk]: { timeClockId: id, start: now } };
      setRoomTimers(next);
      try { localStorage.setItem(FINISH_TIMERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    } catch {
      const next = { ...roomTimersRef.current, [rk]: { timeClockId: null, start: now } };
      setRoomTimers(next);
      try { localStorage.setItem(FINISH_TIMERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    }
  }

  async function stopRoomTimer(jobNumber: string | null, roomNumber: string | null) {
    const rk = roomKey(jobNumber, roomNumber);
    const timer = roomTimersRef.current[rk];
    if (!timer) return;
    const next = { ...roomTimersRef.current };
    delete next[rk];
    setRoomTimers(next);
    try { localStorage.setItem(FINISH_TIMERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    if (!timer.timeClockId) return;
    try {
      const now = new Date().toISOString();
      const totalHours = Math.max(0, (new Date(now).getTime() - new Date(timer.start).getTime()) / 3600000);
      await supabase.from('time_clock').update({ clock_out: now, total_hours: Math.round(totalHours * 100) / 100 }).eq('id', timer.timeClockId);
    } catch { /* best-effort */ }
  }

  // ── Open / close room full-screen ──────────────────────────────────────────

  function openRoomView(jobNumber: string | null, roomNumber: string | null, jobPath: string, roomParts: FinishPart[]) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    setOpenRoom({ jobNumber, roomNumber, jobPath });
    // Default: all parts selected
    const init: Record<string, boolean> = {};
    roomParts.forEach((p) => { init[p.id] = true; });
    setSelected(init);
    setSelectMode(false);
    setExpandedCabs({});
    void startRoomTimer(jobNumber, roomNumber, jobPath);
  }

  // Collapse the full-screen room view back to the queue WITHOUT stopping
  // the timer. The timer keeps running in the background — crew can navigate
  // freely while finishing work continues. Timer only stops on Push or QC.
  function collapseRoomView() {
    setOpenRoom(null);
    setSelected({});
    setSelectMode(false);
  }

  // Exit the room view AND stop the timer. Called only from Push and QC paths.
  async function exitRoomView() {
    if (!openRoom) return;
    await stopRoomTimer(openRoom.jobNumber, openRoom.roomNumber);
    setOpenRoom(null);
    setSelected({});
    setSelectMode(false);
    void load();
  }

  // ── Selection helpers ──────────────────────────────────────────────────────

  function togglePart(partId: string) {
    setSelected((s) => ({ ...s, [partId]: !s[partId] }));
  }

  function toggleCabinet(cabParts: FinishPart[]) {
    const allOn = cabParts.every((p) => selected[p.id]);
    setSelected((s) => {
      const n = { ...s };
      cabParts.forEach((p) => { n[p.id] = !allOn; });
      return n;
    });
  }

  function selectAll(roomParts: FinishPart[]) {
    const init: Record<string, boolean> = {};
    roomParts.forEach((p) => { init[p.id] = true; });
    setSelected(init);
  }

  // ── Push selected parts ────────────────────────────────────────────────────

  async function pushSelected(toDept: string) {
    if (!openRoom || pushBusy) return;
    const items = parts.filter((p) =>
      (p.job_number ?? '__nojob__') === (openRoom.jobNumber ?? '__nojob__') &&
      (p.roomNumber ?? '__noroom__') === (openRoom.roomNumber ?? '__noroom__') &&
      selected[p.id]
    );
    if (items.length === 0) { showToast('Select at least one part', true); return; }
    setPushBusy(true);
    try {
      const results = await Promise.allSettled(items.map((p) =>
        pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: 'finishing', toDept, workerName: crewName, timeClockId: roomTimersRef.current[roomKey(openRoom.jobNumber, openRoom.roomNumber)]?.timeClockId ?? null })
      ));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) showToast(`${failed} part${failed === 1 ? '' : 's'} failed to push — try again`, true);
      // Recompute each unique cabinet
      const uniqueCabs = [...new Set(items.map((p) => p.cabinet_unit_id))];
      await Promise.allSettled(uniqueCabs.map((id) => recomputeCabinet(tenantId, id)));
      // Remove pushed parts from local state
      const pushedIds = new Set(items.map((p) => p.id));
      setParts((prev) => prev.filter((p) => !pushedIds.has(p.id)));
      setSelected((s) => { const n = { ...s }; pushedIds.forEach((id) => delete n[id]); return n; });
      notifyDeptWork(tenantId, toDept, openRoom.jobNumber, items.length - failed);
      showToast(`${items.length - failed} part${items.length - failed === 1 ? '' : 's'} sent to ${deptDisplay(toDept)}`);
      // If no parts remain in this room, close
      const remaining = parts.filter((p) =>
        !pushedIds.has(p.id) &&
        (p.job_number ?? '__nojob__') === (openRoom.jobNumber ?? '__nojob__') &&
        (p.roomNumber ?? '__noroom__') === (openRoom.roomNumber ?? '__noroom__')
      );
      if (remaining.length === 0) await exitRoomView();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Push failed', true);
    } finally {
      setPushBusy(false);
    }
  }

  // ── Send entire room to QC ─────────────────────────────────────────────────

  async function sendRoomToQc() {
    if (!openRoom || qcBusy) return;
    const roomParts = parts.filter((p) =>
      (p.job_number ?? '__nojob__') === (openRoom.jobNumber ?? '__nojob__') &&
      (p.roomNumber ?? '__noroom__') === (openRoom.roomNumber ?? '__noroom__')
    );
    if (roomParts.length === 0) { await exitRoomView(); return; }
    setQcBusy(true);
    const now = new Date().toISOString();
    try {
      // Move all finishing parts in this room to QC
      const cabIds = [...new Set(roomParts.map((p) => p.cabinet_unit_id))];
      await Promise.allSettled(cabIds.map(async (cabId) => {
        await supabase.from('parts')
          .update({ assigned_dept: 'qc', checked: true, checked_at: now, checked_by: crewName || null })
          .eq('cabinet_unit_id', cabId).eq('tenant_id', tenantId).eq('assigned_dept', 'finishing');
        await supabase.from('cabinet_units')
          .update({ status: 'ready_for_qc', assigned_dept: 'qc', completed_by: crewName || 'Finishing' })
          .eq('id', cabId).eq('tenant_id', tenantId);
      }));
      await stopRoomTimer(openRoom.jobNumber, openRoom.roomNumber);
      // Bell-log so supervisor has a record even if they miss the push.
      try {
        await supabase.from('notifications').insert({
          tenant_id: tenantId, target_type: 'supervisor',
          title: `${roomLabel(openRoom.roomNumber)} ready for QC`,
          body: `${openRoom.jobPath.split('/').map((s) => s.trim()).join(' / ')} — ${roomParts.length} part${roomParts.length === 1 ? '' : 's'}`,
          url: '/app/supervisor',
        });
      } catch { /* best-effort */ }
      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: `${roomLabel(openRoom.roomNumber)} ready for QC`,
        body: `${openRoom.jobPath.split('/').map((s) => s.trim()).join(' / ')} — ${roomParts.length} part${roomParts.length === 1 ? '' : 's'}`,
        url: '/app/supervisor',
      });
      // Fire the job-level "ready for QC" notification if this was the last room.
      try {
        await maybeNotifyJobQc(tenantId, openRoom.jobNumber, openRoom.jobPath.split('/').map((s) => s.trim()).join(' / '));
      } catch { /* best-effort */ }
      showToast(`${roomLabel(openRoom.roomNumber)} sent to QC`);
      await exitRoomView();
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send to QC', true);
    } finally {
      setQcBusy(false);
    }
  }

  // ── Full-screen room work view ─────────────────────────────────────────────

  if (openRoom) {
    const spec = effectiveSpec(specForJob(openRoom.jobNumber), openRoom.roomNumber);
    const roomParts = parts.filter((p) =>
      (p.job_number ?? '__nojob__') === (openRoom.jobNumber ?? '__nojob__') &&
      (p.roomNumber ?? '__noroom__') === (openRoom.roomNumber ?? '__noroom__')
    );
    const byCAb: Record<string, FinishPart[]> = {};
    roomParts.forEach((p) => { (byCAb[p.cabinet_unit_id] ??= []).push(p); });
    const cabinets = Object.entries(byCAb).map(([cabinetId, cParts]) => ({
      cabinetId, label: cParts[0].cabinetLabel, key: cParts[0].cabinetKey, parts: cParts,
    }));
    const selectedCount = roomParts.filter((p) => selected[p.id]).length;
    const allSelected = roomParts.length > 0 && roomParts.every((p) => selected[p.id]);
    const rk = roomKey(openRoom.jobNumber, openRoom.roomNumber);
    const timer = roomTimers[rk];

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#070a0c', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <button onClick={collapseRoomView} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }} aria-label="Back">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)' }}>{roomLabel(openRoom.roomNumber)}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{openRoom.jobPath.split('/').map((s) => s.trim()).join(' / ')}</div>
          </div>
          {timer && (
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#2DE1C9', flexShrink: 0, animation: 'finishPulse 1.4s ease-in-out infinite' }} />
          )}
          <button
            onClick={() => { setSelectMode((m) => !m); if (selectMode) setSelected({}); }}
            style={{ padding: '7px 14px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: selectMode ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', border: `1px solid ${selectMode ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.5)'}`, color: selectMode ? '#F87171' : '#FBBF24', cursor: 'pointer' }}>
            {selectMode ? 'Cancel' : 'Select'}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', maxWidth: '100vw', padding: '16px 18px 120px' }}>

          {/* Finish spec */}
          {spec && (
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 10 }}>Finish Spec</div>
              {(spec.cabinet_color || spec.cabinet_finish || spec.sheen) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <ColorChip color={spec.cabinet_color} />
                  <div><div style={rowLabel}>Cabinet</div><div style={rowVal}>{spec.cabinet_color || '—'}{(spec.cabinet_finish || spec.sheen) ? ` · ${[spec.cabinet_finish, spec.sheen].filter(Boolean).join(', ')}` : ''}</div></div>
                </div>
              )}
              {(spec.door_style || spec.door_color || spec.door_finish) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <ColorChip color={spec.door_color || spec.cabinet_color} />
                  <div><div style={rowLabel}>Doors</div><div style={rowVal}>{[spec.door_style, spec.door_color, spec.door_finish].filter(Boolean).join(' · ') || '—'}</div></div>
                </div>
              )}
              {(spec.edge_banding_color || spec.edge_banding_type) && (
                <div style={{ marginBottom: 8 }}><div style={rowLabel}>Edge Banding</div><div style={rowVal}>{[spec.edge_banding_color, spec.edge_banding_type].filter(Boolean).join(' · ')}</div></div>
              )}
              {spec.special_notes && <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 6, lineHeight: 1.5 }}>{spec.special_notes}</div>}
              {spec.spec_file_url && (
                <button onClick={() => setSpecFile({ url: spec.spec_file_url!, name: spec.spec_file_name || 'Finish Spec', jobPath: spec.job_path ?? undefined })}
                  style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  View Full Spec
                </button>
              )}
            </div>
          )}

          {/* Select-all row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-mute)' }}>{selectedCount}/{roomParts.length} selected</span>
            <button onClick={() => allSelected ? setSelected({}) : selectAll(roomParts)}
              style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* Cabinets */}
          {cabinets.map((cab) => {
            const cabSelected = cab.parts.every((p) => selected[p.id]);
            const cabSome = cab.parts.some((p) => selected[p.id]) && !cabSelected;
            const cabExpanded = !!expandedCabs[cab.cabinetId];
            return (
              <div key={cab.cabinetId} style={{ marginBottom: 10, borderRadius: 12, border: `1px solid ${cabSelected ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, background: 'var(--bg-1)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px' }}>
                  {/* Cabinet-level checkbox */}
                  <button onClick={() => toggleCabinet(cab.parts)}
                    style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${cabSelected ? 'var(--teal)' : cabSome ? 'rgba(251,191,36,0.8)' : 'var(--line-strong)'}`, background: cabSelected ? 'var(--teal)' : cabSome ? 'rgba(251,191,36,0.25)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}>
                    {cabSelected && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </button>
                  <button onClick={() => setExpandedCabs((e) => ({ ...e, [cab.cabinetId]: !e[cab.cabinetId] }))}
                    style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0 }}>
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: cabExpanded ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{cab.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)', marginLeft: 'auto' }}>{cab.parts.length} part{cab.parts.length === 1 ? '' : 's'}</span>
                  </button>
                  <ViewDrawingsButton tenantId={tenantId} jobNumber={openRoom.jobNumber} cabinetKey={cab.key} compact />
                </div>
                {cabExpanded && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cab.parts.map((p) => {
                      const on = !!selected[p.id];
                      const dims = dimText(p);
                      return (
                        <button key={p.id} onClick={() => togglePart(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: on ? 'rgba(45,225,201,0.06)' : 'transparent', border: `1px solid ${on ? 'rgba(45,225,201,0.3)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 5, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {on && <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                          </span>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{p.part_name}</div>
                            {(dims || p.material) && <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>{[dims, p.material].filter(Boolean).join(' · ')}</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Bottom action bar */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderTop: '1px solid var(--line)', padding: '14px 18px calc(14px + env(safe-area-inset-bottom))', background: '#070a0c', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {selectedCount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginBottom: 2 }}>Push {selectedCount} part{selectedCount === 1 ? '' : 's'} to:</div>
          )}
          {selectedCount > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PUSH_DEPTS.map((d) => (
                <button key={d} onClick={() => void pushSelected(d)} disabled={pushBusy}
                  style={{ flex: 1, minWidth: 0, justifyContent: 'center', display: 'flex', alignItems: 'center', padding: '11px 10px', borderRadius: 10, fontSize: 13, fontWeight: 800, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: pushBusy ? 'wait' : 'pointer', opacity: pushBusy ? 0.6 : 1 }}>
                  {deptDisplay(d)}
                </button>
              ))}
            </div>
          )}
          <button onClick={() => void sendRoomToQc()} disabled={qcBusy}
            style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: qcBusy ? 'wait' : 'pointer', opacity: qcBusy ? 0.6 : 1 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            {qcBusy ? 'Sending…' : 'Send Room to QC'}
          </button>
        </div>
        <style>{`@keyframes finishPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
        {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
      </div>
    );
  }

  // ── Queue view: Job → Room → Cabinet ──────────────────────────────────────

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Finishing</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading finishing queue…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--ink-mute)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nothing to finish yet</div>
          <div style={{ fontSize: 12.5 }}>Parts pushed to Finishing will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobOptions.map((j) => {
            const jobOpen = expandedJob === j.jobNumber;
            const rooms = jobOpen ? roomsForJob(j.jobNumber) : [];
            const count = parts.filter((p) => (p.job_number ?? '__nojob__') === j.jobNumber).length;
            return (
              <div key={j.jobNumber} style={{ borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                {/* Job folder */}
                <button onClick={() => setExpandedJob(jobOpen ? null : j.jobNumber)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: jobOpen ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{count} piece{count === 1 ? '' : 's'}</span>
                </button>

                {/* Room folders */}
                {jobOpen && (
                  <div style={{ borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                    {rooms.map((room) => {
                      const rk = roomKey(j.jobNumber, room.roomNumber);
                      const roomOpen = expandedRoom === rk;
                      const activeTimer = !!roomTimers[rk];
                      return (
                        <div key={rk} style={{ borderBottom: '1px solid var(--line)' }}>
                          <button onClick={() => setExpandedRoom(roomOpen ? null : rk)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px 12px 24px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: roomOpen ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{roomLabel(room.roomNumber)}</span>
                            {activeTimer && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2DE1C9', display: 'inline-block', animation: 'finishPulse 1.4s ease-in-out infinite' }} />}
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{room.parts.length} piece{room.parts.length === 1 ? '' : 's'}</span>
                          </button>

                          {/* Cabinet list inside room */}
                          {roomOpen && (
                            <div style={{ padding: '8px 14px 12px 32px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {room.cabinets.map((cab) => (
                                <button key={cab.cabinetId}
                                  onClick={() => openRoomView(j.jobNumber === '__nojob__' ? null : j.jobNumber, room.roomNumber, j.label, room.parts)}
                                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                                  <div style={{ minWidth: 0, flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{cab.label}</div>
                                    <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{cab.parts.length} part{cab.parts.length === 1 ? '' : 's'}</div>
                                  </div>
                                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
                                </button>
                              ))}
                              {/* Open room button */}
                              <button onClick={() => openRoomView(j.jobNumber === '__nojob__' ? null : j.jobNumber, room.roomNumber, j.label, room.parts)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 12, fontSize: 13.5, fontWeight: 800, fontFamily: 'inherit', background: activeTimer ? 'rgba(45,225,201,0.12)' : 'rgba(45,225,201,0.08)', border: `1px solid ${activeTimer ? 'rgba(45,225,201,0.5)' : 'rgba(45,225,201,0.25)'}`, color: 'var(--teal)', cursor: 'pointer' }}>
                                {activeTimer ? (
                                  <>
                                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2DE1C9', animation: 'finishPulse 1.4s ease-in-out infinite' }} />
                                    Continue Working
                                  </>
                                ) : (
                                  <>
                                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
                                    Start Room
                                  </>
                                )}
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
      <style>{`@keyframes finishPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
      {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
    </div>
  );
}
