'use client';
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { colorToHex, recomputeCabinet } from '@/lib/partActions';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';

// The Finishing department's home view. Shows the finish specs the supervisor set
// for active jobs (color chips, door/edge summaries, room overrides, the uploaded
// spec doc + drawings) and the list of individual parts that were pushed to the
// Finishing dept ("Parts to Finish") with a Mark Complete action.

type FinishSpec = {
  id: string;
  job_number: string;
  job_path: string | null;
  cabinet_color: string | null;
  cabinet_finish: string | null;
  sheen: string | null;
  paint_type: string | null;
  primer: string | null;
  stain_color: string | null;
  door_style: string | null;
  door_color: string | null;
  door_finish: string | null;
  edge_banding_color: string | null;
  edge_banding_type: string | null;
  special_notes: string | null;
  room_overrides: Record<string, Record<string, string>> | null;
  spec_file_url: string | null;
  spec_file_name: string | null;
};

type FinishPart = {
  id: string;
  part_name: string;
  cabinet_unit_id: string;
  job_number: string | null;
  cabinetLabel: string;
  cabinetKey: string;
  jobPath: string;
};

interface Props {
  tenantId: string;
  showToast: (msg: string, error?: boolean) => void;
}

const card: React.CSSProperties = { padding: '16px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid var(--line)' };
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 };
const rowLabel: React.CSSProperties = { fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600 };
const rowVal: React.CSSProperties = { fontSize: 13.5, color: 'var(--ink)', fontWeight: 600 };

const ColorChip = ({ color }: { color: string | null }) => (
  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, background: colorToHex(color), border: '1px solid rgba(255,255,255,0.18)', display: 'inline-block' }} />
);

function specSummary(s: FinishSpec): boolean {
  return !!(s.cabinet_color || s.door_style || s.door_color || s.edge_banding_color || s.spec_file_url || s.special_notes);
}

