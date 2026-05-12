'use client';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

type ClockEntry = {
  id: string;
  worker_name: string | null;
  dept: string | null;
  clock_in: string;
  clock_out: string | null;
  date: string | null;
  total_hours: number | null;
  notes: string | null;
  job_number: string | null;
  status: string | null;
};

type DamageRow = {
  id: string;
  part_name: string;
  dept: string | null;
  notes: string | null;
  photo_url: string | null;
  status: string | null;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolution_cost: number | null;
  resolved_at: string | null;
  created_at: string;
};

type PartRow = {
  id: string;
  worker_name: string | null;
  job_number: string | null;
  part_name: string;
  dept: string | null;
  status: string;
  notes: string | null;
  created_at: string;
};

type NeedRow = {
  id: string;
  item: string;
  dept: string | null;
  job_number: string | null;
  qty: number | null;
  status: string | null;
  created_at: string;
};

type JobRow = { id: string; job_number: string; job_name: string | null };
type SortDir = 'asc' | 'desc';
type ReportKey = 'daily' | 'job' | 'weekly' | 'craftsman' | 'damage' | 'inventory' | 'parts';

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function toISO(d: Date) { return d.toISOString().split('T')[0]; }
function todayISO() { return toISO(new Date()); }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); }

function weekStart(ref = new Date()): string {
  const d = new Date(ref);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return toISO(d);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso); d.setDate(d.getDate() + n); return toISO(d);
}

function toHHMM(h: number | null): string {
  if (!h || h <= 0) return '0h 00m';
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  return `${hrs}h ${String(min).padStart(2, '0')}m`;
}

