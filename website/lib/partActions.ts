// Single source of truth for moving a part between departments.
//
// THE MODEL — a part lives in exactly one place at a time:
//   parts.assigned_dept = 'production' | 'craftsman' | 'finishing' | 'assembly' | 'qc' | 'complete'
//   parts.status        = 'pending' | 'complete'
// A cabinet's assigned_dept is the majority dept of its parts (recomputed on
// every push). production_status is never read or written here.
//
// pushPart() is the one function that performs a dept transition. PushPicker (and
// the legacy pushPartToDept wrapper) call it.

import { supabase } from './supabase';
import { sendNotify } from './notify';
import type { ViewerFile } from '@/components/FileViewer';

export const PART_DEPTS = ['Production', 'Craftsman', 'Finishing', 'Assembly'] as const;
export type PartDept = (typeof PART_DEPTS)[number];

// Title-case a stored dept value ('craftsman' → 'Craftsman').
export function deptDisplay(dept: string | null | undefined): string {
  if (!dept) return '';
  if (dept === 'split') return 'Split';
  return dept.charAt(0).toUpperCase() + dept.slice(1);
}

// ── Routing pattern learning ──────────────────────────────────────────────────
// Derive a reusable pattern from a part name: lowercase, drop dimensions and
// punctuation, keep the meaningful words. "Base 24 Door 23.5x30" → "base door".
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'qty', 'pcs', 'pc', 'x']);
export function patternFromPartName(name: string): string {
  const cleaned = (name || '')
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?/g, ' ')   // strip dimension numbers
    .replace(/["'#x×]/g, ' ')             // strip quote/× separators
    .replace(/[^a-z\s]/g, ' ');           // strip remaining punctuation
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const pattern = words.slice(0, 4).join(' ').trim();
  return pattern || (name || '').trim().toLowerCase().slice(0, 40);
}

// Upsert one confirmed push into part_routing_patterns and recompute the
// confidence for every destination sharing this (pattern, from_dept).
async function learnRouting(tenantId: string, partName: string, fromDept: string, toDept: string): Promise<void> {
  const pattern = patternFromPartName(partName);
  if (!pattern) return;
  try {
    const { data: existing } = await supabase
      .from('part_routing_patterns')
      .select('id, times_confirmed')
      .eq('tenant_id', tenantId)
      .eq('part_name_pattern', pattern)
      .eq('from_dept', fromDept)
      .eq('to_dept', toDept)
      .maybeSingle();
    if (existing) {
      await supabase.from('part_routing_patterns')
        .update({ times_confirmed: ((existing as { times_confirmed: number }).times_confirmed ?? 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: string }).id);
    } else {
      await supabase.from('part_routing_patterns').insert({
        tenant_id: tenantId, part_name_pattern: pattern,
        from_dept: fromDept, to_dept: toDept, times_confirmed: 1, confidence_score: 1,
      });
    }

    // Recompute confidence = times_confirmed / total pushes for this (pattern, from_dept).
    const { data: siblings } = await supabase
      .from('part_routing_patterns')
      .select('id, times_confirmed')
      .eq('tenant_id', tenantId)
      .eq('part_name_pattern', pattern)
      .eq('from_dept', fromDept);
    const rows = (siblings as { id: string; times_confirmed: number }[] | null) ?? [];
    const total = rows.reduce((s, r) => s + (r.times_confirmed ?? 0), 0);
    if (total > 0) {
      await Promise.all(rows.map((r) =>
        supabase.from('part_routing_patterns')
          .update({ confidence_score: Math.round(((r.times_confirmed ?? 0) / total) * 1000) / 1000 })
          .eq('id', r.id),
      ));
    }
  } catch { /* learning is best-effort */ }
}

// The Push Picker's suggested destination for a part: highest-confidence learned
// route for this (part name pattern, from dept). null = no suggestion yet.
// confidence is 0–1 (the share of pushes for this pattern that went to this dept).
export type RouteSuggestion = { toDept: string; confidence: number };
export async function suggestedDestination(tenantId: string, partName: string, fromDept: string): Promise<RouteSuggestion | null> {
  const pattern = patternFromPartName(partName);
  if (!pattern) return null;
  try {
    const { data } = await supabase
      .from('part_routing_patterns')
      .select('to_dept, confidence_score, times_confirmed')
      .eq('tenant_id', tenantId)
      .eq('part_name_pattern', pattern)
      .eq('from_dept', fromDept)
      .order('confidence_score', { ascending: false })
      .order('times_confirmed', { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as { to_dept: string; confidence_score: number | null } | null;
    if (!row?.to_dept) return null;
    return { toDept: row.to_dept, confidence: row.confidence_score ?? 0 };
  } catch {
    return null;
  }
}

// ── Cabinet recompute ─────────────────────────────────────────────────────────
// Recompute a cabinet's assigned_dept as the majority dept of its parts, and roll
// the cabinet up to 'complete' once every part is complete.
export async function recomputeCabinet(tenantId: string, cabinetUnitId: string): Promise<void> {
  try {
    const [{ data: cab }, { data: partRows }] = await Promise.all([
      supabase.from('cabinet_units').select('assigned_dept, status').eq('id', cabinetUnitId).maybeSingle(),
      supabase.from('parts').select('assigned_dept, status').eq('cabinet_unit_id', cabinetUnitId).eq('tenant_id', tenantId),
    ]);
    const cabRow = cab as { assigned_dept: string | null; status: string | null } | null;
    const parts = (partRows as { assigned_dept: string | null; status: string | null }[] | null) ?? [];
    if (parts.length === 0) return;

    // Majority dept among parts (ties broken by first-seen).
    const counts = new Map<string, number>();
    for (const p of parts) {
      const d = p.assigned_dept || 'production';
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    let majority = 'production';
    let best = -1;
    for (const [dept, n] of counts) { if (n > best) { best = n; majority = dept; } }

    const update: Record<string, unknown> = { assigned_dept: majority };
    const allComplete = parts.every((p) => p.status === 'complete');
    if (allComplete && cabRow?.status !== 'complete') {
      update.status = 'complete';
      update.completed_at = new Date().toISOString();
    }
    await supabase.from('cabinet_units').update(update).eq('id', cabinetUnitId);
  } catch { /* best-effort */ }
}

// ── pushPart — THE single dept-transition function ───────────────────────────
// Step 1 (reassign the part) must succeed or throw. Every later step is
// best-effort and isolated so a failure in one never blocks the others.
export async function pushPart(opts: {
  tenantId: string;
  partId: string;
  partName: string;
  cabinetUnitId: string;
  jobNumber: string | null;
  fromDept: string;
  toDept: string;
  workerName: string;
  timeClockId: string | null;
}): Promise<void> {
  const fromDept = (opts.fromDept || '').toLowerCase();
  const toDept = (opts.toDept || '').toLowerCase();

  // 1. Reassign the part — must succeed.
  const { error } = await supabase.from('parts')
    .update({ assigned_dept: toDept, status: toDept === 'complete' ? 'complete' : 'pending' })
    .eq('id', opts.partId).eq('tenant_id', opts.tenantId);
  if (error) throw error;

  // 2. Log the transition.
  try {
    await supabase.from('part_dept_events').insert({
      tenant_id: opts.tenantId,
      part_id: opts.partId,
      cabinet_unit_id: opts.cabinetUnitId,
      job_number: opts.jobNumber ?? null,
      from_dept: fromDept || null,
      to_dept: toDept,
      worker_name: opts.workerName || null,
    });
  } catch { /* best-effort */ }

  // 3. Recompute the cabinet's majority dept (+ completion rollup).
  try { await recomputeCabinet(opts.tenantId, opts.cabinetUnitId); } catch { /* best-effort */ }

  // 4. Learn the push.
  try { await learnRouting(opts.tenantId, opts.partName, fromDept, toDept); } catch { /* best-effort */ }

  // 5. (QC is triggered explicitly by the Assembly / Finishing QC buttons — a
  //    push alone never sends a cabinet to QC. See maybeNotifyJobQc.)

  // 6. Job completion rollup — when every cabinet in the job is complete.
  if (toDept === 'complete' && opts.jobNumber) {
    try {
      const { data } = await supabase.from('cabinet_units')
        .select('status').eq('tenant_id', opts.tenantId).eq('job_number', opts.jobNumber);
      const rows = (data as { status: string | null }[] | null) ?? [];
      if (rows.length > 0 && rows.every((r) => r.status === 'complete')) {
        try { await supabase.from('jobs').update({ status: 'complete' }).eq('tenant_id', opts.tenantId).eq('job_number', opts.jobNumber); } catch { /* best-effort */ }
        try { await supabase.from('jobs').update({ completed_at: new Date().toISOString() }).eq('tenant_id', opts.tenantId).eq('job_number', opts.jobNumber); } catch { /* column optional */ }
        sendNotify({ tenant_id: opts.tenantId, target: 'supervisor', title: 'Job complete', body: `Job ${opts.jobNumber} is complete`, url: '/app/supervisor' });
      }
    } catch { /* best-effort */ }
  }

  // 7. Shift event log.
  try {
    await supabase.from('shift_events').insert({
      tenant_id: opts.tenantId,
      time_clock_id: opts.timeClockId ?? null,
      worker_name: opts.workerName || 'Crew',
      event_type: 'part_pushed',
      dept: deptDisplay(toDept),
      previous_dept: fromDept ? deptDisplay(fromDept) : null,
      metadata: {
        part_name: opts.partName,
        from_dept: fromDept || null,
        to_dept: toDept,
        cabinet_unit_id: opts.cabinetUnitId,
        job_number: opts.jobNumber ?? null,
      },
    });
  } catch { /* best-effort */ }

  // 8. Notify the destination dept's crew.
  if (toDept !== 'complete') {
    sendNotify({
      tenant_id: opts.tenantId,
      target: 'crew',
      dept_target: deptDisplay(toDept),
      title: `New work in ${deptDisplay(toDept)}`,
      body: `${opts.partName}${opts.jobNumber ? ` — Job ${opts.jobNumber}` : ''}`,
      url: '/app/crew',
    });
  }
}

// Legacy wrapper kept so existing PartPushButton callers keep compiling. Delegates
// to pushPart (lowercasing depts, ignoring production_status).
export async function pushPartToDept(opts: {
  tenantId: string;
  part: { id: string; part_name: string; cabinet_unit_id: string; job_number?: string | null };
  fromDept: string;
  toDept: string;
  unitLabel?: string;
  jobPath?: string | null;
  timeClockId?: string | null;
  workerName?: string;
}): Promise<void> {
  await pushPart({
    tenantId: opts.tenantId,
    partId: opts.part.id,
    partName: opts.part.part_name,
    cabinetUnitId: opts.part.cabinet_unit_id,
    jobNumber: opts.part.job_number ?? null,
    fromDept: opts.fromDept,
    toDept: opts.toDept,
    workerName: opts.workerName || 'Supervisor',
    timeClockId: opts.timeClockId ?? null,
  });
}

// ── QC gating ───────────────────────────────────────────────────────────────
// A part is still "in production" (i.e. not yet accounted for at QC) while its
// assigned_dept is one of the four working departments.
const IN_PRODUCTION_DEPTS = ['production', 'craftsman', 'finishing', 'assembly'];

// Has every part for EVERY cabinet in this job left the working departments?
// This is the gate the spec requires before a job's QC notification may fire and
// before the Assembly QC button is allowed to appear.
export async function jobFullyAccounted(tenantId: string, jobNumber: string | null): Promise<boolean> {
  if (!jobNumber) return false;
  try {
    const { data } = await supabase
      .from('parts')
      .select('assigned_dept, status')
      .eq('tenant_id', tenantId)
      .eq('job_number', jobNumber);
    const rows = (data as { assigned_dept: string | null; status: string | null }[] | null) ?? [];
    if (rows.length === 0) return false;
    return rows.every((p) =>
      p.status === 'complete' || !IN_PRODUCTION_DEPTS.includes((p.assigned_dept || 'production').toLowerCase()));
  } catch {
    return false;
  }
}

// Fire the supervisor "ready for QC" notification only when the whole job is
// accounted for (spec rule 7). Called by the Assembly / Finishing QC buttons
// after they flip a cabinet to ready_for_qc. Silent otherwise.
export async function maybeNotifyJobQc(tenantId: string, jobNumber: string | null, jobLabel?: string): Promise<boolean> {
  if (!(await jobFullyAccounted(tenantId, jobNumber))) return false;
  sendNotify({
    tenant_id: tenantId, target: 'supervisor',
    title: 'Job ready for QC',
    body: `Job ${jobLabel || jobNumber} is ready for QC`,
    url: '/app/supervisor',
  });
  try {
    await supabase.from('notifications').insert({
      tenant_id: tenantId, target_type: 'supervisor',
      title: 'Job ready for QC', body: `Job ${jobLabel || jobNumber} is ready for QC`, url: '/app/supervisor',
    });
  } catch { /* bell log best-effort */ }
  return true;
}

// ── Color parsing ───────────────────────────────────────────────────────────
// Best-effort map of a finish color name to a hex swatch for the finishing crew's
// color chip. Falls back to a teal placeholder when nothing matches.
export function colorToHex(name: string | null | undefined): string {
  const n = (name || '').toLowerCase();
  if (!n.trim()) return '#2DE1C9';
  if (n.includes('off-white') || n.includes('off white') || n.includes('white') || n.includes('dove') || n.includes('cream') || n.includes('ivory') || n.includes('alabaster')) return '#F5F5F0';
  if (n.includes('navy') || n.includes('dark blue') || n.includes('hale')) return '#1B2A4A';
  if (n.includes('blue')) return '#3B5C8A';
  if (n.includes('black') || n.includes('onyx') || n.includes('charcoal')) return '#1a1a1a';
  if (n.includes('grey') || n.includes('gray') || n.includes('greige') || n.includes('agreeable')) return '#808080';
  if (n.includes('green') || n.includes('sage') || n.includes('olive')) return '#2D5A27';
  if (n.includes('red') || n.includes('burgundy')) return '#8A2D2D';
  if (n.includes('brown') || n.includes('walnut') || n.includes('espresso') || n.includes('oak') || n.includes('stain')) return '#5A3D28';
  if (n.includes('beige') || n.includes('tan') || n.includes('natural')) return '#D8C7A8';
  return '#2DE1C9';
}

// ── Drawing lookup ────────────────────────────────────────────────────────────
export type DrawingLookup = { files: ViewerFile[]; mode: 'specific' | 'all' | 'none' };

// Find the drawings that belong to a cabinet: current drawings for the job,
// narrowed to the cabinet key (e.g. "K01") when any filename/label matches.
export async function findCabinetDrawings(tenantId: string, jobNumber: string | null, cabinetKey: string): Promise<DrawingLookup> {
  if (!jobNumber) return { files: [], mode: 'none' };
  try {
    const { data } = await supabase
      .from('job_drawings')
      .select('label, file_url, file_name, file_type, job_path, is_current')
      .eq('tenant_id', tenantId)
      .eq('job_number', jobNumber)
      .order('created_at', { ascending: false })
      .limit(200);
    const rows = ((data as { label: string | null; file_url: string | null; file_name: string | null; file_type: string | null; job_path: string | null; is_current?: boolean | null }[] | null) ?? [])
      .filter((r) => r.is_current !== false && r.file_url);
    if (rows.length === 0) return { files: [], mode: 'none' };

    const toViewer = (rs: typeof rows): ViewerFile[] => rs.map((r) => ({
      url: r.file_url as string,
      name: r.file_name || r.label || 'Drawing',
      jobPath: r.job_path ?? undefined,
      fileType: r.file_type ?? undefined,
    }));

    const key = (cabinetKey || '').match(/[A-Za-z0-9]+/)?.[0]?.toLowerCase() ?? '';
    if (key) {
      const matched = rows.filter((r) => (r.file_name || '').toLowerCase().includes(key) || (r.label || '').toLowerCase().includes(key));
      if (matched.length > 0) return { files: toViewer(matched), mode: 'specific' };
    }
    return { files: toViewer(rows), mode: 'all' };
  } catch {
    return { files: [], mode: 'none' };
  }
}
