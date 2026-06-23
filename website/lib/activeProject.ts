// One active or paused project per crew member across the whole app. The project
// attaches to the USER (worker_name) — not the device or department — and its
// authoritative state lives in Supabase (crew_active_projects), so it follows the
// crew member across devices. Each dept view caches a copy locally for speed.
//
// Lifecycle:
//   start   → a dept view opens a time_clock session, then upsertActiveProject()
//   pause   → pauseWorkerProject() closes the session (logging its hours) + marks paused
//   resume  → startProjectSession() opens a fresh time_clock session + marks active
//   finish  → clearProject() removes the row once the cabinet is pushed on / completed
//
// time_clock keeps ONE row per session (multiple rows per cabinet across pauses);
// each row logs only its own session hours so the supervisor's reports sum
// total_hours naturally with no change. accumulated_seconds tracks the cumulative
// total only for the crew-facing elapsed display.

import { supabase } from './supabase';

export type ActiveProjectStatus = 'active' | 'paused';

export type ActiveProject = {
  id: string;
  tenant_id: string;
  worker_name: string;
  dept: string;
  cabinet_unit_id: string;
  unit_label: string;
  job_number: string | null;
  time_clock_id: string | null;
  session_start: string | null;
  accumulated_seconds: number;
  status: ActiveProjectStatus;
};

const COLS = 'id, tenant_id, worker_name, dept, cabinet_unit_id, unit_label, job_number, time_clock_id, session_start, accumulated_seconds, status';

// dept (lowercased) → the time_clock.status the dept logs its sessions under.
const CLOCK_STATUS: Record<string, string> = {
  craftsman: 'craftsman_build',
  assembly: 'assembly_work',
  finishing: 'finishing_work',
};

const deptKey = (d: string) => (d || '').toLowerCase();
export const deptLabel = (d: string) => {
  const k = deptKey(d);
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : d;
};

// "1h 20m" / "5m" — accumulated elapsed for crew + supervisor displays.
export function fmtAccumulated(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Total seconds = all prior sessions + the live session (only while active).
export function projectTotalSeconds(p: ActiveProject): number {
  const session = p.status === 'active' && p.session_start
    ? Math.max(0, Math.floor((Date.now() - new Date(p.session_start).getTime()) / 1000))
    : 0;
  return (p.accumulated_seconds ?? 0) + session;
}

// The single open project (active or paused) for a worker, or null.
export async function getWorkerProject(tenantId: string, workerName: string): Promise<ActiveProject | null> {
  if (!tenantId || !workerName) return null;
  try {
    const { data } = await supabase
      .from('crew_active_projects').select(COLS)
      .eq('tenant_id', tenantId).eq('worker_name', workerName)
      .maybeSingle();
    return (data as ActiveProject | null) ?? null;
  } catch { return null; }
}

// Write/refresh the active project row for a worker, pointing at the dept view's
// already-open time_clock session. Does NOT create a time_clock row — the dept
// view owns that on its normal start path.
export async function upsertActiveProject(opts: {
  tenantId: string;
  workerName: string;
  dept: string;
  cabinetUnitId: string;
  unitLabel: string;
  jobNumber: string | null;
  timeClockId: string | null;
  sessionStart: string;
  accumulatedSeconds?: number;
}): Promise<void> {
  try {
    await supabase.from('crew_active_projects').upsert({
      tenant_id: opts.tenantId,
      worker_name: opts.workerName,
      dept: deptKey(opts.dept),
      cabinet_unit_id: opts.cabinetUnitId,
      unit_label: opts.unitLabel,
      job_number: opts.jobNumber,
      time_clock_id: opts.timeClockId,
      session_start: opts.sessionStart,
      accumulated_seconds: opts.accumulatedSeconds ?? 0,
      status: 'active',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,worker_name' });
  } catch { /* best-effort — Supabase is the source of truth, retried on next start */ }
}

// Resume (or fresh-start from a clock-in prompt): open a new time_clock session
// and mark the project active. Returns the new session's time_clock id + start.
export async function startProjectSession(opts: {
  tenantId: string;
  workerName: string;
  dept: string;
  cabinetUnitId: string;
  unitLabel: string;
  jobNumber: string | null;
  accumulatedSeconds?: number;
}): Promise<{ timeClockId: string | null; sessionStart: string }> {
  const now = new Date().toISOString();
  const status = CLOCK_STATUS[deptKey(opts.dept)] ?? 'active';
  let timeClockId: string | null = null;
  try {
    const { data } = await supabase.from('time_clock').insert({
      tenant_id: opts.tenantId, worker_name: opts.workerName || 'Crew', dept: deptLabel(opts.dept),
      clock_in: now, date: now.split('T')[0], status,
      notes: `Build: ${opts.unitLabel}`, job_number: opts.jobNumber,
      cabinet_unit_id: opts.cabinetUnitId,
    }).select('id').single();
    timeClockId = (data as { id: string } | null)?.id ?? null;
  } catch { timeClockId = null; }
  await upsertActiveProject({ ...opts, timeClockId, sessionStart: now, accumulatedSeconds: opts.accumulatedSeconds ?? 0 });
  return { timeClockId, sessionStart: now };
}

// Pause the worker's active project: close its time_clock session (logging only
// that session's hours), fold the session into accumulated_seconds, mark paused.
// Returns { accumulated, sessionSeconds, project } or null if nothing was active.
export async function pauseWorkerProject(
  tenantId: string,
  workerName: string,
): Promise<{ accumulated: number; sessionSeconds: number; project: ActiveProject } | null> {
  const p = await getWorkerProject(tenantId, workerName);
  if (!p || p.status !== 'active') return null;
  const now = new Date().toISOString();
  const sessionSeconds = p.session_start
    ? Math.max(0, Math.floor((Date.now() - new Date(p.session_start).getTime()) / 1000))
    : 0;
  const accumulated = (p.accumulated_seconds ?? 0) + sessionSeconds;
  if (p.time_clock_id) {
    // Log ONLY this session's hours so reports sum across rows naturally.
    try {
      await supabase.from('time_clock')
        .update({ clock_out: now, total_hours: Math.round((sessionSeconds / 3600) * 100) / 100 })
        .eq('id', p.time_clock_id);
    } catch { /* best-effort */ }
  }
  try {
    await supabase.from('crew_active_projects')
      .update({ status: 'paused', time_clock_id: null, session_start: null, accumulated_seconds: accumulated, updated_at: now })
      .eq('tenant_id', tenantId).eq('worker_name', workerName);
  } catch { /* best-effort */ }
  return { accumulated, sessionSeconds, project: p };
}

// Remove the project row once the cabinet has been pushed on / completed / QC'd.
export async function clearProject(tenantId: string, workerName: string): Promise<void> {
  if (!tenantId || !workerName) return;
  try {
    await supabase.from('crew_active_projects')
      .delete().eq('tenant_id', tenantId).eq('worker_name', workerName);
  } catch { /* best-effort */ }
}
