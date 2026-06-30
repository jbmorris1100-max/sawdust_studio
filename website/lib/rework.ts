// ============================================================================
// Phase 6 — Rework signal detector (pure logic)
// ============================================================================
//
// WHAT THIS COMPUTES
//   Candidate `ai_rework_events` rows from two sources:
//     • part_dept_events backward moves — sort_order(to_dept) < sort_order(from_dept)
//     • damage_reports (report_type='damage')
//
// COUNTING vs GROUPING (the confirmed Phase 6 design)
//   We emit ONE ROW PER PART (the counted unit — a 12-part recut weighs 12, not 1),
//   but stamp each row with a deterministic `bounceEventId` that GROUPS the per-part
//   rows of a single occurrence. The supervisor UI groups by bounceEventId to show
//   ONE confirm/correct card per kickback; the rework metric sums the per-part rows
//   under each CONFIRMED event. Status is uniform within a bounceEventId (you
//   confirm/correct the occurrence as a whole) — intended, not a limitation.
//
// CLUSTERING (no magic number)
//   The per-part rows of one QC fail are written by a single bulk INSERT
//   (QcInspectorView/QcTab: `partsToFail.map(...)`) — one transaction, so Postgres
//   now() is constant and every part shares an IDENTICAL created_at. So we cluster
//   on the EXACT timestamp: bounceEventId = `${cabinet}|${from}>${to}|${occurredAt}`.
//   ⚠️ This rests on that transaction-timestamp behavior and is NOT yet verified
//   against real multi-part QC-fail data (none exists in the DB at time of writing).
//   If a future write path ever splits one kickback across multiple INSERTs with
//   differing timestamps, this would over-split the group — revisit with a tolerance
//   only when real data shows it is needed. Do NOT reintroduce fixed-bucket flooring
//   (floor(t/window)): two near rows can straddle a bucket boundary.
//
// AUTO-CONFIRM vs PENDING
//   from_dept='qc' (QC fail) and damage rows are AUTO-CONFIRMED rework (status
//   'confirmed') — they count immediately. Every OTHER backward move is 'pending'
//   and does NOT count until a supervisor confirms it via the confirm/correct flow.
//
// QUALITY REWORK ≠ LEGITIMATE RE-ROUTE — the whole point of the pending state.
//   A backward move can be real quality rework OR a legitimate re-route (a recut
//   request, a mis-sort correction). We never auto-count an ambiguous backward move
//   as a quality failure; the supervisor confirms (real rework) or corrects
//   (reclassify -> dismissed, doesn't count). Same anti-false-signal stance as the
//   Phase 5 baselines (MIN_SAMPLES, queue/idle-vs-labor).
//
// DAMAGE LINKAGE
//   damage_reports has NO cabinet/part FK: part_name is a free-text description,
//   job_id an optional free-text job number. We do NOT fabricate a fuzzy join. A
//   damage row carries cabinet_unit_id=null, part_id=null, job_number=job_id, and
//   bounceEventId='damage:<id>' (one report = one event = one row). It therefore
//   contributes 1 to the per-part count, not N — a faithful limit of the source.
// ============================================================================

import { patternFromPartName } from './partNamePattern';

export type DeptOrder = Record<string, number>; // lowercased dept name -> sort_order

export type PartDeptEvent = {
  part_id: string;
  cabinet_unit_id: string | null;
  job_number: string | null;
  from_dept: string | null;
  to_dept: string | null;
  worker_name: string | null;
  created_at: string; // ISO
};

export type DamageReport = {
  id: string;
  part_name: string | null;
  job_id: string | null;
  dept: string | null;
  report_type: string | null;
  created_at: string; // ISO
};

export type ReworkSource = 'qc_fail' | 'damage' | 'backward_bounce';
export type ReworkStatus = 'confirmed' | 'pending' | 'dismissed';

export type ReworkRow = {
  bounce_event_id: string;
  part_id: string | null;
  cabinet_unit_id: string | null;
  job_number: string | null;
  source: ReworkSource;
  from_dept: string | null;
  to_dept: string | null;
  occurred_at: string;        // ISO
  status: ReworkStatus;       // 'confirmed' for qc_fail/damage, 'pending' for backward_bounce
  part_name_pattern: string | null; // normalized part-name pattern (suppression key); null for damage
};

// "Normal, don't flag again" suppression: a backward_bounce matching
// (from_dept, to_dept, part_name_pattern) is not flagged again. Build the lookup
// key with suppressionKey so the UI write and the detector check always agree.
export const suppressionKey = (fromDept: string, toDept: string, pattern: string) =>
  `${fromDept.trim().toLowerCase()}|${toDept.trim().toLowerCase()}|${pattern}`;

