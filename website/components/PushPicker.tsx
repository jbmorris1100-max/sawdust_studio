'use client';
import { useEffect, useState } from 'react';
import { pushPart, suggestedDestination } from '@/lib/partActions';

// PushPicker — the single way crew move a part to another department.
//
// Shows the destinations valid from the current dept as a row of buttons. The
// AI-suggested destination (highest-confidence learned route for this part name
// + current dept) gets a teal highlight and a "Suggested" pill. One tap pushes —
// no confirmation dialog. A wrong tap is fine; the AI just learns from it.

interface Props {
  tenantId: string;
  partId: string;
  partName: string;
  cabinetUnitId: string;
  jobNumber: string | null;
  currentDept: string;                 // lowercase: 'production' | 'craftsman' | 'finishing' | 'assembly'
  workerName: string;
  timeClockId: string | null;
  onPushed: (toDept: string) => void;
  onToast: (msg: string, error?: boolean) => void;
}

// Valid destinations from each department (the assembly flow uses Mark Cabinet
// Complete instead of a push picker, so it has no destinations here).
const DESTINATIONS: Record<string, string[]> = {
  production: ['craftsman', 'finishing', 'assembly'],
  craftsman:  ['finishing', 'assembly', 'production'],
  finishing:  ['assembly', 'production', 'craftsman'],
  assembly:   [],
};

const LABEL: Record<string, string> = {
  production: 'Production', craftsman: 'Craftsman', finishing: 'Finishing', assembly: 'Assembly',
};

const IcoArrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
  </svg>
);

export default function PushPicker({
  tenantId, partId, partName, cabinetUnitId, jobNumber,
  currentDept, workerName, timeClockId, onPushed, onToast,
}: Props) {
  const from = (currentDept || '').toLowerCase();
  const dests = DESTINATIONS[from] ?? ['craftsman', 'finishing', 'assembly'];
  const [suggested, setSuggested] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void suggestedDestination(tenantId, partName, from).then((s) => {
      if (!cancelled && s && dests.includes(s)) setSuggested(s);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, partName, from]);

  async function push(toDept: string) {
    if (busy) return;
    setBusy(toDept);
    try {
      await pushPart({ tenantId, partId, partName, cabinetUnitId, jobNumber, fromDept: from, toDept, workerName, timeClockId });
      onToast(`Sent to ${LABEL[toDept] ?? toDept}`);
      onPushed(toDept);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Push failed', true);
      setBusy(null);
    }
  }

  if (dests.length === 0) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-mute)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <IcoArrow /> Push to
      </span>
      {dests.map((d) => {
        const isSuggested = d === suggested;
        const isBusy = busy === d;
        return (
          <button
            key={d}
            type="button"
            disabled={!!busy}
            onClick={(e) => { e.stopPropagation(); void push(d); }}
            style={{
              position: 'relative',
              minHeight: 40, padding: '0 14px', borderRadius: 10,
              fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              cursor: busy ? 'wait' : 'pointer',
              color: isSuggested ? '#04201c' : 'var(--ink)',
              background: isSuggested ? 'var(--teal, #2DE1C9)' : 'var(--bg-1, #11151a)',
              border: `1px solid ${isSuggested ? 'var(--teal, #2DE1C9)' : 'var(--line)'}`,
              opacity: busy && !isBusy ? 0.5 : 1,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {isBusy ? 'Sending…' : LABEL[d] ?? d}
            {isSuggested && !isBusy && (
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 20, background: 'rgba(4,32,28,0.18)', color: '#04201c' }}>
                Suggested
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
