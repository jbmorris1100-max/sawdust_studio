'use client';
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNotify } from '@/lib/notify';
import CabinetScanner from '../scan/CabinetScanner';

// ── QC Inspector view ─────────────────────────────────────────────────────────
// Rendered in the crew app when a QC delegate enters via /app/crew?qc=1. The
// delegate scans (or types) a cabinet label, reviews each part Pass/Fail, then
// confirms. All-pass completes the cabinet (and notifies the supervisor, plus a
// "Job Fully QC'd" notice when it was the last cabinet); any fail puts the
// cabinet on QC hold and notifies the supervisor.

type CabRow = {
  id: string;
  unit_label: string | null;
  cabinet_number: string | null;
  job_number: string | null;
  status: string | null;
  assigned_dept: string | null;
};

type QcPart = {
  id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number | null;
};

interface Props {
  tenantId: string;
  qcName: string;
  showToast: (msg: string, error?: boolean) => void;
  onExit: () => void;
}

function dimText(p: QcPart): string {
  return [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
}

const primaryBtn: React.CSSProperties = {
  width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8,
  padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit',
  background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer',
};

export default function QcInspectorView({ tenantId, qcName, showToast, onExit }: Props) {
  const [scanning, setScanning] = useState(false);
  const [cabinet, setCabinet] = useState<CabRow | null>(null);
  const [parts, setParts] = useState<QcPart[]>([]);
  const [verdicts, setVerdicts] = useState<Record<string, 'pass' | 'fail'>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadCabinet = useCallback(async (cab: CabRow) => {
    setScanning(false);
    setCabinet(cab);
    setParts([]);
    setVerdicts({});
    setLoading(true);
    try {
      const { data } = await supabase
        .from('parts')
        .select('id, part_name, material, width, height, depth, quantity')
        .eq('tenant_id', tenantId)
        .eq('cabinet_unit_id', cab.id)
        .order('part_name');
      setParts((data as QcPart[] | null) ?? []);
    } catch {
      showToast('Could not load parts for this cabinet', true);
    } finally {
      setLoading(false);
    }
  }, [tenantId, showToast]);

  function setVerdict(partId: string, v: 'pass' | 'fail') {
    setVerdicts((prev) => ({ ...prev, [partId]: v }));
  }

  function reset() {
    setCabinet(null);
    setParts([]);
    setVerdicts({});
  }

  const allMarked = parts.length > 0 && parts.every((p) => verdicts[p.id]);
  const hasFailures = parts.some((p) => verdicts[p.id] === 'fail');

  async function confirmQc() {
    if (!cabinet || busy || !allMarked) return;
    setBusy(true);
    const label = cabinet.unit_label || cabinet.cabinet_number || 'Cabinet';
    const jobNum = cabinet.job_number;
    try {
      if (hasFailures) {
        const { error } = await supabase.from('cabinet_units')
          .update({ status: 'qc_hold', assigned_dept: 'qc' })
          .eq('id', cabinet.id).eq('tenant_id', tenantId);
        if (error) throw error;
        sendNotify({
          tenant_id: tenantId, target: 'supervisor',
          title: 'QC Failed',
          body: `QC Failed — ${label}${jobNum ? ` ${jobNum}` : ''}`,
          url: '/app/supervisor',
        });
        showToast(`${label} put on QC hold`);
      } else {
        const now = new Date().toISOString();
        const { error } = await supabase.from('cabinet_units')
          .update({ status: 'complete', assigned_dept: 'complete', qc_by: qcName, qc_at: now })
          .eq('id', cabinet.id).eq('tenant_id', tenantId);
        if (error) throw error;
        try {
          await supabase.from('parts')
            .update({ status: 'complete', assigned_dept: 'complete' })
            .eq('cabinet_unit_id', cabinet.id).eq('tenant_id', tenantId);
        } catch { /* best-effort */ }
        sendNotify({
          tenant_id: tenantId, target: 'supervisor',
          title: 'QC Complete',
          body: `QC Complete — ${label}${jobNum ? ` ${jobNum}` : ''}`,
          url: '/app/supervisor',
        });
        // If every cabinet on this job is now complete, fire the job-level notice.
        if (jobNum) {
          try {
            const { data } = await supabase.from('cabinet_units')
              .select('status').eq('tenant_id', tenantId).eq('job_number', jobNum);
            const rows = (data as { status: string | null }[] | null) ?? [];
            if (rows.length > 0 && rows.every((r) => (r.status || '').toLowerCase() === 'complete')) {
              sendNotify({
                tenant_id: tenantId, target: 'supervisor',
                title: "Job Fully QC'd",
                body: `Job Fully QC'd — ${jobNum}`,
                url: '/app/supervisor',
              });
            }
          } catch { /* best-effort */ }
        }
        showToast(`${label} passed QC`);
      }
      reset();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save QC result', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'rgba(5,6,8,0.92)', backdropFilter: 'blur(12px)', zIndex: 10 }}>
        <span style={{ color: 'var(--teal)', display: 'flex' }}>
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--ink)' }}>QC Inspector</div>
          <div style={{ fontSize: 12, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{qcName}</div>
        </div>
        <button onClick={onExit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', fontSize: 13, fontFamily: 'inherit', padding: '6px 10px' }}>
          Exit
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '18px', maxWidth: 560, width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!cabinet ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 24 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--ink)' }}>Scan a cabinet to inspect</div>
              <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 6, lineHeight: 1.5 }}>
                Scan the cabinet label, review each part, then pass or fail the unit.
              </div>
            </div>
            <button onClick={() => setScanning(true)} style={primaryBtn}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
              Scan Cabinet
            </button>
          </div>
        ) : (
          <>
            {/* Cabinet header */}
            <div style={{ padding: '18px 18px', borderRadius: 14, background: 'var(--bg-1)', border: '1px solid rgba(45,225,201,0.3)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 6 }}>Inspecting</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{cabinet.unit_label || cabinet.cabinet_number || 'Cabinet'}</div>
              {cabinet.job_number && <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 4 }}>Job {cabinet.job_number}</div>}
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading parts…</div>
            ) : parts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--ink-mute)', fontSize: 13, background: 'var(--bg-1)', borderRadius: 14, border: '1px solid var(--line)' }}>
                No parts loaded for this cabinet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {parts.map((p) => {
                  const v = verdicts[p.id];
                  const dims = dimText(p);
                  return (
                    <div key={p.id} style={{ padding: '13px 14px', borderRadius: 12, background: 'var(--bg-1)', border: `1px solid ${v === 'fail' ? 'rgba(248,113,113,0.4)' : v === 'pass' ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                          {p.part_name}
                          {p.quantity && p.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{p.quantity}</span>}
                        </div>
                        {(dims || p.material) && <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{[dims, p.material].filter(Boolean).join(' · ')}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setVerdict(p.id, 'pass')}
                          style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '9px', borderRadius: 9, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', background: v === 'pass' ? '#2DE1C9' : 'rgba(45,225,201,0.1)', border: `1px solid ${v === 'pass' ? '#2DE1C9' : 'rgba(45,225,201,0.3)'}`, color: v === 'pass' ? '#04201c' : '#2DE1C9' }}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Pass
                        </button>
                        <button onClick={() => setVerdict(p.id, 'fail')}
                          style={{ flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6, padding: '9px', borderRadius: 9, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', background: v === 'fail' ? '#F87171' : 'rgba(248,113,113,0.1)', border: `1px solid ${v === 'fail' ? '#F87171' : 'rgba(248,113,113,0.3)'}`, color: v === 'fail' ? '#1a0606' : '#F87171' }}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          Fail
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <button onClick={() => void confirmQc()} disabled={!allMarked || busy}
                style={{ ...primaryBtn, background: !allMarked || busy ? 'var(--bg-1)' : hasFailures ? '#F87171' : '#2DE1C9', color: !allMarked || busy ? 'var(--ink-mute)' : hasFailures ? '#1a0606' : '#04201c', cursor: !allMarked || busy ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Saving…' : hasFailures ? 'Confirm QC — Send to Hold' : 'Confirm QC — Pass'}
              </button>
              <button onClick={reset} disabled={busy}
                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: busy ? 'not-allowed' : 'pointer' }}>
                Scan a different cabinet
              </button>
            </div>
          </>
        )}
      </div>

      {scanning && (
        <CabinetScanner
          tenantId={tenantId}
          onClose={() => setScanning(false)}
          onMatch={(cab) => void loadCabinet(cab)}
        />
      )}
    </div>
  );
}
