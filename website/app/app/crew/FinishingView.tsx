'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { colorToHex, pushPart, maybeNotifyJobQc } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import PushPicker, { type AiMode } from '@/components/PushPicker';

// The Finishing department's view. The queue lists jobs -> cabinets; tapping a
// cabinet opens a full-screen work view:
//   - cabinet header + the job's finish spec (color / finish / sheen / edge band
//     / door style)
//   - the cabinet's parts with checkboxes (all selected by default)
//   - two exits: PUSH (send the selected parts on to the next dept) and QC.
//
// A background timer starts automatically when the cabinet opens (no start
// button, no visible clock) and stops on PUSH / QC / back — logging to
// time_clock so the supervisor's Pipeline / Worker Timeline / Dept Time by Job
// all see the finishing hours. There is no CO/Damage button — crew use the home
// screen damage report button for all damage / change orders.

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
  jobPath: string;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  crewName?: string;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
  aiMode?: AiMode;
}

const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const rowLabel: React.CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 };
const rowVal: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink)', fontWeight: 600 };

const ColorChip = ({ color }: { color: string | null }) => (
  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, background: colorToHex(color), border: '1px solid rgba(255,255,255,0.18)', display: 'inline-block' }} />
);

function dimText(p: FinishPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}

export default function FinishingView({ tenantId, showToast, crewName = '', isClockedIn = true, onRequireClock, aiMode = 'learn' }: Props) {
  const [specs, setSpecs] = useState<FinishSpec[]>([]);
  const [parts, setParts] = useState<FinishPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [specFile, setSpecFile] = useState<ViewerFile | null>(null);

  // Full-screen cabinet work view.
  const [openCab, setOpenCab] = useState<{ cabinetId: string; label: string; key: string; jobNumber: string | null; jobPath: string } | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [exitBusy, setExitBusy] = useState(false);
  // Background finishing timer for the open cabinet. State drives the PushPicker
  // prop (so it re-renders with the real id); the ref mirror lets async handlers
  // read the latest value without a stale closure.
  const [finishTcId, setFinishTcId] = useState<string | null>(null);
  const timeClockId = useRef<string | null>(null);
  const setTimeClock = (id: string | null) => { timeClockId.current = id; setFinishTcId(id); };

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
        .limit(400);
      const pRows = (partRows as { id: string; part_name: string; cabinet_unit_id: string; job_number: string | null; material: string | null; width: number | null; height: number | null; depth: number | null; status: string | null }[] | null) ?? [];

      const cabIds = Array.from(new Set(pRows.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const cabMap: Record<string, { label: string; key: string }> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null }[] | null) ?? []).forEach((c) => {
          cabMap[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '' };
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

      setParts(pRows.map((p) => {
        const cab = cabMap[p.cabinet_unit_id] ?? { label: 'Cabinet', key: '' };
        return {
          id: p.id, part_name: p.part_name, cabinet_unit_id: p.cabinet_unit_id, job_number: p.job_number,
          material: p.material, width: p.width, height: p.height, depth: p.depth,
          cabinetLabel: cab.label, cabinetKey: cab.key,
          jobPath: (p.job_number && jobPathMap[p.job_number]) || (p.job_number ? `Job ${p.job_number}` : 'Unassigned'),
        };
      }));
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-finishing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finish_specs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { if (!openCab) void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load, openCab]);

  const jobOptions = useMemo(() => {
    const map: Record<string, string> = {};
    parts.forEach((p) => { const jn = p.job_number ?? '__nojob__'; if (!map[jn]) map[jn] = p.jobPath; });
    return Object.entries(map)
      .map(([jobNumber, jobPath]) => ({ jobNumber, label: jobPath.split('/').map((s) => s.trim()).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [parts]);

  useEffect(() => {
    if (!selectedJob) return;
    if (!jobOptions.some((j) => j.jobNumber === selectedJob)) setSelectedJob('');
  }, [jobOptions, selectedJob]);

  const groupsForJob = useCallback((jobNumber: string) => {
    const groups: Record<string, { label: string; key: string; parts: FinishPart[] }> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      const g = (groups[p.cabinet_unit_id] ??= { label: p.cabinetLabel, key: p.cabinetKey, parts: [] });
      g.parts.push(p);
    });
    return Object.entries(groups).map(([cabinetId, g]) => ({ cabinetId, ...g }));
  }, [parts]);

  const openCabParts = useMemo(
    () => (openCab ? parts.filter((p) => p.cabinet_unit_id === openCab.cabinetId) : []),
    [openCab, parts],
  );
  const specForJob = useCallback((jobNumber: string | null) => jobNumber ? specs.find((s) => s.job_number === jobNumber) ?? null : null, [specs]);

  // ── Background timer ───────────────────────────────────────────────────────
  async function startTimer(jobNumber: string | null, label: string) {
    const now = new Date().toISOString();
    try {
      const { data } = await supabase.from('time_clock').insert({
        tenant_id: tenantId, worker_name: crewName || 'Finishing', dept: 'Finishing',
        clock_in: now, date: now.split('T')[0], status: 'finishing_work',
        notes: `Finishing: ${label}`, job_number: jobNumber,
      }).select('id').single();
      setTimeClock((data as { id: string } | null)?.id ?? null);
    } catch { setTimeClock(null); }
  }
  async function stopTimer() {
    const id = timeClockId.current;
    setTimeClock(null);
    if (!id) return;
    try {
      const { data } = await supabase.from('time_clock').select('clock_in').eq('id', id).single();
      const clockIn = (data as { clock_in: string } | null)?.clock_in;
      const now = new Date().toISOString();
      const totalHours = clockIn ? Math.max(0, (new Date(now).getTime() - new Date(clockIn).getTime()) / 3600000) : 0;
      await supabase.from('time_clock').update({ clock_out: now, total_hours: Math.round(totalHours * 100) / 100 }).eq('id', id);
    } catch { /* best-effort */ }
  }

  function openCabinet(g: { cabinetId: string; label: string; key: string; parts: FinishPart[] }) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    const jobNumber = g.parts[0]?.job_number ?? null;
    const jobPath = g.parts[0]?.jobPath ?? '';
    setOpenCab({ cabinetId: g.cabinetId, label: g.label, key: g.key, jobNumber, jobPath });
    // All parts selected by default.
    const initial: Record<string, boolean> = {};
    g.parts.forEach((p) => { initial[p.id] = true; });
    setChecked(initial);
    void startTimer(jobNumber, g.label);
  }
  async function closeCabinet() {
    await stopTimer();
    setOpenCab(null);
    setChecked({});
    void load();
  }

  // ── QC exit — send the whole cabinet to QC (Finishing -> QC directly) ───────
  async function sendToQc() {
    if (!openCab || exitBusy) return;
    setExitBusy(true);
    const now = new Date().toISOString();
    try {
      // Move every finishing part on this cabinet out to QC.
      await supabase.from('parts')
        .update({ assigned_dept: 'qc', checked: true, checked_at: now, checked_by: crewName || null })
        .eq('cabinet_unit_id', openCab.cabinetId).eq('tenant_id', tenantId).eq('assigned_dept', 'finishing');
      await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc', completed_by: crewName || 'Finishing' })
        .eq('id', openCab.cabinetId).eq('tenant_id', tenantId);
      await stopTimer();
      // Notify the supervisor only when the whole job is accounted for.
      const fired = await maybeNotifyJobQc(tenantId, openCab.jobNumber, openCab.jobPath.split('/').map((s) => s.trim()).join(' / '));
      if (!fired) {
        // Still log the cabinet completion silently for the pipeline.
        sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Cabinet finished', body: `${openCab.label} finished in Finishing`, url: '/app/supervisor' });
      }
      showToast('Cabinet sent to QC');
      setOpenCab(null);
      setChecked({});
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send to QC', true);
    } finally {
      setExitBusy(false);
    }
  }

  function openFullSpecFile(s: FinishSpec) {
    if (s.spec_file_url) setSpecFile({ url: s.spec_file_url, name: s.spec_file_name || 'Finish Spec', jobPath: s.job_path ?? undefined });
  }

  // ── Full-screen cabinet work view ──────────────────────────────────────────
  if (openCab) {
    const spec = specForJob(openCab.jobNumber);
    const checkedCount = openCabParts.filter((p) => checked[p.id]).length;
    const representative = openCabParts.find((p) => checked[p.id]) ?? openCabParts[0];
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: '#070a0c', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
          <button onClick={() => void closeCabinet()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }} aria-label="Back">
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>{openCab.label}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{openCab.jobPath.split('/').map((s) => s.trim()).join(' / ')}</div>
          </div>
          <div style={{ marginLeft: 'auto' }}>
            <ViewDrawingsButton tenantId={tenantId} jobNumber={openCab.jobNumber} cabinetKey={openCab.key} compact={false} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px 24px' }}>
          {/* Finish spec */}
          {spec && (
            <div style={{ ...card, marginBottom: 18 }}>
              <div style={{ ...sectionLabel, marginBottom: 12 }}>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Z"/><path d="M9 21h6"/></svg>
                Finish Spec
              </div>
              {(spec.cabinet_color || spec.cabinet_finish || spec.sheen) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <ColorChip color={spec.cabinet_color} />
                  <div><div style={rowLabel}>Cabinet</div><div style={rowVal}>{spec.cabinet_color || '—'}{(spec.cabinet_finish || spec.sheen) ? ` · ${[spec.cabinet_finish, spec.sheen].filter(Boolean).join(', ')}` : ''}</div></div>
                </div>
              )}
              {(spec.door_style || spec.door_color || spec.door_finish) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <ColorChip color={spec.door_color || spec.cabinet_color} />
                  <div><div style={rowLabel}>Doors</div><div style={rowVal}>{[spec.door_style, spec.door_color, spec.door_finish].filter(Boolean).join(' · ') || '—'}</div></div>
                </div>
              )}
              {(spec.edge_banding_color || spec.edge_banding_type) && (
                <div style={{ marginBottom: 10 }}><div style={rowLabel}>Edge Banding</div><div style={rowVal}>{[spec.edge_banding_color, spec.edge_banding_type].filter(Boolean).join(' · ')}</div></div>
              )}
              {spec.special_notes && <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 8, lineHeight: 1.5 }}>{spec.special_notes}</div>}
              {spec.spec_file_url && (
                <button onClick={() => openFullSpecFile(spec)} style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                  View Full Spec
                </button>
              )}
            </div>
          )}

          {/* Parts with checkboxes */}
          <div style={sectionLabel}>Parts ({checkedCount}/{openCabParts.length} selected)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {openCabParts.map((p) => {
              const on = !!checked[p.id];
              const dims = dimText(p);
              return (
                <button key={p.id} onClick={() => setChecked((c) => ({ ...c, [p.id]: !c[p.id] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 12, background: 'var(--bg-1)', border: `1px solid ${on ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{p.part_name}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{[dims, p.material].filter(Boolean).join(' · ')}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Exit bar — PUSH (select dest) + QC */}
        <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12, background: '#070a0c' }}>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Push selected to:</div>
          {representative ? (
            <PushPicker
              tenantId={tenantId}
              partId={representative.id}
              partName={representative.part_name}
              cabinetUnitId={representative.cabinet_unit_id}
              jobNumber={representative.job_number}
              currentDept="finishing"
              workerName={crewName}
              timeClockId={finishTcId}
              aiMode={aiMode}
              onPushed={(toDept) => {
                // PushPicker already moved the representative; move the rest of the
                // checked parts, then stop the timer and close.
                void (async () => {
                  for (const p of openCabParts) {
                    if (p.id === representative.id || !checked[p.id]) continue;
                    try {
                      await pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: p.cabinet_unit_id, jobNumber: p.job_number, fromDept: 'finishing', toDept, workerName: crewName, timeClockId: timeClockId.current });
                    } catch { /* best-effort */ }
                  }
                  await stopTimer();
                  setOpenCab(null); setChecked({}); void load();
                })();
              }}
              onToast={showToast}
            />
          ) : <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No parts selected.</div>}
          <button onClick={() => void sendToQc()} disabled={exitBusy}
            style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: exitBusy ? 'wait' : 'pointer', opacity: exitBusy ? 0.6 : 1 }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
            {exitBusy ? 'Sending…' : 'Send Cabinet to QC'}
          </button>
        </div>
        {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
      </div>
    );
  }

  // ── Queue view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={sectionLabel}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
        Finishing
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
            const jobOpen = selectedJob === j.jobNumber;
            const groups = jobOpen ? groupsForJob(j.jobNumber) : [];
            const count = parts.filter((p) => (p.job_number ?? '__nojob__') === j.jobNumber).length;
            return (
              <div key={j.jobNumber} style={{ borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                <button onClick={() => setSelectedJob(jobOpen ? '' : j.jobNumber)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: jobOpen ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{j.label}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{count} piece{count === 1 ? '' : 's'}</span>
                </button>
                {jobOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px 14px', borderTop: '1px solid var(--line)' }}>
                    {groups.map((g) => (
                      <button key={g.cabinetId} onClick={() => openCabinet(g)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 16px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{g.label}</div>
                          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2 }}>{g.parts.length} part{g.parts.length === 1 ? '' : 's'} to finish</div>
                        </div>
                        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m9 18 6-6-6-6"/></svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
    </div>
  );
}
