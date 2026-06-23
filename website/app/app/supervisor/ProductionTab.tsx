'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { pushPart, deptDisplay, recomputeCabinet } from '@/lib/partActions';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import DeptCrewStrip from './DeptCrewStrip';

// ── Supervisor Production tab ──────────────────────────────────────────────────
// Modeled on AssemblyTab: a "Crew on floor" strip, then collapsible Job folders →
// Cabinet rows. Each cabinet lists its production parts with a cut-status badge,
// and can be pushed to Assembly / Craftsman / Finishing or marked all-cut.

type CabinetUnit = {
  id: string;
  tenant_id: string;
  job_number: string | null;
  room_number: string | null;
  cabinet_number: string | null;
  unit_label: string;
  status: string;
  assigned_dept: string | null;
  production_status: string | null;
  created_at: string;
};

type ProdPart = {
  id: string;
  cabinet_unit_id: string;
  job_number: string | null;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number | null;
  status: string;
  production_status: string | null;
  assigned_dept: string | null;
};

type Job = { id: string; job_number: string; job_name: string | null; status: string; job_path?: string | null };

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
  departments?: string[];
}

// Push destinations from production (parts flow FROM production).
const PUSH_TARGETS = ['Assembly', 'Craftsman', 'Finishing'];

const IcoChevron = ({ open, size = 16 }: { open: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
    <polyline points="9 6 15 12 9 18"/>
  </svg>
);

// Cut-status badge: not_cut → grey · cutting → amber · cut → teal.
function CutStatusBadge({ status }: { status: string | null }) {
  const s = (status || 'not_cut').toLowerCase();
  const meta = s === 'cut'
    ? { label: 'Cut', color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)', border: 'rgba(94,234,212,0.3)' }
    : s === 'cutting'
      ? { label: 'Cutting', color: '#FBBF24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' }
      : { label: 'Not Cut', color: '#8BA5A0', bg: 'rgba(139,165,160,0.12)', border: 'rgba(139,165,160,0.2)' };
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: meta.color, background: meta.bg, border: `1px solid ${meta.border}`, flexShrink: 0 }}>{meta.label}</span>;
}

// Room folder label — matches FinishingView: null room_number → 'General'.
function roomLabel(roomNumber: string | null): string {
  if (!roomNumber) return 'General';
  return `Room ${roomNumber}`;
}

// Group a job's units by room, named rooms first and 'General'/no-room last
// (same ordering convention as FinishingView.roomsForJob).
function roomsForUnits(jobUnits: CabinetUnit[]): { roomNumber: string | null; units: CabinetUnit[] }[] {
  const byRoom: Record<string, CabinetUnit[]> = {};
  jobUnits.forEach((u) => { const rk = u.room_number ?? '__noroom__'; (byRoom[rk] ??= []).push(u); });
  return Object.entries(byRoom)
    .sort(([a], [b]) => {
      if (a === '__noroom__') return 1;
      if (b === '__noroom__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([rk, units]) => ({ roomNumber: rk === '__noroom__' ? null : rk, units }));
}

function rowStyle(indent: number, divider: boolean): CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 11,
    padding: '13px 20px', paddingLeft: 20 + indent,
    background: 'none', border: 'none',
    borderTop: divider ? '1px solid var(--line)' : 'none',
    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)',
  };
}

function dimLabel(p: ProdPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}

