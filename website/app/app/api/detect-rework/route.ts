import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  computeRework,
  confirmedCount,
  suppressionKey,
  type PartDeptEvent,
  type DamageReport,
  type DeptOrder,
  type ReworkRow,
} from '@/lib/rework';

// ============================================================================
// Phase 6 — rework detector (entrypoint)
// ============================================================================
// Reads this tenant's departments (for sort_order), part_dept_events, and
// damage_reports; runs the pure detector in @/lib/rework; persists NEW candidate
// rows to ai_rework_events.
//
// INSERT-ONLY. The detector is idempotent and MUST NEVER overwrite a supervisor's
// confirm/correct decision: existing rows (by the dedup key) are left untouched,
// only genuinely new occurrences are inserted. No updates, no deletes here — the
// confirm/correct flow (separate, supervisor-driven) owns status transitions.
//
// POST { tenantId: string, dryRun?: boolean }
//   dryRun=true  -> compute only, write nothing (verification).
//   dryRun=false -> compute + insert new rows (requires the Phase 6 migration; if
//                   ai_rework_events is missing the write is reported not-applied
//                   rather than crashing).
// ============================================================================

const PAGE = 1000;

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Matches the COALESCE-based unique index: (tenant_id, bounce_event_id, part_id||'').
const dedupKey = (bounceEventId: string, partId: string | null) => `${bounceEventId}|${partId ?? ''}`;

async function fetchDeptOrder(db: SupabaseClient, tenantId: string): Promise<DeptOrder> {
  const { data, error } = await db
    .from('departments').select('name, sort_order').eq('tenant_id', tenantId);
  if (error) throw error;
  const order: DeptOrder = {};
  for (const d of (data as { name: string; sort_order: number }[] | null) ?? []) {
    if (d.name) order[d.name.trim().toLowerCase()] = d.sort_order;
  }
  return order;
}

async function fetchAllEvents(db: SupabaseClient, tenantId: string): Promise<PartDeptEvent[]> {
  const all: PartDeptEvent[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('part_dept_events')
      .select('part_id, cabinet_unit_id, job_number, from_dept, to_dept, worker_name, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as PartDeptEvent[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

// part_id -> part name, for the suppression pattern (part_dept_events has no name).
async function fetchPartNames(db: SupabaseClient, tenantId: string): Promise<Record<string, string | null>> {
  const map: Record<string, string | null> = {};
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('parts').select('id, part_name').eq('tenant_id', tenantId).range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as { id: string; part_name: string | null }[] | null) ?? [];
    for (const r of rows) map[r.id] = r.part_name;
    if (rows.length < PAGE) break;
  }
  return map;
}

// Suppression keys ("Normal, don't flag again"). Missing table (pre-migration) ->
// empty set, so detection still runs (nothing suppressed) rather than crashing.
async function fetchSuppressions(db: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const set = new Set<string>();
  const { data, error } = await db
    .from('ai_rework_suppressions').select('from_dept, to_dept, part_name_pattern').eq('tenant_id', tenantId);
  if (error) return set; // table not yet applied — treat as no suppressions
  for (const s of (data as { from_dept: string; to_dept: string; part_name_pattern: string }[] | null) ?? []) {
    set.add(suppressionKey(s.from_dept, s.to_dept, s.part_name_pattern));
  }
  return set;
}

async function fetchDamage(db: SupabaseClient, tenantId: string): Promise<DamageReport[]> {
  const all: DamageReport[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('damage_reports')
      .select('id, part_name, job_id, dept, report_type, created_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as DamageReport[] | null) ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

type PersistOutcome = { applied: boolean; insertedNew: number; alreadyPresent: number; error: string | null };

async function persist(
  db: SupabaseClient, tenantId: string, calc: string, rows: ReworkRow[],
): Promise<PersistOutcome> {
  try {
    // Existing keys for this tenant — so we insert ONLY new occurrences and never
    // disturb rows the supervisor may have already confirmed/dismissed.
    const existing = new Set<string>();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from('ai_rework_events').select('bounce_event_id, part_id')
        .eq('tenant_id', tenantId).range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data as { bounce_event_id: string; part_id: string | null }[] | null) ?? [];
      for (const e of page) existing.add(dedupKey(e.bounce_event_id, e.part_id));
      if (page.length < PAGE) break;
    }

    const toInsert = rows
      .filter((r) => !existing.has(dedupKey(r.bounce_event_id, r.part_id)))
      .map((r) => ({
        tenant_id: tenantId,
        bounce_event_id: r.bounce_event_id,
        part_id: r.part_id,
        cabinet_unit_id: r.cabinet_unit_id,
        job_number: r.job_number,
        source: r.source,
        from_dept: r.from_dept,
        to_dept: r.to_dept,
        occurred_at: r.occurred_at,
        status: r.status,
        part_name_pattern: r.part_name_pattern,
        detected_at: calc,
      }));

    let insertedNew = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error } = await db.from('ai_rework_events').insert(chunk);
      if (error) throw error;
      insertedNew += chunk.length;
    }
    return { applied: true, insertedNew, alreadyPresent: rows.length - insertedNew, error: null };
  } catch (e) {
    return { applied: false, insertedNew: 0, alreadyPresent: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: Request) {
  const db = serviceClient();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  let body: { tenantId?: string; dryRun?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const tenantId = body.tenantId;
  const dryRun = body.dryRun === true;
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

  let deptOrder: DeptOrder, events: PartDeptEvent[], damage: DamageReport[];
  let partNames: Record<string, string | null>, suppressions: Set<string>;
  try {
    [deptOrder, events, damage, partNames, suppressions] = await Promise.all([
      fetchDeptOrder(db, tenantId),
      fetchAllEvents(db, tenantId),
      fetchDamage(db, tenantId),
      fetchPartNames(db, tenantId),
      fetchSuppressions(db, tenantId),
    ]);
  } catch (e) {
    return NextResponse.json({ error: `read failed: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }

  const result = computeRework(events, damage, deptOrder, { partNames, suppressions });
  const calc = new Date().toISOString();

  const summary = {
    ok: true,
    tenantId,
    dryRun,
    departments: Object.keys(deptOrder).length,
    eventsRead: events.length,
    damageRead: damage.length,
    // Per-part rows by source. qc_fail + damage are auto-confirmed; backward_bounce
    // is pending until a supervisor confirms (does NOT count yet).
    qcFail: result.qcFail,
    damage: result.damage,
    backwardBouncePending: result.backwardBounce,
    suppressedByRule: result.suppressedByRule,    // not flagged — supervisor said "normal"
    bounceEvents: result.bounceEvents,            // distinct UI cards
    confirmedCount: confirmedCount(result.rework), // the rework metric (per-part, confirmed only)
    skippedUnknownDept: result.skippedUnknownDept,
  };

  if (dryRun) {
    return NextResponse.json({ ...summary, persisted: false, note: 'dryRun — nothing written' });
  }

  const outcome = await persist(db, tenantId, calc, result.rework);
  return NextResponse.json({ ...summary, persisted: outcome.applied, aiReworkEvents: outcome });
}
