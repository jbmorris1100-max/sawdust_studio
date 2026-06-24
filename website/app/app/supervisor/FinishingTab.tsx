'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { pushPart, colorToHex } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import DeptCrewStrip from './DeptCrewStrip';

// ── Supervisor Finishing tab ───────────────────────────────────────────────────
// Modeled on AssemblyTab: a "Crew on floor" strip, then collapsible Job → Room →
// Cabinet folders. Each cabinet row shows its finish color chip + finish type from
// finish_specs, and can be pushed to Assembly / QC or flagged. Active finishing
// room timers (localStorage 'finishing_room_timers') surface as a live dot.

type CabinetUnit = {
  id: string;
  tenant_id: string;
  job_number: string | null;
  room_number: string | null;
  cabinet_number: string | null;
  unit_label: string;
  status: string;
  assigned_dept: string | null;
  flagged_reason: string | null;
  created_at: string;
};

type FinPart = {
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
  assigned_dept: string | null;
};

type FinishSpec = {
  job_number: string;
  cabinet_color: string | null;
  cabinet_finish: string | null;
  sheen: string | null;
};

type Job = { id: string; job_number: string; job_name: string | null; status: string; job_path?: string | null };
type RoomTimer = { timeClockId: string | null; start: string };

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
  departments?: string[];
  // Department this tab is scoped to. Defaults to 'Finishing' so the fixed tab is
  // unchanged; the dynamic '__dept__' renderer passes a custom department name to
  // reuse this room-grouped structure for any 'group_auto'-template dept.
  deptName?: string;
}

const FINISH_TIMERS_KEY = 'finishing_room_timers';

const IcoChevron = ({ open, size = 16 }: { open: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>
    <polyline points="9 6 15 12 9 18"/>
  </svg>
);

const ColorChip = ({ color }: { color: string | null }) => (
  <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, background: colorToHex(color), border: '1px solid rgba(255,255,255,0.18)', display: 'inline-block' }} />
);

function rowStyle(indent: number, flagged: boolean, divider: boolean): CSSProperties {
  return {
    width: '100%', display: 'flex', alignItems: 'center', gap: 11,
    padding: '13px 20px', paddingLeft: 20 + indent,
    background: flagged ? 'rgba(248,113,113,0.035)' : 'none', border: 'none',
    borderTop: divider ? '1px solid var(--line)' : 'none',
    cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', color: 'var(--ink)',
  };
}

function dimLabel(p: FinPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}

function roomKey(jobNumber: string | null, roomNumber: string | null): string {
  return `${jobNumber ?? '__nojob__'}::${roomNumber ?? '__noroom__'}`;
}

