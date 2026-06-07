'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

// Supervisor modal for setting a job's finishing specs — upload a spec document
// and/or fill the structured form. Upserts into finish_specs.

type RoomOverride = { room: string; field: string; value: string };
const OVERRIDE_FIELDS = ['Cabinet Color', 'Door Color', 'Sheen', 'Finish', 'Notes'];
const FINISH_TYPES = ['Painted', 'Stained', 'Natural', 'Glazed', 'Other'];
const SHEENS = ['Flat', 'Satin', 'Semi-Gloss', 'Gloss', 'N/A'];

interface Props {
  tenantId: string;
  jobNumber: string;
  jobPath: string | null;
  onClose: () => void;
  showToast: (msg: string, error?: boolean) => void;
}

type Form = {
  cabinet_color: string; cabinet_finish: string; sheen: string; paint_type: string; primer: string;
  door_style: string; door_color: string; door_finish: string;
  edge_banding_color: string; edge_banding_type: string;
  stain_color: string; special_notes: string;
};
const EMPTY: Form = {
  cabinet_color: '', cabinet_finish: '', sheen: '', paint_type: '', primer: '',
  door_style: '', door_color: '', door_finish: '',
  edge_banding_color: '', edge_banding_type: '', stain_color: '', special_notes: '',
};

const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--ink-mute)', fontWeight: 600, display: 'block', marginBottom: 5 };
const sectionTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--teal)', margin: '6px 0 10px' };

