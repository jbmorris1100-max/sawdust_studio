'use client';

// Supervisor-editable routing rules. The classify-units AI route reads these
// (priority ASC) and applies the first matching rule as a hard department
// override BEFORE its learned patterns / model call. Changes save immediately.

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type RoutingRule = {
  id: string;
  tenant_id: string;
  priority: number;
  condition_field: string;
  condition_operator: string;
  condition_value: string;
  assigned_dept: string;
  is_active: boolean;
};

type SeedRule = Pick<RoutingRule, 'priority' | 'condition_field' | 'condition_operator' | 'condition_value' | 'assigned_dept'>;

// Mirrors the previous hardcoded CRAFTSMAN_KEYWORDS / finishing logic. Order
// matters: priority 5 (adjustable shelf → production) must fire before
// priority 6 (shelf → craftsman).
const SEED_RULES: SeedRule[] = [
  { priority: 0, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'countertop',       assigned_dept: 'craftsman' },
  { priority: 1, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'floating shelf',   assigned_dept: 'craftsman' },
  { priority: 2, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'float shelf',      assigned_dept: 'craftsman' },
  { priority: 3, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'vent hood',        assigned_dept: 'craftsman' },
  { priority: 4, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'range hood',       assigned_dept: 'craftsman' },
  { priority: 5, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'adjustable shelf', assigned_dept: 'production' },
  { priority: 6, condition_field: 'unit_label', condition_operator: 'contains', condition_value: 'shelf',            assigned_dept: 'craftsman' },
  { priority: 7, condition_field: 'part_name',  condition_operator: 'contains', condition_value: 'edge band',        assigned_dept: 'finishing' },
  { priority: 8, condition_field: 'part_name',  condition_operator: 'contains', condition_value: 'door',             assigned_dept: 'finishing' },
  { priority: 9, condition_field: 'part_name',  condition_operator: 'contains', condition_value: 'drawer front',     assigned_dept: 'finishing' },
];

const FIELDS = ['unit_label', 'part_name', 'material', 'cabinet_type'] as const;
const OPERATORS = ['contains', 'equals', 'starts_with'] as const;
const DEPTS = ['production', 'craftsman', 'finishing', 'assembly'] as const;

const FIELD_LABEL: Record<string, string> = {
  unit_label: 'Unit label', part_name: 'Part name', material: 'Material', cabinet_type: 'Cabinet type',
};
const OP_LABEL: Record<string, string> = {
  contains: 'contains', equals: 'equals', starts_with: 'starts with',
};
const DEPT_COLOR: Record<string, string> = {
  production: '#2DE1C9', craftsman: '#FBBF24', finishing: '#F97316', assembly: '#3B82F6',
};

function deptColor(d: string): string { return DEPT_COLOR[d] ?? '#A78BFA'; }

function DeptBadge({ dept }: { dept: string }) {
  const c = deptColor(dept);
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, color: c, background: `${c}22`, border: `1px solid ${c}40`, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{dept}</span>
  );
}

