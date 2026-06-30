// ============================================================================
// Phase 8 — Bottleneck detector (pure logic)
// ============================================================================
//
// WHAT THIS DOES
//   Given one JOB's part_dept_events plus the TENANT's published ai_baselines
//   (and ai_crew_pace), decide — per stage — whether that job is running SLOWER
//   than the tenant's baseline for the stage, and if so surface the auto-walk
//   targets (which cabinet, which crew member) so the supervisor knows where to
//   look. This is the "auto-drill" used in assist / autonomous mode. In learn
//   mode it is never called (the drill-down stays manual-only).
//
// WHAT IS / ISN'T HONEST HERE (read before changing thresholds or wording)
//   • Every number returned comes from the DB: job dwell from this job's paired
//     part_dept_events (same pairing as the Phase 5 engine — see toCompletedStages),
//     baseline avg from ai_baselines, crew dwell from this job's own events. We
//     never invent a value. If a value isn't measurable, the field is null and the
//     UI must omit it rather than guess.
//   • MIN_SAMPLES gate (same 5 as Phase 5): we only compare against a baseline
//     whose sample_count >= MIN_SAMPLES. A 0–4 sample baseline is an anecdote, not
//     a statistic, so a stage with a thin baseline is reported 'insufficient_baseline'
//     ("not enough data yet"), NEVER flagged as a bottleneck. This mirrors the
//     baseline engine's own withholding rule.
//   • QUEUE/IDLE DWELL ≠ ACTIVE LABOR. part_dept_events dwell is WALL-CLOCK: it
//     includes time a part sat unclaimed in a queue before anyone touched it. So a
//     long dwell attributed to a worker is NOT proof that worker is slow — it may be
//     a staffing/flow problem. The crew field is therefore `worker` + `avgDwellHours`
//     and the UI MUST phrase it as "longest time-in-dept (includes queue/wait)",
//     never "slowest worker". (Same warning the Phase 5 engine documents.)
// ============================================================================

import { MIN_SAMPLES, toCompletedStages, type PartDeptEvent } from './baselines';

// A job stage running more than this multiple of its baseline avg is flagged a
// bottleneck (i.e. >25% slower). Deliberately conservative; tune as real data
// accumulates. Named constant so the test and the UI agree on one source.
export const SLOW_RATIO = 1.25;

export type BaselineLookup = { stage: string; avg_hours: number | null; sample_count: number };

export type StageAnalysis = {
  stage: string;
  jobAvgHours: number;             // this job's observed avg dwell for the stage
  jobSampleCount: number;          // completed-stage observations for this job in the stage
  baselineAvgHours: number | null; // null when no qualifying baseline exists
  baselineSampleCount: number;     // 0 when no baseline row exists
  ratio: number | null;            // jobAvgHours / baselineAvgHours (null if no baseline)
  status: 'bottleneck' | 'ok' | 'insufficient_baseline';
  // Auto-walk targets — populated ONLY for status === 'bottleneck'. Every value
  // is measured from this job's own events; null when not attributable.
  slowestCabinet: { cabinetUnitId: string | null; avgDwellHours: number; sampleCount: number } | null;
  slowestCrew: { worker: string; avgDwellHours: number; sampleCount: number } | null;
};

