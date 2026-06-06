'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';

// ── Craftsman builds (crew view) ──────────────────────────────────────────────
// Shows cabinet_units assigned to the Craftsman dept, grouped by job. A craftsman
// can: select which parts are in their scope (pushing the remainder to another dept
// as a split ticket), run a build timer, and walk a unit through
// Build → Finishing → Complete. Every split trains craftsman_classifications.

type CUnit = {
  id: string;
  job_number: string | null;
  room_number: string | null;
  job_id: string | null;
  unit_label: string;
  status: string;
  assigned_dept: string | null;
  is_split: boolean | null;
  split_from_id: string | null;
  parent_unit_id: string | null;
};

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

interface Props {
  tenantId: string;
  crewName: string;
  timeClockId: string | null;
  showToast: (msg: string, error?: boolean) => void;
}

const PUSH_DEPTS = ['Production', 'Assembly', 'Finishing'] as const;
type PushDept = (typeof PUSH_DEPTS)[number];

// Keywords for deriving a reusable learned pattern from a unit label (mirrors the
// classify-units route so crew-side learning uses the same vocabulary).
const CRAFTSMAN_KEYWORDS = [
  'countertop', 'counter top', 'butcher block', 'slab', 'floating shelf', 'float shelf',
  'vent hood', 'range hood', 'hood', 'wine rack', 'mantle', 'mantel', 'fireplace',
  'surround', 'bench seat', 'window seat', 'bench', 'corbel', 'waterfall', 'display',
  'custom', 'trim', 'panel slab',
];

function patternFromLabel(label: string): string {
  const lower = label.toLowerCase();
  for (const kw of CRAFTSMAN_KEYWORDS) if (lower.includes(kw)) return kw;
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return words.sort((a, b) => b.length - a.length)[0] ?? lower.trim().slice(0, 40);
}

function dimLabel(p: CPart): string {
  const parts: string[] = [];
  if (p.width)  parts.push(`${p.width}"`);
  if (p.height) parts.push(`${p.height}"`);
  if (p.depth)  parts.push(`${p.depth}"`);
  return parts.join('x');
}

function partLabel(p: CPart): string {
  const dims = dimLabel(p);
  const bits = [p.part_name];
  if (dims) bits.push(dims);
  if (p.material) bits.push(p.material);
  return bits.join(' — ');
}

function statusMeta(status: string): { label: string; color: string } {
  switch (status) {
    case 'building':  return { label: 'Building',  color: '#60A5FA' };
    case 'finishing': return { label: 'Finishing', color: '#FBBF24' };
    case 'complete':  return { label: 'Complete',  color: '#34D399' };
    case 'flagged':   return { label: 'Flagged',   color: '#F87171' };
    default:          return { label: 'Pending',   color: '#8BA5A0' };
  }
}

function fmtElapsed(startISO: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(startISO).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

const BUILDS_KEY = 'craftsman_unit_builds';

// Thin-stroke icons (no emoji).
const IcoCraft = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);
const IcoSplit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>
  </svg>
);
const IcoPush = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
  </svg>
);

