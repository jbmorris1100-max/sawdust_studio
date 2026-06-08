'use client';

// Part-level breakdown for one job, shown when a Production Pipeline row is
// expanded. Groups every part by its current department and surfaces how long
// each part has sat in that dept (from part_dept_events) so bottlenecks float
// to the top. Parts idle > 8h (static threshold for now) get a "Slow" badge.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

type DrillPart = {
  id: string;
  part_name: string;
  cabinet_unit_id: string;
  assigned_dept: string | null;
  production_status: string | null;
  status: string | null;
};

type DrillRow = {
  part: DrillPart;
  cabinetLabel: string;
  dept: string;            // grouping bucket (lowercase): production|craftsman|finishing|assembly|complete
  enteredAt: number | null; // ms timestamp of most recent dept event
  ageMs: number | null;
};

const GROUP_ORDER = ['production', 'craftsman', 'finishing', 'assembly', 'complete'] as const;
const DEPT_COLOR: Record<string, string> = {
  production: '#2DE1C9', craftsman: '#FBBF24', finishing: '#F97316', assembly: '#3B82F6', complete: '#34D399',
};
const SLOW_MS = 8 * 60 * 60 * 1000; // 8 hours

function deptColor(d: string): string { return DEPT_COLOR[d] ?? '#A78BFA'; }

function fmtDur(ms: number | null): string {
  if (ms == null) return '—';
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function DeptBadge({ dept }: { dept: string }) {
  const c = deptColor(dept);
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: c, background: `${c}22`, border: `1px solid ${c}40`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{dept}</span>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const s = (status || '').toLowerCase();
  if (!s) return null;
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: 'var(--ink-mute)', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{s.replace(/_/g, ' ')}</span>
  );
}

export default function JobDrillDown({ tenantId, jobNumber, showToast }: { tenantId: string; jobNumber: string; showToast: (msg: string, error?: boolean) => void }) {
  const [rows, setRows] = useState<DrillRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tenantId || !jobNumber) return;
    setLoading(true);
    try {
      // 1. Cabinets for this job → ids + labels + their base dept/status.
      const { data: cabData } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, cabinet_number, assigned_dept, status')
        .eq('tenant_id', tenantId)
        .eq('job_number', jobNumber);
      const cabs = (cabData as { id: string; unit_label: string; cabinet_number: string | null; assigned_dept: string | null; status: string | null }[] | null) ?? [];
      if (cabs.length === 0) { setRows([]); setLoading(false); return; }
      const cabById = new Map(cabs.map((c) => [c.id, c]));
      const cabIds = cabs.map((c) => c.id);

      // 2. Parts on those cabinets.
      const { data: partData } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, assigned_dept, production_status, status')
        .eq('tenant_id', tenantId)
        .in('cabinet_unit_id', cabIds);
      const parts = (partData as DrillPart[] | null) ?? [];

      // 3. Dept-transition events for those parts → newest per part.
      const enteredByPart = new Map<string, number>();
      if (parts.length > 0) {
        const partIds = parts.map((p) => p.id);
        try {
          const { data: evData } = await supabase
            .from('part_dept_events')
            .select('part_id, created_at')
            .eq('tenant_id', tenantId)
            .in('part_id', partIds)
            .order('created_at', { ascending: false });
          ((evData as { part_id: string; created_at: string }[] | null) ?? []).forEach((e) => {
            if (!enteredByPart.has(e.part_id)) enteredByPart.set(e.part_id, new Date(e.created_at).getTime());
          });
        } catch { /* events table may not exist until migration runs */ }
      }

      const now = Date.now();
      const built: DrillRow[] = parts.map((p) => {
        const cab = cabById.get(p.cabinet_unit_id);
        const baseDept = (cab?.assigned_dept && cab.assigned_dept !== 'split') ? cab.assigned_dept : 'production';
        const isComplete = (p.status || '').toLowerCase() === 'complete' || (cab?.status || '').toLowerCase() === 'complete';
        const dept = isComplete ? 'complete' : ((p.assigned_dept || baseDept) || 'production').toLowerCase();
        const enteredAt = enteredByPart.get(p.id) ?? null;
        return {
          part: p,
          cabinetLabel: cab?.cabinet_number || cab?.unit_label || '—',
          dept,
          enteredAt,
          ageMs: enteredAt != null ? now - enteredAt : null,
        };
      });
      setRows(built);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load job detail', true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, jobNumber, showToast]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink-mute)', background: 'rgba(255,255,255,0.02)' }}>Loading parts…</div>;
  }
  if (rows.length === 0) {
    return <div style={{ padding: '14px 20px', fontSize: 13, color: 'var(--ink-mute)', background: 'rgba(255,255,255,0.02)' }}>No parts found for this job.</div>;
  }

  // Group, then sort each group by longest time-in-dept first (nulls last).
  const groups = GROUP_ORDER
    .map((g) => ({
      dept: g,
      items: rows.filter((r) => r.dept === g).sort((a, b) => {
        if (a.ageMs == null && b.ageMs == null) return 0;
        if (a.ageMs == null) return 1;
        if (b.ageMs == null) return -1;
        return b.ageMs - a.ageMs;
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--line)', padding: '12px 16px 16px' }}>
      {groups.map((g) => {
        const c = deptColor(g.dept);
        return (
          <div key={g.dept} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: c }}>{g.dept}</span>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{g.items.length} part{g.items.length === 1 ? '' : 's'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {g.items.map((r) => {
                const slow = r.ageMs != null && r.ageMs > SLOW_MS && g.dept !== 'complete';
                return (
                  <div key={r.part.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg-1, rgba(255,255,255,0.02))' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.part.part_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>{r.cabinetLabel}</div>
                    </div>
                    <DeptBadge dept={g.dept} />
                    <StatusPill status={r.part.production_status} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: slow ? '#FBBF24' : 'var(--ink-dim)', fontVariantNumeric: 'tabular-nums' }}>{fmtDur(r.ageMs)}</span>
                      {slow && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#FBBF24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', whiteSpace: 'nowrap' }}>
                          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          Slow
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
