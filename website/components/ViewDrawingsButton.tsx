'use client';
import { useState } from 'react';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import { findCabinetDrawings } from '@/lib/partActions';

// A self-contained "View Drawings" button. On tap it looks up the drawings for a
// cabinet (narrowed to the cabinet key when filenames match), then opens the
// existing FileViewer. Manages its own overlay so it drops into any cabinet header.
interface Props {
  tenantId: string;
  jobNumber: string | null;
  cabinetKey: string;     // e.g. "K01" / unit label — used to narrow the drawing match
  compact?: boolean;      // icon-only
  label?: string;
}

type Phase = 'closed' | 'loading' | 'empty' | 'list' | 'viewer';

const IcoDoc = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);

export default function ViewDrawingsButton({ tenantId, jobNumber, cabinetKey, compact, label }: Props) {
  const [phase, setPhase] = useState<Phase>('closed');
  const [files, setFiles] = useState<ViewerFile[]>([]);
  const [mode, setMode]   = useState<'specific' | 'all' | 'none'>('none');
  const [idx, setIdx]     = useState(0);

  async function open(e: React.MouseEvent) {
    e.stopPropagation();
    setPhase('loading');
    const res = await findCabinetDrawings(tenantId, jobNumber, cabinetKey);
    setFiles(res.files);
    setMode(res.mode);
    if (res.files.length === 0) setPhase('empty');
    else if (res.files.length === 1) { setIdx(0); setPhase('viewer'); }
    else setPhase('list');
  }

  function close() { setPhase('closed'); }

  return (
    <>
      <button
        type="button"
        onClick={open}
        title="View drawings for this cabinet"
        style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: compact ? 5 : '5px 10px', borderRadius: 8,
          background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.22)',
          color: '#A78BFA', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <IcoDoc /> {!compact && (label ?? 'View Drawings')}
      </button>

      {phase === 'loading' && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1800, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-dim)', fontSize: 14 }}>
          Loading drawings…
        </div>
      )}

      {phase === 'empty' && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1800, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 18, padding: 28, maxWidth: 360, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>No drawings uploaded for this job</div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 18 }}>Ask your supervisor to upload plans.</div>
            <button onClick={close} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Close</button>
          </div>
        </div>
      )}

      {phase === 'list' && (
        <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1800, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: '#0a0d10', borderTop: '1px solid var(--line-strong)', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '18px 16px calc(18px + env(safe-area-inset-bottom))', maxHeight: '70vh', overflowY: 'auto' }}>
            {mode === 'all' && (
              <div style={{ fontSize: 12.5, color: '#FBBF24', marginBottom: 12 }}>No drawings specific to this cabinet — showing all job drawings.</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {files.map((f, i) => (
                <button key={`${f.url}-${i}`} onClick={() => { setIdx(i); setPhase('viewer'); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', borderRadius: 12, background: 'var(--bg-1, #11151a)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}>
                  <span style={{ color: '#A78BFA', display: 'flex', flexShrink: 0 }}><IcoDoc /></span>
                  <span style={{ fontSize: 14, color: 'var(--ink)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                </button>
              ))}
            </div>
            <button onClick={close} style={{ marginTop: 14, width: '100%', minHeight: 44, borderRadius: 12, border: 'none', background: 'none', color: 'var(--ink-mute)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Close</button>
          </div>
        </div>
      )}

      {phase === 'viewer' && files[idx] && (
        <FileViewer file={files[idx]} onClose={() => { if (files.length > 1) setPhase('list'); else close(); }} />
      )}
    </>
  );
}
