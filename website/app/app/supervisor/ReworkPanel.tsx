'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// ============================================================================
// Phase 6 — supervisor confirm/correct flow for PENDING rework (backward bounces)
// ============================================================================
// Surfaces ai_rework_events with status='pending' (ambiguous backward dept moves —
// NOT QC fails or damage, which are auto-confirmed). Grouped by bounce_event_id so
// one occurrence = one card even though the underlying rows are per-part.
//
//   • "Normal, don't flag again"  -> writes ai_rework_suppressions for each distinct
//        (from_dept, to_dept, part_name_pattern) in the group, and sets the group's
//        events to status='dismissed'. Future detect-rework runs skip that pattern.
//   • "Log it"                    -> small form (category + notes) -> inserts a
//        damage_reports row (report_type='damage', logged_by_role='supervisor',
//        rework_category=...) and sets the group's events to status='confirmed'.
//   • "Scan now"                  -> POST /app/api/detect-rework to refresh pending.
//
// All reads/writes go through the browser client under the supervisor's session;
// ai_rework_events / ai_rework_suppressions tenant_isolation RLS scopes them.
// ============================================================================

type Props = { tenantId: string; showToast: (msg: string, error?: boolean) => void };

type EventRow = {
  id: string;
  bounce_event_id: string;
  part_id: string | null;
  cabinet_unit_id: string | null;
  job_number: string | null;
  from_dept: string | null;
  to_dept: string | null;
  occurred_at: string;
  part_name_pattern: string | null;
};

