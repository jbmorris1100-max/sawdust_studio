'use client';
/* ============================================================================
 * CrewDeptSearch — dept-scoped crew search bar (crew home)
 * ----------------------------------------------------------------------------
 * The crew-facing counterpart to the supervisor's universal JobSearch, but
 * HARD-SCOPED to the crew member's own department. Every query is filtered by
 * cabinet_units.assigned_dept = the crew member's dept key, so a crew member can
 * only ever surface cabinets (and the jobs they belong to) that are currently
 * assigned to their own department — never another dept's work.
 *
 * Reuses the JobSearch UX pattern: debounced input, a dropdown of grouped
 * results (Jobs / Cabinets), path-free single-term matching on
 * unit_label / cabinet_number / job_number. Selecting a result opens the
 * existing read-only JobPartsDrillDown for that cabinet or job.
 * ========================================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import JobPartsDrillDown from './JobPartsDrillDown';

type CabRow = {
  id: string;
  job_number: string | null;
  unit_label: string | null;
  cabinet_number: string | null;
  room_number: string | null;
  assigned_dept: string | null;
};

type Selection =
  | { kind: 'cabinet'; cabinetId: string; label: string }
  | { kind: 'job'; jobNumber: string; label: string };

export default function CrewDeptSearch({
  tenantId,
  deptKey,
  deptLabel,
}: {
  tenantId: string;
  deptKey: string;   // already lowercased (crewDept.toLowerCase())
  deptLabel?: string;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cabs, setCabs] = useState<CabRow[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // close dropdown on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const run = useCallback(async (raw: string) => {
    const term = raw.trim().replace(/[,()]/g, ' ').trim();
    if (!term || !deptKey) { setCabs([]); setLoading(false); return; }
    setLoading(true);
    try {
      // HARD dept scope: assigned_dept = the crew's dept (case-insensitive), then
      // match the term on cabinet label / number / job number. PostgREST ANDs the
      // .ilike() dept filter with the .or() term filter, so results can never
      // escape the crew member's department.
      const { data } = await supabase
        .from('cabinet_units')
        .select('id, job_number, unit_label, cabinet_number, room_number, assigned_dept')
        .eq('tenant_id', tenantId)
        .ilike('assigned_dept', deptKey)
        .or(`unit_label.ilike.%${term}%,cabinet_number.ilike.%${term}%,job_number.ilike.%${term}%`)
        .order('cabinet_number')
        .limit(12);
      setCabs((data as CabRow[]) ?? []);
    } catch {
      setCabs([]);
    }
    setLoading(false);
  }, [tenantId, deptKey]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void run(q); }, 220);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, run]);

  // Distinct jobs among the dept-scoped cabinet matches (jobs aren't dept-scoped
  // themselves, so we derive them from the cabinets that ARE in this dept).
  const jobs = Array.from(
    cabs.reduce((m, c) => {
      if (c.job_number && !m.has(c.job_number)) m.set(c.job_number, c.job_number);
      return m;
    }, new Map<string, string>()).values(),
  );

  const hasResults = jobs.length + cabs.length > 0;
  const pickCabinet = (c: CabRow) => { setOpen(false); setSelection({ kind: 'cabinet', cabinetId: c.id, label: c.unit_label || c.cabinet_number || 'Cabinet' }); };
  const pickJob = (jobNumber: string) => { setOpen(false); setSelection({ kind: 'job', jobNumber, label: `#${jobNumber}` }); };

  return (
    <div style={{ marginBottom: 20 }}>
      <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', height: 46, borderRadius: 11, background: 'var(--bg-1)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
            placeholder={deptLabel ? `Search ${deptLabel}… job or cabinet` : 'Search your department…'}
            style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit' }}
          />
          {q && <button onClick={() => { setQ(''); setOpen(false); }} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 16, padding: 0 }} aria-label="Clear">×</button>}
        </div>

        {open && q.trim() && (
          <div style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 50, maxHeight: 360, overflowY: 'auto', background: 'var(--bg-2)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 11, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
            {loading && !hasResults && <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-mute)' }}>Searching…</div>}
            {!loading && !hasResults && <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-mute)' }}>No matches in your department for &ldquo;{q}&rdquo;.</div>}

            {jobs.length > 0 && <SectionLabel>Jobs</SectionLabel>}
            {jobs.map((jn) => (
              <Row key={`job-${jn}`} icon="job" title={`#${jn}`} sub={deptLabel ? `${deptLabel} work` : undefined} onClick={() => pickJob(jn)} />
            ))}

            {cabs.length > 0 && <SectionLabel>Cabinets</SectionLabel>}
            {cabs.map((c) => (
              <Row key={c.id} icon="cabinet"
                title={c.unit_label || c.cabinet_number || 'Cabinet'}
                sub={[c.job_number ? `#${c.job_number}` : null, c.room_number ? `Room ${c.room_number}` : null].filter(Boolean).join(' · ') || undefined}
                onClick={() => pickCabinet(c)}
              />
            ))}
          </div>
        )}
      </div>

      {selection && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSelection(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-2)', borderTopLeftRadius: 18, borderTopRightRadius: 18, border: '1px solid rgba(255,255,255,0.12)', padding: '18px 18px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{selection.label}</div>
              <button onClick={() => setSelection(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 22, lineHeight: 1, padding: 0 }} aria-label="Close">×</button>
            </div>
            {selection.kind === 'cabinet'
              ? <JobPartsDrillDown tenantId={tenantId} cabinetUnitIds={[selection.cabinetId]} defaultOpen />
              : <JobPartsDrillDown tenantId={tenantId} jobNumber={selection.jobNumber} defaultOpen />}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '9px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{children}</div>;
}

function Row({ icon, title, sub, onClick }: { icon: 'job' | 'cabinet'; title: string; sub?: string; onClick?: () => void }) {
  const glyph = {
    job:     <path d="M3 7h18M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />,
    cabinet: <path d="M4 4h16v16H4zM12 4v16M4 8h8M12 8h8" />,
  }[icon];
  return (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '10px 14px', background: 'none', border: 'none', borderTop: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>{glyph}</svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>{sub}</div>}
      </div>
    </button>
  );
}
