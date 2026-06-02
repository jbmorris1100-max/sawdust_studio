'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

type CabinetUnit = {
  id: string;
  tenant_id: string;
  job_id: string | null;
  job_number: string | null;
  room_number: string | null;
  cabinet_number: string | null;
  unit_label: string;
  status: string;
  flagged_reason: string | null;
  completed_at: string | null;
  created_at: string;
};

type AssemblyPart = {
  id: string;
  cabinet_unit_id: string;
  job_number: string | null;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  status: string;
  checked_at: string | null;
  checked_by: string | null;
  flag_type: string | null;
  flag_notes: string | null;
  scan_value: string | null;
  created_at: string;
};

type Job = {
  id: string;
  job_number: string;
  job_name: string | null;
  status: string;
};

type CsvRow = Record<string, string>;

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs: Job[];
}

// ── SVG icons (thin stroke, no emoji) ─────────────────────────────────────────

const IcoCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IcoDamaged = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);
const IcoMissing = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="8" y1="12" x2="16" y2="12"/>
  </svg>
);
const IcoWrong = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IcoPending = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
  </svg>
);
const IcoFlag = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
    <line x1="4" y1="22" x2="4" y2="15"/>
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitLine(line: string): string[] {
    const result: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(field.trim()); field = '';
      } else { field += ch; }
    }
    result.push(field.trim());
    return result;
  }
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const vals = splitLine(l);
    const row: CsvRow = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function statusMeta(status: string): { label: string; color: string; bg: string; border: string } {
  switch (status) {
    case 'complete':    return { label: 'Complete',    color: '#34D399', bg: 'rgba(52,211,153,0.1)',   border: 'rgba(52,211,153,0.25)' };
    case 'in_assembly': return { label: 'In Assembly', color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)',   border: 'rgba(94,234,212,0.25)' };
    case 'flagged':     return { label: 'Flagged',     color: '#F87171', bg: 'rgba(248,113,113,0.1)',  border: 'rgba(248,113,113,0.3)' };
    default:            return { label: 'Pending',     color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)',   border: 'rgba(95,111,108,0.2)' };
  }
}

function partStatusIcon(status: string, flagType: string | null) {
  if (flagType === 'damaged')    return <span style={{ color: '#F87171' }}><IcoDamaged /></span>;
  if (flagType === 'missing')    return <span style={{ color: '#FBBF24' }}><IcoMissing /></span>;
  if (flagType === 'wrong_part') return <span style={{ color: '#F87171' }}><IcoWrong /></span>;
  if (status === 'checked' || status === 'complete') return <span style={{ color: '#34D399' }}><IcoCheck /></span>;
  return <span style={{ color: '#8BA5A0' }}><IcoPending /></span>;
}

