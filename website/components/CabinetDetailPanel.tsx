'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { deptDisplay } from '../lib/partActions';

// ── Cabinet detail panel ───────────────────────────────────────────────────
// Inline panel shown below the supervisor's universal search bar when a cabinet
// is selected from the results (or typed + Enter). Lists every part of that
// cabinet with its current dept + status, and live-updates via a realtime
// subscription on the parts table so the panel reflects parts moving between
// departments while it's open.

type Cabinet = {
  id: string;
  unit_label: string | null;
  cabinet_number: string | null;
  job_number: string | null;
  room_number: string | null;
  status: string;
  assigned_dept: string | null;
};
type Part = {
  id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number | null;
  assigned_dept: string | null;
  status: string | null;
};

interface Props {
  tenantId: string;
  cabinetId: string;
  onClose: () => void;
}

// Mirror of AssemblyTab.statusMeta for visual consistency across the portal.
function statusMeta(status: string): { label: string; color: string; bg: string; border: string } {
  switch (status) {
    case 'complete':     return { label: 'Complete',     color: '#34D399', bg: 'rgba(52,211,153,0.1)',  border: 'rgba(52,211,153,0.25)' };
    case 'ready_for_qc': return { label: 'Ready for QC', color: '#2DE1C9', bg: 'rgba(45,225,201,0.12)', border: 'rgba(45,225,201,0.35)' };
    case 'pending_qc_check': return { label: 'Awaiting QC', color: '#FBBF24', bg: 'rgba(251,191,36,0.1)', border: 'rgba(251,191,36,0.3)' };
    case 'finishing':    return { label: 'Finishing',    color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)'  };
    case 'building':     return { label: 'Building',     color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' };
    case 'in_assembly':  return { label: 'In Assembly',  color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' };
    case 'in_progress':  return { label: 'In Progress',  color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',  border: 'rgba(96,165,250,0.25)' };
    case 'cut':          return { label: 'Cut',          color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)',  border: 'rgba(94,234,212,0.25)' };
    case 'cutting':      return { label: 'Cutting',      color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',  border: 'rgba(251,191,36,0.3)'  };
    case 'flagged':      return { label: 'Flagged',      color: '#F87171', bg: 'rgba(248,113,113,0.1)', border: 'rgba(248,113,113,0.3)' };
    default:             return { label: status ? deptDisplay(status) : 'Not Cut', color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)', border: 'rgba(95,111,108,0.2)' };
  }
}

function dims(p: Part): string | null {
  const parts = [p.width, p.height, p.depth].filter((v) => v != null && v !== 0) as number[];
  if (parts.length === 0) return null;
  return parts.join(' × ');
}

export default function CabinetDetailPanel({ tenantId, cabinetId, onClose }: Props) {
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [{ data: cabRow }, { data: partRows }] = await Promise.all([
        supabase.from('cabinet_units')
          .select('id, unit_label, cabinet_number, job_number, room_number, status, assigned_dept')
          .eq('id', cabinetId).eq('tenant_id', tenantId).single(),
        supabase.from('parts')
          .select('id, part_name, material, width, height, depth, quantity, assigned_dept, status')
          .eq('cabinet_unit_id', cabinetId).eq('tenant_id', tenantId)
          .order('part_name', { ascending: true }),
      ]);
      setCabinet((cabRow as Cabinet | null) ?? null);
      setParts((partRows as Part[] | null) ?? []);
    } catch { /* best-effort */ }
    setLoading(false);
  }, [tenantId, cabinetId]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  // Realtime — refresh when any part of this cabinet changes dept/status.
  useEffect(() => {
    const ch = supabase
      .channel(`rt-cabinet-detail-${cabinetId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `cabinet_unit_id=eq.${cabinetId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [cabinetId, load]);

  const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };
  const title = cabinet?.unit_label || cabinet?.cabinet_number || 'Cabinet';
  const sub = [cabinet?.job_number ? `#${cabinet.job_number}` : null, cabinet?.room_number ? `Room ${cabinet.room_number}` : null].filter(Boolean).join(' · ');

  return (
    <div style={card}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
            {cabinet && (() => {
              const m = statusMeta((cabinet.status || '').toLowerCase());
              return (
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 20, background: m.bg, color: m.color, border: `1px solid ${m.border}` }}>
                  {m.label}
                </span>
              );
            })()}
          </div>
          {sub && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 3 }}>{sub}</div>}
        </div>
        <button onClick={onClose} aria-label="Close"
          style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', display: 'flex', padding: 4 }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading cabinet…</div>
      ) : parts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-mute)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>No parts found</div>
          <div style={{ fontSize: 12.5 }}>This cabinet has no parts recorded yet.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {parts.map((p) => {
            const d = dims(p);
            const meta = statusMeta((p.status || '').toLowerCase());
            const detail = [d, p.material].filter(Boolean).join(' · ');
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, background: 'var(--bg-2, #11151a)', border: '1px solid var(--line)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.part_name}{p.quantity && p.quantity > 1 ? <span style={{ color: 'var(--ink-mute)' }}> ×{p.quantity}</span> : null}
                  </div>
                  {detail && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{deptDisplay(p.assigned_dept || '')}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: meta.bg, color: meta.color, border: `1px solid ${meta.border}` }}>{meta.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