export default function RoutingRulesPanel({ tenantId, showToast }: { tenantId: string; showToast: (msg: string, error?: boolean) => void }) {
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ field: string; operator: string; value: string; dept: string }>({
    field: 'unit_label', operator: 'contains', value: '', dept: 'craftsman',
  });
  const [busy, setBusy] = useState(false);
  const dragIndex = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const seeded = useRef(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('routing_rules')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('priority', { ascending: true });
      const rows = (data as RoutingRule[] | null) ?? [];
      // Seed defaults once for a tenant that has never configured rules.
      if (rows.length === 0 && !seeded.current) {
        seeded.current = true;
        try {
          await supabase.from('routing_rules').insert(
            SEED_RULES.map((r) => ({ ...r, tenant_id: tenantId, is_active: true })),
          );
          const { data: seededData } = await supabase
            .from('routing_rules')
            .select('*')
            .eq('tenant_id', tenantId)
            .order('priority', { ascending: true });
          setRules((seededData as RoutingRule[] | null) ?? []);
        } catch { setRules([]); }
      } else {
        setRules(rows);
      }
    } catch {
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  async function addRule() {
    const value = form.value.trim();
    if (!value || busy) return;
    setBusy(true);
    const priority = rules.length ? Math.max(...rules.map((r) => r.priority)) + 1 : 0;
    try {
      const { data, error } = await supabase.from('routing_rules').insert({
        tenant_id: tenantId, priority,
        condition_field: form.field, condition_operator: form.operator,
        condition_value: value, assigned_dept: form.dept, is_active: true,
      }).select('*').single();
      if (error) throw error;
      setRules((rs) => [...rs, data as RoutingRule]);
      setForm({ field: 'unit_label', operator: 'contains', value: '', dept: 'craftsman' });
      setAdding(false);
      showToast('Rule added');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not add rule', true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRule(id: string) {
    const prev = rules;
    setRules((rs) => rs.filter((r) => r.id !== id));
    try {
      const { error } = await supabase.from('routing_rules').delete().eq('id', id).eq('tenant_id', tenantId);
      if (error) throw error;
      showToast('Rule removed');
    } catch (err: unknown) {
      setRules(prev);
      showToast(err instanceof Error ? err.message : 'Could not remove rule', true);
    }
  }

  async function toggleActive(rule: RoutingRule) {
    const next = !rule.is_active;
    setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, is_active: next } : r));
    try {
      const { error } = await supabase.from('routing_rules')
        .update({ is_active: next, updated_at: new Date().toISOString() })
        .eq('id', rule.id).eq('tenant_id', tenantId);
      if (error) throw error;
    } catch (err: unknown) {
      setRules((rs) => rs.map((r) => r.id === rule.id ? { ...r, is_active: !next } : r));
      showToast(err instanceof Error ? err.message : 'Could not update rule', true);
    }
  }

  // Index-based reorder: move dragged row to target slot, renumber priority by
  // position, then persist every changed priority.
  async function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...rules];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const renumbered = next.map((r, i) => ({ ...r, priority: i }));
    const prev = rules;
    setRules(renumbered);
    try {
      // Persist only rows whose priority actually changed.
      const changed = renumbered.filter((r) => prev.find((p) => p.id === r.id)?.priority !== r.priority);
      await Promise.all(
        changed.map((r) => supabase.from('routing_rules').update({ priority: r.priority, updated_at: new Date().toISOString() }).eq('id', r.id).eq('tenant_id', tenantId)),
      );
    } catch (err: unknown) {
      setRules(prev);
      showToast(err instanceof Error ? err.message : 'Could not reorder', true);
    }
  }

  return (
    <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Routing Rules</div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>Department assignments the AI applies first, in priority order</div>
        </div>
        <button onClick={() => setAdding((a) => !a)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: '1px solid var(--teal)', background: 'rgba(45,225,201,0.1)', color: 'var(--teal)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Rule
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <select className="form-input" value={form.field} onChange={(e) => setForm((f) => ({ ...f, field: e.target.value }))} style={{ width: 'auto', minWidth: 130, cursor: 'pointer' }}>
            {FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABEL[f]}</option>)}
          </select>
          <select className="form-input" value={form.operator} onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value }))} style={{ width: 'auto', minWidth: 120, cursor: 'pointer' }}>
            {OPERATORS.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}
          </select>
          <input className="form-input" value={form.value} placeholder="value…" onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') void addRule(); }} style={{ flex: '1 1 160px', minWidth: 120 }} />
          <span style={{ color: 'var(--ink-mute)', fontSize: 13 }}>→</span>
          <select className="form-input" value={form.dept} onChange={(e) => setForm((f) => ({ ...f, dept: e.target.value }))} style={{ width: 'auto', minWidth: 120, cursor: 'pointer', textTransform: 'capitalize' }}>
            {DEPTS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button onClick={() => void addRule()} disabled={!form.value.trim() || busy}
            style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#2DE1C9', color: '#051A12', fontSize: 13, fontWeight: 800, cursor: (!form.value.trim() || busy) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: (!form.value.trim() || busy) ? 0.5 : 1 }}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => { setAdding(false); setForm({ field: 'unit_label', operator: 'contains', value: '', dept: 'craftsman' }); }}
            style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-mute)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
        </div>
      )}

      {/* Rules list */}
      {loading ? (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading rules…</div>
      ) : rules.length === 0 ? (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No routing rules yet. Add one to start steering departments.</div>
      ) : (
        rules.map((r, i) => (
          <div
            key={r.id}
            draggable
            onDragStart={() => { dragIndex.current = i; }}
            onDragOver={(e) => { e.preventDefault(); if (dragOver !== i) setDragOver(i); }}
            onDragEnd={() => { dragIndex.current = null; setDragOver(null); }}
            onDrop={(e) => { e.preventDefault(); const from = dragIndex.current; dragIndex.current = null; setDragOver(null); if (from != null) void reorder(from, i); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px',
              borderBottom: '1px solid var(--line)',
              background: dragOver === i ? 'rgba(45,225,201,0.06)' : 'transparent',
              opacity: r.is_active ? 1 : 0.45,
            }}
          >
            {/* Drag handle */}
            <span title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--ink-mute)', display: 'flex', flexShrink: 0 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg>
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', width: 20, textAlign: 'center', flexShrink: 0 }}>{i}</span>
            <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--ink-mute)' }}>{FIELD_LABEL[r.condition_field] ?? r.condition_field}</span>
              <span style={{ color: 'var(--ink-mute)', fontStyle: 'italic' }}>{OP_LABEL[r.condition_operator] ?? r.condition_operator}</span>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>&ldquo;{r.condition_value}&rdquo;</span>
              <span style={{ color: 'var(--ink-mute)' }}>→</span>
              <DeptBadge dept={r.assigned_dept} />
            </div>
            {/* Enable/disable toggle */}
            <button onClick={() => void toggleActive(r)} title={r.is_active ? 'Disable rule' : 'Enable rule'}
              style={{ width: 38, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', flexShrink: 0, padding: 0, position: 'relative', background: r.is_active ? 'rgba(45,225,201,0.35)' : 'var(--line)', transition: 'background 0.15s' }}>
              <span style={{ position: 'absolute', top: 2, left: r.is_active ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: r.is_active ? '#2DE1C9' : 'var(--ink-mute)', transition: 'left 0.15s' }} />
            </button>
            {/* Delete */}
            <button onClick={() => void deleteRule(r.id)} title="Delete rule"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', flexShrink: 0 }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        ))
      )}
    </div>
  );
}