export default function CraftsmanBuilds({ tenantId, crewName, timeClockId, showToast }: Props) {
  const [units,   setUnits]   = useState<CUnit[]>([]);
  const [parts,   setParts]   = useState<CPart[]>([]);
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyUnit, setBusyUnit] = useState<string | null>(null);

  // Per-unit build timer start times (persisted so the timer survives reloads).
  const [buildStarts, setBuildStarts] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);

  // Part-selection overlay state
  const [selUnit, setSelUnit] = useState<CUnit | null>(null);
  const [selPartIds, setSelPartIds] = useState<Set<string>>(new Set());
  const [overlayStep, setOverlayStep] = useState<'select' | 'push'>('select');
  const [pushDept, setPushDept] = useState<PushDept>('Production');
  const [splitting, setSplitting] = useState(false);

  // Success confirmation (auto-dismiss)
  const [success, setSuccess] = useState<{ kept: number; pushed: number; dept: string } | null>(null);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load ────────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      const { data: unitData } = await supabase
        .from('cabinet_units')
        .select('id, job_number, room_number, job_id, unit_label, status, assigned_dept, is_split, split_from_id, parent_unit_id')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'craftsman')
        .neq('status', 'complete')
        .order('job_number', { ascending: false });
      const list = (unitData as CUnit[] | null) ?? [];
      setUnits(list);

      if (list.length > 0) {
        const ids = list.map((u) => u.id);
        const { data: partData } = await supabase
          .from('parts')
          .select('id, cabinet_unit_id, job_number, part_name, material, width, height, depth, quantity, assigned_dept, flag_type')
          .in('cabinet_unit_id', ids);
        setParts((partData as CPart[] | null) ?? []);

        const jobNums = Array.from(new Set(list.map((u) => u.job_number).filter(Boolean))) as string[];
        if (jobNums.length > 0) {
          const { data: jobsData } = await supabase
            .from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jobsData as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => {
            if (j.job_path) map[j.job_number] = j.job_path;
          });
          setJobPaths(map);
        }
      } else {
        setParts([]);
      }
    } catch {
      /* leave existing state */
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // Realtime — reload on any cabinet_units / parts change for this tenant.
  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel('rt-craftsman-builds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  // Restore persisted build-start timestamps.
  useEffect(() => {
    try { const r = localStorage.getItem(BUILDS_KEY); if (r) setBuildStarts(JSON.parse(r)); } catch { /* ignore */ }
  }, []);

  // Tick the live timer once a second while any unit is building.
  useEffect(() => {
    const anyBuilding = units.some((u) => u.status === 'building');
    if (!anyBuilding) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [units]);

  useEffect(() => () => { if (successTimer.current) clearTimeout(successTimer.current); }, []);

  function persistStarts(next: Record<string, string>) {
    setBuildStarts(next);
    try { localStorage.setItem(BUILDS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const unitParts = (unitId: string) => parts.filter((p) => p.cabinet_unit_id === unitId);
  const jobLabel = (jobNumber: string | null) =>
    jobNumber ? (jobPaths[jobNumber] ? jobPaths[jobNumber].split('/').map((s) => s.trim()).join(' / ') : `Job ${jobNumber}`) : 'No Job';

  // ── Build flow ──────────────────────────────────────────────────────────────
  async function startBuild(unit: CUnit) {
    if (busyUnit) return;
    setBusyUnit(unit.id);
    try {
      const { error } = await supabase.from('cabinet_units').update({ status: 'building' }).eq('id', unit.id);
      if (error) throw error;
      persistStarts({ ...buildStarts, [unit.id]: new Date().toISOString() });
      setUnits((prev) => prev.map((u) => u.id === unit.id ? { ...u, status: 'building' } : u));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start build', true);
    } finally {
      setBusyUnit(null);
    }
  }

  async function markBuildComplete(unit: CUnit) {
    if (busyUnit) return;
    setBusyUnit(unit.id);
    const start = buildStarts[unit.id];
    const durationMin = start ? Math.round((Date.now() - new Date(start).getTime()) / 60000) : null;
    try {
      const { error } = await supabase.from('cabinet_units').update({ status: 'finishing' }).eq('id', unit.id);
      if (error) throw error;
      // Log the build to shift_events.
      if (timeClockId) {
        try {
          await supabase.from('shift_events').insert({
            tenant_id: tenantId, time_clock_id: timeClockId, worker_name: crewName || 'Craftsman',
            event_type: 'craftsman_build', dept: 'Craftsman',
            metadata: { unit_id: unit.id, unit_label: unit.unit_label, job_number: unit.job_number, duration_min: durationMin },
          });
        } catch { /* best effort */ }
      }
      const next = { ...buildStarts }; delete next[unit.id]; persistStarts(next);
      setUnits((prev) => prev.map((u) => u.id === unit.id ? { ...u, status: 'finishing' } : u));
      showToast('Ready for finishing');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update build', true);
    } finally {
      setBusyUnit(null);
    }
  }

  async function markFinishingComplete(unit: CUnit) {
    if (busyUnit) return;
    setBusyUnit(unit.id);
    try {
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', unit.id);
      if (error) throw error;

      // Parent rollup: if this unit is part of a split, and every sibling in the
      // group is now complete, ensure the original parent unit is marked complete.
      const parentId = unit.parent_unit_id || unit.split_from_id;
      if (parentId) {
        try {
          const { data: siblings } = await supabase
            .from('cabinet_units').select('id, status')
            .eq('tenant_id', tenantId)
            .or(`id.eq.${parentId},parent_unit_id.eq.${parentId},split_from_id.eq.${parentId}`);
          const sibs = (siblings as { id: string; status: string }[] | null) ?? [];
          const allComplete = sibs.every((s) => s.id === unit.id || s.status === 'complete');
          if (allComplete) {
            await supabase.from('cabinet_units').update({ status: 'complete' }).eq('id', parentId).neq('status', 'complete');
          }
        } catch { /* rollup best-effort; supervisor view also computes parent status */ }
      }

      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: 'Build complete',
        body: `${unit.unit_label} — ${jobLabel(unit.job_number)} is complete`,
        url: '/app/supervisor',
      });
      setUnits((prev) => prev.filter((u) => u.id !== unit.id)); // drops off the active list
      showToast('Marked complete');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete', true);
    } finally {
      setBusyUnit(null);
    }
  }

  // ── Part selection overlay ──────────────────────────────────────────────────
  function openSelection(unit: CUnit) {
    const ps = unitParts(unit.id);
    setSelUnit(unit);
    setSelPartIds(new Set(ps.map((p) => p.id))); // all checked by default
    setOverlayStep('select');
    setPushDept('Production');
  }
  function closeSelection() {
    setSelUnit(null);
    setSelPartIds(new Set());
    setOverlayStep('select');
    setSplitting(false);
  }
  function togglePart(id: string) {
    setSelPartIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // Shop learning — upsert one (label-pattern, part-pattern, dept) confirmation.
  async function learnPattern(labelPattern: string, partName: string, dept: string) {
    const part_name_pattern = partName.trim().toLowerCase();
    try {
      const { data: existing } = await supabase
        .from('craftsman_classifications')
        .select('id, times_confirmed')
        .eq('tenant_id', tenantId)
        .eq('unit_label_pattern', labelPattern)
        .eq('part_name_pattern', part_name_pattern)
        .eq('assigned_dept', dept)
        .maybeSingle();
      if (existing) {
        await supabase.from('craftsman_classifications')
          .update({ times_confirmed: ((existing as { times_confirmed: number }).times_confirmed ?? 0) + 1, confirmed_by: crewName || 'Craftsman', updated_at: new Date().toISOString() })
          .eq('id', (existing as { id: string }).id);
      } else {
        await supabase.from('craftsman_classifications').insert({
          tenant_id: tenantId, unit_label_pattern: labelPattern, part_name_pattern,
          assigned_dept: dept, confirmed_by: crewName || 'Craftsman', times_confirmed: 1,
        });
      }
    } catch { /* learning is best-effort */ }
  }

  // Confirm selection. If parts are unchecked, the caller has already chosen to
  // push them (pushDept) or keep all. `doPush=false` keeps everything in craftsman.
  async function confirmSelection(doPush: boolean) {
    if (!selUnit || splitting) return;
    setSplitting(true);
    const all = unitParts(selUnit.id);
    const kept = all.filter((p) => selPartIds.has(p.id));
    const pushed = all.filter((p) => !selPartIds.has(p.id));
    const labelPattern = patternFromLabel(selUnit.unit_label);

    try {
      if (pushed.length === 0 || !doPush) {
        // No split — assign all parts to craftsman.
        const ids = (doPush ? kept : all).map((p) => p.id);
        if (ids.length > 0) {
          const { error } = await supabase.from('parts').update({ assigned_dept: 'craftsman' }).in('id', ids);
          if (error) throw error;
        }
        // If keeping all, also fold any previously-pushed parts back in.
        if (!doPush && pushed.length > 0) {
          await supabase.from('parts').update({ assigned_dept: 'craftsman' }).in('id', pushed.map((p) => p.id));
        }
        for (const p of (doPush ? kept : all)) void learnPattern(labelPattern, p.part_name, 'craftsman');
        showToast('Selection confirmed');
        closeSelection();
        void load();
        return;
      }

      // ── Split: kept stay in craftsman, pushed move to a new dept ticket ───────
      const newDept = pushDept.toLowerCase();
      // 1. checked parts → craftsman
      if (kept.length > 0) {
        const { error } = await supabase.from('parts').update({ assigned_dept: 'craftsman' }).in('id', kept.map((p) => p.id));
        if (error) throw error;
      }
      // 2. create the box ticket for the remainder
      const { data: newUnitData, error: unitErr } = await supabase.from('cabinet_units').insert({
        tenant_id: tenantId,
        job_id: selUnit.job_id,
        job_number: selUnit.job_number,
        room_number: selUnit.room_number,
        unit_label: `${selUnit.unit_label} (Box)`,
        status: 'pending',
        assigned_dept: newDept,
        is_split: true,
        split_from_id: selUnit.id,
        parent_unit_id: selUnit.id,
      }).select('id').single();
      if (unitErr) throw unitErr;
      const newUnitId = (newUnitData as { id: string }).id;

      // 3. move unchecked parts to the new unit (compensate on later failure)
      try {
        const { error: moveErr } = await supabase.from('parts')
          .update({ cabinet_unit_id: newUnitId, assigned_dept: newDept })
          .in('id', pushed.map((p) => p.id));
        if (moveErr) throw moveErr;

        // 4. update original unit → craftsman ticket
        const { error: origErr } = await supabase.from('cabinet_units')
          .update({ is_split: true, unit_label: `${selUnit.unit_label} (Craftsman)` })
          .eq('id', selUnit.id);
        if (origErr) throw origErr;
      } catch (inner) {
        // Roll back: move parts back to the original, then delete the new unit.
        try { await supabase.from('parts').update({ cabinet_unit_id: selUnit.id }).in('id', pushed.map((p) => p.id)); } catch { /* ignore */ }
        try { await supabase.from('cabinet_units').delete().eq('id', newUnitId); } catch { /* ignore */ }
        throw inner;
      }

      // 5. shop learning + shift event
      for (const p of kept)   void learnPattern(labelPattern, p.part_name, 'craftsman');
      for (const p of pushed) void learnPattern(labelPattern, p.part_name, newDept);
      if (timeClockId) {
        try {
          await supabase.from('shift_events').insert({
            tenant_id: tenantId, time_clock_id: timeClockId, worker_name: crewName || 'Craftsman',
            event_type: 'craftsman_classification', dept: 'Craftsman',
            metadata: {
              unit_id: selUnit.id, original_dept: 'craftsman', new_dept: newDept,
              parts_kept: kept.length, parts_pushed: pushed.length,
            },
          });
        } catch { /* best effort */ }
      }

      // Notify supervisor of the split.
      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: 'Ticket split',
        body: `Craftsman split ${selUnit.unit_label} — ${pushed.length} part${pushed.length === 1 ? '' : 's'} sent to ${pushDept}`,
        url: '/app/supervisor',
      });

      setSuccess({ kept: kept.length, pushed: pushed.length, dept: pushDept });
      if (successTimer.current) clearTimeout(successTimer.current);
      successTimer.current = setTimeout(() => setSuccess(null), 2000);
      closeSelection();
      void load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Split failed — no changes saved', true);
      setSplitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const byJob: Record<string, CUnit[]> = {};
  units.forEach((u) => { const k = u.job_number || '__nojob__'; (byJob[k] ??= []).push(u); });
  const jobKeys = Object.keys(byJob);

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <span style={{ color: 'var(--teal)', display: 'flex' }}><IcoCraft /></span>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Craftsman Builds</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading builds…</div>
      ) : jobKeys.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>No craftsman builds assigned</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Ask your supervisor to upload a cutlist.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {jobKeys.map((jk) => (
            <div key={jk}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', marginBottom: 8 }}>{jobLabel(jk === '__nojob__' ? null : jk)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {byJob[jk].map((unit) => {
                  const ps = unitParts(unit.id);
                  const sm = statusMeta(unit.status);
                  const start = buildStarts[unit.id];
                  const busy = busyUnit === unit.id;
                  return (
                    <div key={unit.id} style={{ borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', padding: '16px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{unit.unit_label}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: sm.color, background: `${sm.color}22` }}>{sm.label}</span>
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 10 }}>{jobLabel(unit.job_number)}</div>

                      {/* Parts list with material notes */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                        {ps.length === 0 ? (
                          <div style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>No parts loaded.</div>
                        ) : ps.map((p) => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: p.flag_type ? '#F87171' : 'var(--ink-dim)' }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ flexShrink: 0, opacity: 0.6 }}><circle cx="12" cy="12" r="9"/></svg>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partLabel(p)}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</span>
                          </div>
                        ))}
                      </div>

                      {/* Live build timer */}
                      {unit.status === 'building' && start && (
                        <div style={{ fontSize: 20, fontWeight: 700, color: '#60A5FA', fontVariantNumeric: 'tabular-nums', marginBottom: 12 }}>{fmtElapsed(start)}</div>
                      )}

                      {/* Action buttons by status */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {unit.status !== 'building' && unit.status !== 'finishing' && (
                          <>
                            <button className="btn btn-primary" disabled={busy} onClick={() => startBuild(unit)} style={{ flex: '1 1 auto', justifyContent: 'center', minWidth: 130, opacity: busy ? 0.6 : 1 }}>Start Build</button>
                            <button disabled={busy} onClick={() => openSelection(unit)}
                              style={{ flex: '1 1 auto', minWidth: 130, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)', color: 'var(--teal)', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                              <IcoSplit /> Select my parts
                            </button>
                          </>
                        )}
                        {unit.status === 'building' && (
                          <button className="btn btn-primary" disabled={busy} onClick={() => markBuildComplete(unit)} style={{ flex: 1, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>Mark Build Complete</button>
                        )}
                        {unit.status === 'finishing' && (
                          <button disabled={busy} onClick={() => markFinishingComplete(unit)}
                            style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderRadius: 10, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', color: '#34D399', fontSize: 13, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                            Mark Finishing Complete
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Part-selection / push overlay ───────────────────────────────────── */}
      {selUnit && (() => {
        const all = unitParts(selUnit.id);
        const uncheckedCount = all.filter((p) => !selPartIds.has(p.id)).length;
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg-0, #07090b)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={closeSelection} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{selUnit.unit_label}</div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
              {overlayStep === 'select' ? (
                <>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Select the parts YOU are building:</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {all.map((p) => {
                      const checked = selPartIds.has(p.id);
                      return (
                        <button key={p.id} onClick={() => togglePart(p.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: checked ? 'rgba(94,234,212,0.08)' : 'var(--bg-1)', border: `1px solid ${checked ? 'rgba(94,234,212,0.3)' : 'var(--line)'}`, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}>
                          <div style={{ width: 24, height: 24, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${checked ? 'var(--teal)' : 'var(--ink-mute)'}`, background: checked ? 'var(--teal)' : 'transparent' }}>
                            {checked && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                          <span style={{ fontSize: 14, color: p.flag_type ? '#F87171' : 'var(--ink)', minWidth: 0 }}>{partLabel(p)}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Push {uncheckedCount} remaining part{uncheckedCount === 1 ? '' : 's'} to another dept?</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 18 }}>The parts you unchecked will become a separate ticket for the chosen department.</div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', marginBottom: 10 }}>Send to</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {PUSH_DEPTS.map((d) => (
                      <button key={d} onClick={() => setPushDept(d)}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 12, background: pushDept === d ? 'rgba(94,234,212,0.08)' : 'var(--bg-1)', border: `1px solid ${pushDept === d ? 'rgba(94,234,212,0.3)' : 'var(--line)'}`, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}>
                        <span style={{ color: pushDept === d ? 'var(--teal)' : 'var(--ink-mute)', display: 'flex' }}><IcoPush /></span>
                        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{d}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer actions */}
            <div style={{ padding: '16px 20px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
              {overlayStep === 'select' ? (
                <button className="btn btn-primary" disabled={splitting} onClick={() => {
                  if (uncheckedCount > 0) setOverlayStep('push');
                  else void confirmSelection(false); // everything kept
                }} style={{ flex: 1, justifyContent: 'center', opacity: splitting ? 0.6 : 1 }}>
                  Confirm selection
                </button>
              ) : (
                <>
                  <button disabled={splitting} onClick={() => void confirmSelection(false)}
                    style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', padding: '12px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink-dim)', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Keep all in Craftsman
                  </button>
                  <button className="btn btn-primary" disabled={splitting} onClick={() => void confirmSelection(true)} style={{ flex: 1, justifyContent: 'center', opacity: splitting ? 0.6 : 1 }}>
                    {splitting ? 'Pushing…' : 'Push parts'}
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Split success confirmation (auto-dismiss) ───────────────────────── */}
      {success && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, padding: 32, textAlign: 'center', maxWidth: 360 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(52,211,153,0.12)', color: '#34D399', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Parts split successfully</div>
            <div style={{ fontSize: 14, color: 'var(--ink-dim)' }}>{success.kept} part{success.kept === 1 ? '' : 's'} staying in Craftsman</div>
            <div style={{ fontSize: 14, color: 'var(--ink-dim)' }}>{success.pushed} part{success.pushed === 1 ? '' : 's'} sent to {success.dept}</div>
          </div>
        </div>
      )}
    </div>
  );
}
