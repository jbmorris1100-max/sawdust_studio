'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_DEPARTMENTS } from '@/lib/auth';
import { deptDisplay } from '@/lib/partActions';
import { sendNotify } from '@/lib/notify';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// Supervisor QC tab. Lists every cabinet that crew sent to QC (status =
// 'ready_for_qc'), grouped by job. Each cabinet shows its parts (with final
// dept), who marked it complete, and the time each part spent in each dept (from
// part_dept_events). PASS completes the cabinet (and the job, once every cabinet
// is done); FAIL routes it back to a chosen dept with required notes.

type QcCabinet = {
  id: string;
  unit_label: string;
  cabinet_number: string | null;
  job_number: string | null;
  status: string;
  completed_by: string | null;
};
type QcPart = { id: string; part_name: string; assigned_dept: string | null; cabinet_unit_id: string };
type DeptEvent = { part_id: string; to_dept: string | null; created_at: string };

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: { job_number: string; job_path?: string | null }[];
  departments?: string[];
}

function fmtHours(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

export default function QcTab({ tenantId, showToast, jobs = [], departments }: Props) {
  const depts = departments && departments.length ? departments : DEFAULT_DEPARTMENTS;
  const [cabs, setCabs] = useState<QcCabinet[]>([]);
  const [partsByCab, setPartsByCab] = useState<Record<string, QcPart[]>>({});
  const [deptTime, setDeptTime] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // FAIL modal.
  const [failCab, setFailCab] = useState<QcCabinet | null>(null);
  const [failDept, setFailDept] = useState(depts[0] ?? 'Production');
  const [failNotes, setFailNotes] = useState('');
  const [failBusy, setFailBusy] = useState(false);

  const jobLabel = useCallback((jobNumber: string | null) => {
    if (!jobNumber) return 'No Job';
    const j = jobs.find((x) => x.job_number === jobNumber);
    return (j?.job_path || `Job ${jobNumber}`).split('/').map((s) => s.trim()).join(' / ');
  }, [jobs]);

  const load = useCallback(async () => {
    try {
      const { data: cabRows } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, cabinet_number, job_number, status, completed_by')
        .eq('tenant_id', tenantId)
        .eq('status', 'ready_for_qc')
        .order('completed_at', { ascending: true });
      const list = (cabRows as QcCabinet[] | null) ?? [];
      setCabs(list);

      const cabIds = list.map((c) => c.id);
      const pByCab: Record<string, QcPart[]> = {};
      const dTime: Record<string, Record<string, number>> = {};
      if (cabIds.length > 0) {
        const [{ data: pr }, { data: ev }] = await Promise.all([
          supabase.from('parts').select('id, part_name, assigned_dept, cabinet_unit_id').in('cabinet_unit_id', cabIds).eq('tenant_id', tenantId),
          supabase.from('part_dept_events').select('part_id, to_dept, created_at, cabinet_unit_id').in('cabinet_unit_id', cabIds).eq('tenant_id', tenantId).order('created_at', { ascending: true }),
        ]);
        ((pr as QcPart[] | null) ?? []).forEach((p) => { (pByCab[p.cabinet_unit_id] ??= []).push(p); });

        // Time per dept = sum over each part of (next event − this event), credited
        // to the dept the part was in for that span.
        const evByCab: Record<string, Record<string, DeptEvent[]>> = {};
        ((ev as (DeptEvent & { cabinet_unit_id: string })[] | null) ?? []).forEach((e) => {
          ((evByCab[e.cabinet_unit_id] ??= {})[e.part_id] ??= []).push(e);
        });
        for (const cabId of cabIds) {
          const perDept: Record<string, number> = {};
          const byPart = evByCab[cabId] ?? {};
          for (const events of Object.values(byPart)) {
            for (let i = 0; i < events.length - 1; i++) {
              const span = new Date(events[i + 1].created_at).getTime() - new Date(events[i].created_at).getTime();
              const d = (events[i].to_dept || '').toLowerCase();
              if (d && span > 0) perDept[d] = (perDept[d] ?? 0) + span;
            }
          }
          dTime[cabId] = perDept;
        }
      }
      setPartsByCab(pByCab);
      setDeptTime(dTime);
    } catch { /* tables optional */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-supervisor-qc')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  // PASS — complete the cabinet (and the job once every cabinet is done).
  async function pass(cab: QcCabinet) {
    if (busy) return;
    setBusy(cab.id);
    const now = new Date().toISOString();
    try {
      await supabase.from('parts').update({ status: 'complete', assigned_dept: 'complete' }).eq('cabinet_unit_id', cab.id).eq('tenant_id', tenantId);
      const { error } = await supabase.from('cabinet_units').update({ status: 'complete', assigned_dept: 'complete', completed_at: now }).eq('id', cab.id).eq('tenant_id', tenantId);
      if (error) throw error;

      // Job rollup — if every cabinet in the job is complete, complete the job.
      if (cab.job_number) {
        const { data } = await supabase.from('cabinet_units').select('status').eq('tenant_id', tenantId).eq('job_number', cab.job_number);
        const rows = (data as { status: string | null }[] | null) ?? [];
        if (rows.length > 0 && rows.every((r) => (r.status || '').toLowerCase() === 'complete')) {
          try { await supabase.from('jobs').update({ status: 'complete' }).eq('tenant_id', tenantId).eq('job_number', cab.job_number); } catch { /* best-effort */ }
          try { await supabase.from('jobs').update({ completed_at: now }).eq('tenant_id', tenantId).eq('job_number', cab.job_number); } catch { /* column optional */ }
          sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Job complete', body: `Job ${jobLabel(cab.job_number)} passed QC and is complete`, url: '/app/supervisor' });
        }
      }
      setCabs((prev) => prev.filter((c) => c.id !== cab.id));
      showToast(`${cab.unit_label} passed QC`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not pass cabinet', true);
    } finally {
      setBusy(null);
    }
  }

  function openFail(cab: QcCabinet) {
    setFailCab(cab);
    setFailDept(depts[0] ?? 'Production');
    setFailNotes('');
  }

  // FAIL — route the cabinet back to a chosen dept with required notes.
  async function submitFail() {
    if (!failCab || failBusy) return;
    if (!failNotes.trim()) { showToast('Notes are required', true); return; }
    setFailBusy(true);
    const destLower = failDept.toLowerCase();
    try {
      await supabase.from('parts').update({ assigned_dept: destLower, status: 'pending' }).eq('cabinet_unit_id', failCab.id).eq('tenant_id', tenantId);
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'in_progress', assigned_dept: destLower, qc_notes: failNotes.trim() })
        .eq('id', failCab.id).eq('tenant_id', tenantId);
      if (error) throw error;

      // Log the kickback on each part (best-effort).
      try {
        const ids = (partsByCab[failCab.id] ?? []).map((p) => p.id);
        if (ids.length > 0) {
          await supabase.from('part_dept_events').insert(ids.map((pid) => ({
            tenant_id: tenantId, part_id: pid, cabinet_unit_id: failCab!.id,
            job_number: failCab!.job_number, from_dept: 'qc', to_dept: destLower, worker_name: 'Supervisor',
          })));
        }
      } catch { /* best-effort */ }

      sendNotify({
        tenant_id: tenantId, target: 'crew', dept_target: deptDisplay(destLower),
        title: `QC kickback to ${deptDisplay(destLower)}`,
        body: `${failCab.unit_label}${failCab.job_number ? ` — Job ${failCab.job_number}` : ''}: ${failNotes.trim()}`,
        url: '/app/crew',
      });
      setCabs((prev) => prev.filter((c) => c.id !== failCab!.id));
      showToast(`${failCab.unit_label} sent back to ${failDept}`);
      setFailCab(null);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not fail cabinet', true);
    } finally {
      setFailBusy(false);
    }
  }

  // Group cabinets by job.
  const groups: Record<string, QcCabinet[]> = {};
  cabs.forEach((c) => { (groups[c.job_number ?? '__nojob__'] ??= []).push(c); });
  const jobKeys = Object.keys(groups).sort((a, b) => jobLabel(a === '__nojob__' ? null : a).localeCompare(jobLabel(b === '__nojob__' ? null : b)));

  const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Quality Control</div>
        {cabs.length > 0 && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: 'rgba(45,225,201,0.14)', color: 'var(--teal)' }}>{cabs.length} waiting</span>}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading QC queue…</div>
      ) : cabs.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', color: 'var(--ink-mute)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Nothing waiting for QC</div>
          <div style={{ fontSize: 12.5 }}>Cabinets crew send to QC will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {jobKeys.map((jk) => (
            <div key={jk}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-dim)', marginBottom: 10 }}>{jobLabel(jk === '__nojob__' ? null : jk)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {groups[jk].map((cab) => {
                  const parts = partsByCab[cab.id] ?? [];
                  const times = deptTime[cab.id] ?? {};
                  const isBusy = busy === cab.id;
                  return (
                    <div key={cab.id} style={card}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{cab.unit_label}</span>
                        <ViewDrawingsButton tenantId={tenantId} jobNumber={cab.job_number} cabinetKey={cab.cabinet_number || cab.unit_label || ''} compact />
                        {cab.completed_by && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>Completed by {cab.completed_by}</span>}
                      </div>

                      {/* Parts + final dept */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                        {parts.map((p) => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <span style={{ flex: 1, minWidth: 0, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</span>
                            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{deptDisplay(p.assigned_dept || '')}</span>
                          </div>
                        ))}
                      </div>

                      {/* Time in each dept */}
                      {Object.keys(times).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                          {Object.entries(times).map(([d, ms]) => (
                            <span key={d} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 20, background: 'var(--bg-2, #11151a)', color: 'var(--ink-mute)' }}>
                              {deptDisplay(d)} · {fmtHours(ms)}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => void pass(cab)} disabled={isBusy}
                          style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: isBusy ? 'wait' : 'pointer' }}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          {isBusy ? 'Saving…' : 'Pass'}
                        </button>
                        <button onClick={() => openFail(cab)} disabled={isBusy}
                          style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 7, padding: '11px', borderRadius: 10, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#F87171', cursor: isBusy ? 'wait' : 'pointer' }}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          Fail
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAIL modal */}
      {failCab && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }}
          onClick={(e) => { if (e.target === e.currentTarget && !failBusy) setFailCab(null); }}>
          <div style={{ background: '#0a0d10', borderRadius: 16, border: '1px solid var(--line-strong)', padding: 28, width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h3 style={{ margin: 0, color: 'var(--ink)', fontSize: 17, fontWeight: 700 }}>Fail — {failCab.unit_label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Send back to</label>
              <select value={failDept} onChange={(e) => setFailDept(e.target.value)}
                style={{ background: 'var(--bg-1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', fontSize: 14, fontFamily: 'inherit' }}>
                {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: 'var(--ink-mute)', fontSize: 13 }}>Notes <span style={{ color: '#F87171' }}>*</span></label>
              <textarea rows={3} value={failNotes} onChange={(e) => setFailNotes(e.target.value)} placeholder="What needs to be fixed…"
                style={{ background: 'var(--bg-1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 12px', fontSize: 14, resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setFailCab(null)} disabled={failBusy}
                style={{ background: 'var(--bg-1)', color: 'var(--ink-mute)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 20px', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
              <button onClick={() => void submitFail()} disabled={failBusy || !failNotes.trim()}
                style={{ background: failBusy || !failNotes.trim() ? 'rgba(248,113,113,0.4)' : '#F87171', color: '#1a0606', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 14, fontWeight: 700, cursor: failBusy || !failNotes.trim() ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
                {failBusy ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
