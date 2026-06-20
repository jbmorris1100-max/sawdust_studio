'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { pushPart, deptDisplay, recomputeCabinet, notifyDeptWork } from '@/lib/partActions';
import PushPicker from '@/components/PushPicker';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// ── Part template (generalized Production cut-list) ──────────────────────────
// The 'part' tracking template: no Start button, dwell-time only — a queue of
// job folders, each expanding to cabinets → parts the crew checks off as cut and
// pushes onward. Previously hardcoded to dept 'production' inline in crew/page.tsx;
// now a config-driven component keyed by the department's name/id so any 'part'
// department renders the same flow. The job→cabinet→part hierarchy here already
// satisfies the universal spec-verification drill-down for this template.

type ProdPart = {
  id: string; part_name: string; material: string | null;
  width: number | null; height: number | null; depth: number | null;
  quantity: number; production_status: string | null;
  cut_by: string | null; cut_at: string | null; cut_photo_url: string | null;
};
type ProdUnit = {
  id: string; unit_label: string; job_number: string | null;
  cabinet_number: string | null; room_number: string | null;
  status: string; production_status: string | null;
  partsTotal: number; partsCut: number; jobPath: string; dueDate: string | null;
};
type CutJobPart = {
  id: string; part_name: string; material: string | null;
  width: number | null; height: number | null; depth: number | null;
  quantity: number; checked: boolean; cabinet_unit_id: string;
  qc_notes: string | null; qc_failed: boolean | null;
};
type CutJobCab = { cabinetId: string; label: string; key: string; jobNumber: string | null; parts: CutJobPart[] };

type AiMode = 'learn' | 'assist' | 'autonomous';

// ── Replicated local helpers (kept private to this template) ─────────────────
function dueBadgeMeta(dueDate: string): { label: string; color: string; overdue: boolean } {
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  const overdue = days < 0;
  const color = overdue || days <= 2 ? '#F87171' : days <= 6 ? '#FBBF24' : '#34D399';
  const label = overdue ? `${-days}d overdue` : days === 0 ? 'Due today' : `${days}d`;
  return { label, color, overdue };
}
function DueBadge({ dueDate }: { dueDate: string }) {
  const { label, color, overdue } = dueBadgeMeta(dueDate);
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, ...(overdue ? { animation: 'prodPulse 1.4s ease-in-out infinite' } : {}) }}>
      {label}
    </span>
  );
}
function getFinishingFlag(partName: string, material: string | null): string | null {
  const n = (partName + ' ' + (material || '')).toLowerCase();
  if (n.includes('edge') || n.includes('banding')) return 'Edge Band';
  if (n.includes('door') || n.includes('drawer front')) return 'Paint/Stain';
  if (n.includes('face frame') || n.includes('faceframe')) return 'Paint/Stain';
  if (n.includes('end panel') || n.includes('side panel')) return 'Paint/Stain';
  return null;
}

