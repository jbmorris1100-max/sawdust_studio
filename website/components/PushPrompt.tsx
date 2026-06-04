'use client';
import { useEffect, useState } from 'react';
import { usePushNotifications, pushSupported } from '@/lib/usePushNotifications';

const PROMPT_KEY = 'pwa_prompt_shown';

// Mobile-only: width heuristic OR touch support. Never shows on desktop.
function isMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 768 || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function detectPlatform(): 'ios' | 'android' | 'other' {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

const IOS_STEPS = [
  'Tap the Share button in Safari',
  'Tap "Add to Home Screen"',
  'Tap Add',
  'Open InlineIQ from your home screen',
];
const ANDROID_STEPS = [
  'Tap the menu in Chrome',
  'Tap "Add to Home Screen"',
  'Tap Add',
];

export default function PushPrompt({
  tenantId,
  userType,
  userName,
}: {
  tenantId: string;
  userType: 'supervisor' | 'crew';
  userName?: string;
}) {
  const { permission, subscribe } = usePushNotifications({ tenantId, userType, userName });
  const [visible, setVisible] = useState(false);
  const [howToOpen, setHowToOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    // Decide visibility on the client only (localStorage / feature checks).
    try {
      const alreadyShown = localStorage.getItem(PROMPT_KEY) === 'true';
      if (
        !alreadyShown &&
        pushSupported() &&
        isMobile() &&
        Notification.permission === 'default'
      ) {
        setVisible(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Hide automatically once permission is no longer 'default'.
  useEffect(() => {
    if (permission !== 'default') setVisible(false);
  }, [permission]);

  function dismiss() {
    try { localStorage.setItem(PROMPT_KEY, 'true'); } catch {}
    setVisible(false);
    setHowToOpen(false);
  }

  async function handleEnable() {
    setEnabling(true);
    try {
      await subscribe();
    } finally {
      setEnabling(false);
      // Whether granted or denied, don't nag again.
      try { localStorage.setItem(PROMPT_KEY, 'true'); } catch {}
      setVisible(false);
    }
  }

  if (!visible) return null;

  const platform = detectPlatform();
  const steps = platform === 'android' ? ANDROID_STEPS : IOS_STEPS;
  const stepsTitle = platform === 'android' ? 'Android (Chrome)' : 'iPhone (Safari)';

  return (
    <>
      <div
        style={{
          position: 'sticky', top: 64, zIndex: 49,
          background: 'rgba(94,234,212,0.08)',
          borderBottom: '1px solid rgba(94,234,212,0.25)',
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--teal)', textAlign: 'center' }}>
          Get instant alerts — add InlineIQ to your home screen
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setHowToOpen(true)}
            style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'transparent', border: '1px solid rgba(94,234,212,0.4)', borderRadius: 7, padding: '5px 11px', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            How to
          </button>
          <button
            onClick={handleEnable}
            disabled={enabling}
            style={{ fontSize: 12, fontWeight: 700, color: '#001917', background: 'var(--teal)', border: 'none', borderRadius: 7, padding: '6px 12px', cursor: enabling ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: enabling ? 0.6 : 1 }}
          >
            {enabling ? 'Enabling…' : 'Enable Notifications'}
          </button>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            style={{ width: 28, height: 28, borderRadius: 7, background: 'transparent', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>

      {howToOpen && (
        <div
          onClick={() => setHowToOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(5,6,8,0.8)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 380, background: '#0a0d10', border: '1px solid rgba(94,234,212,0.18)', borderRadius: 16, padding: '24px 22px', position: 'relative' }}
          >
            <button
              onClick={() => setHowToOpen(false)}
              aria-label="Close"
              style={{ position: 'absolute', top: 14, right: 14, width: 30, height: 30, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <h3 style={{ fontSize: 17, fontWeight: 800, color: 'var(--ink)', margin: '0 0 4px' }}>Add to Home Screen</h3>
            <p style={{ fontSize: 12.5, color: 'var(--ink-mute)', margin: '0 0 18px' }}>{stepsTitle}</p>
            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map((s, i) => (
                <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: '50%', background: 'rgba(94,234,212,0.12)', color: 'var(--teal)', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  <span style={{ fontSize: 14, color: 'var(--ink-dim)' }}>{s}</span>
                </li>
              ))}
            </ol>
            <button
              onClick={handleEnable}
              disabled={enabling}
              style={{ width: '100%', marginTop: 22, fontSize: 14, fontWeight: 700, color: '#001917', background: 'var(--teal)', border: 'none', borderRadius: 10, padding: '12px', cursor: enabling ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: enabling ? 0.6 : 1 }}
            >
              {enabling ? 'Enabling…' : 'Enable Notifications'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
