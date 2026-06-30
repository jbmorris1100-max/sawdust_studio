'use client';

// Part-level breakdown for one job, shown when a Production Pipeline row is
// expanded. Groups every part by its current department and surfaces how long
// each part has sat in that dept (from part_dept_events) so bottlenecks float
// to the top.
//
// TWO LAYERS (Phase 8):
//   • MANUAL drill-down (all modes, incl. 'learn'): the dept-grouped part list
//     below. The "Slow" badge here is a STATIC > 8h idle threshold — NOT an AI
//     baseline-derived signal (labeled as such in the UI so a supervisor never
//     mistakes it for AI analysis).
//   • AUTO drill (assist / autonomous only): an AI Bottleneck Analysis panel
//     above the list that compares this job's per-stage dwell against the
//     tenant's ai_baselines (see lib/bottleneck.ts) and, when a stage is running
//     slow, walks job → dept → cabinet → crew to the likely driver. Never shown
//     in 'learn' mode — that keeps drill-down manual-only there. The manual path
//     is NEVER removed; auto-analysis is additive.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { analyzeJobBottlenecks, type BaselineLookup, type BottleneckResult, type StageAnalysis } from '@/lib/bottleneck';
import type { PartDeptEvent } from '@/lib/baselines';

type AiMode = 'learn' | 'assist' | 'autonomous';

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
// STATIC idle threshold for the manual "Slow" badge below. This is intentionally
// NOT the AI baseline — it's a fixed 8h rule of thumb. The AI baseline comparison
// lives in the auto-drill panel (lib/bottleneck.ts). Keep them distinct.
const SLOW_MS = 8 * 60 * 60 * 1000; // 8 hours (static threshold)

function deptColor(d: string): string { return DEPT_COLOR[d] ?? '#A78BFA'; }

