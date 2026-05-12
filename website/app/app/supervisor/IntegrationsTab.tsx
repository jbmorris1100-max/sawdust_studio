'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

type Job = {
  id: string;
  tenant_id: string;
  job_number: string;
  job_name: string | null;
  status: string;
  created_at: string;
  source?: string | null;
};

type JobDrawing = {
  id: string;
  job_name: string | null;
  label: string | null;
  file_url: string | null;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  plans: JobDrawing[];
  setPlans: React.Dispatch<React.SetStateAction<JobDrawing[]>>;
}

type CardKey = 'innergy' | 'cv' | 'mozaik' | 'csv' | 'microvellum' | 'other' | 'plans';
type CsvRow = Record<string, string>;

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
        result.push(field.trim());
        field = '';
      } else {
        field += ch;
      }
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

function guessColumn(headers: string[], candidates: string[]): string {
  const lower = headers.map((h) => h.toLowerCase());
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx >= 0) return headers[idx];
  }
  return headers[0] ?? '';
}

// ── Shared input style ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#0E1818', color: 'var(--ink)',
  border: '1px solid var(--line-strong)', borderRadius: 8,
  padding: '9px 12px', fontSize: 14, width: '100%',
  fontFamily: 'inherit', outline: 'none',
};

// ── Source badge map ─────────────────────────────────────────────────────────

const SOURCE_BADGES: Record<string, { label: string; color: string; bg: string }> = {
  innergy:       { label: 'Innergy',        color: '#2DE1C9', bg: 'rgba(45,225,201,0.12)' },
  cabinet_vision:{ label: 'Cabinet Vision', color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
  mozaik:        { label: 'Mozaik',         color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  custom:        { label: 'CSV',            color: '#8BA5A0', bg: 'rgba(139,165,160,0.12)' },
};

export function SourceBadge({ source }: { source?: string | null }) {
  if (!source || source === 'manual' || !SOURCE_BADGES[source]) return null;
  const { label, color, bg } = SOURCE_BADGES[source];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: bg, color, flexShrink: 0 }}>
      {label}
    </span>
  );
}

// ── Collapsible card shell ────────────────────────────────────────────────────

function ErpCard({
  id, open, onToggle, title, statusBadge, children,
}: {
  id: CardKey;
  open: boolean;
  onToggle: (k: CardKey) => void;
  title: string;
  statusBadge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => onToggle(id)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
          {statusBadge}
        </div>
        <svg
          width={14} height={14} viewBox="0 0 24 24" fill="none"
          stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round"
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--line)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, color, background: bg }}>
      {label}
    </span>
  );
}

// ── CSV import UI (shared by CV, Mozaik, Universal) ──────────────────────────

