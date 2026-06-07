'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { colorToHex, recomputeCabinet } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// The Finishing department's home view. Shows the finish specs the supervisor set
// for active jobs, then a structured "parts to finish" flow: pick a job → check the
// parts (grouped by cabinet, with select-all) → mark them complete. Each part can
// also be kicked back to another dept via a CO/Damage report.

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
  // Clock-in gate — finishing actions require an open shift.
  isClockedIn?: boolean;
  onRequireClock?: () => void;
}

const SEND_BACK_DEPTS = ['Production', 'Assembly', 'Craftsman'];

const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const rowLabel: React.CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 };
const rowVal: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink)', fontWeight: 600 };

const ColorChip = ({ color }: { color: string | null }) => (
  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, background: colorToHex(color), border: '1px solid rgba(255,255,255,0.18)', display: 'inline-block' }} />
);

function specSummary(s: FinishSpec): boolean {
  return !!(s.cabinet_color || s.door_style || s.door_color || s.edge_banding_color || s.spec_file_url || s.special_notes);
}

function dimText(p: FinishPart): string {
  const bits: string[] = [];
  if (p.width)  bits.push(`${p.width}`);
  if (p.height) bits.push(`${p.height}`);
  if (p.depth)  bits.push(`${p.depth}`);
  return bits.join('x');
}

function partDisplay(p: FinishPart): string {
  const dims = dimText(p);
  const bits = [p.part_name];
  if (dims) bits.push(dims);
  if (p.material) bits.push(p.material);
  return bits.join(' — ');
}

