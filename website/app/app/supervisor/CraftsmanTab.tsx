'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import FinishSpecsModal from './FinishSpecsModal';

// ── Types ─────────────────────────────────────────────────────────────────────

type CabinetUnit = {
  id: string;
  tenant_id: string;
  job_id: string | null;
  job_number: string | null;
  room_number: string | null;
  cabinet_number: string | null;
  unit_label: string;
  status: string;
  assigned_dept: string | null;
  is_split: boolean | null;
  production_status: string | null;
  created_at: string;
};

type CraftPart = {
  id: string;
  cabinet_unit_id: string | null;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  assigned_dept: string | null;
};

type Job = {
  id: string;
  job_number: string;
  job_name: string | null;
  status: string;
  job_path?: string | null;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
}

// Keywords that suggest a unit belongs in the Craftsman queue (mirrors the
// crew-side classifier vocabulary).
const SUGGEST_KEYWORDS = ['countertop', 'shelf', 'hood', 'mantle', 'mantel', 'island', 'bench', 'wine', 'corbel'];

// Depts a craftsman unit can be reassigned to.
const REASSIGN_DEPTS = ['Production', 'Assembly', 'Finishing'];

const STATUS_ORDER = ['pending', 'building', 'finishing', 'complete'];

// ── Icons (thin stroke, no emoji) ─────────────────────────────────────────────