function CsvImportCard({
  source, tenantId, jobs, setJobs, showToast,
  numColCandidates, nameColCandidates, showMapping,
}: {
  source: 'cabinet_vision' | 'mozaik' | 'custom';
  tenantId: string;
  jobs: Job[];
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
  showToast: (msg: string, error?: boolean) => void;
  numColCandidates: string[];
  nameColCandidates: string[];
  showMapping: boolean;
}) {
  const [headers, setHeaders]     = useState<string[]>([]);
  const [rows, setRows]           = useState<CsvRow[]>([]);
  const [numCol, setNumCol]       = useState('');
  const [nameCol, setNameCol]     = useState('');
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName]   = useState('');

  function handleFile(file: File) {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCSV(text);
      setHeaders(h);
      setRows(r);
      setNumCol(guessColumn(h, numColCandidates));
      setNameCol(guessColumn(h, nameColCandidates));
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    if (!numCol || rows.length === 0 || importing) return;
    setImporting(true);

    const existingNums = new Set(jobs.map((j) => j.job_number.toLowerCase()));
    const toInsert = rows
      .filter((r) => r[numCol]?.trim())
      .filter((r) => !existingNums.has(r[numCol].trim().toLowerCase()))
      .map((r) => ({
        tenant_id:  tenantId,
        job_number: r[numCol].trim(),
        job_name:   nameCol && r[nameCol]?.trim() ? r[nameCol].trim() : null,
        status:     'active',
        source,
        raw_data:   r,
      }));

    if (toInsert.length === 0) {
      showToast('No new jobs to import (all already exist)', true);
      setImporting(false);
      return;
    }

    try {
      const { data, error } = await supabase.from('jobs').insert(toInsert).select();
      if (error) throw error;
      setJobs((prev) => [...(data as Job[]), ...prev]);
      showToast(`Imported ${toInsert.length} job${toInsert.length !== 1 ? 's' : ''} ✓`);
      setRows([]);
      setHeaders([]);
      setFileName('');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Import failed', true);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
        Export a job list from your software as CSV, then upload it here. New jobs will be added to your Active Jobs list.
      </p>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          CSV File
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
            background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)',
            borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--teal)', fontWeight: 600,
          }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            Choose file
            <input
              type="file" accept=".csv,text/csv" style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
            />
          </label>
          {fileName && <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{fileName}</span>}
        </div>
      </label>

      {headers.length > 0 && (
        <>
          {showMapping && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Job Number Column <span style={{ color: '#F87171' }}>*</span>
                </label>
                <select value={numCol} onChange={(e) => setNumCol(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  Job Name Column
                </label>
                <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="">(none)</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
          )}

          {!showMapping && (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              Detected <strong style={{ color: 'var(--ink-dim)' }}>{rows.length} rows</strong> · Job# column: <strong style={{ color: 'var(--teal)' }}>{numCol || '—'}</strong>
              {nameCol ? <> · Name column: <strong style={{ color: 'var(--teal)' }}>{nameCol}</strong></> : null}
            </div>
          )}

          {/* Preview table */}
          <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--line)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.03)' }}>
                  {headers.slice(0, 5).map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--ink-mute)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                  {headers.length > 5 && <th style={{ padding: '8px 12px', color: 'var(--ink-mute)' }}>…</th>}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 4).map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                    {headers.slice(0, 5).map((h) => (
                      <td key={h} style={{ padding: '7px 12px', color: 'var(--ink-dim)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row[h] ?? ''}
                      </td>
                    ))}
                    {headers.length > 5 && <td style={{ padding: '7px 12px', color: 'var(--ink-mute)' }}>…</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleImport}
            disabled={importing || !numCol}
            style={{ alignSelf: 'flex-start', opacity: (importing || !numCol) ? 0.5 : 1 }}
          >
            {importing ? 'Importing…' : `Import ${rows.length} rows`}
          </button>
        </>
      )}
    </div>
  );
}

// ── Main IntegrationsTab ──────────────────────────────────────────────────────