function calcHours(clockIn: string, clockOut: string | null): number {
  return (((clockOut ? new Date(clockOut) : new Date()).getTime()) - new Date(clockIn).getTime()) / 3_600_000;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const esc = (v: string | number | null | undefined) =>
    `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

const inputSt: React.CSSProperties = {
  background: '#0E1818', color: 'var(--ink)',
  border: '1px solid var(--line-strong)', borderRadius: 8,
  padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
};
const thSt: React.CSSProperties = {
  padding: '9px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700,
  letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--ink-mute)',
  borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', cursor: 'default',
};
const tdSt: React.CSSProperties  = { padding: '10px 16px', fontSize: 13, color: 'var(--ink-dim)', borderBottom: '1px solid var(--line)' };
const tdBold: React.CSSProperties = { ...tdSt, fontWeight: 700, color: 'var(--ink)' };

function ExportBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
      background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)',
      color: 'var(--teal)', cursor: 'pointer', fontFamily: 'inherit',
    }}>
      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export CSV
    </button>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <div style={{ padding: '32px 20px', textAlign: 'center', fontSize: 13, color: 'var(--ink-mute)' }}>{msg}</div>;
}

function LoadingRows({ cols }: { cols: number }) {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <tr key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} style={{ padding: '11px 16px' }}>
              <div style={{ height: 12, borderRadius: 4, background: 'rgba(255,255,255,0.04)', width: j === 0 ? '80%' : '55%' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function SortTh({ label, col, sortCol, sortDir, onSort }: {
  label: string; col: string; sortCol: string; sortDir: SortDir; onSort: (c: string) => void;
}) {
  const active = sortCol === col;
  return (
    <th onClick={() => onSort(col)} style={{
      ...thSt, cursor: 'pointer', userSelect: 'none',
      color: active ? 'var(--teal)' : 'var(--ink-mute)',
    }}>
      {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  );
}

function DateRange({ start, end, onStart, onEnd }: {
  start: string; end: string;
  onStart: (v: string) => void; onEnd: (v: string) => void;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>From</label>
        <input type="date" value={start} onChange={(e) => onStart(e.target.value)} style={inputSt} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>To</label>
        <input type="date" value={end} onChange={(e) => onEnd(e.target.value)} style={inputSt} />
      </div>
    </>
  );
}

function StatusPill({ status }: { status: string | null }) {
  const s = (status ?? '').toLowerCase().replace(/\s+/g, '_');
  const MAP: Record<string, { c: string; bg: string }> = {
    open:        { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
    pending:     { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
    ordered:     { c: '#5EEAD4', bg: 'rgba(94,234,212,0.12)' },
    reviewed:    { c: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
    resolved:    { c: '#34D399', bg: 'rgba(52,211,153,0.12)' },
    received:    { c: '#34D399', bg: 'rgba(52,211,153,0.12)' },
    passed_qc:   { c: '#34D399', bg: 'rgba(52,211,153,0.12)' },
    in_progress: { c: '#5EEAD4', bg: 'rgba(94,234,212,0.12)' },
    failed_qc:   { c: '#F87171', bg: 'rgba(248,113,113,0.12)' },
    on_hold:     { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
    cancelled:   { c: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' },
  };
  const t = MAP[s] ?? { c: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' };
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: t.c, background: t.bg, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
      {(status ?? '—').replace(/_/g, ' ')}
    </span>
  );
}

function MetricTile({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="portal-card" style={{ padding: '16px 20px' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color, letterSpacing: '-0.02em' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{label}</div>
    </div>
  );
}

// ── Timeline helpers ──────────────────────────────────────────────────────────

const DAY_START = 6;   // 6 AM
const DAY_END   = 18;  // 6 PM
const DAY_MINS  = (DAY_END - DAY_START) * 60;

function timePct(isoTime: string): number {
  const d = new Date(isoTime);
  const mins = d.getHours() * 60 + d.getMinutes() - DAY_START * 60;
  return Math.min(100, Math.max(0, (mins / DAY_MINS) * 100));
}

function segColor(e: ClockEntry): string {
  if (e.status === 'craftsman_build') return '#A78BFA';
  if (e.job_number) return '#2DE1C9';
  return '#FBBF24';
}

function segLabel(e: ClockEntry): string {
  if (e.job_number) return `Job ${e.job_number}`;
  if (e.status === 'craftsman_build') return (e.notes ?? 'Craftsman').split(' ').slice(0, 3).join(' ');
  return (e.notes ?? e.dept ?? 'Activity').split(' ').slice(0, 3).join(' ');
}

// ── WorkerTimeline ────────────────────────────────────────────────────────────

function WorkerTimeline({ entries, workerName }: { entries: ClockEntry[]; workerName: string }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...entries].sort((a, b) => new Date(a.clock_in).getTime() - new Date(b.clock_in).getTime());

  const totalHours = sorted.reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);
  const pct = Math.round(Math.min(100, (totalHours / (DAY_MINS / 60)) * 100));
  const pctColor = pct >= 90 ? '#34D399' : pct >= 70 ? '#FBBF24' : '#F87171';

  const dayLabel = sorted[0]
    ? new Date(sorted[0].clock_in).toLocaleDateString('en-US', { weekday: 'long' })
    : '';

  return (
    <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', letterSpacing: '0.04em' }}>{workerName.toUpperCase()}</span>
          {dayLabel && <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>· {dayLabel}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--ink-dim)' }}>
            <strong style={{ color: pctColor }}>{toHHMM(totalHours)} logged</strong>
            {' · '}
            <span style={{ color: 'var(--ink-mute)' }}>{pct}% accounted</span>
          </span>
          {pct >= 100 && (
            <span style={{ fontSize: 10, color: '#34D399', background: 'rgba(52,211,153,0.12)', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
              ✓ Auto-tracked
            </span>
          )}
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round"
            style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </button>

      {/* Bar */}
      <div style={{ padding: '0 16px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          {['6AM', '8AM', '10AM', '12PM', '2PM', '4PM', '6PM'].map((l) => (
            <span key={l} style={{ fontSize: 9, color: 'var(--ink-mute)', userSelect: 'none' }}>{l}</span>
          ))}
        </div>
        <div style={{ position: 'relative', height: 28, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ position: 'absolute', top: 0, bottom: 0, left: `${(i / 6) * 100}%`, width: 1, background: 'rgba(255,255,255,0.05)' }} />
          ))}
          {sorted.map((e) => {
            const l = timePct(e.clock_in);
            const r = timePct(e.clock_out ?? new Date().toISOString());
            const w = Math.max(0.4, r - l);
            const color = segColor(e);
            return (
              <div key={e.id}
                title={`${segLabel(e)} · ${fmtTime(e.clock_in)} – ${e.clock_out ? fmtTime(e.clock_out) : 'now'}`}
                style={{
                  position: 'absolute', top: 2, bottom: 2, left: `${l}%`, width: `${w}%`,
                  background: color, borderRadius: 4, overflow: 'hidden',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: `0 0 6px ${color}40`,
                }}
              >
                {w > 7 && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#050608', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px', maxWidth: '100%', userSelect: 'none' }}>
                    {w > 14 ? segLabel(e) : (e.job_number ?? '')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Event log */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--line)' }}>
          {sorted.map((e, idx) => {
            const color = segColor(e);
            const typeLabel = e.status === 'craftsman_build' ? 'CRAFTSMAN BUILD' : e.job_number ? 'SCAN' : 'QUICK SWITCH';
            return (
              <div key={e.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, padding: '9px 16px',
                background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
                borderBottom: idx < sorted.length - 1 ? '1px solid var(--line)' : 'none',
              }}>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)', minWidth: 80, flexShrink: 0 }}>
                  {fmtTime(e.clock_in)}{e.clock_out ? ` – ${fmtTime(e.clock_out)}` : ''}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: `${color}18`, color, flexShrink: 0, marginTop: 1, letterSpacing: '0.06em' }}>
                  {typeLabel}
                </span>
                <span style={{ fontSize: 13, color: 'var(--ink-dim)', flex: 1 }}>
                  {segLabel(e)}
                  {e.notes && e.notes !== segLabel(e) && (
                    <span style={{ color: 'var(--ink-mute)', marginLeft: 8, fontSize: 12 }}>{e.notes}</span>
                  )}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)', flexShrink: 0 }}>
                  {toHHMM(e.total_hours ?? calcHours(e.clock_in, e.clock_out))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Productivity metrics bar ──────────────────────────────────────────────────

function DailyMetrics({ entries }: { entries: ClockEntry[] }) {
  const byWorker: Record<string, ClockEntry[]> = {};
  entries.forEach((e) => {
    const n = e.worker_name ?? 'Unknown';
    if (!byWorker[n]) byWorker[n] = [];
    byWorker[n].push(e);
  });
  const workers = Object.keys(byWorker);
  const totalHours = entries.reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);
  const avgHours = workers.length > 0 ? totalHours / workers.length : 0;
  const full = workers.filter((w) => {
    const h = byWorker[w].reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);
    return h / (DAY_MINS / 60) >= 0.9;
  }).length;
  const pctFull = workers.length > 0 ? Math.round((full / workers.length) * 100) : 0;
  const jobHrs: Record<string, number> = {};
  entries.forEach((e) => { if (e.job_number) jobHrs[e.job_number] = (jobHrs[e.job_number] ?? 0) + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)); });
  const topJobs = Object.entries(jobHrs).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const maxJobHrs = topJobs[0]?.[1] ?? 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 2fr', gap: 12, marginBottom: 4 }}>
      <MetricTile label="Total Hours" value={toHHMM(totalHours)} color="#2DE1C9" />
      <MetricTile label="Avg / Worker" value={toHHMM(avgHours)} color="#5EEAD4" />
      <MetricTile label="≥90% Accounted" value={`${pctFull}%`} color={pctFull >= 90 ? '#34D399' : pctFull >= 70 ? '#FBBF24' : '#F87171'} />
      <div className="portal-card" style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Top Jobs</div>
        {topJobs.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No job numbers logged</div>
          : topJobs.map(([job, hrs]) => (
            <div key={job} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, color: 'var(--ink-dim)', fontWeight: 600 }}>Job {job}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{toHHMM(hrs)}</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${(hrs / maxJobHrs) * 100}%`, background: '#2DE1C9', borderRadius: 3 }} />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

