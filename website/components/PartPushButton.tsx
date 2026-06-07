'use client';
import { useState } from 'react';
import { PART_DEPTS, pushPartToDept } from '@/lib/partActions';

// A "Push" button that reassigns one part to another department. Self-contained:
// renders the button, a bottom-sheet dept picker, and runs the push. Drop it into
// any part row. `onPushed` lets the host optimistically remove the part from view.
interface Props {
  tenantId: string;
  part: { id: string; part_name: string; cabinet_unit_id: string; job_number?: string | null };
  currentDept: string;          // dept label of the surface this button lives in ('' = unknown)
  unitLabel?: string;
  jobPath?: string | null;
  timeClockId?: string | null;
  workerName?: string;
  onPushed?: (toDept: string) => void;
  onToast?: (msg: string, error?: boolean) => void;
  compact?: boolean;            // icon-only
}

const IcoPush = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
  </svg>
);

export default function PartPushButton({ tenantId, part, currentDept, unitLabel, jobPath, timeClockId, workerName, onPushed, onToast, compact }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const options = PART_DEPTS.filter((d) => d.toLowerCase() !== (currentDept || '').toLowerCase());

  async function choose(toDept: string) {
    if (busy) return;
    setBusy(true);
    try {
      await pushPartToDept({ tenantId, part, fromDept: currentDept, toDept, unitLabel, jobPath, timeClockId, workerName });
      onToast?.(`Part sent to ${toDept}`);
      onPushed?.(toDept);
      setOpen(false);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Push failed', true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title="Push this part to another dept"
        style={{
          flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: compact ? 5 : '5px 10px', borderRadius: 8,
          background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.22)',
          color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <IcoPush /> {!compact && 'Push'}
      </button>

      {open && (
        <div
          onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 460, background: '#0a0d10', borderTop: '1px solid var(--line-strong)', borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: '20px 18px calc(20px + env(safe-area-inset-bottom))' }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>Send this part to:</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{part.part_name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {options.map((d) => (
                <button key={d} disabled={busy} onClick={() => void choose(d)}
                  style={{ minHeight: 52, borderRadius: 12, border: '1px solid var(--line)', background: 'var(--bg-1, #11151a)', color: 'var(--ink)', fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
                  {d}
                </button>
              ))}
            </div>
            <button onClick={() => setOpen(false)} style={{ marginTop: 14, width: '100%', minHeight: 46, borderRadius: 12, border: 'none', background: 'none', color: 'var(--ink-mute)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}