const IcoChevron = ({ open }: { open: boolean }) => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
    <polyline points="9 6 15 12 9 18"/>
  </svg>
);
const IcoCraft = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);
const IcoSplit = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>
  </svg>
);
const IcoPlus = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
const IcoBrush = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusMeta(status: string): { label: string; color: string; bg: string } {
  switch ((status || 'pending').toLowerCase()) {
    case 'building':  return { label: 'Building',  color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' };
    case 'finishing': return { label: 'Finishing', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' };
    case 'complete':  return { label: 'Complete',  color: '#34D399', bg: 'rgba(52,211,153,0.12)' };
    default:          return { label: 'Pending',   color: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' };
  }
}

function dimText(parts: CraftPart[]): string {
  const p = parts.find((x) => x.width || x.height || x.depth);
  if (!p) return '';
  const bits: string[] = [];
  if (p.width)  bits.push(`${p.width}"`);
  if (p.height) bits.push(`${p.height}"`);
  if (p.depth)  bits.push(`${p.depth}"`);
  return bits.join(' x ');
}

function materialText(parts: CraftPart[]): string {
  const p = parts.find((x) => x.material && x.material.trim());
  return p?.material?.trim() ?? '';
}

function patternFromLabel(label: string): string {
  const lower = label.toLowerCase();
  for (const kw of SUGGEST_KEYWORDS) if (lower.includes(kw)) return kw;
  return lower.trim().slice(0, 40);
}

const lbl: CSSProperties = { fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 };

// ── Component ─────────────────────────────────────────────────────────────────

export default function CraftsmanTab({ tenantId, showToast, jobs = [] }: Props) {
  const [units,   setUnits]   = useState<CabinetUnit[]>([]);
  const [parts,   setParts]   = useState<CraftPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Add-craftsman-piece form
  const [addOpen, setAddOpen] = useState(false);
  const [fJob,    setFJob]    = useState('');
  const [fDesc,   setFDesc]   = useState('');
  const [fMat,    setFMat]    = useState('');
  const [fW,      setFW]      = useState('');
  const [fH,      setFH]      = useState('');
  const [fD,      setFD]      = useState('');
  const [fNotes,  setFNotes]  = useState('');
  const [adding,  setAdding]  = useState(false);

  // Finish-spec modal (per job)
  const [specJob, setSpecJob] = useState<{ jobNumber: string; jobPath: string | null } | null>(null);

  const jobLabelFor = useCallback((jobNumber: string | null): string => {
    if (!jobNumber) return 'No Job';
    const j = jobs.find((x) => x.job_number === jobNumber);
    if (j?.job_path && j.job_path.trim()) return j.job_path.split('/').map((s) => s.trim()).filter(Boolean).join(' / ');
    if (j?.job_name && j.job_name.trim()) return j.job_name.trim();
    return `Job ${jobNumber}`;
  }, [jobs]);

  const load = useCallback(async () => {
    try {
      const UNIT_COLS = 'id, tenant_id, job_id, job_number, room_number, cabinet_number, unit_label, status, assigned_dept, is_split, production_status, created_at';
      const [unitRes, partRes] = await Promise.all([
        supabase
          .from('cabinet_units')
          .select(UNIT_COLS)
          .eq('tenant_id', tenantId)
          .in('assigned_dept', ['craftsman', 'production'])
          .limit(5000),
        supabase
          .from('parts')
          .select('id, cabinet_unit_id, part_name, material, width, height, depth, assigned_dept')
          .eq('tenant_id', tenantId)
          .limit(10000),
      ]);
      let unitList = (unitRes.data as CabinetUnit[]) ?? [];
      const allParts = (partRes.data as CraftPart[]) ?? [];

      // A cabinet also belongs in the craftsman tab when any of its parts was
      // pushed to craftsman — those cabinets become 'split' and so are missed by
      // the assigned_dept filter above. Pull them in by id.
      const craftPartCabIds = Array.from(new Set(allParts
        .filter((p) => p.assigned_dept === 'craftsman')
        .map((p) => p.cabinet_unit_id)
        .filter(Boolean))) as string[];
      const missingIds = craftPartCabIds.filter((id) => !unitList.some((u) => u.id === id));
      if (missingIds.length > 0) {
        try {
          const { data: extra } = await supabase
            .from('cabinet_units').select(UNIT_COLS).eq('tenant_id', tenantId).in('id', missingIds);
          unitList = [...unitList, ...((extra as CabinetUnit[]) ?? [])];
        } catch { /* best-effort */ }
      }

      setUnits(unitList);
      setParts(allParts);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load craftsman work', true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Realtime — supervisor sees new units / dept reassignments AND part pushes
  // (a part pushed to craftsman must surface its cabinet here instantly).
  useEffect(() => {
    const ch = supabase
      .channel('rt-sup-craftsman')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  const partsFor = useCallback((unitId: string) => parts.filter((p) => p.cabinet_unit_id === unitId), [parts]);

  // Cabinet ids that have at least one part pushed to craftsman.
  const craftPartCabIds = useMemo(
    () => new Set(parts.filter((p) => p.assigned_dept === 'craftsman').map((p) => p.cabinet_unit_id).filter(Boolean)),
    [parts],
  );

  // Section 1 — units assigned to craftsman OR owning a craftsman part (splits).
  const craftsmanUnits = useMemo(
    () => units.filter((u) => u.assigned_dept === 'craftsman' || craftPartCabIds.has(u.id)),
    [units, craftPartCabIds],
  );

  const groupedByJob = useMemo(() => {
    const groups: Record<string, CabinetUnit[]> = {};
    craftsmanUnits.forEach((u) => {
      const key = u.job_number ?? 'No Job';
      (groups[key] ??= []).push(u);
    });
    return Object.entries(groups)
      .map(([job, us]) => ({
        job,
        units: us.slice().sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
      }))
      .sort((a, b) => jobLabelFor(a.job).localeCompare(jobLabelFor(b.job)));
  }, [craftsmanUnits, jobLabelFor]);

  // Section 2 — production units whose label suggests craftsman work (and which
  // don't already own a craftsman part).
  const suggestedUnits = useMemo(() =>
    units.filter((u) => u.assigned_dept === 'production'
      && !craftPartCabIds.has(u.id)
      && SUGGEST_KEYWORDS.some((kw) => u.unit_label.toLowerCase().includes(kw))),
  [units, craftPartCabIds]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function reassign(unit: CabinetUnit, dept: string) {
    if (busyId) return;
    const target = dept.toLowerCase();
    setBusyId(unit.id);
    setUnits((prev) => prev.map((u) => u.id === unit.id ? { ...u, assigned_dept: target } : u));
    try {
      const { error } = await supabase.from('cabinet_units').update({ assigned_dept: target }).eq('id', unit.id);
      if (error) throw error;
      showToast(`Moved to ${dept}`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Reassign failed', true);
      void load();
    } finally {
      setBusyId(null);
    }
  }

  async function assignToCraftsman(unit: CabinetUnit) {
    if (busyId) return;
    setBusyId(unit.id);
    setUnits((prev) => prev.map((u) => u.id === unit.id ? { ...u, assigned_dept: 'craftsman' } : u));
    try {
      const { error } = await supabase.from('cabinet_units').update({ assigned_dept: 'craftsman' }).eq('id', unit.id);
      if (error) throw error;
      // Save the pattern so the classifier learns this is craftsman work.
      try {
        await supabase.from('craftsman_classifications').insert({
          tenant_id: tenantId,
          unit_label_pattern: patternFromLabel(unit.unit_label),
          assigned_dept: 'craftsman',
          confirmed_by: 'Supervisor',
        });
      } catch (_) { /* learning is best-effort */ }
      showToast('Assigned to Craftsman');
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Assign failed', true);
      void load();
    } finally {
      setBusyId(null);
    }
  }

  // "Keep in Production" — dismiss the suggestion without changing the dept.
  // We record the pattern as production so the same unit stops being suggested.
  async function keepInProduction(unit: CabinetUnit) {
    if (busyId) return;
    setBusyId(unit.id);
    try {
      await supabase.from('craftsman_classifications').insert({
        tenant_id: tenantId,
        unit_label_pattern: patternFromLabel(unit.unit_label),
        assigned_dept: 'production',
        confirmed_by: 'Supervisor',
      });
      // Locally drop it from the suggestion list for this session.
      setDismissed((prev) => { const n = new Set(prev); n.add(unit.id); return n; });
      showToast('Kept in Production');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not save', true);
    } finally {
      setBusyId(null);
    }
  }

  async function addCraftsmanPiece() {
    if (adding) return;
    const desc = fDesc.trim();
    if (!desc) { showToast('Add a description', true); return; }
    if (!fJob) { showToast('Select a job', true); return; }
    setAdding(true);
    try {
      const job = jobs.find((j) => j.job_number === fJob);
      const { data: unitRow, error: unitErr } = await supabase
        .from('cabinet_units')
        .insert({
          tenant_id:         tenantId,
          job_id:            job?.id ?? null,
          job_number:        fJob,
          unit_label:        desc,
          assigned_dept:     'craftsman',
          status:            'pending',
          production_status: 'not_cut',
        })
        .select('id')
        .single();
      if (unitErr) throw unitErr;
      const unitId = (unitRow as { id: string }).id;
      // Associated part holds the dimensions / material.
      const toNum = (v: string) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
      const { error: partErr } = await supabase.from('parts').insert({
        tenant_id:       tenantId,
        cabinet_unit_id: unitId,
        job_number:      fJob,
        part_name:       desc,
        material:        fMat.trim() || null,
        width:           toNum(fW),
        height:          toNum(fH),
        depth:           toNum(fD),
        assigned_dept:   'craftsman',
        production_status: 'not_cut',
      });
      if (partErr) throw partErr;
      showToast('Craftsman piece added');
      setFJob(''); setFDesc(''); setFMat(''); setFW(''); setFH(''); setFD(''); setFNotes('');
      setAddOpen(false);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add piece', true);
    } finally {
      setAdding(false);
    }
  }

  const activeSuggested = suggestedUnits.filter((u) => !dismissed.has(u.id));

  // ── Render ───────────────────────────────────────────────────────────────────

  const sectionTitle: CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ── SECTION 1 — Craftsman Assignments ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--teal)' }}>
          <IcoCraft />
          <span style={sectionTitle}>Craftsman Assignments</span>
        </div>

        {loading ? (
          <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
        ) : groupedByJob.length === 0 ? (
          <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No craftsman work assigned yet.</div>
        ) : (
          groupedByJob.map(({ job, units: jobUnits }) => {
            const open = !collapsed[job];
            return (
              <div key={job} className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  onClick={() => setCollapsed((c) => ({ ...c, [job]: open }))}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'none', border: 'none', borderBottom: open ? '1px solid var(--line)' : 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink-mute)' }}
                >
                  <IcoChevron open={open} />
                  <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{jobLabelFor(job)}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{jobUnits.length} craftsman piece{jobUnits.length === 1 ? '' : 's'}</span>
                </button>

                {open && (
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {jobUnits.map((unit) => {
                      const up = partsFor(unit.id);
                      const dims = dimText(up);
                      const mat  = materialText(up);
                      const sm   = statusMeta(unit.status);
                      const splitDepts = Array.from(new Set(up.map((p) => p.assigned_dept).filter(Boolean))) as string[];
                      const busy = busyId === unit.id;
                      return (
                        <div key={unit.id} style={{ padding: '14px 18px', borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                                {unit.cabinet_number ? `${unit.cabinet_number} ` : ''}{unit.unit_label}
                              </div>
                              {(mat || dims) && (
                                <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 3 }}>
                                  {mat}{mat && dims ? ' · ' : ''}{dims}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 6, color: sm.color, background: sm.bg }}>{sm.label}</span>
                            {unit.is_split && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 6, color: '#A78BFA', background: 'rgba(167,139,250,0.12)' }}>
                                <IcoSplit /> Split{splitDepts.length ? ` · ${splitDepts.map((d) => d[0].toUpperCase() + d.slice(1)).join(', ')}` : ''}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <ViewDrawingsButton tenantId={tenantId} jobNumber={unit.job_number} cabinetKey={unit.cabinet_number || unit.unit_label} />

                            {/* Reassign dropdown */}
                            <select
                              value=""
                              disabled={busy}
                              onChange={(e) => { if (e.target.value) void reassign(unit, e.target.value); }}
                              style={{ fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line-strong)', color: 'var(--ink-dim)', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit' }}
                            >
                              <option value="">Reassign…</option>
                              {REASSIGN_DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>

                            {/* Section 4 — finish spec */}
                            <button
                              onClick={() => setSpecJob({ jobNumber: unit.job_number ?? fJob, jobPath: jobLabelFor(unit.job_number) })}
                              disabled={!unit.job_number}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)', color: '#FBBF24', cursor: unit.job_number ? 'pointer' : 'not-allowed', opacity: unit.job_number ? 1 : 0.5, fontFamily: 'inherit' }}
                            >
                              <IcoBrush /> Add Finish Spec
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ── SECTION 2 — Unassigned Craftsman Work ── */}
      {activeSuggested.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#FBBF24' }}>
            <span style={sectionTitle}>Unassigned Craftsman Work</span>
          </div>
          <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
            {activeSuggested.map((unit, i) => {
              const up = partsFor(unit.id);
              const dims = dimText(up);
              const mat  = materialText(up);
              const busy = busyId === unit.id;
              return (
                <div key={unit.id} style={{ padding: '14px 18px', borderTop: i === 0 ? 'none' : '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#FBBF24', marginBottom: 4 }}>Suggested for Craftsman</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{unit.unit_label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 3 }}>
                      {jobLabelFor(unit.job_number)}{(mat || dims) ? ' · ' : ''}{mat}{mat && dims ? ' · ' : ''}{dims}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => void assignToCraftsman(unit)}
                      disabled={busy}
                      className="btn btn-primary"
                      style={{ fontSize: 12, padding: '7px 14px', opacity: busy ? 0.6 : 1 }}
                    >
                      Assign to Craftsman
                    </button>
                    <button
                      onClick={() => void keepInProduction(unit)}
                      disabled={busy}
                      className="btn btn-ghost"
                      style={{ fontSize: 12, padding: '7px 14px', opacity: busy ? 0.6 : 1 }}
                    >
                      Keep in Production
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SECTION 3 — Add Craftsman Work Manually ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!addOpen ? (
          <button
            onClick={() => setAddOpen(true)}
            className="btn btn-ghost"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start' }}
          >
            <IcoPlus /> Add Craftsman Piece
          </button>
        ) : (
          <div className="portal-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={sectionTitle}>Add Craftsman Piece</span>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
            </div>
            <div>
              <label style={lbl}>Job</label>
              <select className="form-input" value={fJob} onChange={(e) => setFJob(e.target.value)} style={{ width: '100%', cursor: 'pointer' }}>
                <option value="">— select a job —</option>
                {jobs.filter((j) => j.status === 'active').map((j) => (
                  <option key={j.id} value={j.job_number}>{jobLabelFor(j.job_number)}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Description</label>
              <input className="form-input" value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="e.g. Custom Vent Hood" style={{ width: '100%' }} />
            </div>
            <div>
              <label style={lbl}>Material</label>
              <input className="form-input" value={fMat} onChange={(e) => setFMat(e.target.value)} placeholder="e.g. White Oak" style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}><label style={lbl}>Width</label><input className="form-input" type="number" value={fW} onChange={(e) => setFW(e.target.value)} placeholder='in' style={{ width: '100%' }} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Height</label><input className="form-input" type="number" value={fH} onChange={(e) => setFH(e.target.value)} placeholder='in' style={{ width: '100%' }} /></div>
              <div style={{ flex: 1 }}><label style={lbl}>Depth</label><input className="form-input" type="number" value={fD} onChange={(e) => setFD(e.target.value)} placeholder='in' style={{ width: '100%' }} /></div>
            </div>
            <div>
              <label style={lbl}>Notes</label>
              <textarea className="form-input" value={fNotes} onChange={(e) => setFNotes(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} />
            </div>
            <button onClick={() => void addCraftsmanPiece()} disabled={adding} className="btn btn-primary" style={{ alignSelf: 'flex-start', opacity: adding ? 0.6 : 1 }}>
              {adding ? 'Adding…' : 'Add to Craftsman Queue'}
            </button>
          </div>
        )}
      </div>

      {/* Section 4 — finish spec modal (per job) */}
      {specJob && (
        <FinishSpecsModal
          tenantId={tenantId}
          jobNumber={specJob.jobNumber}
          jobPath={specJob.jobPath}
          onClose={() => setSpecJob(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
}