export default function FinishingView({ tenantId, showToast }: Props) {
  const [specs, setSpecs] = useState<FinishSpec[]>([]);
  const [parts, setParts] = useState<FinishPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [fullSpec, setFullSpec] = useState<FinishSpec | null>(null);
  const [specFile, setSpecFile] = useState<ViewerFile | null>(null);

  const load = useCallback(async () => {
    try {
      // Active jobs (so we only show specs for jobs still in progress).
      let activeJobNums: string[] | null = null;
      try {
        const { data: jrows } = await supabase
          .from('jobs').select('job_number').eq('tenant_id', tenantId).eq('status', 'active');
        activeJobNums = ((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number);
      } catch { /* jobs table optional */ }

      // Finish specs.
      const { data: specRows } = await supabase
        .from('finish_specs').select('*').eq('tenant_id', tenantId).order('updated_at', { ascending: false });
      let specList = (specRows as FinishSpec[] | null) ?? [];
      if (activeJobNums && activeJobNums.length > 0) {
        const set = new Set(activeJobNums);
        specList = specList.filter((s) => set.has(s.job_number));
      }
      setSpecs(specList);

      // Parts pushed to finishing (not yet complete).
      const { data: partRows } = await supabase
        .from('parts')
        .select('id, part_name, cabinet_unit_id, job_number, status')
        .eq('tenant_id', tenantId)
        .eq('assigned_dept', 'finishing')
        .neq('status', 'complete')
        .limit(400);
      const pRows = (partRows as { id: string; part_name: string; cabinet_unit_id: string; job_number: string | null; status: string | null }[] | null) ?? [];

      // Resolve cabinet labels + job paths.
      const cabIds = Array.from(new Set(pRows.map((p) => p.cabinet_unit_id).filter(Boolean)));
      const cabMap: Record<string, { label: string; key: string }> = {};
      if (cabIds.length > 0) {
        const { data: cabs } = await supabase
          .from('cabinet_units').select('id, unit_label, cabinet_number').in('id', cabIds);
        ((cabs as { id: string; unit_label: string | null; cabinet_number: string | null }[] | null) ?? []).forEach((c) => {
          cabMap[c.id] = { label: c.unit_label || c.cabinet_number || 'Cabinet', key: c.cabinet_number || c.unit_label || '' };
        });
      }
      const jobNums = Array.from(new Set(pRows.map((p) => p.job_number).filter(Boolean))) as string[];
      const jobPathMap: Record<string, string> = {};
      specList.forEach((s) => { if (s.job_path) jobPathMap[s.job_number] = s.job_path; });
      const missing = jobNums.filter((n) => !jobPathMap[n]);
      if (missing.length > 0) {
        try {
          const { data: jrows } = await supabase.from('jobs').select('job_number, job_path').eq('tenant_id', tenantId).in('job_number', missing);
          ((jrows as { job_number: string; job_path: string | null }[] | null) ?? []).forEach((j) => { jobPathMap[j.job_number] = j.job_path || `Job ${j.job_number}`; });
        } catch { /* best-effort */ }
      }

      setParts(pRows.map((p) => {
        const cab = cabMap[p.cabinet_unit_id] ?? { label: 'Cabinet', key: '' };
        return {
          id: p.id, part_name: p.part_name, cabinet_unit_id: p.cabinet_unit_id, job_number: p.job_number,
          cabinetLabel: cab.label, cabinetKey: cab.key,
          jobPath: (p.job_number && jobPathMap[p.job_number]) || (p.job_number ? `Job ${p.job_number}` : 'Unassigned'),
        };
      }));
    } catch { /* tables may not exist until migrations run */ }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // Realtime: refresh when specs or finishing parts change.
  useEffect(() => {
    const ch = supabase
      .channel('rt-finishing')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finish_specs', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId, load]);

  async function markComplete(part: FinishPart) {
    if (busy[part.id]) return;
    setBusy((b) => ({ ...b, [part.id]: true }));
    try {
      const { error } = await supabase.from('parts').update({ status: 'complete', production_status: 'complete', checked_at: new Date().toISOString() }).eq('id', part.id).eq('tenant_id', tenantId);
      if (error) throw error;
      await recomputeCabinet(tenantId, part.cabinet_unit_id);
      setParts((prev) => prev.filter((p) => p.id !== part.id));
      showToast('Part marked complete');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update part', true);
    } finally {
      setBusy((b) => ({ ...b, [part.id]: false }));
    }
  }

  function openFullSpec(s: FinishSpec) {
    if (s.spec_file_url) {
      setSpecFile({ url: s.spec_file_url, name: s.spec_file_name || 'Finish Spec', jobPath: s.job_path ?? undefined });
    } else {
      setFullSpec(s);
    }
  }

  return (
    <>
      {/* ── Finish Specs ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 32 }}>
        <div style={sectionLabel}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Z"/><path d="M9 21h6"/></svg>
          Finish Specs
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading finish specs…</div>
        ) : specs.filter(specSummary).length === 0 ? (
          <div style={{ ...card, textAlign: 'center', color: 'var(--ink-mute)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No finish specs uploaded</div>
            <div style={{ fontSize: 12.5 }}>Ask your supervisor to add finish specs.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {specs.filter(specSummary).map((s) => {
              const overrides = Object.entries(s.room_overrides ?? {});
              return (
                <div key={s.id} style={card}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>{(s.job_path || `Job ${s.job_number}`).split('/').map((x) => x.trim()).join(' / ')}</div>

                  {/* Cabinet finish */}
                  {(s.cabinet_color || s.cabinet_finish || s.sheen) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <ColorChip color={s.cabinet_color} />
                      <div style={{ minWidth: 0 }}>
                        <div style={rowLabel}>Cabinet</div>
                        <div style={rowVal}>{s.cabinet_color || '—'}{(s.cabinet_finish || s.sheen) ? <span style={{ fontWeight: 500, color: 'var(--ink-dim)' }}>{`  ·  ${[s.cabinet_finish, s.sheen].filter(Boolean).join(', ')}`}</span> : null}</div>
                        {s.paint_type && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 1 }}>{s.paint_type}{s.primer ? ` · Primer: ${s.primer}` : ''}</div>}
                      </div>
                    </div>
                  )}

                  {/* Door */}
                  {(s.door_style || s.door_color || s.door_finish) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <ColorChip color={s.door_color || s.cabinet_color} />
                      <div style={{ minWidth: 0 }}>
                        <div style={rowLabel}>Doors</div>
                        <div style={rowVal}>{[s.door_style, s.door_color].filter(Boolean).join(' · ') || '—'}{s.door_finish ? <span style={{ fontWeight: 500, color: 'var(--ink-dim)' }}>{`  ·  ${s.door_finish}`}</span> : null}</div>
                      </div>
                    </div>
                  )}

                  {/* Edge banding */}
                  {(s.edge_banding_color || s.edge_banding_type) && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={rowLabel}>Edge Banding</div>
                      <div style={rowVal}>{[s.edge_banding_color, s.edge_banding_type].filter(Boolean).join(' · ')}</div>
                    </div>
                  )}

                  {/* Room overrides */}
                  {overrides.length > 0 && (
                    <div style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.18)' }}>
                      <div style={{ ...rowLabel, color: '#A78BFA', marginBottom: 6 }}>Room Overrides</div>
                      {overrides.map(([room, fields]) => (
                        <div key={room} style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 3 }}>
                          <b style={{ color: 'var(--ink)' }}>{room}</b>{' — '}{Object.entries(fields).map(([f, v]) => `${f}: ${v}`).join(', ')}
                        </div>
                      ))}
                    </div>
                  )}

                  {s.special_notes && <div style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginTop: 10, lineHeight: 1.5 }}>{s.special_notes}</div>}

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                    <button
                      onClick={() => openFullSpec(s)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                      View Full Spec
                    </button>
                    <ViewDrawingsButton tenantId={tenantId} jobNumber={s.job_number} cabinetKey="" />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Parts to Finish ────────────────────────────────────────────────── */}
      {parts.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={sectionLabel}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>
            Parts to Finish ({parts.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {parts.map((p) => (
              <div key={p.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.part_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.cabinetLabel} · {p.jobPath.split('/').map((x) => x.trim()).join(' / ')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                  <ViewDrawingsButton tenantId={tenantId} jobNumber={p.job_number} cabinetKey={p.cabinetKey} compact />
                  <button
                    onClick={() => void markComplete(p)}
                    disabled={busy[p.id]}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, background: 'rgba(45,225,201,0.1)', border: '1px solid rgba(45,225,201,0.3)', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: busy[p.id] ? 'not-allowed' : 'pointer', opacity: busy[p.id] ? 0.6 : 1, fontFamily: 'inherit' }}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    Done
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full-spec form modal (when no PDF uploaded) */}
      {fullSpec && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setFullSpec(null); }} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 480, margin: '24px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{(fullSpec.job_path || `Job ${fullSpec.job_number}`).split('/').map((x) => x.trim()).join(' / ')}</div>
              <button onClick={() => setFullSpec(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}><svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {([
                ['Cabinet Color', fullSpec.cabinet_color], ['Cabinet Finish', fullSpec.cabinet_finish], ['Sheen', fullSpec.sheen],
                ['Paint Type', fullSpec.paint_type], ['Primer', fullSpec.primer], ['Stain Color', fullSpec.stain_color],
                ['Door Style', fullSpec.door_style], ['Door Color', fullSpec.door_color], ['Door Finish', fullSpec.door_finish],
                ['Edge Banding Color', fullSpec.edge_banding_color], ['Edge Banding Type', fullSpec.edge_banding_type],
              ] as [string, string | null][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
                  <span style={rowLabel}>{k}</span>
                  <span style={{ ...rowVal, textAlign: 'right', display: 'flex', alignItems: 'center', gap: 8 }}>{k.includes('Color') ? <ColorChip color={v} /> : null}{v}</span>
                </div>
              ))}
              {fullSpec.special_notes && (
                <div><div style={{ ...rowLabel, marginBottom: 4 }}>Special Notes</div><div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{fullSpec.special_notes}</div></div>
              )}
              {Object.entries(fullSpec.room_overrides ?? {}).length > 0 && (
                <div>
                  <div style={{ ...rowLabel, color: '#A78BFA', marginBottom: 6 }}>Room Overrides</div>
                  {Object.entries(fullSpec.room_overrides ?? {}).map(([room, fields]) => (
                    <div key={room} style={{ fontSize: 12.5, color: 'var(--ink-dim)', marginBottom: 3 }}><b style={{ color: 'var(--ink)' }}>{room}</b>{' — '}{Object.entries(fields).map(([f, v]) => `${f}: ${v}`).join(', ')}</div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {specFile && <FileViewer file={specFile} onClose={() => setSpecFile(null)} />}
    </>
  );
}
