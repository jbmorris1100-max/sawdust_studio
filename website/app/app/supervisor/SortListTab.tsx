'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { supabase } from '@/lib/supabase';
import { DEFAULT_DEPARTMENTS } from '@/lib/auth';
import { deptDisplay } from '@/lib/partActions';

// ── Sort List ───────────────────────────────────────────────────────────────
// The Learn-mode queue of unit classifications the AI was NOT allowed to guess.
// classify-units parks every unit that matched no routing rule and no confirmed
// learned pattern here (see api/classify-units). The supervisor assigns each one
// to a real department by hand; that assignment moves the unit + its parts,
// removes the queue entry, and teaches the classifier (craftsman_classifications)
// the same way a confirmed AI classification does — so the same kind of unit
// stops being queued once the pattern crosses the auto-assign threshold.

type Job = {
  id: string;
  job_number: string;
  job_name: string | null;
  status: string;
  job_path?: string | null;
};

// One sort_list row joined to its cabinet_unit. cabinet_units is a to-one embed
// (sort_list.cabinet_unit_id → cabinet_units.id), so it arrives as a single
// object (or null if the unit was deleted out from under the queue entry).
type SortRow = {
  id: string;
  cabinet_unit_id: string;
  job_number: string | null;
  created_at: string;
  cabinet_units: {
    unit_label: string;
    cabinet_number: string | null;
    room_number: string | null;
    assigned_dept: string | null;
  } | null;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs?: Job[];
  departments?: string[];
}

