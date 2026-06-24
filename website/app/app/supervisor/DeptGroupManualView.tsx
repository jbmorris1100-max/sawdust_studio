'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { fmtAccumulated } from '@/lib/activeProject';
import DeptCrewStrip from './DeptCrewStrip';

// ── Supervisor view for a 'group_manual'-template department ───────────────────
// MINIMAL by design: a 'group_manual' crew member multi-selects cabinets and runs
// ONE timed session over the whole selection (backed by crew_active_projects +
// time_clock). There is no existing supervisor reference for this template, so
// this view only surfaces what a supervisor needs at a glance — the active/paused
// sessions for this department, who is on each, and how long it has been running.
// It deliberately does NOT add push/complete actions; the crew drives the session.

type Job = { id: string; job_number: string; job_name: string | null; status: string; job_path?: string | null };

type SessionRow = {
  id: string;
  worker_name: string;
  unit_label: string;
  job_number: string | null;
  session_start: string | null;
  accumulated_seconds: number;
  status: 'active' | 'paused';
};

interface Props {
  tenantId: string;
  deptName: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
}

// Seconds elapsed for a row: prior accumulated time plus the current running span
// (only counts toward the live total while the session is active).
function rowSeconds(r: SessionRow): number {
  const live = r.status === 'active' && r.session_start
    ? Math.max(0, Math.floor((Date.now() - new Date(r.session_start).getTime()) / 1000))
    : 0;
  return (r.accumulated_seconds || 0) + live;
}

export default function DeptGroupManualView({ tenantId, deptName, showToast, jobs }: Props) {
  const deptKey = deptName.toLowerCase();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0); // forces a re-render so elapsed time stays live

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('crew_active_projects')
        .select('id, worker_name, unit_label, job_number, session_start, accumulated_seconds, status')
        .eq('tenant_id', tenantId)
        .eq('dept', deptKey)
        .in('status', ['active', 'paused']);
      if (error) throw error;
      setRows((data as SessionRow[] | null) ?? []);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load sessions', true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, deptKey, showToast]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: any change to this tenant's sessions refreshes the list.
  useEffect(() => {
    const ch = supabase
      .channel(`rt-sup-groupmanual-${deptKey}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, deptKey, load]);

  // Tick once per second so the live elapsed counters advance.
  useEffect(() => {
    const active = rows.some((r) => r.status === 'active');
    if (!active) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [rows]);

  const jobLabelFor = (jobNumber: string | null): string => {
    if (!jobNumber) return 'No Job';
    const j = (jobs ?? []).find((x) => x.job_number === jobNumber);
    if (j) {
      if (j.job_path && j.job_path.trim()) return j.job_path.split('/').map((s) => s.trim()).filter(Boolean).join(' / ');
      if (j.job_name && j.job_name.trim()) return j.job_name.trim();
    }
    return `Job ${jobNumber}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <DeptCrewStrip tenantId={tenantId} dept={deptName} />

      {loading ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading sessions…</div>
      ) : rows.length === 0 ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          No active sessions in {deptName} right now.
        </div>
      ) : (
        <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderTop: i > 0 ? '1px solid var(--line)' : 'none' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: r.status === 'active' ? '#2DE1C9' : '#8BA5A0' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{r.worker_name || 'Unknown'}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
                  {r.unit_label}{' · '}{jobLabelFor(r.job_number)}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: r.status === 'active' ? '#2DE1C9' : 'var(--ink-dim)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtAccumulated(rowSeconds(r))}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginTop: 2 }}>
                  {r.status === 'active' ? 'Running' : 'Paused'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