export default function FinishingTab({ tenantId, showToast, jobs, deptName = 'Finishing' }: Props) {
  const deptKey = deptName.toLowerCase();
  const [units, setUnits] = useState<CabinetUnit[]>([]);
  const [parts, setParts] = useState<FinPart[]>([]);
  const [specs, setSpecs] = useState<Record<string, FinishSpec>>({});
  const [timers, setTimers] = useState<Record<string, RoomTimer>>({});
  const [loading, setLoading] = useState(true);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [expandedRoom, setExpandedRoom] = useState<string | null>(null);
  const [expandedCab, setExpandedCab] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Flag modal
  const [flagUnit, setFlagUnit] = useState<CabinetUnit | null>(null);
  const [flagNotes, setFlagNotes] = useState('');

  const load = useCallback(async () => {
    try {
      const [unitRes, partRes, specRes] = await Promise.all([
        supabase.from('cabinet_units')
          .select('id, tenant_id, job_number, room_number, cabinet_number, unit_label, status, assigned_dept, flagged_reason, created_at')
          .eq('tenant_id', tenantId).eq('assigned_dept', deptKey).neq('status', 'complete')
          .order('created_at', { ascending: false }).limit(5000),
        supabase.from('parts')
          .select('id, cabinet_unit_id, job_number, part_name, material, width, height, depth, quantity, status, assigned_dept')
          .eq('tenant_id', tenantId).eq('assigned_dept', deptKey).limit(10000),
        supabase.from('finish_specs')
          .select('job_number, cabinet_color, cabinet_finish, sheen')
          .eq('tenant_id', tenantId),
      ]);
      setUnits((unitRes.data as CabinetUnit[] | null) ?? []);
      setParts((partRes.data as FinPart[] | null) ?? []);
      const specMap: Record<string, FinishSpec> = {};
      ((specRes.data as FinishSpec[] | null) ?? []).forEach((s) => { specMap[s.job_number] = s; });
      setSpecs(specMap);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load finishing work', true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, deptKey, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Active room timers from localStorage (set by the finishing crew view).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(FINISH_TIMERS_KEY);
      setTimers(stored ? (JSON.parse(stored) as Record<string, RoomTimer>) : {});
    } catch { setTimers({}); }
  }, []);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-sup-finishing-${deptKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finish_specs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
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

  // Push every finishing part of a cabinet to Assembly.
  async function pushCabinet(unit: CabinetUnit, toDept: string) {
    if (busyId) return;
    const cabParts = unitParts(unit.id);
    if (cabParts.length === 0) { showToast('No finishing parts on this cabinet', true); return; }
    setBusyId(unit.id);
    try {
      const results = await Promise.allSettled(cabParts.map((p) =>
        pushPart({ tenantId, partId: p.id, partName: p.part_name, cabinetUnitId: unit.id, jobNumber: unit.job_number, fromDept: deptKey, toDept, workerName: 'Supervisor', timeClockId: null })
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

  // Send the cabinet to QC — parts to 'qc', cabinet to 'ready_for_qc'.
  async function pushToQc(unit: CabinetUnit) {
    if (busyId) return;
    setBusyId(unit.id);
    try {
      await supabase.from('parts')
        .update({ assigned_dept: 'qc' })
        .eq('cabinet_unit_id', unit.id).eq('tenant_id', tenantId).eq('assigned_dept', deptKey);
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc', completed_by: 'Supervisor' })
        .eq('id', unit.id).eq('tenant_id', tenantId);
      if (error) throw error;
      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: 'Cabinet ready for QC',
        body: `${unit.unit_label}${unit.job_number ? ` — ${jobLabelFor(unit.job_number)}` : ''}`,
        url: '/app/supervisor',
      });
      showToast(`${unit.unit_label} sent to QC`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not send to QC', true);
    } finally {
      setBusyId(null);
    }
  }

  async function submitFlag() {
    const unit = flagUnit;
    if (!unit) return;
    const notes = flagNotes.trim();
    if (!notes) return;
    setBusyId(unit.id);
    try {
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'flagged', flagged_reason: notes })
        .eq('id', unit.id).eq('tenant_id', tenantId);
      if (error) throw error;
      sendNotify({
        tenant_id: tenantId, target: 'supervisor',
        title: 'Finishing issue flagged',
        body: `${unit.unit_label}: ${notes}`,
        url: '/app/supervisor',
      });
      showToast('Issue flagged');
      setFlagUnit(null); setFlagNotes('');
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not flag', true);
    } finally {
      setBusyId(null);
    }
  }

  // Group by job → room.
  const byJob: Record<string, CabinetUnit[]> = {};
  units.forEach((u) => { (byJob[u.job_number || 'No Job'] ??= []).push(u); });
  const jobKeys = Object.keys(byJob).sort((a, b) => jobLabelFor(a).localeCompare(jobLabelFor(b)));

  const roomsForJob = (jobUnits: CabinetUnit[]): [string, CabinetUnit[]][] => {
    const byRoom: Record<string, CabinetUnit[]> = {};
    jobUnits.forEach((u) => { (byRoom[u.room_number || 'General'] ??= []).push(u); });
    return Object.keys(byRoom)
      .sort((a, b) => { if (a === 'General') return 1; if (b === 'General') return -1; return a.localeCompare(b, undefined, { numeric: true }); })
      .map((rk) => [rk, byRoom[rk]] as [string, CabinetUnit[]]);
  };

  const actionBtn = (color: string): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8,
    background: `${color}1a`, border: `1px solid ${color}55`, color, fontSize: 12.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DeptCrewStrip tenantId={tenantId} dept={deptName} />

      {loading ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading finishing data…</div>
      ) : units.length === 0 ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No cabinets in finishing right now.</div>
      ) : (
        <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
          {jobKeys.map((jobKey, ji) => {
            const jobUnits = byJob[jobKey];
            const jobOpen = expandedJob === jobKey;
            const rooms = roomsForJob(jobUnits);
            const spec = specs[jobKey];
            return (
              <div key={jobKey} style={{ borderTop: ji > 0 ? '1px solid var(--line)' : 'none' }}>
                {/* Job folder */}
                <button onClick={() => { setExpandedJob(jobOpen ? null : jobKey); setExpandedRoom(null); setExpandedCab(null); }} style={rowStyle(0, false, false)}>
                  <IcoChevron open={jobOpen} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{jobLabelFor(jobKey)}</span>
                      <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{jobUnits.length} unit{jobUnits.length !== 1 ? 's' : ''}</span>
                      {spec && (spec.cabinet_color || spec.cabinet_finish) && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--ink-mute)' }}>
                          <ColorChip color={spec.cabinet_color} />
                          {[spec.cabinet_color, spec.cabinet_finish].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Rooms */}
                {jobOpen && rooms.map(([roomLabel, roomUnits]) => {
                  const roomId = `${jobKey}::${roomLabel}`;
                  const roomOpen = expandedRoom === roomId;
                  const activeTimer = !!timers[roomKey(jobKey === 'No Job' ? null : jobKey, roomLabel === 'General' ? null : roomLabel)];
                  return (
                    <div key={roomId}>
                      <button onClick={() => { setExpandedRoom(roomOpen ? null : roomId); setExpandedCab(null); }} style={rowStyle(16, false, true)}>
                        <IcoChevron open={roomOpen} />
                        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{roomLabel === 'General' ? 'General' : `Room ${roomLabel}`}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{roomUnits.length} unit{roomUnits.length !== 1 ? 's' : ''}</span>
                          {activeTimer && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2DE1C9', flexShrink: 0, animation: 'finPulse 1.4s ease-in-out infinite' }} />}
                        </div>
                      </button>

                      {/* Cabinets */}
                      {roomOpen && roomUnits.map((unit) => {
                        const cabParts = unitParts(unit.id);
                        const cabOpen = expandedCab === unit.id;
                        const isFlagged = unit.status === 'flagged';
                        const busy = busyId === unit.id;
                        return (
                          <div key={unit.id} style={{ borderLeft: isFlagged ? '3px solid #F87171' : '3px solid transparent' }}>
                            <button onClick={() => setExpandedCab(cabOpen ? null : unit.id)} style={rowStyle(32, isFlagged, true)}>
                              <IcoChevron open={cabOpen} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                                  {unit.cabinet_number ? `${unit.cabinet_number} — ${unit.unit_label}` : unit.unit_label}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 10 }}>{cabParts.length} part{cabParts.length !== 1 ? 's' : ''}</span>
                              </div>
                              {spec && spec.cabinet_color && <ColorChip color={spec.cabinet_color} />}
                              {isFlagged && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: '#F87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', flexShrink: 0 }}>Flagged</span>
                              )}
                            </button>

                            {cabOpen && (
                              <div style={{ padding: '4px 20px 16px 51px', background: 'rgba(255,255,255,0.015)' }}>
                                <div style={{ marginBottom: 8 }}>
                                  <ViewDrawingsButton tenantId={tenantId} jobNumber={unit.job_number} cabinetKey={unit.cabinet_number || unit.unit_label} compact={false} />
                                </div>

                                {isFlagged && unit.flagged_reason && (
                                  <div style={{ fontSize: 12, color: '#F87171', marginBottom: 8 }}>Flagged: {unit.flagged_reason}</div>
                                )}

                                {cabParts.length === 0 ? (
                                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', padding: '8px 0' }}>No finishing parts for this unit.</div>
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
                                    </div>
                                  ))
                                )}

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                                  <button onClick={() => void pushCabinet(unit, 'Assembly')} disabled={busy} style={{ ...actionBtn('#3B82F6'), opacity: busy ? 0.6 : 1 }}>
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                                    Assembly
                                  </button>
                                  <button onClick={() => void pushToQc(unit)} disabled={busy} style={{ ...actionBtn('#2DE1C9'), opacity: busy ? 0.6 : 1 }}>
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                                    QC
                                  </button>
                                  <button onClick={() => { setFlagUnit(unit); setFlagNotes(''); }} disabled={busy} style={{ ...actionBtn('#F87171'), opacity: busy ? 0.6 : 1 }}>
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                                    Flag Issue
                                  </button>
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

      <style>{`@keyframes finPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

      {/* Flag modal */}
      {flagUnit && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget && !busyId) { setFlagUnit(null); setFlagNotes(''); } }}
        >
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 460, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F87171' }}>Flag Issue</div>
            <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{flagUnit.cabinet_number ? `${flagUnit.cabinet_number} — ` : ''}{flagUnit.unit_label}</div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>What&apos;s wrong?</label>
              <textarea className="form-input" value={flagNotes} onChange={(e) => setFlagNotes(e.target.value)} rows={4} placeholder="Describe the finishing issue…" style={{ width: '100%', resize: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => { setFlagUnit(null); setFlagNotes(''); }} disabled={!!busyId} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button
                onClick={() => void submitFlag()}
                disabled={!!busyId || !flagNotes.trim()}
                style={{ flex: 2, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '12px', borderRadius: 10, background: '#F87171', color: '#1a0606', border: 'none', fontSize: 14, fontWeight: 700, cursor: (busyId || !flagNotes.trim()) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (busyId || !flagNotes.trim()) ? 0.6 : 1 }}
              >
                Flag Issue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