export type BottleneckResult = {
  stages: StageAnalysis[];        // every stage this job has completed-stage data for
  bottlenecks: StageAnalysis[];   // subset with status === 'bottleneck', worst (highest ratio) first
  analyzedStages: number;         // stages with a qualifying baseline (could be compared)
  hasQualifyingBaseline: boolean; // at least one stage had a baseline meeting MIN_SAMPLES
  threshold: number;              // MIN_SAMPLES used
  slowRatio: number;              // SLOW_RATIO used
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

// Highest-average group (by key) among the provided (key, hours) samples. Used for
// both "slowest cabinet" and "slowest crew" within a bottlenecked stage. Keys that
// are null/empty are skipped (unattributable). Returns null when nothing qualifies.
function topByAvg<T>(
  samples: { key: T | null; hours: number }[],
): { key: T; avg: number; count: number } | null {
  const groups = new Map<T, number[]>();
  for (const s of samples) {
    if (s.key == null || s.key === ('' as unknown as T)) continue;
    const arr = groups.get(s.key);
    if (arr) arr.push(s.hours); else groups.set(s.key, [s.hours]);
  }
  let best: { key: T; avg: number; count: number } | null = null;
  for (const [key, xs] of groups) {
    const avg = mean(xs);
    if (!best || avg > best.avg) best = { key, avg, count: xs.length };
  }
  return best;
}

export function analyzeJobBottlenecks(
  jobEvents: PartDeptEvent[],
  baselines: BaselineLookup[],
  opts: { minSamples?: number; slowRatio?: number } = {},
): BottleneckResult {
  const threshold = opts.minSamples ?? MIN_SAMPLES;
  const slowRatio = opts.slowRatio ?? SLOW_RATIO;

  // Pair this job's events into completed stages (identical logic to the baseline
  // engine: a part dwelled in stage `to_dept` until its next transition).
  const completed = toCompletedStages(jobEvents);

  // Baseline lookup by stage — only rows that MEET the sample floor qualify.
  const baseByStage = new Map<string, BaselineLookup>();
  for (const b of baselines) baseByStage.set(b.stage, b);

  // Group this job's completed stages by stage.
  const byStage = new Map<string, typeof completed>();
  for (const c of completed) {
    const arr = byStage.get(c.stage);
    if (arr) arr.push(c); else byStage.set(c.stage, [c]);
  }

  const stages: StageAnalysis[] = [];
  let analyzedStages = 0;
  let hasQualifyingBaseline = false;

  for (const [stage, items] of byStage) {
    const durations = items.map((i) => i.durationHours);
    const jobAvg = round2(mean(durations));
    const base = baseByStage.get(stage);
    const baselineQualifies = !!base && base.avg_hours != null && base.sample_count >= threshold;

    if (!baselineQualifies) {
      stages.push({
        stage,
        jobAvgHours: jobAvg,
        jobSampleCount: durations.length,
        baselineAvgHours: base?.avg_hours ?? null,
        baselineSampleCount: base?.sample_count ?? 0,
        ratio: null,
        status: 'insufficient_baseline',
        slowestCabinet: null,
        slowestCrew: null,
      });
      continue;
    }

    hasQualifyingBaseline = true;
    analyzedStages += 1;
    const baselineAvg = base!.avg_hours as number;
    const ratio = round2(jobAvg / baselineAvg);
    const isBottleneck = jobAvg > baselineAvg * slowRatio;

    let slowestCabinet: StageAnalysis['slowestCabinet'] = null;
    let slowestCrew: StageAnalysis['slowestCrew'] = null;
    if (isBottleneck) {
      const cab = topByAvg(items.map((i) => ({ key: i.cabinetUnitId, hours: i.durationHours })));
      if (cab) slowestCabinet = { cabinetUnitId: cab.key, avgDwellHours: round2(cab.avg), sampleCount: cab.count };
      const crew = topByAvg(items.map((i) => ({ key: i.worker, hours: i.durationHours })));
      if (crew) slowestCrew = { worker: crew.key, avgDwellHours: round2(crew.avg), sampleCount: crew.count };
    }

    stages.push({
      stage,
      jobAvgHours: jobAvg,
      jobSampleCount: durations.length,
      baselineAvgHours: round2(baselineAvg),
      baselineSampleCount: base!.sample_count,
      ratio,
      status: isBottleneck ? 'bottleneck' : 'ok',
      slowestCabinet,
      slowestCrew,
    });
  }

  const bottlenecks = stages
    .filter((s) => s.status === 'bottleneck')
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

  return {
    stages,
    bottlenecks,
    analyzedStages,
    hasQualifyingBaseline,
    threshold,
    slowRatio,
  };
}
