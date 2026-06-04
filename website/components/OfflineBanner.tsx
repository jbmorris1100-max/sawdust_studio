'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { syncQueue, pendingCount } from '@/lib/offlineQueue';

// Registers the service worker, shows the offline / back-online banner, and
// drains the offline action queue on load and whenever the connection returns.
//
// Mounted on the crew and supervisor pages (the only places offline work
// happens). `onSynced` lets the host page refresh its data after a sync.
export default function OfflineBanner({
  tenantId,
  onSynced,
}: {
  tenantId?: string;
  onSynced?: () => void;
}) {
  const [offline, setOffline]   = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const [pending, setPending]   = useState(0);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSync = useCallback(async () => {
    if (!tenantId) return;
    try {
      const n = await syncQueue(supabase, tenantId);
      setPending(pendingCount());
      if (n > 0) onSynced?.();
    } catch {
      /* sync best-effort */
    }
  }, [tenantId, onSynced]);

  // Register the service worker (covers offline caching even when push is never
  // enabled) and run an initial sync to catch any actions queued in a prior session.
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    setOffline(typeof navigator !== 'undefined' && !navigator.onLine);
    setPending(pendingCount());
    void runSync();
  }, [runSync]);

  // Connection state listeners.
  useEffect(() => {
    function goOffline() {
      setOffline(true);
      setDismissed(false);
      setBackOnline(false);
    }
    function goOnline() {
      setOffline(false);
      setBackOnline(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setBackOnline(false), 2000);
      void runSync();
    }
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [runSync]);

  // Back-online green flash (2s).
  if (backOnline) {
    return (
      <div style={bannerBase('rgba(52,211,153,0.1)', 'rgba(52,211,153,0.3)')}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#34D399', fontWeight: 600 }}>
          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5 10 17l9-10" />
          </svg>
          Back online{pending > 0 ? ' — syncing…' : ''}
        </span>
      </div>
    );
  }

  if (!offline || dismissed) return null;

  return (
    <div style={bannerBase('rgba(251,191,36,0.08)', 'rgba(251,191,36,0.3)')}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#FBBF24', textAlign: 'center' }}>
        <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M1 1l22 22" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
        You&apos;re offline — showing cached data{pending > 0 ? ` · ${pending} pending sync` : ''}
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        style={{ width: 26, height: 26, borderRadius: 7, background: 'transparent', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
    </div>
  );
}

function bannerBase(bg: string, border: string): React.CSSProperties {
  return {
    position: 'sticky', top: 64, zIndex: 48,
    background: bg, borderBottom: `1px solid ${border}`,
    padding: '8px 16px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
  };
}
