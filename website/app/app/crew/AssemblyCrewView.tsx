'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// The Assembly department's home view. Shows parts pushed to assembly, grouped by
// job → cabinet (folder accordion). When every part for a cabinet is in assembly
// or complete, a "Mark Cabinet Complete" button appears — tapping it sends the
// cabinet to the supervisor's QC gate (status = 'ready_for_qc').

type AsmPart = {
  id: string;
  part_name: string;
  cabinet_unit_id: string;
  job_number: string | null;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  assigned_dept: string | null;
  status: string | null;
};

type CabInfo = { label: string; key: string };

interface Props {
  tenantId: string;
  crewName?: string;
  showToast: (msg: string, error?: boolean) => void;
  isClockedIn?: boolean;
  onRequireClock?: () => void;
}

function dimText(p: AsmPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}
function partDisplay(p: AsmPart): string {
  const bits = [p.part_name];
  const d = dimText(p);
  if (d) bits.push(d);
  if (p.material) bits.push(p.material);
  return bits.join(' — ');
}

export default function AssemblyCrewView({ tenantId, crewName = '', showToast, isClockedIn = true, onRequireClock }: Props) {
  const [parts, setParts] = useState<AsmPart[]>([]);
  // cabinetReady[cabinetId] = every part on the cabinet is assembly/complete.
  const [cabReady, setCabReady] = useState<Record<string, boolean>>({});
  const [cabInfo, setCabInfo] = useState<Record<string, CabInfo>>({});
  const [jobPaths, setJobPaths] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [busyCab, setBusyCab] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Active jobs only — completed jobs disappear from every crew view.
      let activeJobNums: Set<string> | null = null;
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
      } catch { /* jobs table optional */ }

      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, material, width, height, depth, assigned_dept, status')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'assembly')
        .neq('status', 'complete')
        .limit(600);
      let asm = (partRows as AsmPart[] | null) ?? [];
      if (activeJobNums) asm = asm.filter((p) => !p.job_number || activeJobNums!.has(p.job_number));
      setParts(asm);

      const cabIds = Array.from(new Set(asm.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const info: Record<string, CabInfo> = {};
      const ready: Record<string, boolean> = {};
      if (cabIds.length > 0) {
        const [{ data: cabs }, { data: allParts }] = await Promise.all([
          supabase.from('cabinet_units').select('id, unit_label, cabinet_number').in('id', cabIds),
          supabase.from('parts').select('cabinet_unit_id, assigned_dept, status').in('cabinet_unit_id', cabIds),
        ]);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null }[] | null) ?? []).forEach((c) => {
          info[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '' };
        });
        // A cabinet is ready when every one of its parts is in assembly or complete.
        const byCab: Record<string, { assigned_dept: string | null; status: string | null }[]> = {};
        ((allParts as { cabinet_unit_id: string; assigned_dept: string | null; status: string | null }[] | null) ?? []).forEach((p) => {
          (byCab[p.cabinet_unit_id] ??= []).push(p);
        });
        for (const id of cabIds) {
          const ps = byCab[id] ?? [];
          ready[id] = ps.length > 0 && ps.every((p) => p.assigned_dept === 'assembly' || p.assigned_dept === 'complete' || p.status === 'complete');
        }
      }
      setCabInfo(info);
      setCabReady(ready);

      const jobNums = Array.from(new Set(asm.map((p) => p.job_number).filter(Boolean))) as string[];
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', jobNums);
          const map: Record<string, string> = {};
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { map[j.job_number] = j.job_path || `Job ${j.job_number}`; });
          setJobPaths(map);
        } catch { /* best-effort */ }
      }
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel('rt-assembly-crew')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

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

  const cabinetsForJob = (jobNumber: string) => {
    const groups: Record<string, AsmPart[]> = {};
    parts.filter((p) => (p.job_number ?? '__nojob__') === jobNumber).forEach((p) => {
      (groups[p.cabinet_unit_id] ??= []).push(p);
    });
    return Object.entries(groups).map(([cabinetId, cp]) => ({ cabinetId, parts: cp }));
  };

  async function markCabinetComplete(cabinetId: string, jobNumber: string | null, label: string) {
    if (!isClockedIn) { onRequireClock?.(); return; }
    if (busyCab) return;
    setBusyCab(cabinetId);
    try {
      const { error } = await supabase.from('cabinet_units')
        .update({ status: 'ready_for_qc', assigned_dept: 'qc' })
        .eq('id', cabinetId).eq('tenant_id', tenantId);
      if (error) throw error;
      const body = `${label}${jobNumber ? ` — Job ${jobNumber}` : ''} is ready for QC`;
      sendNotify({ tenant_id: tenantId, target: 'supervisor', title: 'Ready for QC', body, url: '/app/supervisor' });
      try {
        await supabase.from('notifications').insert({ tenant_id: tenantId, target_type: 'supervisor', title: 'Ready for QC', body, url: '/app/supervisor' });
      } catch { /* bell log best-effort */ }
      setParts((prev) => prev.filter((p) => p.cabinet_unit_id !== cabinetId));
      showToast('Cabinet sent to QC');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not complete cabinet', true);
    } finally {
      setBusyCab(null);
    }
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Assembly</div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading assembly queue…</div>
      ) : jobOptions.length === 0 ? (
        <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)', textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>Nothing to assemble yet</div>
          <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6 }}>Parts pushed to Assembly will appear here.</div>
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
                      const ready = cabReady[c.cabinetId];
                      const busy = busyCab === c.cabinetId;
                      const jobNumber = c.parts[0]?.job_number ?? null;
                      return (
                        <div key={c.cabinetId} style={{ padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{info.label}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-mute)' }}>{c.parts.length} part{c.parts.length === 1 ? '' : 's'}</span>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                            {c.parts.map((p) => (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--ink-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{partDisplay(p)}</span>
                                <ViewDrawingsButton tenantId={tenantId} jobNumber={p.job_number} cabinetKey={info.key} compact />
                              </div>
                            ))}
                          </div>
                          {ready ? (
                            <button
                              onClick={() => void markCabinetComplete(c.cabinetId, jobNumber, info.label)}
                              disabled={busy}
                              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: busy ? 'var(--bg-1)' : 'rgba(45,225,201,0.14)', border: `1px solid ${busy ? 'var(--line)' : 'rgba(45,225,201,0.4)'}`, color: busy ? 'var(--ink-mute)' : 'var(--teal)', cursor: busy ? 'wait' : 'pointer' }}
                            >
                              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                              {busy ? 'Saving…' : 'Mark Cabinet Complete'}
                            </button>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--ink-mute)', textAlign: 'center', padding: '8px 0' }}>
                              Waiting on other departments before this cabinet can be assembled.
                            </div>
                          )}
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