// Thin-stroke icons.
const IcoCheckbox = ({ checked }: { checked: boolean }) => (
  <span style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${checked ? 'var(--teal)' : 'var(--ink-mute)'}`, background: checked ? 'var(--teal)' : 'transparent' }}>
    {checked && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
  </span>
);
const IcoAlert = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

export default function FinishingView({ tenantId, showToast, crewName = '', isClockedIn = true, onRequireClock }: Props) {
  const [specs, setSpecs] = useState<FinishSpec[]>([]);
  const [parts, setParts] = useState<FinishPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [fullSpec, setFullSpec] = useState<FinishSpec | null>(null);
  const [specFile, setSpecFile] = useState<ViewerFile | null>(null);

  // CO/Damage kickback modal
  const [coPart, setCoPart] = useState<FinishPart | null>(null);
  const [coType, setCoType] = useState<'damage' | 'change_order'>('damage');
  const [coDesc, setCoDesc] = useState('');
  const [coSendDept, setCoSendDept] = useState<string>('Production');
  const [coPhoto, setCoPhoto] = useState<File | null>(null);
  const [coPreview, setCoPreview] = useState<string | null>(null);
  const [coSaving, setCoSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      // Active jobs (so we only show specs for jobs still in progress).
      let activeJobNums: string[] | null = null;
      try {
        const { data: jrows } = await supabase
          .from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = ((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number);
      } catch { /* jobs table optional */ }

      // Finish specs.
      const { data: specRows } = await supabase
        .from('finish_specs').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false });
      let specList = (specRows as FinishSpec[] | null) ?? [];
      if (activeJobNums && activeJobNums.length > 0) {
        const set = new Set(activeJobNums);
        specList = specList.filter((s) => set.has(s.job_number));
      }
      setSpecs(specList);

      // Parts pushed to finishing (not yet complete).
      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, material, width, height, depth, status')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'finishing')
        .neq('status', 'complete')
        .limit(400);
      const pRows = (partRows as { id: string; part_name: string; cabinet_unit_id: string; job_number: string | null; material: string | null; width: number | null; height: number | null; depth: number | null; status: string | null }[] | null) ?? [];

      // Resolve cabinet labels + job paths.
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

  // Realtime: refresh when specs or finishing parts change.
  useEffect(() => {
    const ch = supabase
      .channel('rt-finishing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finish_specs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  // ── Job list + selected-job grouping ───────────────────────────────────────
  const jobOptions = useMemo(() => {
    const map: Record<string, string> = {};
    parts.forEach((p) => { const jn = p.job_number ?? '__nojob__'; if (!map[jn]) map[jn] = p.jobPath; });
    return Object.entries(map)
      .map(([jobNumber, jobPath]) => ({ jobNumber, label: jobPath.split('/').map((s) => s.trim()).join(' / ') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [parts]);

  // Keep a valid selected job as the parts list changes.
  useEffect(() => {
    if (jobOptions.length === 0) { if (selectedJob) setSelectedJob(''); return; }
    if (!jobOptions.some((j) => j.jobNumber === selectedJob)) setSelectedJob(jobOptions[0].jobNumber);
  }, [jobOptions, selectedJob]);

  const jobParts = useMemo(
    () => parts.filter((p) => (p.job_number ?? '__nojob__') === selectedJob),
    [parts, selectedJob],
  );

  // Group selected job's parts by cabinet unit.
  const cabinetGroups = useMemo(() => {
    const groups: Record<string, { label: string; key: string; parts: FinishPart[] }> = {};
    jobParts.forEach((p) => {
      const g = (groups[p.cabinet_unit_id] ??= { label: p.cabinetLabel, key: p.cabinetKey, parts: [] });
      g.parts.push(p);
    });
    return Object.entries(groups).map(([cabinetId, g]) => ({ cabinetId, ...g }));
  }, [jobParts]);

  const jobPartIds = useMemo(() => jobParts.map((p) => p.id), [jobParts]);
  const allSelected = jobPartIds.length > 0 && jobPartIds.every((id) => checked.has(id));
  const checkedInJob = jobPartIds.filter((id) => checked.has(id)).length;

  function togglePart(id: string) {
    setChecked((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function toggleAll() {
    setChecked((prev) => {
      const n = new Set(prev);
      if (allSelected) jobPartIds.forEach((id) => n.delete(id));
      else jobPartIds.forEach((id) => n.add(id));
      return n;
    });
  }
  function toggleCabinet(ids: string[]) {
    setChecked((prev) => {
      const n = new Set(prev);
      const all = ids.every((id) => n.has(id));
      if (all) ids.forEach((id) => n.delete(id));
      else ids.forEach((id) => n.add(id));
      return n;
    });
  }

  // ── Mark selected parts complete ───────────────────────────────────────────
  async function markSelectedComplete() {
    if (!isClockedIn) { onRequireClock?.(); return; }
    const ids = jobPartIds.filter((id) => checked.has(id));
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    const affected = Array.from(new Set(jobParts.filter((p) => ids.includes(p.id)).map((p) => p.cabinet_unit_id)));
    try {
      const { error } = await supabase.from('parts')
        .update({ status: 'complete', production_status: 'complete', checked_at: new Date().toISOString(), checked_by: crewName || null })
        .in('id', ids).eq('tenant_id', tenantId);
      if (error) throw error;

      for (const cabId of affected) {
        await recomputeCabinet(tenantId, cabId);
        // If the whole cabinet is now complete, let the supervisor know.
        try {
          const { data: cab } = await supabase.from('cabinet_units').select('status, unit_label, job_number').eq('id', cabId).maybeSingle();
          const c = cab as { status: string | null; unit_label: string | null; job_number: string | null } | null;
          if (c && c.status === 'complete') {
            sendNotify({
              tenant_id: tenantId, target: 'supervisor',
              title: 'Cabinet complete',
              body: `${c.unit_label || 'Cabinet'} — ${c.job_number ? `Job ${c.job_number}` : ''} finished in Finishing`,
              url: '/app/supervisor',
            });
          }
        } catch { /* notify best-effort */ }
      }

      setParts((prev) => prev.filter((p) => !ids.includes(p.id)));
      setChecked((prev) => { const n = new Set(prev); ids.forEach((id) => n.delete(id)); return n; });
      showToast(`${ids.length} part${ids.length === 1 ? '' : 's'} marked complete`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update parts', true);
    } finally {
      setBulkBusy(false);
    }
  }

  // ── CO/Damage kickback ─────────────────────────────────────────────────────
  function openCoDamage(part: FinishPart) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    setCoPart(part);
    setCoType('damage');
    setCoDesc('');
    setCoSendDept('Production');
    setCoPhoto(null);
    setCoPreview(null);
  }
  function closeCoDamage() {
    setCoPart(null); setCoPhoto(null); setCoPreview(null); setCoDesc('');
  }

  async function submitCoDamage() {
    if (!coPart || coSaving) return;
    if (!isClockedIn) { onRequireClock?.(); return; }
    setCoSaving(true);
    try {
      let photoUrl: string | null = null;
      if (coPhoto) {
        try {
          const ext = coPhoto.name.split('.').pop() ?? 'jpg';
          const path = `${tenantId}/${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from('damage-photos').upload(path, coPhoto, { upsert: true });
          if (!upErr) { photoUrl = supabase.storage.from('damage-photos').getPublicUrl(path).data.publicUrl; }
        } catch { /* photo optional */ }
      }
      const sendDept = coSendDept.toLowerCase();
      const typeLabel = coType === 'change_order' ? 'Change Order' : 'Damage';
      const note = `${typeLabel} from Finishing — ${coPart.cabinetLabel}. After repair → ${coSendDept}.${coDesc.trim() ? ` ${coDesc.trim()}` : ''}`;

      const { error: dmgErr } = await supabase.from('damage_reports').insert({
        tenant_id:   tenantId,
        part_name:   coPart.part_name,
        dept:        'Finishing',
        notes:       note,
        photo_url:   photoUrl,
        status:      'open',
        report_type: coType,
        ...(coPart.job_number && { job_id: coPart.job_number }),
      });
      if (dmgErr) throw dmgErr;

      // Kick the part back to the chosen dept for rework.
      const { error: partErr } = await supabase.from('parts')
        .update({ assigned_dept: sendDept, production_status: 'pending', status: 'pending' })
        .eq('id', coPart.id).eq('tenant_id', tenantId);
      if (partErr) throw partErr;
      await recomputeCabinet(tenantId, coPart.cabinet_unit_id);

      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: `${typeLabel} report from Finishing`,
        body: `${coPart.part_name} — ${coPart.jobPath.split('/').map((s) => s.trim()).join(' / ')} — tap to review`,
        url: '/app/supervisor',
      });

      setParts((prev) => prev.filter((p) => p.id !== coPart.id));
      setChecked((prev) => { const n = new Set(prev); n.delete(coPart.id); return n; });
      showToast(`Sent to ${coSendDept} for rework`);
      closeCoDamage();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not submit report', true);
    } finally {
      setCoSaving(false);
    }
  }

  function openFullSpec(s: FinishSpec) {
    if (s.spec_file_url) {
      setSpecFile({ url: s.spec_file_url, name: s.spec_file_name || 'Finish Spec', jobPath: s.job_path ?? undefined });
    } else {
      setFullSpec(s);
    }
  }

  return (
    <>
      {/* ── Finish Specs ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Z"/><path d="M9 21h6"/></svg>
          Finish Specs
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading finish specs…</div>
        ) : specs.filter(specSummary).length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--ink-mute)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No finish specs uploaded</div>
            <div style={{ fontSize: 12.5 }}>Ask your supervisor to add finish specs.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {specs.filter(specSummary).map((s) => {
              const overrides = Object.entries(s.room_overrides ?? {});
              return (
                <div key={s.id} style={card}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>{(s.job_path || `Job ${s.job_number}`).split('/').map((x) => x.trim()).join(' / ')}</div>

                  {/* Cabinet finish */}
                  {(s.cabinet_color || s.cabinet_finish || s.sheen) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <ColorChip color={s.cabinet_color} />
                      <div style={{ minWidth: 0 }}>
                        <div style={rowLabel}>Cabinet</div>
                        <div style={rowVal}>{s.cabinet_color || '—'}{(s.cabinet_finish || s.sheen) ? <span style={{ fontWeight: 500, color: 'var(--ink-dim)' }}>{`  ·  ${[s.cabinet_finish, s.sheen].filter(Boolean).join(', ')}`}</span> : null}</div>
                        {s.paint_type && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 1 }}>{s.paint_type}{s.primer ? ` · Primer: ${s.primer}` : ''}</div>}
                      </div>
                    </div>
                  )}

                  {/* Door */}
                  {(s.door_style || s.door_color || s.door_finish) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <ColorChip color={s.door_color || s.cabinet_color} />
                      <div style={{ minWidth: 0 }}>
                        <div style={rowLabel}>Doors</div>
                        <div style={rowVal}>{[s.door_style, s.door_color].filter(Boolean).join(' · ') || '—'}{s.door_finish ? <span style={{ fontWeight: 500, color: 'var(--ink-dim)' }}>{`  ·  ${s.door_finish}`}</span> : null}</div>
                      </div>
                    </div>
                  )}

                  {/* Edge banding */}
                  {(s.edge_banding_color || s.edge_banding_type) && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={rowLabel}>Edge Banding</div>
                      <div style={rowVal}>{[s.edge_banding_color, s.edge_banding_type].filter(Boolean).join(' · ')}</div>
                    </div>
                  )}

                  {/* Room overrides */}
                  {overrides.length > 0 && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.18)' }}>
                      <div style={{ ...rowLabel, color: '#A78BFA', marginBottom: 6 }}>Room Overrides</div>
                      {overrides.map(([room, fields]) => (
                        <div key={room} style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 3 }}>
                          <b style={{ color: 'var(--ink)' }}>{room}</b>{' — '}{Object.entries(fields).map(([f, v]) => `${f}: ${v}`).join(', ')}
                        </div>
                      ))}
                    </div>
                  )}

                  {s.special_notes && <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 10, lineHeight: 1.5 }}>{s.special_notes}</div>}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => openFullSpec(s)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                      View Full Spec
                    </button>
                    <ViewDrawingsButton tenantId={tenantId} jobNumber={s.job_number} cabinetKey="" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Parts to Finish — structured selection flow ────────────────────── */}
      {!loading && parts.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={sectionLabel}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
            Parts to Finish ({parts.length})
          </div>

          {/* STEP 1 — Job selector */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ ...rowLabel, marginBottom: 6 }}>Job</div>
            <select
              value={selectedJob}
              onChange={(e) => setSelectedJob(e.target.value)}
              style={{ width: '100%', padding: '11px 12px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
            >
              {jobOptions.map((j) => (
                <option key={j.jobNumber} value={j.jobNumber}>{j.label}</option>
              ))}
            </select>
          </div>

          {/* STEP 2 — Parts checklist grouped by cabinet */}
          {jobPartIds.length > 0 && (
            <button
              onClick={toggleAll}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '7px 12px', borderRadius: 8, background: 'none', border: '1px solid var(--line)', color: 'var(--ink-dim)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <IcoCheckbox checked={allSelected} />
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {cabinetGroups.map((g) => {
              const ids = g.parts.map((p) => p.id);
              const cabAll = ids.every((id) => checked.has(id));
              return (
                <div key={g.cabinetId} style={card}>
                  {/* Cabinet header — select all within cabinet */}
                  <button
                    onClick={() => toggleCabinet(ids)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0, marginBottom: 10 }}
                  >
                    <IcoCheckbox checked={cabAll} />
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{g.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-mute)' }}>{g.parts.length} part{g.parts.length === 1 ? '' : 's'}</span>
                  </button>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {g.parts.map((p) => {
                      const isChecked = checked.has(p.id);
                      return (
                        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <button
                            onClick={() => togglePart(p.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: isChecked ? 'rgba(94,234,212,0.06)' : 'transparent', border: `1px solid ${isChecked ? 'rgba(94,234,212,0.25)' : 'var(--line)'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                          >
                            <IcoCheckbox checked={isChecked} />
                            <span style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partDisplay(p)}</span>
                          </button>
                          <ViewDrawingsButton tenantId={tenantId} jobNumber={p.job_number} cabinetKey={p.cabinetKey} compact />
                          <button
                            onClick={() => openCoDamage(p)}
                            title="Report a change order or damage and send back for rework"
                            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '7px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.28)', color: '#F87171', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                          >
                            <IcoAlert /> CO/Damage
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* STEP 3 — Mark complete */}
          <button
            onClick={() => void markSelectedComplete()}
            disabled={checkedInJob === 0 || bulkBusy}
            style={{
              marginTop: 16, width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8,
              padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              background: checkedInJob > 0 && !bulkBusy ? 'rgba(45,225,201,0.14)' : 'var(--bg-1)',
              border: `1px solid ${checkedInJob > 0 && !bulkBusy ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`,
              color: checkedInJob > 0 && !bulkBusy ? 'var(--teal)' : 'var(--ink-mute)',
              cursor: checkedInJob > 0 && !bulkBusy ? 'pointer' : 'not-allowed',
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {bulkBusy ? 'Saving…' : `Mark ${checkedInJob} part${checkedInJob === 1 ? '' : 's'} complete`}
          </button>
        </div>
      )}

      {/* Full-spec form modal (when no PDF uploaded) */}
      {fullSpec && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setFullSpec(null); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 480, margin: '24px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{(fullSpec.job_path || `Job ${fullSpec.job_number}`).split('/').map((x) => x.trim()).join(' / ')}</div>
              <button onClick={() => setFullSpec(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {([
                ['Cabinet Color', fullSpec.cabinet_color], ['Cabinet Finish', fullSpec.cabinet_finish], ['Sheen', fullSpec.sheen],
                ['Paint Type', fullSpec.paint_type], ['Primer', fullSpec.primer], ['Stain Color', fullSpec.stain_color],
                ['Door Style', fullSpec.door_style], ['Door Color', fullSpec.door_color], ['Door Finish', fullSpec.door_finish],
                ['Edge Banding Color', fullSpec.edge_banding_color], ['Edge Banding Type', fullSpec.edge_banding_type],
              ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                  <span style={rowLabel}>{k}</span>
                  <span style={{ ...rowVal, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>{k.includes('Color') ? <ColorChip color={v} /> : null}{v}</span>
                </div>
              ))}
              {fullSpec.special_notes && (
                <div><div style={{ ...rowLabel, marginBottom: 4 }}>Special Notes</div><div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{fullSpec.special_notes}</div></div>
              )}
              {Object.entries(fullSpec.room_overrides ?? {}).length > 0 && (
                <div>
                  <div style={{ ...rowLabel, color: '#A78BFA', marginBottom: 6 }}>Room Overrides</div>
                  {Object.entries(fullSpec.room_overrides ?? {}).map(([room, fields]) => (
                    <div key={room} style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 3 }}><b style={{ color: 'var(--ink)' }}>{room}</b>{' — '}{Object.entries(fields).map(([f, v]) => `${f}: ${v}`).join(', ')}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── CO / Damage kickback modal ─────────────────────────────────────── */}
      {coPart && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !coSaving) closeCoDamage(); }} style={{ position: 'fixed', inset: 0, zIndex: 410, background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 440, margin: '24px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>CO / Damage</div>
              <button onClick={closeCoDamage} disabled={coSaving} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Report Type toggle */}
              <div>
                <div style={{ ...rowLabel, marginBottom: 6 }}>Report Type</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['damage', 'Damage'], ['change_order', 'Change Order']] as [typeof coType, string][]).map(([val, label]) => {
                    const active = coType === val;
                    const accent = val === 'damage' ? '#F87171' : '#FBBF24';
                    return (
                      <button key={val} onClick={() => setCoType(val)}
                        style={{ flex: 1, padding: '10px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', color: active ? accent : 'var(--ink-mute)', background: active ? `${accent}1f` : 'var(--bg-1)', border: `1px solid ${active ? accent : 'var(--line)'}` }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Prefilled context */}
              <div style={{ ...card, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{coPart.part_name}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{coPart.cabinetLabel} · {coPart.jobPath.split('/').map((x) => x.trim()).join(' / ')}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Reporter: {crewName || 'Crew'}</div>
              </div>

              {/* Description */}
              <div>
                <div style={{ ...rowLabel, marginBottom: 6 }}>Description</div>
                <textarea value={coDesc} onChange={(e) => setCoDesc(e.target.value)} rows={3} placeholder={coType === 'change_order' ? 'What needs to change…' : 'Describe the damage…'}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>

              {/* Send back to dept */}
              <div>
                <div style={{ ...rowLabel, marginBottom: 6 }}>After repair, send to:</div>
                <select value={coSendDept} onChange={(e) => setCoSendDept(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}>
                  {SEND_BACK_DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              {/* Optional photo */}
              <div>
                <div style={{ ...rowLabel, marginBottom: 6 }}>Photo (optional)</div>
                <input type="file" accept="image/*" capture="environment"
                  onChange={(e) => { const f = e.target.files?.[0] ?? null; setCoPhoto(f); setCoPreview(f ? URL.createObjectURL(f) : null); }}
                  style={{ fontSize: 13, color: 'var(--ink-dim)' }} />
                {coPreview && <img src={coPreview} alt="preview" style={{ marginTop: 8, width: 120, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} />}
              </div>

              <button
                onClick={() => void submitCoDamage()}
                disabled={coSaving}
                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '12px', borderRadius: 10, background: coType === 'change_order' ? '#FBBF24' : '#F87171', color: '#1a1206', border: 'none', fontSize: 14, fontWeight: 700, cursor: coSaving ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: coSaving ? 0.6 : 1 }}
              >
                {coSaving ? 'Submitting…' : `Submit & send to ${coSendDept}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
    </>
  );
}
