'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { pushPart } from '@/lib/partActions';
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
// the build running in real time; null until that insert lands.
type ActiveBuild = { unitId: string; start: string; stop: string | null; timeClockId: string | null };

interface Props {
  tenantId: string;
  crewName: string;
  timeClockId: string | null;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
  aiMode?: AiMode;
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

export default function CraftsmanBuilds({ tenantId, crewName, timeClockId, showToast, isClockedIn = true, onRequireClock, aiMode = 'learn' }: Props) {
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
  // Which parts are selected for the push (all default).
  const [pushSel, setPushSel] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0);

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
    } catch { /* leave existing state */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-craftsman-builds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  // Restore an in-progress build after a reload (only restores, never starts).
  useEffect(() => {
    try {
      const r = localStorage.getItem(BUILD_KEY);
      if (r) { const v = JSON.parse(r) as ActiveBuild; setBuild(v); buildRef.current = v; setOpenUnitId(v.unitId); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { buildRef.current = build; }, [build]);

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
    const start = new Date().toISOString();
    // Start the build instantly in the UI, then open a live time_clock row (no
    // clock_out) so the supervisor's Craftsman Build Activity panel shows it
    // running in real time. The row id is stored on the build for the close.
    persistBuild({ unitId: cabinetId, start, stop: null, timeClockId: null });
    try {
      const cab = cabInfo[cabinetId];
      const jobNumber = parts.find((p) => p.cabinet_unit_id === cabinetId)?.job_number ?? null;
      const { data, error } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || 'Craftsman', dept: 'Craftsman',
        clock_in: start, date: start.split('T')[0], status: 'craftsman_build',
        notes: `Build: ${cab?.label ?? 'Cabinet'}`, job_number: jobNumber,
      }).select('id').single();
      if (error) throw error;
      const id = (data as { id: string }).id;
      const b = buildRef.current;
      if (b && b.unitId === cabinetId) persistBuild({ ...b, timeClockId: id });
    } catch { /* live row best-effort; finishUnitBuild still logs hours on push */ }
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
    persistBuild(null);
    setPushSel({});
    // If every part on the cabinet was pushed, the cabinet leaves the queue.
    const remaining = allParts.some((p) => !pushSel[p.id]);
    setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cabinetId || (remaining && !pushSel[p.id])));
    if (!remaining) setOpenUnitId(null);
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

  // ── Full-screen work order ─────────────────────────────────────────────────
  if (openUnitId) {
    const cabParts = parts.filter((p) => p.cabinet_unit_id === openUnitId);
    const info = cabInfo[openUnitId] ?? { label: 'Cabinet', key: '' };
    const isBuilding = build?.unitId === openUnitId;
    const isPushing = isBuilding && !!build?.stop;
    const anotherActive = !!build && build.unitId !== openUnitId;
    const elapsed = build && isBuilding ? elapsedSeconds(build.start, build.stop) : 0;
    const canPush = elapsed >= MIN_PUSH_SECONDS;
    const representative = cabParts.find((p) => pushSel[p.id]) ?? cabParts[0];
    const jobNumber = cabParts[0]?.job_number ?? null;
    // Progress bar — pure visual fill on a 1-hour scale, no endpoint/estimate.
    const fillPct = Math.min(100, (elapsed / 3600) * 100);

    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#070a0c', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => setOpenUnitId(null)} disabled={isBuilding} title={isBuilding ? 'Finish or push the build first' : undefined}
            style={{ background: 'none', border: 'none', cursor: isBuilding ? 'not-allowed' : 'pointer', color: isBuilding ? 'var(--line-strong)' : 'var(--ink-mute)', padding: 4, display: 'flex' }} aria-label="Back">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--ink)' }}>{info.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{jobLabel(jobNumber)}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <ViewDrawingsButton tenantId={tenantId} jobNumber={jobNumber} cabinetKey={info.key} compact={false} />
          </div>
        </div>

        {/* Work order — every part's full spec, always expanded */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px', background: '#070a0c' }}>
          {!isBuilding ? (
            <button onClick={() => void startBuild(openUnitId)} disabled={anotherActive}
              title={anotherActive ? 'Finish your current build first' : undefined}
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 800, fontFamily: 'inherit', background: anotherActive ? 'var(--bg-1)' : '#60A5FA', border: 'none', color: anotherActive ? 'var(--ink-mute)' : '#041020', cursor: anotherActive ? 'not-allowed' : 'pointer' }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>
              {anotherActive ? 'Another build in progress' : 'Start Build'}
            </button>
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
                <button onClick={() => readyToPush(openUnitId, cabParts)} disabled={!canPush}
                  title={!canPush ? 'Let the build run first' : undefined}
                  style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: canPush ? '#2DE1C9' : 'var(--bg-1)', border: `1px solid ${canPush ? '#2DE1C9' : 'var(--line)'}`, color: canPush ? '#04201c' : 'var(--ink-mute)', cursor: canPush ? 'pointer' : 'not-allowed' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  Push To
                </button>
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
      </div>
    );
  }

  // ── Queue view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: 'var(--teal)', display: 'flex' }}><IcoCraft /></span>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Craftsman Builds</div>
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
                      return (
                        <button key={c.cabinetId} onClick={() => setOpenUnitId(c.cabinetId)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 12, background: 'var(--bg-1)', border: `1px solid ${building ? 'rgba(96,165,250,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</div>
                            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2 }}>{c.parts.length} part{c.parts.length === 1 ? '' : 's'}{building ? ' · building now' : ''}</div>
                          </div>
                          {building && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#60A5FA', display: 'inline-block', animation: 'craftPulse 1.4s ease-in-out infinite' }} />}
                          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
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
      <style>{`@keyframes craftPulse{0%,100%{opacity:1}50%{opacity:0.25}}`}</style>
    </div>
  );
}
