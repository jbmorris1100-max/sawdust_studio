'use client';
/* ============================================================================
 * JobSearch — universal path-style job search bar (Part 1)
 * ----------------------------------------------------------------------------
 * The universal language of the app. Searches jobs, job_drawings and
 * cabinet_units. Understands path syntax:
 *
 *   Smith                        → all Smith jobs
 *   Smith/Kitchen                → that job overview
 *   Smith/Kitchen/Cutlist        → cutlist viewer
 *   Smith/Kitchen/Drawings       → file viewer
 *   Smith/Kitchen/Cabinet K03    → that cabinet unit
 *
 * Robust to the schema migration not being applied yet: the job_path column is
 * queried best-effort and falls back to job_name / job_number.
 * ========================================================================== */
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export type SearchTarget =
  | { kind: 'job';     jobNumber: string | null; jobPath: string | null; label: string }
  | { kind: 'cutlist'; jobNumber: string | null; jobPath: string | null; label: string }
  | { kind: 'drawings';jobNumber: string | null; jobPath: string | null; label: string }
  | { kind: 'cabinet'; jobNumber: string | null; jobPath: string | null; cabinetId: string; label: string }
  | { kind: 'file';    url: string; name: string; fileType: string | null; parsed: boolean; jobPath: string | null; jobNumber: string | null; label: string };

type JobRow     = { job_number: string | null; job_name: string | null; job_path?: string | null };
type DrawingRow = { id: string; job_number: string | null; label: string | null; file_name: string | null; file_url: string | null; file_type: string | null; parsed: boolean | null; job_path?: string | null };
type CabinetRow = { id: string; job_number: string | null; unit_label: string | null; cabinet_number: string | null; room_number: string | null };

const SECTION_WORDS: Record<string, 'cutlist' | 'drawings'> = {
  cutlist: 'cutlist', 'cut list': 'cutlist', cutlists: 'cutlist',
  drawings: 'drawings', drawing: 'drawings', plans: 'drawings', plan: 'drawings',
};

function jobLabel(j: JobRow): string {
  return j.job_path || j.job_name || j.job_number || 'Unnamed';
}

