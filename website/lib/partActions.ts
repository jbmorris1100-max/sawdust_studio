// Shared logic for reassigning ("pushing") a single part to another department,
// keeping the owning cabinet's split/completion state correct, and looking up the
// drawings that belong to a cabinet. Used by every part surface (production cut
// view, assembly checklist, craftsman builds, supervisor assembly tab).

import { supabase } from './supabase';
import { sendNotify } from './notify';
import type { ViewerFile } from '@/components/FileViewer';

export const PART_DEPTS = ['Production', 'Assembly', 'Craftsman', 'Finishing'] as const;
export type PartDept = (typeof PART_DEPTS)[number];

// Title-case a stored dept value ('craftsman' → 'Craftsman').
export function deptDisplay(dept: string | null | undefined): string {
  if (!dept) return '';
  if (dept === 'split') return 'Split';
  return dept.charAt(0).toUpperCase() + dept.slice(1);
}

const CRAFTSMAN_KEYWORDS = [
  'countertop', 'counter top', 'butcher block', 'slab', 'floating shelf', 'float shelf',
  'vent hood', 'range hood', 'hood', 'wine rack', 'mantle', 'mantel', 'fireplace',
  'surround', 'bench seat', 'window seat', 'bench', 'corbel', 'waterfall', 'display',
  'custom', 'trim', 'panel slab',
];
function patternFromLabel(label: string): string {
  const lower = (label || '').toLowerCase();
  for (const kw of CRAFTSMAN_KEYWORDS) if (lower.includes(kw)) return kw;
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return words.sort((a, b) => b.length - a.length)[0] ?? lower.trim().slice(0, 40);
}

// Upsert one (label-pattern, part-pattern, dept) confirmation into the learning table.
async function learnPattern(tenantId: string, labelPattern: string, partName: string, dept: string, confirmedBy: string) {
  const part_name_pattern = (partName || '').trim().toLowerCase();
  try {
    const { data: existing } = await supabase
      .from('craftsman_classifications')
      .select('id, times_confirmed')
      .eq('tenant_id', tenantId)
      .eq('unit_label_pattern', labelPattern)
      .eq('part_name_pattern', part_name_pattern)
      .eq('assigned_dept', dept)
      .maybeSingle();
    if (existing) {
      await supabase.from('craftsman_classifications')
        .update({ times_confirmed: ((existing as { times_confirmed: number }).times_confirmed ?? 0) + 1, confirmed_by: confirmedBy, updated_at: new Date().toISOString() })
        .eq('id', (existing as { id: string }).id);
    } else {
      await supabase.from('craftsman_classifications').insert({
        tenant_id: tenantId, unit_label_pattern: labelPattern, part_name_pattern,
        assigned_dept: dept, confirmed_by: confirmedBy, times_confirmed: 1,
      });
    }
  } catch { /* learning is best-effort */ }
}

// Recompute a cabinet's split state + assigned_dept from its parts, and roll the
// cabinet up to 'complete' when every part is complete (regardless of dept).
export async function recomputeCabinet(tenantId: string, cabinetUnitId: string): Promise<void> {
  try {
    const [{ data: cab }, { data: partRows }] = await Promise.all([
      supabase.from('cabinet_units').select('assigned_dept, status').eq('id', cabinetUnitId).maybeSingle(),
      supabase.from('parts').select('assigned_dept, status').eq('cabinet_unit_id', cabinetUnitId).eq('tenant_id', tenantId),
    ]);
    const cabRow = cab as { assigned_dept: string | null; status: string | null } | null;
    const parts = (partRows as { assigned_dept: string | null; status: string | null }[] | null) ?? [];
    if (parts.length === 0) return;

    const baseDept = cabRow?.assigned_dept && cabRow.assigned_dept !== 'split' ? cabRow.assigned_dept : 'production';
    const effective = new Set(parts.map((p) => (p.assigned_dept || baseDept)));
    const update: Record<string, unknown> = {};
    if (effective.size > 1) {
      update.is_split = true;
      update.assigned_dept = 'split';
    } else {
      update.is_split = false;
      update.assigned_dept = Array.from(effective)[0] ?? baseDept;
    }
    // Completion: all parts complete → cabinet complete (never downgrade a complete cabinet).
    const allComplete = parts.every((p) => p.status === 'complete');
    if (allComplete && cabRow?.status !== 'complete') {
      update.status = 'complete';
      update.completed_at = new Date().toISOString();
    }
    await supabase.from('cabinet_units').update(update).eq('id', cabinetUnitId);
  } catch { /* best-effort */ }
}

// Push a single part to another department.
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
  const toLower = opts.toDept.toLowerCase();
  // 1. Reassign the part (this must succeed).
  const { error } = await supabase.from('parts').update({ assigned_dept: toLower }).eq('id', opts.part.id).eq('tenant_id', opts.tenantId);
  if (error) throw error;

  // 2. shift_event (time_clock_id may be null for supervisor-initiated pushes).
  try {
    await supabase.from('shift_events').insert({
      tenant_id: opts.tenantId,
      time_clock_id: opts.timeClockId ?? null,
      worker_name: opts.workerName || 'Supervisor',
      event_type: 'part_reassigned',
      dept: opts.toDept,
      previous_dept: opts.fromDept || null,
      metadata: {
        part_name: opts.part.part_name,
        from_dept: opts.fromDept || null,
        to_dept: opts.toDept,
        cabinet_unit_id: opts.part.cabinet_unit_id,
        job_number: opts.part.job_number ?? null,
      },
    });
  } catch { /* best-effort */ }

  // 3. Shop learning.
  void learnPattern(opts.tenantId, patternFromLabel(opts.unitLabel || ''), opts.part.part_name, toLower, opts.workerName || 'Supervisor');

  // 4. Recompute the cabinet's split + completion state.
  await recomputeCabinet(opts.tenantId, opts.part.cabinet_unit_id);

  // 5. Notify the supervisor.
  const jobLabel = opts.jobPath ? opts.jobPath.split('/').map((s) => s.trim()).join(' / ') : (opts.part.job_number ?? 'job');
  sendNotify({
    tenant_id: opts.tenantId,
    target: 'supervisor',
    title: 'Part reassigned',
    body: `${opts.part.part_name} pushed from ${opts.fromDept || 'a dept'} to ${opts.toDept} on ${jobLabel}`,
    url: '/app/supervisor',
  });
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