function dimLabel(p: AssemblyPart): string {
  const parts: string[] = [];
  if (p.width)  parts.push(`${p.width}"`);
  if (p.height) parts.push(`${p.height}"`);
  if (p.depth)  parts.push(`${p.depth}"`);
  return parts.join(' x ');
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AssemblyTab({ tenantId, showToast, jobs }: Props) {
  const [units,       setUnits]       = useState<CabinetUnit[]>([]);
  const [allParts,    setAllParts]    = useState<AssemblyPart[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [expandedId,  setExpandedId]  = useState<string | null>(null);

  // Import state
  const [importJobId,    setImportJobId]    = useState('');
  const [importFile,     setImportFile]     = useState<File | null>(null);
  const [csvHeaders,     setCsvHeaders]     = useState<string[]>([]);
  const [csvRows,        setCsvRows]        = useState<CsvRow[]>([]);
  const [showMapper,     setShowMapper]     = useState(false);
  const [columnMap,      setColumnMap]      = useState<Record<string, string>>({
    unit_id: '', part_name: '', room: '', material: '', width: '', height: '', depth: '',
  });
  const [importing,      setImporting]      = useState(false);
  const [importSummary,  setImportSummary]  = useState<{ units: number; parts: number } | null>(null);

  // Message team state
  const [msgUnitId,  setMsgUnitId]  = useState<string | null>(null);
  const [msgBody,    setMsgBody]    = useState('');
  const [msgDept,    setMsgDept]    = useState('Assembly');
  const [msgSending, setMsgSending] = useState(false);

  // ── Data load ──────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [unitsRes, partsRes] = await Promise.all([
        supabase.from('cabinet_units').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('parts').select('*').eq('tenant_id', tenantId).order('part_name'),
      ]);
      if (unitsRes.data) setUnits(unitsRes.data as CabinetUnit[]);
      if (partsRes.data) setAllParts(partsRes.data as AssemblyPart[]);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Load failed', true);
    }
    setLoading(false);
  }, [tenantId, showToast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ── Realtime subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    const unitsCh = supabase.channel('rt-cabinet-units')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setUnits((prev) => prev.some((u) => u.id === payload.new.id) ? prev : [payload.new as CabinetUnit, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setUnits((prev) => prev.map((u) => u.id === payload.new.id ? payload.new as CabinetUnit : u));
        } else if (payload.eventType === 'DELETE') {
          setUnits((prev) => prev.filter((u) => u.id !== payload.old.id));
        }
      })
      .subscribe();

    const partsCh = supabase.channel('rt-assembly-parts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setAllParts((prev) => prev.some((p) => p.id === payload.new.id) ? prev : [...prev, payload.new as AssemblyPart]);
        } else if (payload.eventType === 'UPDATE') {
          setAllParts((prev) => prev.map((p) => p.id === payload.new.id ? payload.new as AssemblyPart : p));
        } else if (payload.eventType === 'DELETE') {
          setAllParts((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(unitsCh);
      supabase.removeChannel(partsCh);
    };
  }, [tenantId]);

  // ── CSV import ─────────────────────────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setShowMapper(false);
    setImportSummary(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCSV(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setColumnMap({ unit_id: '', part_name: '', room: '', material: '', width: '', height: '', depth: '' });
      setShowMapper(headers.length > 0);
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!columnMap.unit_id || !columnMap.part_name || !importJobId || importing) return;
    setImporting(true);
    try {
      const job = jobs.find((j) => j.id === importJobId);
      if (!job) throw new Error('Job not found');

      // Group rows by unit ID value
      const unitGroups: Record<string, CsvRow[]> = {};
      csvRows.forEach((row) => {
        const unitVal = row[columnMap.unit_id]?.trim();
        if (!unitVal) return;
        if (!unitGroups[unitVal]) unitGroups[unitVal] = [];
        unitGroups[unitVal].push(row);
      });

      const unitLabelToId: Record<string, string> = {};
      let unitsInserted = 0;
      let partsInserted = 0;

      for (const [unitVal, rows] of Object.entries(unitGroups)) {
        // Parse Job/Room/Cabinet/Part format if present
        const segments = unitVal.split('/').map((s) => s.trim());
        let room_number: string | null = null;
        let cabinet_number: string | null = null;
        let unit_label = unitVal;
        if (segments.length >= 3) {
          room_number    = segments[1] || null;
          cabinet_number = segments[2] || null;
          unit_label     = unitVal;
        } else if (columnMap.room && rows[0]?.[columnMap.room]) {
          room_number = rows[0][columnMap.room]?.trim() || null;
        }

        const { data: unitData, error: unitErr } = await supabase
          .from('cabinet_units')
          .insert({
            tenant_id:      tenantId,
            job_id:         job.id,
            job_number:     job.job_number,
            room_number,
            cabinet_number,
            unit_label,
            status: 'pending',
          })
          .select('id')
          .single();
        if (unitErr) throw unitErr;
        unitLabelToId[unitVal] = unitData.id;
        unitsInserted++;

        const partRows = rows.map((row) => ({
          tenant_id:       tenantId,
          cabinet_unit_id: unitData.id,
          job_number:      job.job_number,
          part_name:       row[columnMap.part_name]?.trim() || 'Unknown part',
          material:        columnMap.material ? (row[columnMap.material]?.trim() || null) : null,
          width:           columnMap.width   ? (parseFloat(row[columnMap.width] ?? '') || null) : null,
          height:          columnMap.height  ? (parseFloat(row[columnMap.height] ?? '') || null) : null,
          depth:           columnMap.depth   ? (parseFloat(row[columnMap.depth] ?? '') || null) : null,
          quantity:        1,
          status:          'pending',
        }));

        const { error: partsErr } = await supabase.from('parts').insert(partRows);
        if (partsErr) throw partsErr;
        partsInserted += partRows.length;
      }

      setImportSummary({ units: unitsInserted, parts: partsInserted });
      setShowMapper(false);
      setImportFile(null);
      await loadAll();
      showToast(`Imported ${unitsInserted} units and ${partsInserted} parts`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Import failed', true);
    } finally {
      setImporting(false);
    }
  }

  // ── Message team ──────────────────────────────────────────────────────────

  function openMsgModal(unit: CabinetUnit) {
    const parts = allParts.filter((p) => p.cabinet_unit_id === unit.id && p.flag_type);
    const firstFlag = parts[0];
    const preBody = firstFlag
      ? `Cabinet ${unit.cabinet_number || unit.unit_label} flagged — ${firstFlag.part_name}: ${(firstFlag.flag_type ?? '').replace('_', ' ')}. Please advise.`
      : `Cabinet ${unit.cabinet_number || unit.unit_label} needs attention. Please advise.`;
    setMsgUnitId(unit.id);
    setMsgBody(preBody);
    setMsgDept('Assembly');
  }

  async function handleSendMsg() {
    if (!msgBody.trim() || msgSending || !msgUnitId) return;
    setMsgSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        sender_name: 'Supervisor',
        dept:        msgDept || null,
        body:        msgBody.trim(),
        tenant_id:   tenantId,
      });
      if (error) throw error;
      setMsgUnitId(null);
      showToast('Message sent');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Send failed', true);
    } finally {
      setMsgSending(false);
    }
  }

  // ── Computed data ──────────────────────────────────────────────────────────

  const unitParts = (unitId: string) => allParts.filter((p) => p.cabinet_unit_id === unitId);
  const checkedCount = (unitId: string) => allParts.filter((p) => p.cabinet_unit_id === unitId && p.status !== 'pending').length;

  // Flagged units first, then by created_at desc
  const sortedUnits = [...units].sort((a, b) => {
    if (a.status === 'flagged' && b.status !== 'flagged') return -1;
    if (b.status === 'flagged' && a.status !== 'flagged') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  // Group by job_number
  const grouped: Record<string, CabinetUnit[]> = {};
  sortedUnits.forEach((u) => {
    const k = u.job_number || 'No Job';
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(u);
  });

  const IMPORT_FIELDS: { key: string; label: string; required?: boolean }[] = [
    { key: 'unit_id',   label: 'Cabinet / Unit ID', required: true },
    { key: 'part_name', label: 'Part Name',          required: true },
    { key: 'room',      label: 'Room' },
    { key: 'material',  label: 'Material' },
    { key: 'width',     label: 'Width' },
    { key: 'height',    label: 'Height' },
    { key: 'depth',     label: 'Depth' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <style>{`@keyframes flagPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* ── Import Cutlist ───────────────────────────────────────────────── */}
      <div className="portal-card">
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>
          Import Cutlist
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Job *</label>
            <select
              className="form-input"
              value={importJobId}
              onChange={(e) => setImportJobId(e.target.value)}
              style={{ width: '100%', cursor: 'pointer' }}
            >
              <option value="">Select a job…</option>
              {jobs.filter((j) => j.status === 'active').map((j) => (
                <option key={j.id} value={j.id}>{j.job_number}{j.job_name ? ` — ${j.job_name}` : ''}</option>
              ))}
            </select>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>CSV File *</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              style={{ fontSize: 13, color: 'var(--ink-dim)', width: '100%' }}
            />
          </div>
        </div>

        {/* Column mapper */}
        {showMapper && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--teal)', marginBottom: 10 }}>
              Map Columns — {csvRows.length} rows parsed
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              {IMPORT_FIELDS.map(({ key, label, required }) => (
                <div key={key}>
                  <label style={{ fontSize: 12, color: required ? 'var(--ink-dim)' : 'var(--ink-mute)', fontWeight: required ? 700 : 500, display: 'block', marginBottom: 4 }}>
                    {label}{required ? ' *' : ''}
                  </label>
                  <select
                    className="form-input"
                    value={columnMap[key] || ''}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, [key]: e.target.value }))}
                    style={{ width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">{required ? '— select column —' : '(skip)'}</option>
                    {csvHeaders.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ opacity: (!columnMap.unit_id || !columnMap.part_name || !importJobId || importing) ? 0.5 : 1 }}
              onClick={handleImport}
              disabled={!columnMap.unit_id || !columnMap.part_name || !importJobId || importing}
            >
              {importing ? 'Importing…' : `Import ${csvRows.length} rows`}
            </button>
          </div>
        )}

        {importSummary && (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', fontSize: 13, color: '#34D399', fontWeight: 600 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ display: 'inline', marginRight: 7, verticalAlign: 'middle' }}><polyline points="20 6 9 17 4 12"/></svg>
            {importSummary.units} cabinet units and {importSummary.parts} parts imported
          </div>
        )}
      </div>

      {/* ── Cabinet Units ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading assembly data…</div>
      ) : units.length === 0 ? (
        <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
          No cabinet units yet. Import a cutlist above to get started.
        </div>
      ) : (
        Object.entries(grouped).map(([jobKey, jobUnits]) => (
          <div key={jobKey} className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', background: 'rgba(94,234,212,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#5EEAD4' }}>
                Job {jobKey}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{jobUnits.length} unit{jobUnits.length !== 1 ? 's' : ''}</span>
            </div>

            {jobUnits.map((unit) => {
              const sm        = statusMeta(unit.status);
              const parts     = unitParts(unit.id);
              const total     = parts.length;
              const checked   = checkedCount(unit.id);
              const pct       = total > 0 ? (checked / total) * 100 : 0;
              const isOpen    = expandedId === unit.id;
              const isFlagged = unit.status === 'flagged';
              const flaggedParts = parts.filter((p) => p.flag_type);

              return (
                <div
                  key={unit.id}
                  style={{
                    borderBottom: '1px solid var(--line)',
                    borderLeft: isFlagged ? '3px solid #F87171' : '3px solid transparent',
                  }}
                >
                  {/* Unit header row */}
                  <button
                    onClick={() => setExpandedId(isOpen ? null : unit.id)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 20px', background: 'none', border: 'none',
                      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    {/* Pulse indicator for flagged */}
                    {isFlagged && (
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#F87171', flexShrink: 0, animation: 'flagPulse 1.5s ease-in-out infinite' }} />
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                          {unit.room_number ? `Room ${unit.room_number} — ` : ''}
                          {unit.cabinet_number ? `Cabinet ${unit.cabinet_number}` : unit.unit_label}
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: sm.color, background: sm.bg, border: `1px solid ${sm.border}` }}>
                          {sm.label}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{total} part{total !== 1 ? 's' : ''}</span>
                      </div>

                      {/* Progress bar */}
                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: unit.status === 'flagged' ? '#F87171' : unit.status === 'complete' ? '#34D399' : '#5EEAD4',
                          borderRadius: 2,
                          transition: 'width 0.4s ease',
                        }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>{checked}/{total} checked</div>
                    </div>

                    <svg
                      width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round"
                      style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>

                  {/* Expanded parts list */}
                  {isOpen && (
                    <div style={{ padding: '0 20px 16px 20px', background: 'rgba(255,255,255,0.015)' }}>
                      {parts.length === 0 ? (
                        <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '8px 0' }}>No parts loaded for this unit.</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                          {parts.map((part) => (
                            <div
                              key={part.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '9px 0',
                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                              }}
                            >
                              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                                {partStatusIcon(part.status, part.flag_type)}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: part.flag_type ? '#F87171' : 'var(--ink)' }}>
                                  {part.part_name}
                                  {part.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{part.quantity}</span>}
                                </div>
                                {(dimLabel(part) || part.material) && (
                                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>
                                    {dimLabel(part)}{part.material ? (dimLabel(part) ? ` · ${part.material}` : part.material) : ''}
                                  </div>
                                )}
                                {part.flag_type && (
                                  <div style={{ fontSize: 11, color: '#F87171', marginTop: 2 }}>
                                    {part.flag_type.replace('_', ' ')}
                                    {part.flag_notes ? ` — ${part.flag_notes}` : ''}
                                  </div>
                                )}
                                {part.checked_by && (
                                  <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>by {part.checked_by}</div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Message Team for flagged */}
                      {isFlagged && (
                        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                          {flaggedParts.length > 0 && (
                            <div style={{ marginBottom: 10 }}>
                              {flaggedParts.map((p) => (
                                <div key={p.id} style={{ fontSize: 12, color: '#F87171', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                  <IcoFlag />
                                  {p.part_name}: {(p.flag_type ?? '').replace('_', ' ')}
                                  {p.flag_notes ? ` — ${p.flag_notes}` : ''}
                                </div>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={() => openMsgModal(unit)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '8px 16px', borderRadius: 8,
                              background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)',
                              color: '#F87171', fontSize: 12, fontWeight: 700,
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                            Message Team
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))
      )}

      {/* ── Message Team Modal ────────────────────────────────────────────── */}
      {msgUnitId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setMsgUnitId(null); }}
        >
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 480, padding: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Message Team</div>
              <button onClick={() => setMsgUnitId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Department</label>
              <select
                className="form-input"
                value={msgDept}
                onChange={(e) => setMsgDept(e.target.value)}
                style={{ width: '100%', cursor: 'pointer' }}
              >
                <option value="">All Departments</option>
                <option value="Production">Production</option>
                <option value="Assembly">Assembly</option>
                <option value="Finishing">Finishing</option>
                <option value="Craftsman">Craftsman</option>
              </select>
            </div>

            <div>
              <label style={{ fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 }}>Message</label>
              <textarea
                className="form-input"
                value={msgBody}
                onChange={(e) => setMsgBody(e.target.value)}
                rows={4}
                style={{ width: '100%', resize: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setMsgUnitId(null)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={() => { void handleSendMsg(); }}
                disabled={!msgBody.trim() || msgSending}
                style={{ flex: 2, justifyContent: 'center', opacity: (!msgBody.trim() || msgSending) ? 0.5 : 1 }}
              >
                {msgSending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
