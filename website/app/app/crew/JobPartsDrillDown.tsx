'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ── Shared spec-verification drill-down ──────────────────────────────────────
// Every template's crew view (Part / Cabinet / Group-Auto / Group-Manual / Sheet)
// must let the crew member drill down through the full job → room → cabinet → part
// hierarchy beneath whatever they've selected, to verify specs. This is that one
// reusable component — do not duplicate this logic per template.
//
// Scope it either by jobNumber (the whole job) or by an explicit set of
// cabinetUnitIds (e.g. a Group-Manual selection, or a single cabinet). Read-only:
// it renders specs + cut status, it never mutates parts.

type DrillCabinet = {
  id: string;
  unit_label: string | null;
  cabinet_number: string | null;
  room_number: string | null;
  job_number: string | null;
  production_status: string | null;
};

type DrillPart = {
  id: string;
  cabinet_unit_id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number | null;
  production_status: string | null;
  assigned_dept: string | null;
  flag_type: string | null;
};

// Compact cut-status pill, mirroring the page-level CutStatusBadge palette
// (teal = cut, amber = cutting, muted = not cut).
function StatusPill({ status }: { status: string | null }) {
  const cut = !!status && ['cut', 'qa_passed', 'in_assembly', 'finishing', 'complete'].includes(status);
  const cutting = status === 'cutting';
  const color = cut ? '#2DE1C9' : cutting ? '#FBBF24' : '#8BA5A0';
  const label = cut ? 'Cut' : cutting ? 'Cutting' : 'Not cut';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color, flexShrink: 0 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}

// Format a part's dimensions as W × H × D, omitting any null axis.
function fmtDims(p: DrillPart): string {
  const ax = [p.width, p.height, p.depth].filter((v): v is number => v != null);
  return ax.length ? ax.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, ''))).join(' × ') : '';
}

const ROOM_NONE = '__no_room__';
const chevron = (open: boolean) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);

export default function JobPartsDrillDown({
  tenantId,
  jobNumber,
  cabinetUnitIds,
  defaultOpen = false,
  emptyLabel = 'No cabinets to show.',
}: {
  tenantId: string;
  jobNumber?: string | null;
  cabinetUnitIds?: string[];
  defaultOpen?: boolean;
  emptyLabel?: string;
}) {
  const [cabinets, setCabinets] = useState<DrillCabinet[]>([]);
  const [partsByCab, setPartsByCab] = useState<Record<string, DrillPart[]>>({});
  const [loading, setLoading] = useState(true);
  const [openRooms, setOpenRooms] = useState<Set<string>>(new Set());
  const [openCabs, setOpenCabs] = useState<Set<string>>(new Set());

  const idsKey = (cabinetUnitIds ?? []).join(',');
  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      let cabQuery = supabase
        .from('cabinet_units')
        .select('id, unit_label, cabinet_number, room_number, job_number, production_status')
        .eq('tenant_id', tenantId);
      if (cabinetUnitIds && cabinetUnitIds.length > 0) cabQuery = cabQuery.in('id', cabinetUnitIds);
      else if (jobNumber) cabQuery = cabQuery.eq('job_number', jobNumber);
      else { setCabinets([]); setPartsByCab({}); setLoading(false); return; }
      const { data: cabs } = await cabQuery.order('cabinet_number');
      const cabRows = (cabs as DrillCabinet[] | null) ?? [];
      setCabinets(cabRows);
      if (cabRows.length > 0) {
        const { data: parts } = await supabase
          .from('parts')
          .select('id, cabinet_unit_id, part_name, material, width, height, depth, quantity, production_status, assigned_dept, flag_type')
          .in('cabinet_unit_id', cabRows.map((c) => c.id))
          .order('part_name');
        const grouped: Record<string, DrillPart[]> = {};
        ((parts as DrillPart[] | null) ?? []).forEach((p) => { (grouped[p.cabinet_unit_id] ??= []).push(p); });
        setPartsByCab(grouped);
        if (defaultOpen) {
          setOpenRooms(new Set(cabRows.map((c) => c.room_number || ROOM_NONE)));
        }
      } else {
        setPartsByCab({});
      }
    } catch { /* best-effort read-only view */ }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, jobNumber, idsKey, defaultOpen]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>Loading specs…</div>;
  }
  if (cabinets.length === 0) {
    return <div style={{ padding: '14px 0', fontSize: 12.5, color: 'var(--ink-mute)' }}>{emptyLabel}</div>;
  }

  // Group cabinets by room, preserving cabinet order within each room.
  const rooms: { key: string; label: string; cabs: DrillCabinet[] }[] = [];
  const roomIndex: Record<string, number> = {};
  for (const c of cabinets) {
    const key = c.room_number || ROOM_NONE;
    if (roomIndex[key] === undefined) {
      roomIndex[key] = rooms.length;
      rooms.push({ key, label: c.room_number || 'Unassigned room', cabs: [] });
    }
    rooms[roomIndex[key]].cabs.push(c);
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    setter(n);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rooms.map((room) => {
        const roomOpen = openRooms.has(room.key);
        const roomCut = room.cabs.flatMap((c) => partsByCab[c.id] ?? []);
        return (
          <div key={room.key} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--bg-1)' }}>
            <button
              onClick={() => toggle(openRooms, setOpenRooms, room.key)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink-mute)' }}
            >
              {chevron(roomOpen)}
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{room.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-mute)' }}>
                {room.cabs.length} cab{room.cabs.length === 1 ? '' : 's'} · {roomCut.length} part{roomCut.length === 1 ? '' : 's'}
              </span>
            </button>

            {roomOpen && (
              <div style={{ padding: '0 8px 8px' }}>
                {room.cabs.map((cab) => {
                  const cabOpen = openCabs.has(cab.id);
                  const parts = partsByCab[cab.id] ?? [];
                  return (
                    <div key={cab.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <button
                        onClick={() => toggle(openCabs, setOpenCabs, cab.id)}
                        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 6px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
                      >
                        {chevron(cabOpen)}
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{cab.unit_label || cab.cabinet_number || 'Cabinet'}</span>
                        <span style={{ marginLeft: 'auto' }}><StatusPill status={cab.production_status} /></span>
                      </button>

                      {cabOpen && (
                        <div style={{ paddingBottom: 6 }}>
                          {parts.length === 0 ? (
                            <div style={{ padding: '6px 8px 6px 29px', fontSize: 12, color: 'var(--ink-mute)' }}>No parts on this cabinet.</div>
                          ) : parts.map((p) => {
                            const dims = fmtDims(p);
                            return (
                              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 29px' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {p.part_name}
                                    {p.flag_type && <span style={{ fontSize: 10, fontWeight: 700, color: '#F87171' }}>⚑</span>}
                                  </div>
                                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                                    {[dims, p.material, (p.quantity ?? 1) > 1 ? `Qty ${p.quantity}` : null].filter(Boolean).join('  ·  ')}
                                  </div>
                                </div>
                                <StatusPill status={p.production_status} />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
