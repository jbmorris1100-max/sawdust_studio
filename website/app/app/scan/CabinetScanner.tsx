'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { deptDisplay } from '@/lib/partActions';

// ── Claude Vision cabinet-label scanner ──────────────────────────────────────
// Full-screen overlay opened from the crew home scan flow. Shows the rear
// camera with a targeting frame; SCAN LABEL captures a frame, posts it to
// /app/api/scan-label (Claude Vision reads the handwritten label server-side),
// then fuzzy-matches the extracted text against this tenant's open cabinets.
// Entirely separate from the QR clock-in flow at /scan, which is unchanged.

type CabRow = {
  id: string;
  unit_label: string | null;
  cabinet_number: string | null;
  job_number: string | null;
  status: string | null;
  assigned_dept: string | null;
};

type Phase = 'idle' | 'scanning' | 'result' | 'error';

interface Props {
  tenantId: string;
  onClose: () => void;
  // Called with the matched cabinet's dept key (e.g. 'assembly') when the user
  // taps the View button — the crew page decides how to get them there.
  onNavigate?: (deptKey: string) => void;
}

// Lowercase, strip everything but letters/digits — tolerant of spacing, dashes
// and case differences between handwriting and the stored label.
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Drop the letter prefix (K01-SinkBase36 -> 01sinkbase36) for last-resort matching.
function stripPrefix(s: string): string {
  return s.replace(/^[a-z]+/, '');
}

function matchCabinet(extracted: string, cabs: CabRow[]): CabRow | null {
  const target = norm(extracted);
  if (!target) return null;
  const fields = (c: CabRow) => [norm(c.unit_label), norm(c.cabinet_number)].filter(Boolean);

  // 1. Exact (case/punctuation-insensitive)
  for (const c of cabs) if (fields(c).some((f) => f === target)) return c;
  // 2. Partial — extracted contains the label or vice versa
  for (const c of cabs) if (fields(c).some((f) => f.length >= 3 && (target.includes(f) || f.includes(target)))) return c;
  // 3. Numeric + description portion only (prefix letters stripped)
  const stripped = stripPrefix(target);
  if (stripped.length >= 3) {
    for (const c of cabs) {
      if (fields(c).some((f) => { const sf = stripPrefix(f); return sf.length >= 3 && (sf === stripped || sf.includes(stripped) || stripped.includes(sf)); })) return c;
    }
  }
  return null;
}