export default function FinishSpecsModal({ tenantId, jobNumber, jobPath, onClose, showToast }: Props) {
  const [form, setForm] = useState<Form>(EMPTY);
  const [overrides, setOverrides] = useState<RoomOverride[]>([]);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [specFileUrl, setSpecFileUrl] = useState<string | null>(null);
  const [specFileName, setSpecFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    try {
      const { data } = await supabase.from('finish_specs').select('*').eq('tenant_id', tenantId).eq('job_number', jobNumber).maybeSingle();
      const row = data as (Form & { id: string; room_overrides: Record<string, Record<string, string>> | null; spec_file_url: string | null; spec_file_name: string | null }) | null;
      if (row) {
        setExistingId(row.id);
        setForm({
          cabinet_color: row.cabinet_color || '', cabinet_finish: row.cabinet_finish || '', sheen: row.sheen || '',
          paint_type: row.paint_type || '', primer: row.primer || '', door_style: row.door_style || '',
          door_color: row.door_color || '', door_finish: row.door_finish || '', edge_banding_color: row.edge_banding_color || '',
          edge_banding_type: row.edge_banding_type || '', stain_color: row.stain_color || '', special_notes: row.special_notes || '',
        });
        setSpecFileUrl(row.spec_file_url ?? null);
        setSpecFileName(row.spec_file_name ?? null);
        const ro: RoomOverride[] = [];
        Object.entries(row.room_overrides ?? {}).forEach(([room, fields]) => {
          Object.entries(fields as Record<string, string>).forEach(([field, value]) => ro.push({ room, field, value }));
        });
        setOverrides(ro);
      }
    } catch { /* table may not exist until migration runs */ }
    setLoading(false);
  }, [tenantId, jobNumber]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      let fileUrl = specFileUrl;
      let fileName = specFileName;
      if (file) {
        const path = `${tenantId}/${jobNumber}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage.from('finish-specs').upload(path, file, { upsert: true });
        if (upErr) throw upErr;
        fileUrl = supabase.storage.from('finish-specs').getPublicUrl(path).data.publicUrl;
        fileName = file.name;
      }
      // Build nested room_overrides object.
      const roObj: Record<string, Record<string, string>> = {};
      overrides.forEach((o) => {
        if (!o.room.trim() || !o.value.trim()) return;
        (roObj[o.room.trim()] ??= {})[o.field] = o.value.trim();
      });
      const payload = {
        tenant_id: tenantId, job_number: jobNumber, job_path: jobPath,
        ...form, room_overrides: roObj, spec_file_url: fileUrl, spec_file_name: fileName,
        updated_at: new Date().toISOString(),
      };
      if (existingId) {
        const { error } = await supabase.from('finish_specs').update(payload).eq('id', existingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('finish_specs').insert(payload).select('id').single();
        if (error) throw error;
        setExistingId((data as { id: string }).id);
      }
      showToast('Finish specs saved');
      onClose();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Save failed', true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 560, margin: '24px 0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Finish Specs</div>
            <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{(jobPath || jobNumber).split('/').join(' / ')}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {loading ? <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div> : (
            <>
              {/* Upload */}
              <div>
                <div style={sectionTitle}>Spec Document</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 10, border: '1px dashed var(--line-strong)', cursor: 'pointer', background: 'var(--bg-1, #11151a)' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                  <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{file ? file.name : specFileName ? `Current: ${specFileName} (replace)` : 'Upload PDF or image'}</span>
                  <input type="file" accept="application/pdf,image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>

              {/* Cabinet finish */}
              <div>
                <div style={sectionTitle}>Cabinet Finish</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Cabinet Color</label><input className="form-input" style={{ width: '100%' }} placeholder="e.g. Benjamin Moore White Dove OC-17" value={form.cabinet_color} onChange={(e) => set('cabinet_color', e.target.value)} /></div>
                  <div><label style={lbl}>Finish Type</label><select className="form-input" style={{ width: '100%' }} value={form.cabinet_finish} onChange={(e) => set('cabinet_finish', e.target.value)}><option value="">—</option>{FINISH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                  <div><label style={lbl}>Sheen</label><select className="form-input" style={{ width: '100%' }} value={form.sheen} onChange={(e) => set('sheen', e.target.value)}><option value="">—</option>{SHEENS.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                  <div><label style={lbl}>Paint Type</label><input className="form-input" style={{ width: '100%' }} placeholder="e.g. SW Emerald Urethane" value={form.paint_type} onChange={(e) => set('paint_type', e.target.value)} /></div>
                  <div><label style={lbl}>Primer (optional)</label><input className="form-input" style={{ width: '100%' }} value={form.primer} onChange={(e) => set('primer', e.target.value)} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><label style={lbl}>Stain Color (if stained)</label><input className="form-input" style={{ width: '100%' }} value={form.stain_color} onChange={(e) => set('stain_color', e.target.value)} /></div>
                </div>
              </div>

              {/* Doors */}
              <div>
                <div style={sectionTitle}>Doors</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={lbl}>Door Style</label><input className="form-input" style={{ width: '100%' }} placeholder="Shaker, Slab, Raised Panel" value={form.door_style} onChange={(e) => set('door_style', e.target.value)} /></div>
                  <div><label style={lbl}>Door Color</label><input className="form-input" style={{ width: '100%' }} value={form.door_color} onChange={(e) => set('door_color', e.target.value)} /></div>
                  <div><label style={lbl}>Door Finish</label><select className="form-input" style={{ width: '100%' }} value={form.door_finish} onChange={(e) => set('door_finish', e.target.value)}><option value="">—</option>{FINISH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
                </div>
              </div>

              {/* Edge banding */}
              <div>
                <div style={sectionTitle}>Edge Banding</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div><label style={lbl}>Color</label><input className="form-input" style={{ width: '100%' }} value={form.edge_banding_color} onChange={(e) => set('edge_banding_color', e.target.value)} /></div>
                  <div><label style={lbl}>Type</label><input className="form-input" style={{ width: '100%' }} placeholder="PVC, Wood, Painted" value={form.edge_banding_type} onChange={(e) => set('edge_banding_type', e.target.value)} /></div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label style={lbl}>Special Notes</label>
                <textarea className="form-input" rows={3} style={{ width: '100%', resize: 'vertical' }} value={form.special_notes} onChange={(e) => set('special_notes', e.target.value)} />
              </div>

              {/* Room overrides */}
              <div>
                <div style={sectionTitle}>Per-Room Overrides</div>
                {overrides.map((o, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input className="form-input" style={{ flex: '1 1 90px', minWidth: 0 }} placeholder="Room" value={o.room} onChange={(e) => setOverrides((prev) => prev.map((x, j) => j === i ? { ...x, room: e.target.value } : x))} />
                    <select className="form-input" style={{ flex: '0 0 120px' }} value={o.field} onChange={(e) => setOverrides((prev) => prev.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}>{OVERRIDE_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                    <input className="form-input" style={{ flex: '1 1 90px', minWidth: 0 }} placeholder="Value" value={o.value} onChange={(e) => setOverrides((prev) => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} />
                    <button onClick={() => setOverrides((prev) => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F87171', padding: 4, flexShrink: 0, display: 'flex' }}><svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                  </div>
                ))}
                <button onClick={() => setOverrides((prev) => [...prev, { room: '', field: OVERRIDE_FIELDS[0], value: '' }])}
                  style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>+ Add room override</button>
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--line)', display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving || loading} style={{ flex: 2, justifyContent: 'center', opacity: saving || loading ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save Finish Specs'}</button>
        </div>
      </div>
    </div>
  );
}
