// ============================================================================
// Offline action queue
// ----------------------------------------------------------------------------
// Crew-critical actions (clock in/out, part scans, damage reports, inventory
// needs) keep working with no connection. Each action is stored in localStorage
// and replayed against Supabase when the device comes back online.
//
// Photos are NOT queued — they need a live connection. A damage report queued
// offline syncs its text now and the photo uploads on a later live submission.
// ============================================================================
import type { SupabaseClient } from '@supabase/supabase-js';

const QUEUE_KEY = 'offline_queue';

export type QueuedActionType =
  | 'clock_in'
  | 'clock_out'
  | 'part_scan'
  | 'damage_report'
  | 'inventory_need';

export interface QueuedAction {
  id: string;
  type: QueuedActionType;
  payload: Record<string, unknown>;
  timestamp: string;
  synced: boolean;
}

// ── Storage primitives ───────────────────────────────────────────────────────

export function getQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as QueuedAction[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedAction[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage full / unavailable — nothing we can do */
  }
}

export function queueAction(action: QueuedAction): void {
  const queue = getQueue();
  queue.push(action);
  writeQueue(queue);
}

// Convenience: build + enqueue in one call, returning the generated action.
export function enqueue(type: QueuedActionType, payload: Record<string, unknown>): QueuedAction {
  const action: QueuedAction = {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    payload,
    timestamp: new Date().toISOString(),
    synced: false,
  };
  queueAction(action);
  return action;
}

export function pendingCount(): number {
  return getQueue().filter((a) => !a.synced).length;
}

function markSynced(id: string): void {
  const queue = getQueue().map((a) => (a.id === id ? { ...a, synced: true } : a));
  // Drop everything already synced so the queue can't grow without bound.
  writeQueue(queue.filter((a) => !a.synced));
}

// ── Replay a single action against Supabase ──────────────────────────────────

async function processAction(
  action: QueuedAction,
  supabase: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const p = action.payload;

  switch (action.type) {
    case 'clock_in': {
      const { error } = await supabase.from('time_clock').insert({
        worker_name: p.worker_name,
        dept:        p.dept,
        current_dept: p.dept,
        clock_in:    p.clock_in,
        clock_out:   null,
        date:        p.date,
        status:      'active',
        tenant_id:   tenantId,
      });
      if (error) throw error;
      break;
    }

    case 'clock_out': {
      // Find the still-open shift for this worker and close it. Keyed on
      // worker_name (not row id) so an offline clock-in that synced first is
      // matched correctly.
      const { data: open } = await supabase
        .from('time_clock')
        .select('id, clock_in, total_break_minutes')
        .eq('tenant_id', tenantId)
        .eq('worker_name', p.worker_name as string)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!open) break; // nothing open — already closed or never opened
      const row = open as { id: string; clock_in: string; total_break_minutes: number | null };
      const clockOutAt = (p.clock_out as string) || new Date().toISOString();
      const totalMs = new Date(clockOutAt).getTime() - new Date(row.clock_in).getTime();
      const totalHours = totalMs / 3_600_000;
      const breakMins = row.total_break_minutes ?? 0;
      const netHours = totalHours - breakMins / 60;
      const { error } = await supabase.from('time_clock').update({
        clock_out:   clockOutAt,
        on_break:    false,
        total_hours: Math.round(netHours * 10000) / 10000,
      }).eq('id', row.id);
      if (error) throw error;
      break;
    }

    case 'part_scan': {
      // payload.updates: array of { id, status, checked_at, checked_by, flag_type, flag_notes }
      const updates = (p.updates as Record<string, unknown>[]) ?? [];
      for (const u of updates) {
        const { error } = await supabase.from('parts').update({
          status:     u.status,
          checked_at: u.checked_at ?? null,
          checked_by: u.checked_by ?? null,
          flag_type:  u.flag_type ?? null,
          flag_notes: u.flag_notes ?? null,
        }).eq('id', u.id as string);
        if (error) throw error;
      }
      if (p.cabinet_unit_id) {
        const unitUpdate: Record<string, unknown> = { status: p.unit_status };
        if (p.unit_status === 'complete') unitUpdate.completed_at = new Date().toISOString();
        if (p.unit_status === 'ready_for_qc') unitUpdate.assigned_dept = 'qc';
        if (p.unit_status === 'flagged') unitUpdate.assigned_dept = 'assembly';
        await supabase.from('cabinet_units').update(unitUpdate).eq('id', p.cabinet_unit_id as string);
        // Sync parts.assigned_dept so cabinet and parts agree on location.
        if (p.unit_status === 'ready_for_qc') {
          try {
            await supabase.from('parts')
              .update({ assigned_dept: 'qc', status: 'pending' })
              .eq('cabinet_unit_id', p.cabinet_unit_id as string)
              .eq('tenant_id', tenantId);
          } catch { /* best-effort */ }
        }
      }
      const reports = (p.damage_reports as Record<string, unknown>[]) ?? [];
      if (reports.length > 0) {
        await supabase.from('damage_reports').insert(
          reports.map((r) => ({ ...r, tenant_id: tenantId })),
        );
      }
      break;
    }

    case 'damage_report': {
      const { error } = await supabase.from('damage_reports').insert({
        part_name: p.part_name,
        dept:      p.dept,
        notes:     p.notes ?? null,
        photo_url: null, // photos require a live connection
        status:    'open',
        tenant_id: tenantId,
      });
      if (error) throw error;
      break;
    }

    case 'inventory_need': {
      const insert: Record<string, unknown> = {
        item:      p.item,
        dept:      p.dept,
        qty:       p.qty ?? 1,
        status:    'pending',
        tenant_id: tenantId,
      };
      if (p.job_number) insert.job_number = p.job_number;
      const { error } = await supabase.from('inventory_needs').insert(insert);
      if (error) throw error;
      break;
    }
  }
}

// ── Drain the queue ──────────────────────────────────────────────────────────
// Safe to call repeatedly: on app load, on the window 'online' event, and after
// any successful network write. Returns the number of actions synced.
let syncing = false;

export async function syncQueue(supabase: SupabaseClient, tenantId: string): Promise<number> {
  if (syncing || typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  syncing = true;
  let synced = 0;
  try {
    const queue = getQueue().filter((a) => !a.synced);
    for (const action of queue) {
      try {
        await processAction(action, supabase, tenantId);
        markSynced(action.id);
        synced++;
      } catch (e) {
        console.error('Sync failed:', action.id, e);
        // Leave it queued — a later sync will retry.
      }
    }
  } finally {
    syncing = false;
  }
  return synced;
}
