'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import PushPicker from '@/components/PushPicker';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// ── Craftsman builds (crew view) ──────────────────────────────────────────────
// Shows parts pushed to the Craftsman dept (parts.assigned_dept = 'craftsman'),
// grouped by job → cabinet (folder accordion). A build timer for each part starts
// when its cabinet is opened and stops when the craftsman pushes the part on. The
// elapsed time is logged to time_clock so the Reports tab sees the hours. The Push
// Picker sends each part to Finishing, Assembly or back to Production.

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
};

type CabInfo = { label: string; key: string };

interface Props {
  tenantId: string;
  crewName: string;
  timeClockId: string | null;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
}

const STARTS_KEY = 'craftsman_part_starts';

function dimLabel(p: CPart): string {
  const parts: string[] = [];
  if (p.width)  parts.push(`${p.width}"`);
  if (p.height) parts.push(`${p.height}"`);
  if (p.depth)  parts.push(`${p.depth}"`);
  return parts.join('x');
}
function partLabel(p: CPart): string {
  const bits = [p.part_name];
  const d = dimLabel(p);
  if (d) bits.push(d);
  if (p.material) bits.push(p.material);
  return bits.join(' — ');
}
function fmtElapsed(startISO: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startISO).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const IcoCraft = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);

export default function CraftsmanBuilds({ tenantId, crewName, timeClockId, showToast, isClockedIn = true, onRequireClock }: Props) {
  const [parts, setParts] = useState<CPart[]>([]);
  const [cabInfo, setCabInfo] = useState<Record<string, CabInfo>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  // Per-part build-start timestamps (persisted so timers survive a reload).
  const [starts, setStarts] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);
  const startsRef = useRef<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, cabinet_unit_id, job_number, part_name, material, width, height, depth, quantity, assigned_dept, flag_type')
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

  // Restore persisted build-start timestamps.
  useEffect(() => {
    try { const r = localStorage.getItem(STARTS_KEY); if (r) { const v = JSON.parse(r); setStarts(v); startsRef.current = v; } } catch { /* ignore */ }
  }, []);
  useEffect(() => { startsRef.current = starts; }, [starts]);

  // Live tick while any timer is running.
  useEffect(() => {
    const iv = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  function persistStarts(next: Record<string, string>) {
    setStarts(next);
    startsRef.current = next;
    try { localStorage.setItem(STARTS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  // Start the build timer for every part on a cabinet when it's first opened.
  function ensureStarted(partIds: string[]) {
    const cur = startsRef.current;
    const missing = partIds.filter((id) => !cur[id]);
    if (missing.length === 0) return;
    const now = new Date().toISOString();
    const next = { ...cur };
    missing.forEach((id) => { next[id] = now; });
    persistStarts(next);
  }

  // On push: log the elapsed build time to time_clock, then clear the timer.
  function onPartPushed(part: CPart) {
    const start = startsRef.current[part.id];
    if (start) {
      const durationMin = Math.round((Date.now() - new Date(start).getTime()) / 60000);
      if (durationMin > 0) {
        const clockInISO = start;
        const now = new Date().toISOString();
        void supabase.from('time_clock').insert({
          tenant_id: tenantId,
          worker_name: crewName || 'Craftsman',
          dept: 'Craftsman',
          clock_in: clockInISO,
          clock_out: now,
          date: now.split('T')[0],
          total_hours: durationMin / 60,
          status: 'craftsman_build',
          notes: `Build: ${part.part_name}`,
          job_number: part.job_number ?? null,
        }).then(() => {}, () => {});
      }
      const next = { ...startsRef.current }; delete next[part.id]; persistStarts(next);
    }
    setParts((prev) => prev.filter((p) => p.id !== part.id));
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

  // When a job opens, start timers for all of its parts.
  useEffect(() => {
    if (!selectedJob) return;
    const ids = parts.filter((p) => (p.job_number ?? '__nojob__') === selectedJob).map((p) => p.id);
    if (ids.length) ensureStarted(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob, parts]);

  const cabinetsForJob = (jobNumber: string) => {
    const groups: Record<string, CPart[]> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      (groups[p.cabinet_unit_id] ??= []).push(p);
    });
    return Object.entries(groups).map(([cabinetId, cp]) => ({ cabinetId, parts: cp }));
  };

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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
                    {cabs.map((c) => {
                      const info = cabInfo[c.cabinetId] ?? { label: 'Cabinet', key: '' };
                      return (
                        <div key={c.cabinetId} style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</span>
                            <ViewDrawingsButton tenantId={tenantId} jobNumber={c.parts[0]?.job_number ?? null} cabinetKey={info.key} compact={false} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {c.parts.map((p) => {
                              const start = starts[p.id];
                              return (
                                <div key={p.id} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: p.flag_type ? '#F87171' : 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partLabel(p)}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</span>
                                    {start && (
                                      <span style={{ fontSize: 13, fontWeight: 700, color: '#60A5FA', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtElapsed(start)}</span>
                                    )}
                                  </div>
                                  <PushPicker
                                    tenantId={tenantId}
                                    partId={p.id}
                                    partName={p.part_name}
                                    cabinetUnitId={p.cabinet_unit_id}
                                    jobNumber={p.job_number}
                                    currentDept="craftsman"
                                    workerName={crewName}
                                    timeClockId={timeClockId}
                                    onPushed={() => onPartPushed(p)}
                                    onToast={showToast}
                                  />
                                </div>
                              );
                            })}
                          </div>
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
}