// ── 1. Daily Labor ────────────────────────────────────────────────────────────

function DailyLaborReport({ tenantId, showToast }: Props) {
  const [date, setDate]       = useState(todayISO);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState('clock_in');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const onSort = useCallback((col: string) => {
    setSortDir((d) => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortCol(col);
  }, [sortCol]);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('time_clock')
      .select('id, worker_name, dept, clock_in, clock_out, date, total_hours, notes, job_number, status')
      .eq('tenant_id', tenantId)
      .eq('date', date)
      .order('clock_in', { ascending: true })
      .then(({ data, error }) => {
        if (error) showToast(error.message, true);
        else setEntries((data as ClockEntry[]) ?? []);
        setLoading(false);
      });
  }, [tenantId, date, showToast]);

  const byWorker = useMemo(() => {
    const m: Record<string, ClockEntry[]> = {};
    entries.forEach((e) => {
      const n = e.worker_name ?? 'Unknown';
      if (!m[n]) m[n] = [];
      m[n].push(e);
    });
    return m;
  }, [entries]);

  const totalHours = entries.reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      const get = (e: ClockEntry): string | number => {
        if (sortCol === 'worker') return e.worker_name ?? '';
        if (sortCol === 'dept')   return e.dept ?? '';
        if (sortCol === 'hours')  return e.total_hours ?? calcHours(e.clock_in, e.clock_out);
        if (sortCol === 'job')    return e.job_number ?? '';
        return e.clock_in;
      };
      const av = get(a), bv = get(b);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entries, sortCol, sortDir]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{`@keyframes rpt-spin{to{transform:rotate(360deg)}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputSt} />
        </div>
        <ExportBtn onClick={() => downloadCSV(`daily-labor_${date}.csv`,
          ['Worker', 'Dept', 'Clock In', 'Clock Out', 'Hours', 'Job #', 'Type', 'Notes'],
          entries.map((e) => [e.worker_name ?? '', e.dept ?? '', fmtTime(e.clock_in), e.clock_out ? fmtTime(e.clock_out) : 'Active',
            (e.total_hours ?? calcHours(e.clock_in, e.clock_out)).toFixed(2), e.job_number ?? '', e.status ?? '', e.notes ?? '']))} />
      </div>

      {!loading && entries.length > 0 && <DailyMetrics entries={entries} />}

      {!loading && Object.keys(byWorker).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Worker Timelines</div>
          {Object.entries(byWorker).map(([name, ents]) => (
            <WorkerTimeline key={name} entries={ents} workerName={name} />
          ))}
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>All Entries</span>
          {!loading && <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{entries.length} entries · {toHHMM(totalHours)} total</span>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Worker"   col="worker"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Dept"     col="dept"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Clock In" col="clock_in" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Clock Out</th>
                <SortTh label="Hours"    col="hours"    sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Job #"    col="job"      sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Type</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows cols={7} /> : sortedEntries.length === 0 ? (
                <tr><td colSpan={7}><EmptyState msg="No clock entries for this date." /></td></tr>
              ) : (
                <>
                  {sortedEntries.map((e, i) => (
                    <tr key={e.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                      <td style={tdBold}>{e.worker_name ?? '—'}</td>
                      <td style={tdSt}>{e.dept ?? '—'}</td>
                      <td style={tdSt}>{fmtTime(e.clock_in)}</td>
                      <td style={tdSt}>{e.clock_out ? fmtTime(e.clock_out) : <span style={{ color: '#2DE1C9' }}>Active</span>}</td>
                      <td style={tdSt}>{toHHMM(e.total_hours ?? calcHours(e.clock_in, e.clock_out))}</td>
                      <td style={tdSt}>{e.job_number ? <code style={{ fontSize: 12 }}>{e.job_number}</code> : '—'}</td>
                      <td style={tdSt}><StatusPill status={e.status ?? 'active'} /></td>
                    </tr>
                  ))}
                  <tr style={{ background: 'rgba(45,225,201,0.04)', borderTop: '2px solid var(--line)' }}>
                    <td style={{ ...tdBold, color: 'var(--teal)' }} colSpan={4}>Total</td>
                    <td style={{ ...tdBold, color: 'var(--teal)' }}>{toHHMM(totalHours)}</td>
                    <td colSpan={2} />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 2. Job Cost ───────────────────────────────────────────────────────────────

function JobCostReport({ tenantId, showToast }: Props) {
  const [jobs,    setJobs]    = useState<JobRow[]>([]);
  const [selJob,  setSelJob]  = useState('');
  const [clock,   setClock]   = useState<ClockEntry[]>([]);
  const [parts,   setParts]   = useState<PartRow[]>([]);
  const [damage,  setDamage]  = useState<DamageRow[]>([]);
  const [needs,   setNeeds]   = useState<NeedRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('jobs').select('id, job_number, job_name').eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => {
        const rows = (data as JobRow[]) ?? [];
        setJobs(rows);
        if (rows[0]) setSelJob(rows[0].job_number);
      });
  }, [tenantId]);

  useEffect(() => {
    if (!selJob) return;
    setLoading(true);
    Promise.all([
      supabase.from('time_clock').select('id, worker_name, dept, clock_in, clock_out, date, total_hours, notes, job_number, status')
        .eq('tenant_id', tenantId).eq('job_number', selJob).order('clock_in'),
      supabase.from('parts_log').select('id, worker_name, job_number, part_name, dept, status, notes, created_at')
        .eq('tenant_id', tenantId).eq('job_number', selJob).order('created_at'),
      supabase.from('damage_reports').select('id, part_name, dept, notes, photo_url, status, resolution_type, resolution_notes, resolved_by, resolution_cost, resolved_at, created_at')
        .eq('tenant_id', tenantId).eq('job_id', selJob).order('created_at'),
      supabase.from('inventory_needs').select('id, item, dept, job_number, qty, status, created_at')
        .eq('tenant_id', tenantId).eq('job_number', selJob).order('created_at'),
    ]).then(([c, p, d, n]) => {
      setClock((c.data as ClockEntry[]) ?? []);
      setParts((p.data as PartRow[]) ?? []);
      setDamage((d.data as DamageRow[]) ?? []);
      setNeeds((n.data as NeedRow[]) ?? []);
      setLoading(false);
    }).catch((err: unknown) => {
      showToast(err instanceof Error ? err.message : 'Load failed', true);
      setLoading(false);
    });
  }, [tenantId, selJob, showToast]);

  const workerTotals = useMemo(() => {
    const m: Record<string, { hours: number; dept: string; days: Set<string | null> }> = {};
    clock.forEach((e) => {
      const n = e.worker_name ?? 'Unknown';
      if (!m[n]) m[n] = { hours: 0, dept: e.dept ?? '—', days: new Set() };
      m[n].hours += e.total_hours ?? calcHours(e.clock_in, e.clock_out);
      m[n].days.add(e.date);
    });
    return Object.entries(m).map(([name, v]) => ({ name, ...v, days: v.days.size }))
      .sort((a, b) => b.hours - a.hours);
  }, [clock]);

  const grandTotal = workerTotals.reduce((s, w) => s + w.hours, 0);

  const SubCard = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
    <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>{title} ({count})</span>
      </div>
      {count === 0 ? <EmptyState msg={`No ${title.toLowerCase()} for this job.`} /> : children}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>Job</label>
          <select value={selJob} onChange={(e) => setSelJob(e.target.value)} style={{ ...inputSt, cursor: 'pointer', minWidth: 200 }}>
            <option value="">— select a job —</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.job_number}>{j.job_number}{j.job_name ? ` · ${j.job_name}` : ''}</option>
            ))}
          </select>
        </div>
        {selJob && <ExportBtn onClick={() => downloadCSV(`job-cost_${selJob}.csv`,
          ['Worker', 'Dept', 'Days', 'Hours'], workerTotals.map((w) => [w.name, w.dept, w.days, w.hours.toFixed(2)]))} />}
      </div>

      {!selJob && <EmptyState msg="Select a job above to view its cost report." />}

      {selJob && (
        <>
          {/* Labor */}
          <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Labor Hours</span>
              {!loading && <span style={{ fontSize: 13, fontWeight: 700, color: '#2DE1C9' }}>{toHHMM(grandTotal)} total</span>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['Worker', 'Dept', 'Days', 'Total Hours', 'Share'].map((h) => <th key={h} style={thSt}>{h}</th>)}</tr></thead>
                <tbody>
                  {loading ? <LoadingRows cols={5} /> : workerTotals.length === 0
                    ? <tr><td colSpan={5}><EmptyState msg="No labor recorded for this job." /></td></tr>
                    : <>
                      {workerTotals.map((w, i) => (
                        <tr key={w.name} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                          <td style={tdBold}>{w.name}</td>
                          <td style={tdSt}>{w.dept}</td>
                          <td style={tdSt}>{w.days}d</td>
                          <td style={tdSt}>{toHHMM(w.hours)}</td>
                          <td style={{ ...tdSt, minWidth: 120 }}>
                            <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)' }}>
                              <div style={{ height: '100%', width: `${grandTotal > 0 ? (w.hours / grandTotal) * 100 : 0}%`, background: '#2DE1C9', borderRadius: 3 }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                      <tr style={{ background: 'rgba(45,225,201,0.04)', borderTop: '2px solid var(--line)' }}>
                        <td style={{ ...tdBold, color: 'var(--teal)' }} colSpan={3}>Grand Total</td>
                        <td style={{ ...tdBold, color: 'var(--teal)' }}>{toHHMM(grandTotal)}</td>
                        <td />
                      </tr>
                    </>}
                </tbody>
              </table>
            </div>
          </div>

          {!loading && (
            <>
              <SubCard title="Parts & QC" count={parts.length}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Date', 'Part', 'Dept', 'Worker', 'Status'].map((h) => <th key={h} style={thSt}>{h}</th>)}</tr></thead>
                    <tbody>{parts.map((p, i) => (
                      <tr key={p.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                        <td style={tdSt}>{fmtDate(p.created_at)}</td><td style={tdBold}>{p.part_name}</td>
                        <td style={tdSt}>{p.dept ?? '—'}</td><td style={tdSt}>{p.worker_name ?? '—'}</td>
                        <td style={tdSt}><StatusPill status={p.status} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </SubCard>

              <SubCard title="Damage Reports" count={damage.length}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Date', 'Part', 'Dept', 'Status', 'Cost'].map((h) => <th key={h} style={thSt}>{h}</th>)}</tr></thead>
                    <tbody>{damage.map((d, i) => (
                      <tr key={d.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                        <td style={tdSt}>{fmtDate(d.created_at)}</td><td style={tdBold}>{d.part_name}</td>
                        <td style={tdSt}>{d.dept ?? '—'}</td><td style={tdSt}><StatusPill status={d.status} /></td>
                        <td style={tdSt}>{d.resolution_cost != null ? `$${d.resolution_cost.toFixed(2)}` : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </SubCard>

              <SubCard title="Inventory Needs" count={needs.length}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr>{['Date', 'Item', 'Dept', 'Qty', 'Status'].map((h) => <th key={h} style={thSt}>{h}</th>)}</tr></thead>
                    <tbody>{needs.map((n, i) => (
                      <tr key={n.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                        <td style={tdSt}>{fmtDate(n.created_at)}</td><td style={tdBold}>{n.item}</td>
                        <td style={tdSt}>{n.dept ?? '—'}</td><td style={tdSt}>{n.qty ?? 1}</td>
                        <td style={tdSt}><StatusPill status={n.status} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </SubCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── 3. Weekly Summary ─────────────────────────────────────────────────────────

function WeeklySummaryReport({ tenantId, showToast }: Props) {
  const [wkStart, setWkStart] = useState(() => weekStart());
  const [clock,   setClock]   = useState<ClockEntry[]>([]);
  const [damage,  setDamage]  = useState<DamageRow[]>([]);
  const [needs,   setNeeds]   = useState<NeedRow[]>([]);
  const [loading, setLoading] = useState(false);

  const wkEnd = useMemo(() => addDays(wkStart, 6), [wkStart]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      supabase.from('time_clock').select('id, worker_name, dept, clock_in, clock_out, date, total_hours, notes, job_number, status')
        .eq('tenant_id', tenantId).gte('date', wkStart).lte('date', wkEnd).order('clock_in'),
      supabase.from('damage_reports').select('id, part_name, dept, notes, photo_url, status, resolution_type, resolution_notes, resolved_by, resolution_cost, resolved_at, created_at')
        .eq('tenant_id', tenantId),
      supabase.from('inventory_needs').select('id, item, dept, job_number, qty, status, created_at')
        .eq('tenant_id', tenantId),
    ]).then(([c, d, n]) => {
      setClock((c.data as ClockEntry[]) ?? []);
      setDamage(((d.data as DamageRow[]) ?? []).filter((r) => !['resolved', 'closed'].includes((r.status ?? '').toLowerCase())));
      setNeeds(((n.data as NeedRow[]) ?? []).filter((r) => !['received', 'cancelled'].includes((r.status ?? '').toLowerCase())));
      setLoading(false);
    }).catch((err: unknown) => { showToast(err instanceof Error ? err.message : 'Load failed', true); setLoading(false); });
  }, [tenantId, wkStart, wkEnd, showToast]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const iso = addDays(wkStart, i);
    const ents = clock.filter((e) => e.date === iso);
    const hours = ents.reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);
    return {
      iso,
      label: new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      short: new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      workers: new Set(ents.map((e) => e.worker_name)).size,
      hours,
      jobs: new Set(ents.filter((e) => e.job_number).map((e) => e.job_number)).size,
    };
  }), [wkStart, clock]);

  const maxDayHrs = Math.max(1, ...days.map((d) => d.hours));
  const weekTotal = days.reduce((s, d) => s + d.hours, 0);

  const jobHrs: Record<string, number> = {};
  clock.forEach((e) => { if (e.job_number) jobHrs[e.job_number] = (jobHrs[e.job_number] ?? 0) + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)); });
  const topJobs = Object.entries(jobHrs).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxJH = topJobs[0]?.[1] ?? 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600 }}>Week of</label>
          <input type="date" value={wkStart} onChange={(e) => setWkStart(e.target.value)} style={inputSt} />
        </div>
        <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
          — {new Date(wkEnd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        <ExportBtn onClick={() => downloadCSV(`weekly-summary_${wkStart}.csv`,
          ['Day', 'Crew Count', 'Total Hours', 'Jobs Active'],
          days.map((d) => [d.label, d.workers, d.hours.toFixed(2), d.jobs]))} />
      </div>

      {/* Day bars */}
      <div className="portal-card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
          Daily Breakdown — {toHHMM(weekTotal)} total
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 110 }}>
          {days.map((d) => {
            const pct = d.hours / maxDayHrs;
            const barH = Math.max(loading ? 4 : 0, pct * 80);
            const color = d.hours === 0 ? 'rgba(255,255,255,0.06)' : pct >= 0.75 ? '#34D399' : pct >= 0.4 ? '#FBBF24' : '#F87171';
            return (
              <div key={d.iso} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <span style={{ fontSize: 9, color: 'var(--ink-mute)' }}>{d.hours > 0 ? toHHMM(d.hours) : ''}</span>
                <div title={`${d.label}: ${d.workers} crew, ${toHHMM(d.hours)}, ${d.jobs} jobs`}
                  style={{ width: '100%', height: barH, background: color, borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
                <span style={{ fontSize: 9, color: 'var(--ink-mute)', textAlign: 'center' }}>{d.short}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top jobs */}
      <div className="portal-card" style={{ padding: '16px 20px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Top Jobs This Week</div>
        {topJobs.length === 0
          ? <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No job numbers logged this week.</div>
          : topJobs.map(([job, hrs]) => (
            <div key={job} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--ink-dim)', fontWeight: 600 }}>Job {job}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{toHHMM(hrs)}</span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${(hrs / maxJH) * 100}%`, background: '#2DE1C9', borderRadius: 4 }} />
              </div>
            </div>
          ))}
      </div>

      {/* Open issues */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { title: 'Open Damage', items: damage.slice(0, 6), color: '#F87171', getLabel: (r: DamageRow) => r.part_name, getStatus: (r: DamageRow) => r.status },
          { title: 'Pending Inventory', items: needs.slice(0, 6), color: '#FBBF24', getLabel: (r: NeedRow) => r.item, getStatus: (r: NeedRow) => r.status },
        ].map(({ title, items, color, getLabel, getStatus }) => (
          <div key={title} className="portal-card" style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color, marginBottom: 10 }}>
              {title} ({items.length})
            </div>
            {items.length === 0
              ? <div style={{ fontSize: 12, color: '#34D399' }}>All clear ✓</div>
              : items.map((r) => (
                <div key={(r as { id: string }).id} style={{ fontSize: 12, color: 'var(--ink-dim)', padding: '5px 0', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{getLabel(r as never)}</span>
                  <StatusPill status={getStatus(r as never)} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 4. Craftsman Build ────────────────────────────────────────────────────────

function CraftsmanBuildReport({ tenantId, showToast }: Props) {
  const [start,   setStart]   = useState(() => daysAgo(30));
  const [end,     setEnd]     = useState(todayISO);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState('clock_in');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const onSort = useCallback((col: string) => { setSortDir((d) => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); setSortCol(col); }, [sortCol]);

  useEffect(() => {
    setLoading(true);
    supabase.from('time_clock')
      .select('id, worker_name, dept, clock_in, clock_out, date, total_hours, notes, job_number, status')
      .eq('tenant_id', tenantId).eq('status', 'craftsman_build')
      .gte('date', start).lte('date', end).order('clock_in', { ascending: false })
      .then(({ data, error }) => {
        if (error) showToast(error.message, true);
        else setEntries((data as ClockEntry[]) ?? []);
        setLoading(false);
      });
  }, [tenantId, start, end, showToast]);

  const totalHours = entries.reduce((s, e) => s + (e.total_hours ?? calcHours(e.clock_in, e.clock_out)), 0);

  const sorted = useMemo(() => [...entries].sort((a, b) => {
    const get = (e: ClockEntry): string | number => {
      if (sortCol === 'worker') return e.worker_name ?? '';
      if (sortCol === 'hours')  return e.total_hours ?? calcHours(e.clock_in, e.clock_out);
      if (sortCol === 'job')    return e.job_number ?? '';
      return e.clock_in;
    };
    const cmp = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }), [entries, sortCol, sortDir]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <ExportBtn onClick={() => downloadCSV(`craftsman-build_${start}_${end}.csv`,
          ['Date', 'Worker', 'Material Description', 'Job #', 'Hours'],
          entries.map((e) => [e.date ?? fmtDate(e.clock_in), e.worker_name ?? '', e.notes ?? '', e.job_number ?? '', (e.total_hours ?? calcHours(e.clock_in, e.clock_out)).toFixed(2)]))} />
      </div>

      {!loading && entries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <MetricTile label="Total Hours"    value={toHHMM(totalHours)}                             color="#A78BFA" />
          <MetricTile label="Build Sessions" value={String(entries.length)}                          color="#5EEAD4" />
          <MetricTile label="Workers"        value={String(new Set(entries.map((e) => e.worker_name)).size)} color="#FBBF24" />
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Date"        col="clock_in" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Worker"      col="worker"   sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Material Description</th>
                <SortTh label="Job #"       col="job"      sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Hours"       col="hours"    sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows cols={5} /> : sorted.length === 0 ? (
                <tr><td colSpan={5}><EmptyState msg="No craftsman build entries for this period." /></td></tr>
              ) : (
                <>
                  {sorted.map((e, i) => (
                    <tr key={e.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                      <td style={tdSt}>{e.date ? new Date(e.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : fmtDate(e.clock_in)}</td>
                      <td style={tdBold}>{e.worker_name ?? '—'}</td>
                      <td style={tdSt}>{e.notes ?? '—'}</td>
                      <td style={tdSt}>{e.job_number ? <code style={{ fontSize: 12 }}>{e.job_number}</code> : '—'}</td>
                      <td style={tdSt}>{toHHMM(e.total_hours ?? calcHours(e.clock_in, e.clock_out))}</td>
                    </tr>
                  ))}
                  <tr style={{ background: 'rgba(167,139,250,0.06)', borderTop: '2px solid var(--line)' }}>
                    <td style={{ ...tdBold, color: '#A78BFA' }} colSpan={4}>Total</td>
                    <td style={{ ...tdBold, color: '#A78BFA' }}>{toHHMM(totalHours)}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 5. Damage Log ─────────────────────────────────────────────────────────────

function DamageReportLog({ tenantId, showToast }: Props) {
  const [start,    setStart]    = useState(() => daysAgo(30));
  const [end,      setEnd]      = useState(todayISO);
  const [filter,   setFilter]   = useState('all');
  const [rows,     setRows]     = useState<DamageRow[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [sortCol,  setSortCol]  = useState('created_at');
  const [sortDir,  setSortDir]  = useState<SortDir>('desc');
  const onSort = useCallback((col: string) => { setSortDir((d) => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); setSortCol(col); }, [sortCol]);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from('damage_reports')
      .select('id, part_name, dept, notes, photo_url, status, resolution_type, resolution_notes, resolved_by, resolution_cost, resolved_at, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', `${start}T00:00:00`).lte('created_at', `${end}T23:59:59`)
      .order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    q.then(({ data, error }) => {
      if (error) showToast(error.message, true);
      else setRows((data as DamageRow[]) ?? []);
      setLoading(false);
    });
  }, [tenantId, start, end, filter, showToast]);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const get = (r: DamageRow): string | number => {
      if (sortCol === 'part')   return r.part_name;
      if (sortCol === 'dept')   return r.dept ?? '';
      if (sortCol === 'status') return r.status ?? '';
      if (sortCol === 'cost')   return r.resolution_cost ?? 0;
      return r.created_at;
    };
    const cmp = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }), [rows, sortCol, sortDir]);

  const totalCost = rows.reduce((s, r) => s + (r.resolution_cost ?? 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
          <option value="resolved">Resolved</option>
        </select>
        <ExportBtn onClick={() => downloadCSV(`damage-log_${start}_${end}.csv`,
          ['Date', 'Part', 'Dept', 'Status', 'Resolution Type', 'Notes', 'Resolved By', 'Cost'],
          rows.map((r) => [fmtDateTime(r.created_at), r.part_name, r.dept ?? '', r.status ?? '', r.resolution_type ?? '', r.notes ?? '', r.resolved_by ?? '', r.resolution_cost?.toFixed(2) ?? '']))} />
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ fontSize: 13, color: 'var(--ink-mute)', display: 'flex', gap: 16 }}>
          <span>{rows.length} reports</span>
          {totalCost > 0 && <span style={{ color: '#F87171', fontWeight: 700 }}>${totalCost.toFixed(2)} total resolution cost</span>}
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Date"       col="created_at" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Part"       col="part"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Dept"       col="dept"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Status"     col="status"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Resolution</th>
                <th style={thSt}>Resolved By</th>
                <SortTh label="Cost"       col="cost"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Photo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows cols={8} /> : sorted.length === 0 ? (
                <tr><td colSpan={8}><EmptyState msg="No damage reports for this period." /></td></tr>
              ) : sorted.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  <td style={tdSt}>{fmtDate(r.created_at)}</td>
                  <td style={tdBold}>{r.part_name}{r.notes && <span style={{ color: 'var(--ink-mute)', fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{r.notes}</span>}</td>
                  <td style={tdSt}>{r.dept ?? '—'}</td>
                  <td style={tdSt}><StatusPill status={r.status} /></td>
                  <td style={tdSt}>{r.resolution_type ?? '—'}{r.resolution_notes && <span style={{ color: 'var(--ink-mute)', display: 'block', fontSize: 11 }}>{r.resolution_notes}</span>}</td>
                  <td style={tdSt}>{r.resolved_by ?? '—'}</td>
                  <td style={tdSt}>{r.resolution_cost != null ? `$${r.resolution_cost.toFixed(2)}` : '—'}</td>
                  <td style={tdSt}>{r.photo_url
                    ? <a href={r.photo_url} target="_blank" rel="noopener noreferrer"><img src={r.photo_url} alt="" style={{ width: 42, height: 32, objectFit: 'cover', borderRadius: 4 }} /></a>
                    : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 6. Inventory ──────────────────────────────────────────────────────────────

function InventoryReport({ tenantId, showToast }: Props) {
  const [start,   setStart]   = useState(() => daysAgo(30));
  const [end,     setEnd]     = useState(todayISO);
  const [filter,  setFilter]  = useState('all');
  const [rows,    setRows]    = useState<NeedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const onSort = useCallback((col: string) => { setSortDir((d) => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); setSortCol(col); }, [sortCol]);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from('inventory_needs')
      .select('id, item, dept, job_number, qty, status, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', `${start}T00:00:00`).lte('created_at', `${end}T23:59:59`)
      .order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    q.then(({ data, error }) => {
      if (error) showToast(error.message, true);
      else setRows((data as NeedRow[]) ?? []);
      setLoading(false);
    });
  }, [tenantId, start, end, filter, showToast]);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const get = (r: NeedRow): string | number => {
      if (sortCol === 'item')   return r.item;
      if (sortCol === 'dept')   return r.dept ?? '';
      if (sortCol === 'status') return r.status ?? '';
      if (sortCol === 'qty')    return r.qty ?? 0;
      return r.created_at;
    };
    const cmp = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }), [rows, sortCol, sortDir]);

  const deptTotals = useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { const d = r.dept ?? 'Unknown'; m[d] = (m[d] ?? 0) + (r.qty ?? 1); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
          <option value="all">All Status</option>
          <option value="pending">Pending</option>
          <option value="ordered">Ordered</option>
          <option value="received">Received</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <ExportBtn onClick={() => downloadCSV(`inventory_${start}_${end}.csv`,
          ['Date', 'Item', 'Dept', 'Qty', 'Job #', 'Status'],
          rows.map((r) => [fmtDateTime(r.created_at), r.item, r.dept ?? '', r.qty ?? 1, r.job_number ?? '', r.status ?? '']))} />
      </div>

      {!loading && deptTotals.length > 0 && (
        <div className="portal-card" style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Totals by Department</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {deptTotals.map(([dept, qty]) => (
              <span key={dept} style={{ fontSize: 13 }}>
                <span style={{ color: 'var(--ink-mute)' }}>{dept}: </span>
                <strong style={{ color: 'var(--teal)' }}>{qty}</strong>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Date"   col="created_at" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Item"   col="item"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Dept"   col="dept"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Qty"    col="qty"        sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Job #</th>
                <SortTh label="Status" col="status"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows cols={6} /> : sorted.length === 0 ? (
                <tr><td colSpan={6}><EmptyState msg="No inventory needs for this period." /></td></tr>
              ) : sorted.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  <td style={tdSt}>{fmtDate(r.created_at)}</td>
                  <td style={tdBold}>{r.item}</td>
                  <td style={tdSt}>{r.dept ?? '—'}</td>
                  <td style={tdSt}>{r.qty ?? 1}</td>
                  <td style={tdSt}>{r.job_number ?? '—'}</td>
                  <td style={tdSt}><StatusPill status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── 7. Parts & QC ─────────────────────────────────────────────────────────────

function PartsQCReport({ tenantId, showToast }: Props) {
  const [start,   setStart]   = useState(() => daysAgo(30));
  const [end,     setEnd]     = useState(todayISO);
  const [filter,  setFilter]  = useState('all');
  const [rows,    setRows]    = useState<PartRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const onSort = useCallback((col: string) => { setSortDir((d) => sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'asc'); setSortCol(col); }, [sortCol]);

  useEffect(() => {
    setLoading(true);
    let q = supabase.from('parts_log')
      .select('id, worker_name, job_number, part_name, dept, status, notes, created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', `${start}T00:00:00`).lte('created_at', `${end}T23:59:59`)
      .order('created_at', { ascending: false });
    if (filter !== 'all') q = q.eq('status', filter);
    q.then(({ data, error }) => {
      if (error) showToast(error.message, true);
      else setRows((data as PartRow[]) ?? []);
      setLoading(false);
    });
  }, [tenantId, start, end, filter, showToast]);

  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const get = (r: PartRow): string | number => {
      if (sortCol === 'part')   return r.part_name;
      if (sortCol === 'job')    return r.job_number ?? '';
      if (sortCol === 'dept')   return r.dept ?? '';
      if (sortCol === 'worker') return r.worker_name ?? '';
      if (sortCol === 'status') return r.status;
      return r.created_at;
    };
    const cmp = get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0;
    return sortDir === 'asc' ? cmp : -cmp;
  }), [rows, sortCol, sortDir]);

  const passed  = rows.filter((r) => r.status === 'Passed QC').length;
  const failed  = rows.filter((r) => r.status === 'Failed QC').length;
  const qcTotal = passed + failed;
  const passRate = qcTotal > 0 ? Math.round((passed / qcTotal) * 100) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <DateRange start={start} end={end} onStart={setStart} onEnd={setEnd} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ ...inputSt, cursor: 'pointer' }}>
          <option value="all">All Status</option>
          <option value="In Progress">In Progress</option>
          <option value="Passed QC">Passed QC</option>
          <option value="Failed QC">Failed QC</option>
          <option value="On Hold">On Hold</option>
        </select>
        <ExportBtn onClick={() => downloadCSV(`parts-qc_${start}_${end}.csv`,
          ['Date', 'Part', 'Job #', 'Dept', 'Worker', 'Status', 'Notes'],
          rows.map((r) => [fmtDateTime(r.created_at), r.part_name, r.job_number ?? '', r.dept ?? '', r.worker_name ?? '', r.status, r.notes ?? '']))} />
      </div>

      {!loading && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <MetricTile label="Total Parts" value={String(rows.length)} color="#5EEAD4" />
          <MetricTile label="QC Pass Rate" value={passRate !== null ? `${passRate}%` : 'N/A'}
            color={passRate === null ? 'var(--ink-mute)' : passRate >= 90 ? '#34D399' : passRate >= 70 ? '#FBBF24' : '#F87171'} />
          <MetricTile label="Failed QC" value={String(failed)} color={failed > 0 ? '#F87171' : '#34D399'} />
        </div>
      )}

      <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <SortTh label="Date"   col="created_at" sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Part"   col="part"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Job #"  col="job"        sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Dept"   col="dept"       sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Worker" col="worker"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <SortTh label="Status" col="status"     sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
                <th style={thSt}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <LoadingRows cols={7} /> : sorted.length === 0 ? (
                <tr><td colSpan={7}><EmptyState msg="No parts logged for this period." /></td></tr>
              ) : sorted.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent' }}>
                  <td style={tdSt}>{fmtDate(r.created_at)}</td>
                  <td style={tdBold}>{r.part_name}</td>
                  <td style={tdSt}>{r.job_number ? <code style={{ fontSize: 12 }}>{r.job_number}</code> : '—'}</td>
                  <td style={tdSt}>{r.dept ?? '—'}</td>
                  <td style={tdSt}>{r.worker_name ?? '—'}</td>
                  <td style={tdSt}><StatusPill status={r.status} /></td>
                  <td style={{ ...tdSt, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

const REPORT_NAV: { key: ReportKey; label: string }[] = [
  { key: 'daily',     label: 'Daily Labor'     },
  { key: 'job',       label: 'Job Cost'        },
  { key: 'weekly',    label: 'Weekly Summary'  },
  { key: 'craftsman', label: 'Craftsman Build' },
  { key: 'damage',    label: 'Damage Log'      },
  { key: 'inventory', label: 'Inventory'       },
  { key: 'parts',     label: 'Parts & QC'      },
];

export default function ReportsTab({ tenantId, showToast }: Props) {
  const [active, setActive] = useState<ReportKey>('daily');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 4 }}>Reports</div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
          Analyze labor, job cost, and shop floor data. All reports filter to your shop only.
        </p>
      </div>

      {/* Secondary nav */}
      <div style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--line)', paddingBottom: 0, marginBottom: 2 }}>
        {REPORT_NAV.map(({ key, label }) => (
          <button key={key} onClick={() => setActive(key)} style={{
            padding: '8px 13px', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
            color: active === key ? 'var(--teal)' : 'var(--ink-mute)',
            background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            borderBottom: active === key ? '2px solid var(--teal)' : '2px solid transparent',
            marginBottom: -1, transition: 'color 0.15s',
          }}>
            {label}
          </button>
        ))}
      </div>

      {active === 'daily'     && <DailyLaborReport     tenantId={tenantId} showToast={showToast} />}
      {active === 'job'       && <JobCostReport        tenantId={tenantId} showToast={showToast} />}
      {active === 'weekly'    && <WeeklySummaryReport  tenantId={tenantId} showToast={showToast} />}
      {active === 'craftsman' && <CraftsmanBuildReport tenantId={tenantId} showToast={showToast} />}
      {active === 'damage'    && <DamageReportLog      tenantId={tenantId} showToast={showToast} />}
      {active === 'inventory' && <InventoryReport      tenantId={tenantId} showToast={showToast} />}
      {active === 'parts'     && <PartsQCReport        tenantId={tenantId} showToast={showToast} />}
    </div>
  );
}