export default function IntegrationsTab({ tenantId, showToast, jobs, setJobs, plans, setPlans }: Props) {
  const [openCard, setOpenCard] = useState<CardKey | null>(null);

  // Innergy state
  const [inApiKey,    setInApiKey]    = useState('');
  const [inSubdomain, setInSubdomain] = useState('');
  const [inShowKey,   setInShowKey]   = useState(false);
  const [inTesting,   setInTesting]   = useState(false);
  const [inSaving,    setInSaving]    = useState(false);
  const [inConnected, setInConnected] = useState(false);
  const [inTestMsg,   setInTestMsg]   = useState<{ text: string; ok: boolean } | null>(null);

  // Plans upload state
  const [planFile,      setPlanFile]      = useState<File | null>(null);
  const [planJobNum,    setPlanJobNum]    = useState('');
  const [planLabel,     setPlanLabel]     = useState('');
  const [planUploading, setPlanUploading] = useState(false);

  // Waitlist state
  const [wlEmail,       setWlEmail]       = useState('');
  const [wlNotes,       setWlNotes]       = useState('');
  const [wlErpName,     setWlErpName]     = useState('');
  const [wlSubmitting,  setWlSubmitting]  = useState(false);
  const [wlDone,        setWlDone]        = useState<Record<string, boolean>>({});

  // Load saved Innergy config from tenant record
  useEffect(() => {
    async function loadConfig() {
      const { data } = await supabase
        .from('tenants')
        .select('innergy_api_key, innergy_subdomain')
        .eq('id', tenantId)
        .single();
      if (data) {
        if (data.innergy_api_key)   { setInApiKey(data.innergy_api_key); setInConnected(true); }
        if (data.innergy_subdomain) setInSubdomain(data.innergy_subdomain);
      }
    }
    void loadConfig();
  }, [tenantId]);

  function toggleCard(k: CardKey) {
    setOpenCard((prev) => (prev === k ? null : k));
  }

  // ── Innergy actions ────────────────────────────────────────────────────────

  async function handleTestInnergy() {
    if (!inApiKey.trim() || !inSubdomain.trim() || inTesting) return;
    setInTesting(true);
    setInTestMsg(null);
    try {
      const res = await fetch('/app/api/test-innergy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: inApiKey.trim(), subdomain: inSubdomain.trim() }),
      });
      const data = await res.json() as { success?: boolean; message?: string; error?: string };
      if (res.ok && data.success) {
        setInTestMsg({ text: data.message ?? 'Connected ✓', ok: true });
      } else {
        setInTestMsg({ text: data.error ?? 'Test failed', ok: false });
      }
    } catch {
      setInTestMsg({ text: 'Network error — check your connection', ok: false });
    } finally {
      setInTesting(false);
    }
  }

  async function handleSaveInnergy() {
    if (!inApiKey.trim() || !inSubdomain.trim() || inSaving) return;
    setInSaving(true);
    try {
      const { error } = await supabase
        .from('tenants')
        .update({ innergy_api_key: inApiKey.trim(), innergy_subdomain: inSubdomain.trim() })
        .eq('id', tenantId);
      if (error) throw error;
      setInConnected(true);
      showToast('Innergy settings saved ✓');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Save failed', true);
    } finally {
      setInSaving(false);
    }
  }

  // ── Plans upload ───────────────────────────────────────────────────────────

  async function handlePlanUpload() {
    if (!planFile || !planJobNum.trim() || planUploading) return;
    setPlanUploading(true);
    try {
      const ext  = planFile.name.split('.').pop() ?? 'bin';
      const path = `${tenantId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('job-plans').upload(path, planFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('job-plans').getPublicUrl(path);
      const { data: row, error: dbErr } = await supabase.from('job_drawings').insert({
        tenant_id:   tenantId,
        job_name:    planJobNum.trim(),
        label:       planLabel.trim() || null,
        file_url:    publicUrl,
        file_name:   planFile.name,
        uploaded_by: 'Supervisor',
      }).select().single();
      if (dbErr) throw dbErr;
      setPlans((prev) => [row as JobDrawing, ...prev]);
      setPlanFile(null);
      setPlanJobNum('');
      setPlanLabel('');
      showToast('Plan uploaded ✓');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', true);
    } finally {
      setPlanUploading(false);
    }
  }

  // ── Waitlist submit ────────────────────────────────────────────────────────

  async function handleWaitlist(erpName: string) {
    if (!wlEmail.trim() || wlSubmitting) return;
    setWlSubmitting(true);
    try {
      const { error } = await supabase.from('integration_waitlist').insert({
        tenant_id: tenantId,
        erp_name:  erpName,
        email:     wlEmail.trim(),
        notes:     wlNotes.trim() || null,
      });
      if (error) throw error;
      setWlDone((prev) => ({ ...prev, [erpName]: true }));
      setWlEmail('');
      setWlNotes('');
      setWlErpName('');
      showToast('Request submitted — we\'ll be in touch ✓');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Submit failed', true);
    } finally {
      setWlSubmitting(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const labelStyle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)',
    textTransform: 'uppercase', letterSpacing: '0.07em',
  };
  const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Section header */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 6 }}>
          ERP Integrations
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
          Connect InlineIQ to your existing shop software. Jobs imported from your ERP will appear in the Active Jobs list with a source badge.
        </p>
      </div>

      {/* ── Innergy ── */}
      <ErpCard
        id="innergy" open={openCard === 'innergy'} onToggle={toggleCard}
        title="Innergy"
        statusBadge={
          inConnected
            ? <StatusPill label="Connected" color="#34D399" bg="rgba(52,211,153,0.12)" />
            : <StatusPill label="Live API" color="#2DE1C9" bg="rgba(45,225,201,0.1)" />
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Import jobs, cut lists, and plans directly from Innergy. Enter your API credentials below.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...fieldWrap, flex: 1 }}>
              <label style={labelStyle}>Subdomain</label>
              <input
                style={inputStyle}
                placeholder="yourshop"
                value={inSubdomain}
                onChange={(e) => setInSubdomain(e.target.value)}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>yourshop.innergy.com</span>
            </div>
            <div style={{ ...fieldWrap, flex: 1 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 40 }}
                  type={inShowKey ? 'text' : 'password'}
                  placeholder="sk-••••••••"
                  value={inApiKey}
                  onChange={(e) => setInApiKey(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setInShowKey((v) => !v)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2 }}
                  title={inShowKey ? 'Hide' : 'Show'}
                >
                  {inShowKey
                    ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </div>
          </div>

          {inTestMsg && (
            <div style={{ fontSize: 13, padding: '9px 14px', borderRadius: 8, background: inTestMsg.ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', color: inTestMsg.ok ? '#34D399' : '#F87171', border: `1px solid ${inTestMsg.ok ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}` }}>
              {inTestMsg.text}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={handleTestInnergy}
              disabled={inTesting || !inApiKey.trim() || !inSubdomain.trim()}
              style={{ fontSize: 13, opacity: (inTesting || !inApiKey.trim() || !inSubdomain.trim()) ? 0.5 : 1 }}
            >
              {inTesting ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSaveInnergy}
              disabled={inSaving || !inApiKey.trim() || !inSubdomain.trim()}
              style={{ fontSize: 13, opacity: (inSaving || !inApiKey.trim() || !inSubdomain.trim()) ? 0.5 : 1 }}
            >
              {inSaving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        </div>
      </ErpCard>

      {/* ── Cabinet Vision ── */}
      <ErpCard
        id="cv" open={openCard === 'cv'} onToggle={toggleCard}
        title="Cabinet Vision"
        statusBadge={<StatusPill label="CSV Import" color="#A78BFA" bg="rgba(167,139,250,0.1)" />}
      >
        <CsvImportCard
          source="cabinet_vision"
          tenantId={tenantId}
          jobs={jobs}
          setJobs={setJobs}
          showToast={showToast}
          numColCandidates={['job #', 'job number', 'job no', 'order #', 'order number', 'job_number', 'number']}
          nameColCandidates={['customer', 'job name', 'description', 'client', 'job_name', 'name']}
          showMapping={false}
        />
      </ErpCard>

      {/* ── Mozaik ── */}
      <ErpCard
        id="mozaik" open={openCard === 'mozaik'} onToggle={toggleCard}
        title="Mozaik"
        statusBadge={<StatusPill label="CSV Import" color="#F59E0B" bg="rgba(245,158,11,0.1)" />}
      >
        <CsvImportCard
          source="mozaik"
          tenantId={tenantId}
          jobs={jobs}
          setJobs={setJobs}
          showToast={showToast}
          numColCandidates={['job #', 'job number', 'job no', 'order', 'project #', 'project number']}
          nameColCandidates={['customer', 'project name', 'description', 'client', 'name']}
          showMapping={false}
        />
      </ErpCard>

      {/* ── Universal CSV ── */}
      <ErpCard
        id="csv" open={openCard === 'csv'} onToggle={toggleCard}
        title="Universal CSV Import"
        statusBadge={<StatusPill label="Any Format" color="#8BA5A0" bg="rgba(139,165,160,0.1)" />}
      >
        <CsvImportCard
          source="custom"
          tenantId={tenantId}
          jobs={jobs}
          setJobs={setJobs}
          showToast={showToast}
          numColCandidates={['job', 'number', 'order', 'id']}
          nameColCandidates={['name', 'customer', 'description', 'title']}
          showMapping={true}
        />
      </ErpCard>

      {/* ── Microvellum ── */}
      <ErpCard
        id="microvellum" open={openCard === 'microvellum'} onToggle={toggleCard}
        title="Microvellum"
        statusBadge={<StatusPill label="Beta" color="#F59E0B" bg="rgba(245,158,11,0.1)" />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Microvellum integration is in closed beta. Request access and we&apos;ll reach out with setup instructions.
          </p>
          {wlDone['Microvellum'] ? (
            <div style={{ fontSize: 13, color: '#34D399', padding: '9px 14px', borderRadius: 8, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              Request submitted ✓ — we&apos;ll reach out within 2 business days.
            </div>
          ) : (
            <>
              <div style={fieldWrap}>
                <label style={labelStyle}>Your Email</label>
                <input style={inputStyle} type="email" placeholder="you@yourshop.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)} />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Microvellum version, export format you use…"
                  value={wlNotes}
                  onChange={(e) => setWlNotes(e.target.value)}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void handleWaitlist('Microvellum')}
                disabled={wlSubmitting || !wlEmail.trim()}
                style={{ alignSelf: 'flex-start', opacity: (wlSubmitting || !wlEmail.trim()) ? 0.5 : 1 }}
              >
                {wlSubmitting ? 'Submitting…' : 'Request Access'}
              </button>
            </>
          )}
        </div>
      </ErpCard>

      {/* ── Other ERP ── */}
      <ErpCard
        id="other" open={openCard === 'other'} onToggle={toggleCard}
        title="Other ERP / Software"
        statusBadge={<StatusPill label="Request" color="#8BA5A0" bg="rgba(139,165,160,0.1)" />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Don&apos;t see your software? Let us know and we&apos;ll add it to the roadmap.
          </p>
          {wlDone['other'] ? (
            <div style={{ fontSize: 13, color: '#34D399', padding: '9px 14px', borderRadius: 8, background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.25)' }}>
              Request submitted ✓ — thanks for the feedback!
            </div>
          ) : (
            <>
              <div style={fieldWrap}>
                <label style={labelStyle}>Software Name <span style={{ color: '#F87171' }}>*</span></label>
                <input style={inputStyle} placeholder="e.g. KCD, 2020 Design, Thermwood…" value={wlErpName} onChange={(e) => setWlErpName(e.target.value)} />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Your Email <span style={{ color: '#F87171' }}>*</span></label>
                <input style={inputStyle} type="email" placeholder="you@yourshop.com" value={wlEmail} onChange={(e) => setWlEmail(e.target.value)} />
              </div>
              <div style={fieldWrap}>
                <label style={labelStyle}>Notes (optional)</label>
                <textarea
                  rows={2}
                  placeholder="What data do you export? (jobs, cut lists, parts…)"
                  value={wlNotes}
                  onChange={(e) => setWlNotes(e.target.value)}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void handleWaitlist(wlErpName.trim() || 'Other')}
                disabled={wlSubmitting || !wlEmail.trim() || !wlErpName.trim()}
                style={{ alignSelf: 'flex-start', opacity: (wlSubmitting || !wlEmail.trim() || !wlErpName.trim()) ? 0.5 : 1 }}
              >
                {wlSubmitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </>
          )}
        </div>
      </ErpCard>

      {/* ── Standalone Plans Upload ── */}
      <ErpCard
        id="plans" open={openCard === 'plans'} onToggle={toggleCard}
        title="Upload Job Plans"
        statusBadge={<StatusPill label="Available" color="#34D399" bg="rgba(52,211,153,0.1)" />}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
            Upload PDFs, drawings, or reference files for any job. Crew will see them in the Plans section.
          </p>

          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ ...fieldWrap, width: 120, flexShrink: 0 }}>
              <label style={labelStyle}>Job # <span style={{ color: '#F87171' }}>*</span></label>
              <input style={inputStyle} placeholder="Job #" value={planJobNum} onChange={(e) => setPlanJobNum(e.target.value)} />
            </div>
            <div style={{ ...fieldWrap, flex: 1 }}>
              <label style={labelStyle}>Label (optional)</label>
              <input style={inputStyle} placeholder="e.g. Floor plan, Elevation…" value={planLabel} onChange={(e) => setPlanLabel(e.target.value)} />
            </div>
          </div>

          <div style={fieldWrap}>
            <label style={labelStyle}>File <span style={{ color: '#F87171' }}>*</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <label style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px',
                background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)',
                borderRadius: 8, cursor: 'pointer', fontSize: 13, color: 'var(--teal)', fontWeight: 600,
              }}>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Choose file
                <input
                  type="file" accept=".pdf,.png,.jpg,.jpeg,.dwg,.svg" style={{ display: 'none' }}
                  onChange={(e) => { if (e.target.files?.[0]) setPlanFile(e.target.files[0]); }}
                />
              </label>
              {planFile && <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{planFile.name}</span>}
            </div>
          </div>

          {plans.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>
              {plans.length} plan{plans.length !== 1 ? 's' : ''} uploaded across all jobs
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handlePlanUpload}
            disabled={planUploading || !planFile || !planJobNum.trim()}
            style={{ alignSelf: 'flex-start', opacity: (planUploading || !planFile || !planJobNum.trim()) ? 0.5 : 1 }}
          >
            {planUploading ? 'Uploading…' : 'Upload Plan'}
          </button>
        </div>
      </ErpCard>

    </div>
  );
}