// Reusable craftsman keywords + pattern extractor — copied VERBATIM from
// api/classify-units so a supervisor's manual sort produces the exact same
// unit_label_pattern the AI classifier would, letting both converge on (and
// increment) the same craftsman_classifications row. (Note: CraftsmanTab has a
// different, simpler patternFromLabel — do not use that one here.)
const CRAFTSMAN_KEYWORDS = [
  'countertop', 'counter top', 'butcher block', 'slab', 'floating shelf', 'float shelf',
  'vent hood', 'range hood', 'hood', 'wine rack', 'mantle', 'mantel', 'fireplace',
  'surround', 'bench seat', 'window seat', 'bench', 'corbel', 'waterfall', 'display',
  'custom', 'trim', 'panel slab',
];
function patternFromLabel(label: string): string {
  const lower = label.toLowerCase();
  for (const kw of CRAFTSMAN_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return words.sort((a, b) => b.length - a.length)[0] ?? lower.trim().slice(0, 40);
}

const lbl: CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' };

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SortListTab({ tenantId, showToast, jobs, departments }: Props) {
  const deptOptions = departments && departments.length ? departments : DEFAULT_DEPARTMENTS;
  const [rows, setRows] = useState<SortRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  // rowId → chosen department name (label form; lowercased on write).
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const jobName = useCallback(
    (jobNumber: string | null) => jobs?.find((j) => j.job_number === jobNumber)?.job_name ?? null,
    [jobs],
  );

  // ── Data load ──────────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await supabase
        .from('sort_list')
        .select('id, cabinet_unit_id, job_number, created_at, cabinet_units(unit_label, cabinet_number, room_number, assigned_dept)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
      // "relation does not exist" — sort_list migration not yet applied.
      if (res.error && (res.error as { code?: string }).code === '42P01') {
        setMigrationNeeded(true);
        setLoading(false);
        return;
      }
      setRows((res.data as unknown as SortRow[] | null) ?? []);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Load failed', true);
    }
    setLoading(false);
  }, [tenantId, showToast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Realtime — new queue entries appear (and resolved ones vanish) live ──────
  useEffect(() => {
    const ch = supabase
      .channel('rt-sortlist')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sort_list', filter: `tenant_id=eq.${tenantId}` }, () => { void loadAll(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, loadAll]);

  // ── Assign one queued unit to a real department ─────────────────────────────
  // Mirrors classify-units' apply (Step 3) + learn (Step 4):
  //   a. cabinet_units + parts move together (assigned_dept), and parts routed to
  //      finishing/assembly are marked cut at write time (those depts receive
  //      already-cut parts — same rule pushPart/classify-units enforce).
  //   b. the sort_list row is deleted — resolved entries don't persist here.
  //   c. the (pattern → dept) is upserted into craftsman_classifications so the
  //      classifier learns, exactly like a confirmed AI classification.
  async function assign(row: SortRow) {
    if (busyId) return;
    const deptLabel = picks[row.id];
    if (!deptLabel) { showToast('Pick a department first', true); return; }
    const unit = row.cabinet_units;
    if (!unit) { showToast('This unit no longer exists', true); void loadAll(); return; }
    const dept = deptLabel.toLowerCase();
    setBusyId(row.id);
    // Optimistic: drop it from the visible queue immediately.
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    try {
      // a. Move the cabinet unit. suggested_dept mirrors assigned_dept (same as
      //    classify-units Step 3) so the Craftsman suggestion view stays correct.
      const { error: unitErr } = await supabase
        .from('cabinet_units')
        .update({ assigned_dept: dept, suggested_dept: dept })
        .eq('id', row.cabinet_unit_id)
        .eq('tenant_id', tenantId);
      if (unitErr) throw unitErr;

      // a. Move the unit's parts. Finishing/Assembly receive already-cut parts.
      const marksCut = dept === 'finishing' || dept === 'assembly';
      const now = new Date().toISOString();
      const { data: movedParts } = await supabase
        .from('parts')
        .update({
          assigned_dept: dept,
          ...(marksCut ? { production_status: 'cut', cut_by: 'Supervisor', cut_at: now } : {}),
        })
        .eq('cabinet_unit_id', row.cabinet_unit_id)
        .eq('tenant_id', tenantId)
        .select('id');

      // b. Remove the queue entry — resolved entries live only in the learner.
      await supabase.from('sort_list').delete().eq('id', row.id).eq('tenant_id', tenantId);

      // Log the arrival so dwell-time has a start point (classify-units logs this
      // in Step 3; in Learn mode it was skipped, so this is the unit's first event).
      try {
        const partIds = ((movedParts as { id: string }[] | null) ?? []).map((p) => p.id);
        if (partIds.length > 0) {
          await supabase.from('part_dept_events').insert(partIds.map((pid) => ({
            tenant_id: tenantId,
            part_id: pid,
            cabinet_unit_id: row.cabinet_unit_id,
            job_number: row.job_number,
            from_dept: null,
            to_dept: dept,
            worker_name: 'Supervisor',
          })));
        }
      } catch { /* event log is best-effort */ }

      // c. Teach the classifier (mirror classify-units Step 4 upsert).
      try {
        const pattern = patternFromLabel(unit.unit_label);
        if (pattern) {
          const { data: existing } = await supabase
            .from('craftsman_classifications')
            .select('id, times_confirmed')
            .eq('tenant_id', tenantId)
            .eq('unit_label_pattern', pattern)
            .eq('assigned_dept', dept)
            .is('part_name_pattern', null)
            .maybeSingle();
          if (existing) {
            await supabase.from('craftsman_classifications')
              .update({ times_confirmed: ((existing as { times_confirmed: number }).times_confirmed ?? 0) + 1, updated_at: new Date().toISOString() })
              .eq('id', (existing as { id: string }).id);
          } else {
            await supabase.from('craftsman_classifications').insert({
              tenant_id: tenantId,
              unit_label_pattern: pattern,
              assigned_dept: dept,
              confirmed_by: 'Supervisor',
            });
          }
        }
      } catch { /* learning is best-effort */ }

      showToast(`${unit.unit_label} → ${deptDisplay(dept)}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Assign failed', true);
      void loadAll(); // restore the row if the move failed
    } finally {
      setBusyId(null);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  if (migrationNeeded) {
    return (
      <div style={{ maxWidth: 720 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>Shop Floor</div>
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>Sort List</h2>
        <div className="portal-card" style={{ marginTop: 20, padding: '28px', textAlign: 'center', color: 'var(--ink-dim)', fontSize: 13 }}>
          The <code>sort_list</code> table hasn’t been created yet. Apply the latest migration to enable this tab.
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Shop Floor</div>
      <h2 style={{ fontSize: 24, marginBottom: 4 }}>Sort List</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, margin: '0 0 24px', maxWidth: 600 }}>
        Units the classifier couldn’t place — no routing rule matched and there’s no confirmed pattern yet.
        Assign each one to a department; the system learns your choice so the same kind of unit routes itself next time.
      </p>

      {loading ? (
        <div style={{ color: 'var(--ink-mute)', fontSize: 13, padding: '24px 0' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div className="portal-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '44px 28px', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(45,225,201,0.08)', border: '1px solid rgba(45,225,201,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>Nothing to sort</div>
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: 0, maxWidth: 420 }}>
            Every uploaded unit has been routed automatically. Anything the classifier can’t place will show up here.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => {
            const unit = row.cabinet_units;
            const sub = [unit?.room_number ? `Room ${unit.room_number}` : null, unit?.cabinet_number ? `Cab ${unit.cabinet_number}` : null]
              .filter(Boolean).join(' · ');
            const jn = row.job_number;
            const jName = jobName(jn);
            return (
              <div key={row.id} className="portal-card" style={{ padding: '16px 18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
                <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {unit?.unit_label ?? '(unit removed)'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {jn && <span><span style={lbl}>Job</span> {jName ? `${jn} — ${jName}` : jn}</span>}
                    {sub && <span>{sub}</span>}
                    <span>{timeAgo(row.created_at)}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
                  <select
                    value={picks[row.id] ?? ''}
                    onChange={(e) => setPicks((prev) => ({ ...prev, [row.id]: e.target.value }))}
                    className="input"
                    style={{ padding: '8px 10px', fontSize: 13, minWidth: 150 }}
                  >
                    <option value="" disabled>Assign to…</option>
                    {deptOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 13, padding: '8px 16px', opacity: !picks[row.id] || busyId === row.id ? 0.5 : 1 }}
                    disabled={!picks[row.id] || busyId === row.id}
                    onClick={() => void assign(row)}
                  >
                    {busyId === row.id ? 'Assigning…' : 'Assign'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
