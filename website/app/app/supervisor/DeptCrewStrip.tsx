'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ── "Crew on floor" strip ─────────────────────────────────────────────────────
// Shows the crew currently clocked in to a department (time_clock WHERE
// current_dept=<dept> AND clock_out IS NULL). Shared across every supervisor
// dept tab so each shows who is on the floor right now. Realtime on time_clock.

type ClockRow = { id: string; worker_name: string; current_dept: string | null; on_break: boolean | null };

interface Props {
  tenantId: string;
  dept: string; // title-case dept label, e.g. 'Finishing'
}

export default function DeptCrewStrip({ tenantId, dept }: Props) {
  const [crew, setCrew] = useState<ClockRow[]>([]);

  const load = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('time_clock')
        .select('id, worker_name, current_dept, on_break')
        .eq('tenant_id', tenantId)
        .eq('current_dept', dept)
        .is('clock_out', null)
        .order('clock_in', { ascending: true });
      setCrew((data as ClockRow[] | null) ?? []);
    } catch { /* best-effort */ }
  }, [tenantId, dept]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel(`rt-crewstrip-${dept.toLowerCase()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_clock', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, dept, load]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 16px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--ink-mute)', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Crew on floor
      </span>
      {crew.length === 0 ? (
        <span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>No one clocked in to {dept}</span>
      ) : (
        crew.map((c) => (
          <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: 'rgba(45,225,201,0.1)', color: '#2DE1C9' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.on_break ? '#FBBF24' : '#2DE1C9', flexShrink: 0 }} />
            {c.worker_name}{c.on_break ? ' · break' : ''}
          </span>
        ))
      )}
    </div>
  );
}