function fmtDur(ms: number | null): string {
  if (ms == null) return '—';
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

const fmtHrs = (h: number) => `${h % 1 === 0 ? h : h.toFixed(1)}h`;

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

// ── Auto-drill panel (assist / autonomous only) ──────────────────────────────
// Renders the bottleneck analysis. Every number shown comes from the detector,
// which reads it straight from the DB — nothing is fabricated. When the data is
// too thin to judge, it says so instead of inventing a flag.
function AutoDrillPanel({ result, cabLabel }: { result: BottleneckResult; cabLabel: (id: string | null) => string }) {
  const teal = 'var(--teal)';
  const Wrap = ({ children, tone }: { children: React.ReactNode; tone?: string }) => (
    <div style={{ border: `1px solid ${tone ? `${tone}40` : 'var(--line)'}`, background: tone ? `${tone}10` : 'rgba(255,255,255,0.02)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: result.stages.length ? 8 : 0 }}>
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={teal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.5-1.5 3.3C13.5 10.5 13 11.5 13 13h-2c0-1.5-.5-2.5-1.5-3.7C8.8 8.5 8 7.5 8 6a4 4 0 0 1 4-4z"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/></svg>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: teal }}>AI Bottleneck Analysis</span>
      </div>
      {children}
    </div>
  );

  // No completed-stage data at all → nothing measurable yet.
  if (result.stages.length === 0) {
    return <Wrap><span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>No completed-stage data for this job yet — nothing to compare against baselines.</span></Wrap>;
  }

  // Stages exist but no baseline met the sample floor → withhold, don't guess.
  if (!result.hasQualifyingBaseline) {
    return (
      <Wrap>
        <span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>
          Not enough baseline data yet — InlineIQ needs ≥{result.threshold} completed-stage samples per stage before it can flag a bottleneck. Showing the manual breakdown below in the meantime.
        </span>
      </Wrap>
    );
  }

  // Baselines exist, but this job isn't running slow anywhere.
  if (result.bottlenecks.length === 0) {
    return (
      <Wrap tone="#34D399">
        <span style={{ fontSize: 12.5, color: '#34D399', fontWeight: 600 }}>No stage is running slower than baseline for this job.</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-mute)', display: 'block', marginTop: 3 }}>Compared {result.analyzedStages} stage{result.analyzedStages === 1 ? '' : 's'} against the tenant baseline (≥{result.threshold} samples).</span>
      </Wrap>
    );
  }

  return (
    <Wrap tone="#FBBF24">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {result.bottlenecks.map((b: StageAnalysis) => (
          <div key={b.stage}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textTransform: 'capitalize' }}>{b.stage}</span>
              <span style={{ fontSize: 12.5, color: 'var(--ink-dim)' }}>is running slow for this job</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>
              ~{fmtHrs(b.jobAvgHours)} avg vs ~{fmtHrs(b.baselineAvgHours as number)} baseline · {b.ratio}× slower · {b.jobSampleCount} part{b.jobSampleCount === 1 ? '' : 's'} measured
            </div>
            {/* Auto-walk: job → dept (above) → cabinet → crew. Only real values. */}
            <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 4 }}>
              {b.slowestCabinet && (
                <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                  <span style={{ color: 'var(--ink-mute)' }}>↳ Cabinet </span>
                  <span style={{ fontWeight: 600 }}>{cabLabel(b.slowestCabinet.cabinetUnitId)}</span>
                  <span style={{ color: 'var(--ink-mute)' }}> — longest here at ~{fmtHrs(b.slowestCabinet.avgDwellHours)}</span>
                </div>
              )}
              {b.slowestCrew && (
                <div style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
                  <span style={{ color: 'var(--ink-mute)' }}>↳ </span>
                  <span style={{ fontWeight: 600 }}>{b.slowestCrew.worker}</span>
                  <span style={{ color: 'var(--ink-mute)' }}> — longest avg time-in-dept ~{fmtHrs(b.slowestCrew.avgDwellHours)} </span>
                  <span style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>(includes queue/wait, not hands-on time)</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </Wrap>
  );
}

export default function JobDrillDown({ tenantId, jobNumber, showToast, aiMode = 'learn' }: { tenantId: string; jobNumber: string; showToast: (msg: string, error?: boolean) => void; aiMode?: AiMode }) {
  const [rows, setRows] = useState<DrillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<BottleneckResult | null>(null);
  const [cabLabels, setCabLabels] = useState<Map<string, string>>(new Map());

  const autoDrill = aiMode === 'assist' || aiMode === 'autonomous';

  const load = useCallback(async () => {
    if (!tenantId || !jobNumber) return;
    setLoading(true);
    setAnalysis(null);
    try {
      // 1. Cabinets for this job → ids + labels + their base dept/status.
      const { data: cabData } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, cabinet_number, assigned_dept, status')
        .eq('tenant_id', tenantId)
        .eq('job_number', jobNumber);
      const cabs = (cabData as { id: string; unit_label: string; cabinet_number: string | null; assigned_dept: string | null; status: string | null }[] | null) ?? [];
      if (cabs.length === 0) { setRows([]); setCabLabels(new Map()); setLoading(false); return; }
      const cabById = new Map(cabs.map((c) => [c.id, c]));
      const cabIds = cabs.map((c) => c.id);
      const labelMap = new Map(cabs.map((c) => [c.id, c.cabinet_number || c.unit_label || '—']));
      setCabLabels(labelMap);

      // 2. Parts on those cabinets.
      const { data: partData } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, assigned_dept, production_status, status')
        .eq('tenant_id', tenantId)
        .in('cabinet_unit_id', cabIds);
      const parts = (partData as DrillPart[] | null) ?? [];

      // 3. Dept-transition events for those parts. Full columns so the same rows
      //    feed BOTH the manual newest-per-part age AND (assist/autonomous) the
      //    bottleneck detector — one query, no drift between the two views.
      const enteredByPart = new Map<string, number>();
      let jobEvents: PartDeptEvent[] = [];
      if (parts.length > 0) {
        const partIds = parts.map((p) => p.id);
        try {
          const { data: evData } = await supabase
            .from('part_dept_events')
            .select('part_id, cabinet_unit_id, job_number, from_dept, to_dept, worker_name, created_at')
            .eq('tenant_id', tenantId)
            .in('part_id', partIds)
            .order('created_at', { ascending: false });
          const evs = (evData as PartDeptEvent[] | null) ?? [];
          jobEvents = evs;
          evs.forEach((e) => {
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

      // 4. Auto-drill (assist / autonomous only): compare this job's per-stage
      //    dwell against the tenant's published baselines.
      if (autoDrill) {
        try {
          const { data: baseData } = await supabase
            .from('ai_baselines')
            .select('stage, avg_hours, sample_count')
            .eq('tenant_id', tenantId);
          const baselines = (baseData as BaselineLookup[] | null) ?? [];
          setAnalysis(analyzeJobBottlenecks(jobEvents, baselines));
        } catch { setAnalysis(null); /* baselines table may not exist yet */ }
      }
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load job detail', true);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, jobNumber, showToast, autoDrill]);

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

  const cabLabel = (id: string | null) => (id ? (cabLabels.get(id) ?? '—') : '—');
  const anySlow = rows.some((r) => r.ageMs != null && r.ageMs > SLOW_MS && r.dept !== 'complete');

  return (
    <div data-testid="job-drilldown" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid var(--line)', padding: '12px 16px 16px' }}>
      {/* AUTO-DRILL: assist / autonomous only. Manual breakdown still renders below. */}
      {autoDrill && analysis && (
        <div data-testid="auto-drill">
          <AutoDrillPanel result={analysis} cabLabel={cabLabel} />
        </div>
      )}

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
                        <span title="Idle > 8h (static threshold, not an AI baseline)" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#FBBF24', background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', whiteSpace: 'nowrap' }}>
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

      {/* Honesty qualifier: the "Slow" badge above is a fixed rule, not AI. */}
      {anySlow && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-mute)', fontStyle: 'italic', marginTop: 2 }}>
          “Slow” = idle &gt; 8h (static threshold, not an AI baseline).
        </div>
      )}
    </div>
  );
}