type Group = {
  key: string;
  from_dept: string | null;
  to_dept: string | null;
  job_number: string | null;
  cabinetLabel: string | null;
  occurred_at: string;
  rowIds: string[];
  partNames: string[];                         // distinct, for display
  patterns: { from: string; to: string; pattern: string }[]; // distinct suppression keys
};

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'damaged', label: 'Damaged' },
  { value: 'wrong_dimensions', label: 'Wrong dimensions' },
  { value: 'wrong_hole_placement', label: 'Wrong hole placement' },
  { value: 'other', label: 'Other' },
];

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '—');
function whenLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ReworkPanel({ tenantId, showToast }: Props) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [formKey, setFormKey] = useState<string | null>(null); // which card's "Log it" form is open
  const [category, setCategory] = useState('damaged');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('ai_rework_events')
      .select('id, bounce_event_id, part_id, cabinet_unit_id, job_number, from_dept, to_dept, occurred_at, part_name_pattern')
      .eq('tenant_id', tenantId).eq('status', 'pending')
      .order('occurred_at', { ascending: false });
    if (error) { showToast(`Could not load rework: ${error.message}`, true); setGroups([]); setLoading(false); return; }
    const rows = (data as EventRow[] | null) ?? [];

    // Resolve part names + cabinet labels for display.
    const partIds = [...new Set(rows.map((r) => r.part_id).filter(Boolean) as string[])];
    const cabIds = [...new Set(rows.map((r) => r.cabinet_unit_id).filter(Boolean) as string[])];
    const partName: Record<string, string> = {};
    const cabLabel: Record<string, string> = {};
    if (partIds.length) {
      const { data: p } = await supabase.from('parts').select('id, part_name').in('id', partIds);
      for (const r of (p as { id: string; part_name: string | null }[] | null) ?? []) partName[r.id] = r.part_name ?? '';
    }
    if (cabIds.length) {
      const { data: c } = await supabase.from('cabinet_units').select('id, unit_label, cabinet_number').in('id', cabIds);
      for (const r of (c as { id: string; unit_label: string | null; cabinet_number: string | null }[] | null) ?? [])
        cabLabel[r.id] = r.unit_label || r.cabinet_number || '';
    }

    // Group by bounce_event_id.
    const byKey = new Map<string, Group>();
    for (const r of rows) {
      let g = byKey.get(r.bounce_event_id);
      if (!g) {
        g = {
          key: r.bounce_event_id, from_dept: r.from_dept, to_dept: r.to_dept, job_number: r.job_number,
          cabinetLabel: r.cabinet_unit_id ? (cabLabel[r.cabinet_unit_id] || null) : null,
          occurred_at: r.occurred_at, rowIds: [], partNames: [], patterns: [],
        };
        byKey.set(r.bounce_event_id, g);
      }
      g.rowIds.push(r.id);
      const nm = r.part_id ? partName[r.part_id] : '';
      if (nm && !g.partNames.includes(nm)) g.partNames.push(nm);
      const pat = r.part_name_pattern ?? '';
      const from = r.from_dept ?? '', to = r.to_dept ?? '';
      if (!g.patterns.some((x) => x.from === from && x.to === to && x.pattern === pat))
        g.patterns.push({ from, to, pattern: pat });
    }
    setGroups([...byKey.values()]);
    setLoading(false);
  }, [tenantId, showToast]);

  useEffect(() => { void load(); }, [load]);

  async function scanNow() {
    setScanning(true);
    try {
      const res = await fetch('/app/api/detect-rework', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId, dryRun: false }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'scan failed');
      showToast(`Scan complete — ${j.backwardBouncePending ?? 0} pending, ${j.suppressedByRule ?? 0} suppressed`);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Scan failed', true);
    } finally { setScanning(false); }
  }

  async function markNormal(g: Group) {
    setBusyKey(g.key);
    try {
      const sup = g.patterns.map((p) => ({
        tenant_id: tenantId, from_dept: p.from, to_dept: p.to, part_name_pattern: p.pattern, created_by: 'supervisor',
      }));
      const { error: sErr } = await supabase
        .from('ai_rework_suppressions')
        .upsert(sup, { onConflict: 'tenant_id,from_dept,to_dept,part_name_pattern', ignoreDuplicates: true });
      if (sErr) throw sErr;
      const { error: uErr } = await supabase
        .from('ai_rework_events').update({ status: 'dismissed' }).in('id', g.rowIds).eq('tenant_id', tenantId);
      if (uErr) throw uErr;
      setGroups((prev) => prev.filter((x) => x.key !== g.key));
      showToast("Marked normal — won't flag this pattern again");
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', true);
    } finally { setBusyKey(null); }
  }

  async function logIt(g: Group) {
    setBusyKey(g.key);
    try {
      const desc = g.partNames.length ? g.partNames.join(', ') : (g.cabinetLabel || 'Rework');
      const { error: dErr } = await supabase.from('damage_reports').insert({
        tenant_id: tenantId,
        part_name: desc.slice(0, 200),
        dept: g.to_dept,
        report_type: 'damage',
        logged_by_role: 'supervisor',
        rework_category: category,
        status: 'open',
        notes: notes.trim() || null,
        ...(g.job_number && { job_id: g.job_number }),
      });
      if (dErr) throw dErr;
      const { error: uErr } = await supabase
        .from('ai_rework_events').update({ status: 'confirmed' }).in('id', g.rowIds).eq('tenant_id', tenantId);
      if (uErr) throw uErr;
      setGroups((prev) => prev.filter((x) => x.key !== g.key));
      setFormKey(null); setNotes(''); setCategory('damaged');
      showToast('Logged as rework');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed', true);
    } finally { setBusyKey(null); }
  }

  return (
    <div data-testid="rework-panel" style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, maxWidth: 560 }}>
          Parts moved <strong>backward</strong> through the shop that weren&apos;t a QC fail or a damage report.
          Confirm real rework, or mark a normal re-route so it isn&apos;t flagged again.
        </p>
        <button data-testid="rework-scan" onClick={scanNow} disabled={scanning} style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', cursor: scanning ? 'default' : 'pointer',
          color: 'var(--teal)', background: 'none', border: '1px solid var(--teal)', borderRadius: 8, fontFamily: 'inherit', opacity: scanning ? 0.6 : 1,
        }}>{scanning ? 'Scanning…' : 'Scan now'}</button>
      </div>

      {loading ? (
        <div style={{ padding: '16px 0', fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
      ) : groups.length === 0 ? (
        <div data-testid="rework-empty" style={{ padding: '20px', fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center', border: '1px dashed var(--line)', borderRadius: 10 }}>
          No pending rework. Backward moves you haven&apos;t reviewed will appear here after a scan.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groups.map((g) => (
            <div key={g.key} data-testid="rework-card" data-bounce-event-id={g.key} style={{
              border: '1px solid var(--line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                    {g.cabinetLabel || 'Cabinet'}{g.job_number ? <span style={{ color: 'var(--ink-mute)', fontWeight: 500 }}> · {g.job_number}</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                    <strong style={{ color: 'var(--amber, #D97706)' }}>{cap(g.from_dept)} → {cap(g.to_dept)}</strong>
                    {' · '}{g.rowIds.length} part{g.rowIds.length === 1 ? '' : 's'}{' · '}{whenLabel(g.occurred_at)}
                  </div>
                  {g.partNames.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 4 }}>{g.partNames.slice(0, 6).join(', ')}{g.partNames.length > 6 ? '…' : ''}</div>
                  )}
                </div>
              </div>

              {formKey === g.key ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <select data-testid="rework-category" value={category} onChange={(e) => setCategory(e.target.value)} style={{
                    padding: '8px 10px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface, #fff)', fontFamily: 'inherit',
                  }}>
                    {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <textarea data-testid="rework-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened? (optional)" rows={2} style={{
                    padding: '8px 10px', fontSize: 13, border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit', resize: 'vertical',
                  }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button data-testid="rework-log-submit" onClick={() => logIt(g)} disabled={busyKey === g.key} style={btn('solid')}>
                      {busyKey === g.key ? 'Saving…' : 'Save rework'}
                    </button>
                    <button onClick={() => { setFormKey(null); setNotes(''); }} disabled={busyKey === g.key} style={btn('ghost')}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button data-testid="rework-log" onClick={() => { setFormKey(g.key); setCategory('damaged'); setNotes(''); }} disabled={busyKey === g.key} style={btn('solid')}>Log it</button>
                  <button data-testid="rework-normal" onClick={() => markNormal(g)} disabled={busyKey === g.key} style={btn('ghost')}>
                    {busyKey === g.key ? '…' : "Normal, don't flag again"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btn(kind: 'solid' | 'ghost'): React.CSSProperties {
  return {
    padding: '8px 13px', fontSize: 12, fontWeight: 700, cursor: 'pointer', borderRadius: 8, fontFamily: 'inherit', whiteSpace: 'nowrap',
    color: kind === 'solid' ? '#fff' : 'var(--ink-mute)',
    background: kind === 'solid' ? 'var(--teal)' : 'none',
    border: kind === 'solid' ? '1px solid var(--teal)' : '1px solid var(--line)',
  };
}