export type ReworkResult = {
  rework: ReworkRow[];
  // Counts for the run summary / verification.
  qcFail: number;          // per-part qc_fail rows (auto-confirmed)
  damage: number;          // damage rows (auto-confirmed)
  backwardBounce: number;  // per-part ambiguous rows (pending)
  bounceEvents: number;    // distinct bounceEventIds (UI cards)
  // Ambiguous backward moves NOT flagged because a supervisor previously marked
  // that (from->to, part pattern) "Normal, don't flag again". qc_fail/damage are
  // never suppressed (they're real rework).
  suppressedByRule: number;
  // part_dept_events rows we could not classify because a dept was missing from the
  // departments map (unknown/custom dept, or terminal 'complete') — surfaced so a
  // misconfigured pipeline is visible rather than silently dropping signal.
  skippedUnknownDept: number;
};

const lc = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

// Is `to` strictly earlier in the pipeline than `from`? Needs both depts in the map.
function isBackward(fromDept: string, toDept: string, order: DeptOrder): boolean | null {
  const f = order[lc(fromDept)];
  const t = order[lc(toDept)];
  if (f === undefined || t === undefined) return null; // ordering unknown -> can't assert
  return t < f;
}

export function computeRework(
  events: PartDeptEvent[],
  damageReports: DamageReport[],
  deptOrder: DeptOrder,
  opts: {
    partNames?: Record<string, string | null>; // part_id -> part name (for the suppression pattern)
    suppressions?: Set<string>;                 // keys from suppressionKey()
  } = {},
): ReworkResult {
  const partNames = opts.partNames ?? {};
  const suppressions = opts.suppressions ?? new Set<string>();
  const rework: ReworkRow[] = [];
  const eventIds = new Set<string>();
  let qcFail = 0, backwardBounce = 0, suppressedByRule = 0, skippedUnknownDept = 0;

  // ── part_dept_events backward moves ────────────────────────────────────────
  for (const e of events) {
    if (!e || !e.part_id || !e.created_at) continue;
    const from = e.from_dept;
    const to = e.to_dept;
    if (!from || !to) continue;            // initial arrival (from null) is not a move backward
    const back = isBackward(from, to, deptOrder);
    if (back === null) { skippedUnknownDept++; continue; }
    if (!back) continue;                   // forward / sideways — not rework

    const isQc = lc(from) === 'qc';
    const pattern = patternFromPartName(partNames[e.part_id] ?? '');

    // Suppression applies ONLY to ambiguous backward bounces — a QC fail is real
    // rework and is never silenced by "Normal, don't flag again".
    if (!isQc && suppressions.has(suppressionKey(from, to, pattern))) {
      suppressedByRule++;
      continue;
    }

    const bounceEventId = `${e.cabinet_unit_id ?? 'nocab'}|${lc(from)}>${lc(to)}|${e.created_at}`;
    eventIds.add(bounceEventId);
    rework.push({
      bounce_event_id: bounceEventId,
      part_id: e.part_id,
      cabinet_unit_id: e.cabinet_unit_id,
      job_number: e.job_number,
      source: isQc ? 'qc_fail' : 'backward_bounce',
      from_dept: from,
      to_dept: to,
      occurred_at: e.created_at,
      status: isQc ? 'confirmed' : 'pending',
      part_name_pattern: pattern || null,
    });
    if (isQc) qcFail++; else backwardBounce++;
  }

  // ── damage_reports (one report = one confirmed event = one row) ─────────────
  let damage = 0;
  for (const d of damageReports) {
    if (!d || !d.id || !d.created_at) continue;
    if (lc(d.report_type) && lc(d.report_type) !== 'damage') continue; // only true damage
    const bounceEventId = `damage:${d.id}`;
    eventIds.add(bounceEventId);
    rework.push({
      bounce_event_id: bounceEventId,
      part_id: null,                 // no part FK in source
      cabinet_unit_id: null,         // no cabinet FK in source
      job_number: d.job_id ?? null,  // optional free-text job number, as entered
      source: 'damage',
      from_dept: null,
      to_dept: d.dept ?? null,
      occurred_at: d.created_at,
      status: 'confirmed',
      part_name_pattern: null, // damage has no part FK to derive a pattern from
    });
    damage++;
  }

  return {
    rework,
    qcFail,
    damage,
    backwardBounce,
    bounceEvents: eventIds.size,
    suppressedByRule,
    skippedUnknownDept,
  };
}

// Confirmed per-part count = the rework metric (pending/dismissed excluded).
export function confirmedCount(rows: ReworkRow[]): number {
  return rows.reduce((n, r) => n + (r.status === 'confirmed' ? 1 : 0), 0);
}