export default function JobSearch({
  tenantId, onSelect, prefill = '', placeholder = 'Search jobs… e.g. Smith/Kitchen', autoFocus = false,
}: {
  tenantId: string;
  onSelect: (t: SearchTarget) => void;
  prefill?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState(prefill);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [files, setFiles] = useState<DrawingRow[]>([]);
  const [cabs, setCabs] = useState<CabinetRow[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // close on outside click
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const run = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (!term) { setJobs([]); setFiles([]); setCabs([]); setLoading(false); return; }
    setLoading(true);

    const segs = term.split('/').map((s) => s.trim()).filter(Boolean);
    const client = segs[0] ?? '';
    const room = segs[1] ?? '';
    const jobNeedle = [client, room].filter(Boolean).join('/');

    // ── jobs: search job_name + job_number always; job_path best-effort ──
    let jobRows: JobRow[] = [];
    try {
      const { data } = await supabase.from('jobs')
        .select('job_number, job_name, job_path')
        .eq('tenant_id', tenantId)
        .or(`job_name.ilike.%${client}%,job_number.ilike.%${client}%,job_path.ilike.%${jobNeedle}%`)
        .limit(8);
      jobRows = (data as JobRow[]) ?? [];
    } catch { /* job_path may not exist yet */ }
    if (jobRows.length === 0) {
      const { data } = await supabase.from('jobs')
        .select('job_number, job_name')
        .eq('tenant_id', tenantId)
        .or(`job_name.ilike.%${client}%,job_number.ilike.%${client}%`)
        .limit(8);
      jobRows = (data as JobRow[]) ?? [];
    }

    // ── files ──
    const { data: fileData } = await supabase.from('job_drawings')
      .select('id, job_number, label, file_name, file_url, file_type, parsed')
      .eq('tenant_id', tenantId)
      .or(`label.ilike.%${term}%,file_name.ilike.%${term}%,job_number.ilike.%${client}%`)
      .limit(8);

    // ── cabinets ──
    const cabNeedle = segs.length >= 3 ? segs.slice(2).join(' ').replace(/^cabinet\s*/i, '') : client;
    const { data: cabData } = await supabase.from('cabinet_units')
      .select('id, job_number, unit_label, cabinet_number, room_number')
      .eq('tenant_id', tenantId)
      .or(`unit_label.ilike.%${cabNeedle}%,cabinet_number.ilike.%${cabNeedle}%,job_number.ilike.%${client}%`)
      .limit(8);

    setJobs(jobRows);
    setFiles((fileData as DrawingRow[]) ?? []);
    setCabs((cabData as CabinetRow[]) ?? []);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { void run(q); }, 220);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, run]);

  // direct path routing on Enter
  const submitPath = () => {
    const segs = q.split('/').map((s) => s.trim()).filter(Boolean);
    if (segs.length >= 3) {
      const section = segs[2].toLowerCase();
      const jobPath = `${segs[0]}/${segs[1]}`;
      if (SECTION_WORDS[section] === 'cutlist') { pick({ kind: 'cutlist', jobNumber: null, jobPath, label: `${jobPath}/Cutlist` }); return; }
      if (SECTION_WORDS[section] === 'drawings') { pick({ kind: 'drawings', jobNumber: null, jobPath, label: `${jobPath}/Drawings` }); return; }
      if (section.startsWith('cabinet')) {
        const id = segs.slice(2).join(' ').replace(/^cabinet\s*/i, '').trim();
        const match = cabs.find((c) => (c.cabinet_number ?? '').toLowerCase() === id.toLowerCase() || (c.unit_label ?? '').toLowerCase().includes(id.toLowerCase()));
        if (match) { pick({ kind: 'cabinet', jobNumber: match.job_number, jobPath, cabinetId: match.id, label: `${jobPath}/Cabinet ${id}` }); return; }
      }
    }
    if (jobs[0]) pickJob(jobs[0]);
  };

  const pick = (t: SearchTarget) => { setOpen(false); onSelect(t); };
  const pickJob = (j: JobRow) => pick({ kind: 'job', jobNumber: j.job_number, jobPath: j.job_path ?? null, label: jobLabel(j) });

  const hasResults = jobs.length + files.length + cabs.length > 0;

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', height: 46, borderRadius: 11, background: 'var(--bg-1)', border: '1px solid rgba(255,255,255,0.1)' }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input
          value={q} autoFocus={autoFocus}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitPath(); if (e.key === 'Escape') setOpen(false); }}
          placeholder={placeholder}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit' }}
        />
        {q && <button onClick={() => { setQ(''); setOpen(false); }} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 16, padding: 0 }} aria-label="Clear">×</button>}
      </div>

      {open && q.trim() && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, zIndex: 50, maxHeight: 380, overflowY: 'auto', background: 'var(--bg-2)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 11, boxShadow: '0 12px 40px rgba(0,0,0,0.5)' }}>
          {loading && !hasResults && <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-mute)' }}>Searching…</div>}
          {!loading && !hasResults && <div style={{ padding: 16, fontSize: 13, color: 'var(--ink-mute)' }}>No matches for &ldquo;{q}&rdquo;.</div>}

          {jobs.length > 0 && <SectionLabel>Jobs</SectionLabel>}
          {jobs.map((j, i) => (
            <Row key={`j${i}`} onClick={() => pickJob(j)} icon="job" title={jobLabel(j)} sub={j.job_number ? `#${j.job_number}` : undefined} />
          ))}

          {files.length > 0 && <SectionLabel>Files</SectionLabel>}
          {files.map((f) => (
            <Row key={f.id} icon={f.file_type === 'csv' ? 'csv' : 'file'}
              title={f.label || f.file_name || 'Untitled'}
              sub={[f.job_number ? `#${f.job_number}` : null, f.file_type === 'csv' && f.parsed ? 'parsed' : null].filter(Boolean).join(' · ') || undefined}
              onClick={() => f.file_url && pick({ kind: 'file', url: f.file_url, name: f.file_name || f.label || 'file', fileType: f.file_type, parsed: !!f.parsed, jobPath: f.job_path ?? null, jobNumber: f.job_number, label: f.label || f.file_name || 'file' })}
            />
          ))}

          {cabs.length > 0 && <SectionLabel>Cabinets</SectionLabel>}
          {cabs.map((c) => (
            <Row key={c.id} icon="cabinet"
              title={c.unit_label || c.cabinet_number || 'Cabinet'}
              sub={[c.job_number ? `#${c.job_number}` : null, c.room_number ? `Room ${c.room_number}` : null].filter(Boolean).join(' · ') || undefined}
              onClick={() => pick({ kind: 'cabinet', jobNumber: c.job_number, jobPath: null, cabinetId: c.id, label: c.unit_label || c.cabinet_number || 'Cabinet' })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '9px 14px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{children}</div>;
}

function Row({ icon, title, sub, onClick }: { icon: 'job' | 'file' | 'csv' | 'cabinet'; title: string; sub?: string; onClick?: () => void }) {
  const glyph = {
    job:     <path d="M3 7h18M3 7v12a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />,
    file:    <path d="M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />,
    csv:     <path d="M4 5h16M4 12h16M4 19h16M9 5v14M15 5v14" />,
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