export default function ProductionTab({ tenantId, showToast, jobs }: Props) {
  const [units, setUnits] = useState<CabinetUnit[]>([]);
  const [parts, setParts] = useState<ProdPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedCab, setExpandedCab] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [unitRes, partRes] = await Promise.all([
        supabase.from('cabinet_units')
          .select('id, tenant_id, job_number, room_number, cabinet_number, unit_label, status, assigned_dept, production_status, created_at')
          .eq('tenant_id', tenantId).eq('assigned_dept', 'production').neq('status', 'complete')
          .order('created_at', { ascending: false }).limit(5000),
        supabase.from('parts')
          .select('id, cabinet_unit_id, job_number, part_name, material, width, height, depth, quantity, status, production_status, assigned_dept')
          .eq('tenant_id', tenantId).eq('assigned_dept', 'production').limit(10000),
      ]);
      setUnits((unitRes.data as CabinetUnit[] | null) ?? []);
      setParts((partRes.data as ProdPart[] | null) ?? []);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load production work', true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-sup-production')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  const jobLabelFor = useCallback((jobNumber: string): string => {
    const j = (jobs ?? []).find((x) => x.job_number === jobNumber);
    if (j) {
      if (j.job_path && j.job_path.trim()) return j.job_path.split('/').map((s) => s.trim()).filter(Boolean).join(' / ');
      if (j.job_name && j.job_name.trim()) return j.job_name.trim();
    }
    return jobNumber === 'No Job' ? 'No Job' : `Job ${jobNumber}`;
  }, [jobs]);

  const unitParts = (unitId: string) => parts.filter((p) => p.cabinet_unit_id === unitId);

  // Derive a cabinet's cut status from its parts — the cabinet-level
  // production_status column is retired (parts are the only trustworthy source).
  // cut = every part cut · cutting = any part mid-cut · else not cut.
  function cabinetCutStatus(unitId: string): string {
    const ps = unitParts(unitId);
    if (ps.length === 0) return 'not_cut';
    if (ps.every((p) => p.production_status === 'cut')) return 'cut';
    if (ps.some((p) => p.production_status === 'cutting')) return 'cutting';
    return 'not_cut';
  }

  // Push every production part of a cabinet to another dept.
  async function pushCabinet(unit: CabinetUnit, toDept: string) {
    if (busyId) return;
    const cabParts = unitParts(unit.id);
    if (cabParts.length === 0) { showToast('No production parts on this cabinet', true); return; }
    setBusyId(unit.id);
    try {
      const results = await Promise.allSettled(cabParts.map((p) =>
        pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: unit.id, jobNumber: unit.job_number, fromDept: 'production', toDept, workerName: 'Supervisor', timeClockId: null })
      ));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed > 0) showToast(`${failed} part${failed === 1 ? '' : 's'} failed to push`, true);
      else showToast(`${unit.unit_label} sent to ${toDept}`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Push failed', true);
    } finally {
      setBusyId(null);
    }
  }

  // Mark every part on a cabinet cut. Brings parity with pushPart's cut
  // confirmation (records cut_by/cut_at and recomputes the cabinet), but stays in
  // production — this never moves the cabinet to another dept.
  async function markAllCut(unit: CabinetUnit) {
    if (busyId) return;
    setBusyId(unit.id);
    try {
      const { error } = await supabase.from('parts')
        .update({ production_status: 'cut', cut_by: 'Supervisor', cut_at: new Date().toISOString() })
        .eq('cabinet_unit_id', unit.id).eq('tenant_id', tenantId);
      if (error) throw error;
      // Keep cabinet_units.status = 'cut' for AssemblyTab's status display, but no
      // longer write the retired cabinet_units.production_status column.
      try { await supabase.from('cabinet_units').update({ status: 'cut' }).eq('id', unit.id); } catch { /* best-effort */ }
      await recomputeCabinet(tenantId, unit.id);
      showToast(`${unit.unit_label} marked cut`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not mark cut', true);
    } finally {
      setBusyId(null);
    }
  }

  // Group by job_number.
  const byJob: Record<string, CabinetUnit[]> = {};
  units.forEach((u) => {
    const k = u.job_number || 'No Job';
    (byJob[k] ??= []).push(u);
  });
  const jobKeys = Object.keys(byJob).sort((a, b) => jobLabelFor(a).localeCompare(jobLabelFor(b)));

  const actionBtn = (color: string): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
    background: `${color}1a`, border: `1px solid ${color}55`, color, fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DeptCrewStrip tenantId={tenantId} dept="Production" />

      {loading ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading production data…</div>
      ) : units.length === 0 ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No cabinets in production right now.</div>
      ) : (
        <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
          {jobKeys.map((jobKey, ji) => {
            const jobUnits = byJob[jobKey];
            const jobOpen = expandedJob === jobKey;
            return (
              <div key={jobKey} style={{ borderTop: ji > 0 ? '1px solid var(--line)' : 'none' }}>
                {/* Job folder */}
                <button onClick={() => { setExpandedJob(jobOpen ? null : jobKey); setExpandedRoom(null); setExpandedCab(null); }} style={rowStyle(0, false)}>
                  <IcoChevron open={jobOpen} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{jobLabelFor(jobKey)}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{jobUnits.length} unit{jobUnits.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </button>

                {/* Room folders */}
                {jobOpen && roomsForUnits(jobUnits).map((room) => {
                  const roomKey = `${jobKey}::${room.roomNumber ?? '__noroom__'}`;
                  const roomOpen = expandedRoom === roomKey;
                  return (
                    <div key={roomKey}>
                      <button onClick={() => { setExpandedRoom(roomOpen ? null : roomKey); setExpandedCab(null); }} style={rowStyle(16, true)}>
                        <IcoChevron open={roomOpen} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{roomLabel(room.roomNumber)}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 10 }}>{room.units.length} unit{room.units.length !== 1 ? 's' : ''}</span>
                        </div>
                      </button>

                {/* Cabinets */}
                {roomOpen && room.units.map((unit) => {
                  const cabParts = unitParts(unit.id);
                  const cabOpen = expandedCab === unit.id;
                  const busy = busyId === unit.id;
                  return (
                    <div key={unit.id}>
                      <button onClick={() => setExpandedCab(cabOpen ? null : unit.id)} style={rowStyle(32, true)}>
                        <IcoChevron open={cabOpen} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                            {unit.cabinet_number ? `${unit.cabinet_number} — ${unit.unit_label}` : unit.unit_label}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 10 }}>{cabParts.length} part{cabParts.length !== 1 ? 's' : ''}</span>
                        </div>
                        <CutStatusBadge status={cabinetCutStatus(unit.id)} />
                      </button>

                      {cabOpen && (
                        <div style={{ padding: '4px 20px 16px 51px', background: 'rgba(255,255,255,0.015)' }}>
                          <div style={{ marginBottom: 8 }}>
                            <ViewDrawingsButton tenantId={tenantId} jobNumber={unit.job_number} cabinetKey={unit.cabinet_number || unit.unit_label} compact={false} />
                          </div>

                          {cabParts.length === 0 ? (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', padding: '8px 0' }}>No production parts for this unit.</div>
                          ) : (
                            cabParts.map((p) => (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                                    {p.part_name}
                                    {p.quantity && p.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{p.quantity}</span>}
                                  </div>
                                  {(dimLabel(p) || p.material) && (
                                    <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>{[dimLabel(p), p.material].filter(Boolean).join(' · ')}</div>
                                  )}
                                </div>
                                <CutStatusBadge status={p.production_status} />
                              </div>
                            ))
                          )}

                          {/* Actions */}
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                            <button onClick={() => void markAllCut(unit)} disabled={busy} style={{ ...actionBtn('#5EEAD4'), opacity: busy ? 0.6 : 1 }}>
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              Mark all cut
                            </button>
                            {PUSH_TARGETS.map((d) => (
                              <button key={d} onClick={() => void pushCabinet(unit, d)} disabled={busy} style={{ ...actionBtn('#3B82F6'), opacity: busy ? 0.6 : 1 }}>
                                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                {deptDisplay(d)}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