function statusLabel(status: string | null): string {
  const s = (status || 'pending').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const CREW_VIEW_DEPTS = ['production', 'craftsman', 'assembly', 'finishing'];

export default function CabinetScanner({ tenantId, onClose, onNavigate }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [extracted, setExtracted] = useState('');
  const [match, setMatch] = useState<CabRow | null>(null);
  const [jobPath, setJobPath] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [units, setUnits] = useState<CabRow[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Open cabinets for this tenant — the fuzzy-match candidate pool.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('cabinet_units')
          .select('id, unit_label, cabinet_number, job_number, status, assigned_dept')
          .eq('tenant_id', tenantId)
          .neq('status', 'complete')
          .limit(2000);
        if (!cancelled) setUnits((data as CabRow[] | null) ?? []);
      } catch { /* match falls back to "no match" UI */ }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Rear camera. Started once; stopped on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      } catch {
        if (!cancelled && phaseRef.current !== 'result') {
          setErrorMsg('Camera unavailable. Allow camera access in your browser settings, then try again.');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  // The <video> unmounts while a result/error is shown — reattach the live
  // stream when the user comes back to the camera.
  useEffect(() => {
    if (phase === 'idle' && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [phase]);

  const resolveMatch = useCallback(async (label: string) => {
    const m = matchCabinet(label, units);
    setExtracted(label);
    setMatch(m);
    setJobPath(null);
    if (m?.job_number) {
      try {
        const { data } = await supabase
          .from('jobs').select('job_path, job_name')
          .eq('tenant_id', tenantId).eq('job_number', m.job_number).maybeSingle();
        const j = data as { job_path: string | null; job_name: string | null } | null;
        setJobPath(j?.job_path || j?.job_name || `Job ${m.job_number}`);
      } catch { setJobPath(`Job ${m.job_number}`); }
    }
    setPhase('result');
  }, [units, tenantId]);

  async function scanLabel() {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      setErrorMsg('Camera is not ready yet — give it a second and try again.');
      setPhase('error');
      return;
    }
    setPhase('scanning');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);
      const base64 = canvas.toDataURL('image/jpeg', 0.85).replace(/^data:image\/jpeg;base64,/, '');

      const res = await fetch('/app/api/scan-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      if (!res.ok) throw new Error('Could not read the label. Try again with the label inside the frame.');
      const { label } = (await res.json()) as { label?: string };
      if (!label || label.toUpperCase() === 'UNREADABLE') {
        setExtracted('');
        setMatch(null);
        setJobPath(null);
        setPhase('result');
        return;
      }
      await resolveMatch(label);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Scan failed. Check your connection and try again.');
      setPhase('error');
    }
  }

  function scanAgain() {
    setExtracted('');
    setMatch(null);
    setJobPath(null);
    setManualInput('');
    setErrorMsg('');
    setPhase('idle');
  }

  const viewDept = (match?.assigned_dept || '').toLowerCase();
  const canView = !!onNavigate && CREW_VIEW_DEPTS.includes(viewDept);

  const primaryBtn: React.CSSProperties = {
    width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8,
    padding: '15px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit',
    background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer',
  };
  const ghostBtn: React.CSSProperties = {
    width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8,
    padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
    background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer',
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
      <style>{`@keyframes labelScanSpin{to{transform:rotate(360deg)}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Scan Cabinet Label</span>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {/* Camera feed — kept mounted so the stream survives result/error states */}
        {(phase === 'idle' || phase === 'scanning') && (
          <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#07090A', borderRadius: 14, overflow: 'hidden' }}>
            <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            {/* Targeting frame — guide the label into the center */}
            <div style={{ position: 'absolute', top: '22%', left: '12%', right: '12%', bottom: '22%', border: '2px solid #2DE1C9', borderRadius: 10, zIndex: 2, boxShadow: '0 0 0 2000px rgba(0,0,0,0.25)' }} />
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.75)', zIndex: 3 }}>
              Center the handwritten label in the frame
            </div>
            {phase === 'scanning' && (
              <div style={{ position: 'absolute', inset: 0, zIndex: 4, background: 'rgba(7,9,10,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" style={{ animation: 'labelScanSpin 1s linear infinite' }}><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-dim)' }}>Reading label...</span>
              </div>
            )}
          </div>
        )}

        {phase === 'idle' && (
          <button onClick={() => void scanLabel()} style={primaryBtn}>
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            Scan Label
          </button>
        )}

        {/* Result — matched cabinet */}
        {phase === 'result' && match && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '22px 20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid rgba(45,225,201,0.35)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>Match found</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--ink)' }}>{match.unit_label || match.cabinet_number || 'Cabinet'}</div>
              {jobPath && (
                <div style={{ fontSize: 13.5, color: 'var(--ink-dim)', marginTop: 6 }}>{jobPath.split('/').map((s) => s.trim()).join(' / ')}</div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {match.assigned_dept && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(45,225,201,0.12)', color: 'var(--teal)' }}>{deptDisplay(match.assigned_dept)}</span>
                )}
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: 'rgba(139,165,160,0.12)', color: 'var(--ink-mute)' }}>{statusLabel(match.status)}</span>
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 12 }}>Label read: {extracted}</div>
            </div>
            {canView && (
              <button onClick={() => onNavigate!(viewDept)} style={primaryBtn}>
                View in {deptDisplay(viewDept)}
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            )}
            <button onClick={scanAgain} style={ghostBtn}>Scan another label</button>
          </div>
        )}

        {/* Result — label read but no cabinet matched (or unreadable) */}
        {phase === 'result' && !match && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '20px', borderRadius: 16, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
              {extracted ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Label read: {extracted}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 6 }}>No matching cabinet found in your open jobs. Search manually:</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Could not read a label</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 6 }}>Try again with better light, or search manually:</div>
                </>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && manualInput.trim()) void resolveMatch(manualInput.trim()); }}
                  placeholder="Type the cabinet label"
                  style={{ flex: 1, minWidth: 0, padding: '11px 13px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
                />
                <button onClick={() => { if (manualInput.trim()) void resolveMatch(manualInput.trim()); }} disabled={!manualInput.trim()}
                  style={{ flexShrink: 0, padding: '11px 16px', borderRadius: 10, border: 'none', background: manualInput.trim() ? '#2DE1C9' : 'var(--bg-1)', color: manualInput.trim() ? '#04201c' : 'var(--ink-mute)', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: manualInput.trim() ? 'pointer' : 'not-allowed' }}>
                  Search
                </button>
              </div>
            </div>
            <button onClick={scanAgain} style={ghostBtn}>Scan again</button>
          </div>
        )}

        {/* Error — camera permission or API failure */}
        {phase === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center', padding: '24px 0' }}>
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>Something went wrong</div>
            <div style={{ fontSize: 13, color: 'var(--ink-mute)', lineHeight: 1.6, maxWidth: 340 }}>{errorMsg}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 340 }}>
              <button onClick={scanAgain} style={primaryBtn}>Try again</button>
              <button onClick={onClose} style={ghostBtn}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