export default function PartTemplateView({
  tenantId, deptName, crewName, timeClockId, aiMode,
  isClockedIn, onRequireClock, showToast, allDepts,
}: {
  tenantId: string;
  deptId: string;
  deptName: string;
  crewName: string;
  timeClockId: string | null;
  aiMode: AiMode;
  isClockedIn: boolean;
  onRequireClock: () => void;
  showToast: (msg: string, error?: boolean) => void;
  allDepts: string[];
}) {
  const deptKey = deptName.toLowerCase();
  // Push destinations: every other department (never back into this one).
  const pushDeptKeys = allDepts.map((d) => d.toLowerCase()).filter((d) => d !== deptKey);

  const requireClock = useCallback((): boolean => {
    if (!isClockedIn) { onRequireClock(); return false; }
    return true;
  }, [isClockedIn, onRequireClock]);

  async function uploadPhoto(file: File, bucket: string): Promise<string | null> {
    const ext  = file.name.split('.').pop() ?? 'jpg';
    const path = `${tenantId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  const [prodUnits, setProdUnits] = useState<ProdUnit[]>([]);
  const [prodLoading, setProdLoading] = useState(false);

  const [cutUnit, setCutUnit] = useState<ProdUnit | null>(null);
  const [cutParts, setCutParts] = useState<ProdPart[]>([]);
  const [cutLoading, setCutLoading] = useState(false);

  const [cutJob, setCutJob] = useState<{ jobPath: string; jobNumber: string | null } | null>(null);
  const [cutJobCabs, setCutJobCabs] = useState<CutJobCab[]>([]);
  const [cutJobLoading, setCutJobLoading] = useState(false);
  const [cutCabExpanded, setCutCabExpanded] = useState<Record<string, boolean>>({});
  const [heldCabs, setHeldCabs] = useState<Record<string, boolean>>({});
  const [fullyCutCab, setFullyCutCab] = useState<{ cabinetId: string; label: string } | null>(null);
  const [destForCabs, setDestForCabs] = useState<string[] | null>(null);
  const [pushGroupOpen, setPushGroupOpen] = useState(false);
  const [groupSel, setGroupSel] = useState<Record<string, boolean>>({});
  const [cutJobBusy, setCutJobBusy] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedParts, setSelectedParts] = useState<Record<string, { part: CutJobPart; cabinetId: string }>>({});
  const [undoState, setUndoState] = useState<{
    label: string; toDept: string; fromDept: string;
    parts: { partId: string; cabinetUnitId: string; partName: string; jobNumber: string | null }[];
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const loadProduction = useCallback(async (showSpinner = true) => {
    if (!tenantId) return;
    if (showSpinner) setProdLoading(true);
    try {
      const { data: units } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, job_number, cabinet_number, room_number, status, production_status')
        .eq('tenant_id', tenantId)
        .neq('status', 'complete')
        .order('job_number', { ascending: true });
      let unitList = (units as Omit<ProdUnit, 'partsTotal' | 'partsCut' | 'jobPath' | 'dueDate'>[]) ?? [];

      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        const activeSet = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
        unitList = unitList.filter((u) => !u.job_number || activeSet.has(u.job_number));
      } catch { /* jobs table optional */ }

      const ids = unitList.map((u) => u.id);
      const counts: Record<string, { total: number; cut: number; remaining: number }> = {};
      if (ids.length > 0) {
        const { data: parts } = await supabase
          .from('parts').select('cabinet_unit_id, assigned_dept, checked').in('cabinet_unit_id', ids);
        ((parts as { cabinet_unit_id: string; assigned_dept: string | null; checked: boolean | null }[]) ?? []).forEach((p) => {
          if (p.assigned_dept !== deptKey) return;
          const e = (counts[p.cabinet_unit_id] ??= { total: 0, cut: 0, remaining: 0 });
          e.total++; e.remaining++;
          if (p.checked) e.cut++;
        });
      }

      const jobNums = Array.from(new Set(unitList.map((u) => u.job_number).filter(Boolean))) as string[];
      const jobMap: Record<string, { jobPath: string; dueDate: string | null }> = {};
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase
            .from('jobs').select('job_number, job_path, due_date')
            .eq('tenant_id', tenantId).in('job_number', jobNums);
          ((jrows as { job_number: string; job_path: string | null; due_date: string | null }[]) ?? []).forEach((j) => {
            jobMap[j.job_number] = { jobPath: j.job_path || `Job ${j.job_number}`, dueDate: j.due_date ?? null };
          });
        } catch (_) {}
      }

      setProdUnits(unitList
        .filter((u) => (counts[u.id]?.remaining ?? 0) > 0)
        .map((u) => {
          const c = counts[u.id] ?? { total: 0, cut: 0, remaining: 0 };
          const jm = u.job_number ? jobMap[u.job_number] : undefined;
          return { ...u, partsTotal: c.total, partsCut: c.cut, jobPath: jm?.jobPath || (u.job_number ? `Job ${u.job_number}` : 'Unassigned'), dueDate: jm?.dueDate ?? null };
        }));
    } catch (_) {}
    setProdLoading(false);
  }, [tenantId, deptKey]);

  useEffect(() => { void loadProduction(); }, [loadProduction]);

  // Realtime: refresh the queue as cabinets/parts change.
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`part-tpl-${deptKey}-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => void loadProduction(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => void loadProduction(false))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [tenantId, deptKey, loadProduction]);

  function closeCutView() { setCutUnit(null); setCutParts([]); }

  async function openCutJob(units: ProdUnit[], jobPath: string) {
    if (!requireClock()) return;
    const jobNumber = units.find((u) => u.job_number)?.job_number ?? null;
    setCutJob({ jobPath, jobNumber });
    setCutJobCabs([]); setCutCabExpanded({}); setHeldCabs({});
    setCutJobLoading(true);
    try {
      const cabIds = units.map((u) => u.id);
      const { data } = await supabase
        .from('parts')
        .select('id, part_name, material, width, height, depth, quantity, checked, cabinet_unit_id, assigned_dept, qc_notes, qc_failed')
        .in('cabinet_unit_id', cabIds)
        .order('part_name');
      const rows = (data as (CutJobPart & { assigned_dept: string | null })[] | null) ?? [];
      const byCab: Record<string, CutJobPart[]> = {};
      rows.filter((p) => p.assigned_dept === deptKey).forEach((p) => {
        (byCab[p.cabinet_unit_id] ??= []).push({ ...p, checked: !!p.checked });
      });
      const cabs: CutJobCab[] = units
        .filter((u) => (byCab[u.id]?.length ?? 0) > 0)
        .map((u) => ({ cabinetId: u.id, label: u.unit_label, key: u.cabinet_number || u.unit_label, jobNumber: u.job_number, parts: byCab[u.id] ?? [] }));
      setCutJobCabs(cabs);
    } catch { /* best-effort */ }
    setCutJobLoading(false);
  }
  function closeCutJob() {
    setCutJob(null); setCutJobCabs([]); setCutCabExpanded({}); setHeldCabs({});
    setFullyCutCab(null); setDestForCabs(null); setPushGroupOpen(false);
    setSelectMode(false); setSelectedParts({});
    void loadProduction();
  }

  async function toggleCutPart(cabinetId: string, partId: string) {
    const cab = cutJobCabs.find((c) => c.cabinetId === cabinetId);
    const part = cab?.parts.find((p) => p.id === partId);
    if (!cab || !part) return;
    const next = !part.checked;
    setCutJobCabs((cabs) => cabs.map((c) => c.cabinetId !== cabinetId ? c : { ...c, parts: c.parts.map((p) => p.id === partId ? { ...p, checked: next } : p) }));
    if (next && cab.parts.every((p) => p.id === partId || p.checked)) {
      setFullyCutCab({ cabinetId, label: cab.label });
    }
    try {
      await supabase.from('parts').update({ checked: next }).eq('id', partId).eq('tenant_id', tenantId);
    } catch { /* optimistic; realtime will reconcile */ }
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
        await pushPart({ tenantId, partId: p.partId, partName: p.partName, cabinetUnitId: p.cabinetUnitId, jobNumber: p.jobNumber, fromDept: u.toDept, toDept: u.fromDept, workerName: crewName, timeClockId });
      } catch { /* best-effort per part */ }
    }
    showToast(`Undone — parts returned to ${deptDisplay(u.fromDept)}`);
    void loadProduction();
  }

  async function pushCutCabinets(cabinetIds: string[], toDept: string) {
    if (cutJobBusy) return;
    setCutJobBusy(true);
    try {
      const tasks: { part: CutJobPart; cid: string; jobNumber: string | null }[] = [];
      for (const cid of cabinetIds) {
        const cab = cutJobCabs.find((c) => c.cabinetId === cid);
        if (!cab) continue;
        for (const p of cab.parts) tasks.push({ part: p, cid, jobNumber: cab.jobNumber });
      }
      const pushedParts = tasks.map((t) => ({ partId: t.part.id, cabinetUnitId: t.cid, partName: t.part.part_name, jobNumber: t.jobNumber }));
      const pushResults = await Promise.allSettled(tasks.map((t) =>
        pushPart({ tenantId, partId: t.part.id, partName: t.part.part_name, cabinetUnitId: t.cid, jobNumber: t.jobNumber, fromDept: deptKey, toDept, workerName: crewName, timeClockId })
      ));
      const failedCount = pushResults.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) showToast(`${failedCount} part${failedCount === 1 ? '' : 's'} failed to push — try again`, true);
      const uniqueCabIds = [...new Set(tasks.map((t) => t.cid))];
      await Promise.all(uniqueCabIds.map((id) => recomputeCabinet(tenantId, id).catch(() => {})));
      setCutJobCabs((cabs) => cabs.filter((c) => !cabinetIds.includes(c.cabinetId)));
      setHeldCabs((h) => { const n = { ...h }; cabinetIds.forEach((id) => delete n[id]); return n; });
      showUndoToast(`${cabinetIds.length} cabinet${cabinetIds.length === 1 ? '' : 's'}`, toDept, deptKey, pushedParts);
      notifyDeptWork(tenantId, toDept, cutJob?.jobNumber ?? null, pushedParts.length);
      void loadProduction();
    } finally {
      setCutJobBusy(false);
      setDestForCabs(null);
    }
  }

  async function pushSelectedParts(toDept: string) {
    if (cutJobBusy) return;
    const items = Object.values(selectedParts);
    if (items.length === 0) return;
    setCutJobBusy(true);
    try {
      const pushResults = await Promise.allSettled(items.map(({ part, cabinetId }) =>
        pushPart({ tenantId, partId: part.id, partName: part.part_name, cabinetUnitId: cabinetId, jobNumber: cutJob?.jobNumber ?? null, fromDept: deptKey, toDept, workerName: crewName, timeClockId })
      ));
      const failedCount = pushResults.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) showToast(`${failedCount} part${failedCount === 1 ? '' : 's'} failed to push — try again`, true);
      const uniqueCabIds = [...new Set(items.map((it) => it.cabinetId))];
      await Promise.all(uniqueCabIds.map((id) => recomputeCabinet(tenantId, id).catch(() => {})));
      const pushedIds = new Set(items.map((it) => it.part.id));
      setCutJobCabs((cabs) => cabs.map((c) => ({ ...c, parts: c.parts.filter((p) => !pushedIds.has(p.id)) })).filter((c) => c.parts.length > 0));
      showUndoToast(
        `${items.length} part${items.length === 1 ? '' : 's'}`, toDept, deptKey,
        items.map((it) => ({ partId: it.part.id, cabinetUnitId: it.cabinetId, partName: it.part.part_name, jobNumber: cutJob?.jobNumber ?? null })),
      );
      notifyDeptWork(tenantId, toDept, cutJob?.jobNumber ?? null, items.length);
      setSelectedParts({}); setSelectMode(false);
      void loadProduction();
    } finally {
      setCutJobBusy(false);
    }
  }

  async function handlePartPhoto(partId: string, file: File) {
    try {
      const url = await uploadPhoto(file, 'part-photos');
      if (!url) return;
      setCutParts((ps) => ps.map((p) => p.id === partId ? { ...p, cut_photo_url: url } : p));
      const { error } = await supabase.from('parts').update({ cut_photo_url: url }).eq('id', partId);
      if (error) throw error;
      showToast('Photo saved');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', true);
    }
  }

  const dimsX = (p: CutJobPart) => [p.width, p.height, p.depth].filter((d) => d != null).map((d) => `${d}"`).join(' x ');

  // ── Render ──────────────────────────────────────────────────────────────────
  const groups: Record<string, ProdUnit[]> = {};
  prodUnits.forEach((u) => { (groups[u.jobPath] ??= []).push(u); });
  const jobPaths = Object.keys(groups);

  const totalParts = cutJobCabs.reduce((s, c) => s + c.parts.length, 0);
  const cutCount   = cutJobCabs.reduce((s, c) => s + c.parts.filter((p) => p.checked).length, 0);
  const heldIds    = Object.keys(heldCabs).filter((id) => heldCabs[id] && cutJobCabs.some((c) => c.cabinetId === id));

  return (
    <div style={{ marginBottom: 40 }}>
      <style>{`@keyframes prodPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{deptDisplay(deptKey)} · Cut List</div>
      </div>

      {prodLoading && prodUnits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading cut list…</div>
      ) : jobPaths.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>No active work assigned. New jobs will appear here automatically.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {jobPaths.map((jp) => {
            const units = groups[jp];
            const due = units.find((u) => u.dueDate)?.dueDate ?? null;
            const total = units.reduce((s, u) => s + u.partsTotal, 0);
            const cut   = units.reduce((s, u) => s + u.partsCut, 0);
            const pct   = total > 0 ? Math.round((cut / total) * 100) : 0;
            return (
              <div key={jp} style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-1)' }}>
                <button onClick={() => void openCutJob(units, jp)}
                  style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{jp.split('/').join(' / ')}</span>
                    {due && <DueBadge dueDate={due} />}
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{cut}/{total} cut</span>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 6 15 12 9 18"/></svg>
                  </div>
                  <div style={{ height: 6, borderRadius: 20, background: 'var(--bg-2, #11151a)', overflow: 'hidden', width: '100%' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#2DE1C9' : '#60A5FA', transition: 'width 0.3s ease' }} />
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Single-cabinet cut view */}
      {cutUnit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button onClick={closeCutView} aria-label="Close"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cutUnit.unit_label}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{cutUnit.jobPath.split('/').join(' / ')}</div>
            </div>
            <ViewDrawingsButton tenantId={tenantId} jobNumber={cutUnit.job_number} cabinetKey={cutUnit.cabinet_number || cutUnit.unit_label} compact />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
            {cutLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>Loading parts…</div>
            ) : cutParts.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>All parts pushed — nothing left for this cabinet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, margin: '0 auto' }}>
                {cutParts.map((p) => {
                  const dims = [p.width, p.height, p.depth].filter((d) => d != null).join(' × ');
                  const flag = getFinishingFlag(p.part_name, p.material);
                  return (
                    <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-1)', padding: '13px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</span>
                            {flag && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', color: '#FBBF24', flexShrink: 0 }}>{flag}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{dims}{p.material ? `${dims ? ' — ' : ''}${p.material}` : ''}</div>
                          {flag && <div style={{ fontSize: 11, color: '#FBBF24', marginTop: 2 }}>Needs finishing before assembly</div>}
                        </div>
                        <label title="Photo proof" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, border: '1px solid var(--line)', background: p.cut_photo_url ? 'rgba(45,225,201,0.12)' : 'var(--bg-2)', color: p.cut_photo_url ? '#2DE1C9' : 'var(--ink-mute)', cursor: 'pointer', flexShrink: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePartPhoto(p.id, f); e.target.value = ''; }} />
                        </label>
                      </div>
                      <PushPicker
                        tenantId={tenantId}
                        partId={p.id}
                        partName={p.part_name}
                        cabinetUnitId={cutUnit.id}
                        jobNumber={cutUnit.job_number}
                        currentDept={deptKey}
                        workerName={crewName}
                        timeClockId={timeClockId}
                        aiMode={aiMode}
                        onPushed={() => { setCutParts((ps) => ps.filter((x) => x.id !== p.id)); void loadProduction(); }}
                        onToast={showToast}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Job-level cut list */}
      {cutJob && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button onClick={closeCutJob} aria-label="Close"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cutJob.jobPath.split('/').map((s) => s.trim()).join(' / ')}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{cutCount}/{totalParts} parts cut</div>
            </div>
            <ViewDrawingsButton tenantId={tenantId} jobNumber={cutJob.jobNumber} cabinetKey="" compact />
            <button
              onClick={() => { if (selectMode) { setSelectMode(false); setSelectedParts({}); } else { setSelectMode(true); } }}
              style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', background: selectMode ? 'rgba(248,113,113,0.15)' : 'rgba(251,191,36,0.15)', border: `1px solid ${selectMode ? 'rgba(248,113,113,0.5)' : 'rgba(251,191,36,0.5)'}`, color: selectMode ? '#F87171' : '#FBBF24', cursor: 'pointer' }}>
              {selectMode ? 'Cancel' : 'Select'}
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: (selectMode && Object.keys(selectedParts).length > 0) ? 'calc(132px + env(safe-area-inset-bottom))' : heldIds.length > 0 ? 'calc(96px + env(safe-area-inset-bottom))' : 'calc(24px + env(safe-area-inset-bottom))' }}>
            {cutJobLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>Loading cut list…</div>
            ) : cutJobCabs.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>All parts cut and pushed — nothing left in this job.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, margin: '0 auto' }}>
                {cutJobCabs.map((c) => {
                  const open = !!cutCabExpanded[c.cabinetId];
                  const cabCut = c.parts.filter((p) => p.checked).length;
                  const held = !!heldCabs[c.cabinetId];
                  return (
                    <div key={c.cabinetId} style={{ border: `1px solid ${held ? 'rgba(251,191,36,0.4)' : 'var(--line)'}`, borderRadius: 12, background: 'var(--bg-1)', overflow: 'hidden' }}>
                      <button onClick={() => setCutCabExpanded((s) => ({ ...s, [c.cabinetId]: !s[c.cabinetId] }))}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{c.label}</span>
                        {held && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 20, background: 'rgba(251,191,36,0.16)', color: '#FBBF24' }}>Held</span>}
                        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: cabCut === c.parts.length ? '#2DE1C9' : 'var(--ink-mute)' }}>{cabCut}/{c.parts.length}</span>
                      </button>
                      {open && (
                        <div style={{ borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                          {c.parts.map((p) => {
                            const selected = !!selectedParts[p.id];
                            const boxOn = selectMode ? selected : p.checked;
                            return (
                              <div key={p.id}
                                onClick={() => {
                                  if (selectMode) {
                                    setSelectedParts((s) => { const n = { ...s }; if (n[p.id]) delete n[p.id]; else n[p.id] = { part: p, cabinetId: c.cabinetId }; return n; });
                                  } else {
                                    void toggleCutPart(c.cabinetId, p.id);
                                  }
                                }}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', touchAction: 'manipulation' }}>
                                <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, border: `1px solid ${boxOn ? 'var(--teal)' : 'var(--line-strong)'}`, background: boxOn ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {boxOn && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                </span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: p.checked ? 'var(--ink-mute)' : 'var(--ink)', textDecoration: p.checked ? 'line-through' : 'none' }}>{p.part_name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</div>
                                  {p.qc_failed && p.qc_notes && (
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '6px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', marginTop: 4 }}>
                                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                                      <span style={{ fontSize: 12, color: '#F87171', lineHeight: 1.4 }}>QC: {p.qc_notes}</span>
                                    </div>
                                  )}
                                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{[dimsX(p), p.material].filter(Boolean).join(' · ')}</div>
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

          {heldIds.length > 0 && !selectMode && (
            <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1500, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
              <button onClick={() => { const sel: Record<string, boolean> = {}; heldIds.forEach((id) => { sel[id] = true; }); setGroupSel(sel); setPushGroupOpen(true); }}
                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#FBBF24', border: 'none', color: '#1a1206', cursor: 'pointer' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                Push Group ({heldIds.length} held)
              </button>
            </div>
          )}

          {selectMode && Object.keys(selectedParts).length > 0 && (() => {
            const n = Object.keys(selectedParts).length;
            return (
              <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1500, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)', marginBottom: 10 }}>Push {n} part{n === 1 ? '' : 's'} to:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {pushDeptKeys.map((d) => (
                    <button key={d} onClick={() => void pushSelectedParts(d)} disabled={cutJobBusy}
                      style={{ flex: 1, minWidth: 0, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '13px 12px', borderRadius: 12, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: cutJobBusy ? 'wait' : 'pointer' }}>
                      {deptDisplay(d)}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

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
        </div>
      )}

      {/* Fully-cut popup */}
      {fullyCutCab && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setFullyCutCab(null); }}>
          <div style={{ width: '100%', maxWidth: 360, background: '#0a0d10', border: '1px solid rgba(45,225,201,0.25)', borderRadius: 18, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'center' }}>
            <div style={{ alignSelf: 'center', width: 52, height: 52, borderRadius: '50%', background: 'rgba(45,225,201,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{fullyCutCab.label} is fully cut</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setHeldCabs((h) => ({ ...h, [fullyCutCab.cabinetId]: true })); setFullyCutCab(null); }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>
                Hold
              </button>
              <button onClick={() => { const id = fullyCutCab.cabinetId; setFullyCutCab(null); setDestForCabs([id]); }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
                Push
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push Group selection modal */}
      {pushGroupOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPushGroupOpen(false); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Push held cabinets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '40vh', overflowY: 'auto' }}>
              {Object.keys(heldCabs).filter((id) => heldCabs[id]).map((id) => {
                const cab = cutJobCabs.find((c) => c.cabinetId === id);
                if (!cab) return null;
                const on = !!groupSel[id];
                return (
                  <button key={id} onClick={() => setGroupSel((s) => ({ ...s, [id]: !s[id] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-1)', border: `1px solid ${on ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{cab.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{cab.parts.length} part{cab.parts.length === 1 ? '' : 's'}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { const ids = Object.keys(groupSel).filter((id) => groupSel[id]); if (ids.length === 0) { showToast('Select at least one cabinet', true); return; } setPushGroupOpen(false); setDestForCabs(ids); }}
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
              Choose destination
            </button>
          </div>
        </div>
      )}

      {/* Destination picker */}
      {destForCabs && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget && !cutJobBusy) setDestForCabs(null); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Send {destForCabs.length} cabinet{destForCabs.length === 1 ? '' : 's'} to</div>
            {pushDeptKeys.map((d) => (
              <button key={d} onClick={() => void pushCutCabinets(destForCabs, d)} disabled={cutJobBusy}
                style={{ width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '15px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: cutJobBusy ? 'wait' : 'pointer' }}>
                {deptDisplay(d)}
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
