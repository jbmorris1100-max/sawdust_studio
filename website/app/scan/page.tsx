'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

// ── /scan ─────────────────────────────────────────────────────────────────────
// Landing page opened when a crew member scans a shop QR code. Reads the action
// and tenant from the URL, identifies the worker (saved name in localStorage),
// then performs the clock-in/out or break action against the time_clock table.
// Every Supabase call is wrapped in try/catch — a failure shows a friendly error
// rather than a blank screen.

const TEAL = '#5EEAD4';
const ACTIONS = ['clock_in', 'clock_out', 'break_start', 'break_end'] as const;
type Action = (typeof ACTIONS)[number];

type Phase = 'loading' | 'need_name' | 'working' | 'success' | 'already_in' | 'error';
type IconKind = 'clock_in' | 'clock_out' | 'break' | 'error' | 'clock';

type OpenShift = {
  id: string;
  worker_name: string;
  clock_in: string;
  on_break: boolean | null;
  break_start: string | null;
  total_break_minutes: number | null;
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

function fmtDuration(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return `${h} hour${h === 1 ? '' : 's'} ${m} min${m === 1 ? '' : 's'}`;
  return `${m} min${m === 1 ? '' : 's'}`;
}

function ScanContent() {
  const params = useSearchParams();
  const router = useRouter();
  const action = (params.get('action') ?? '') as Action;
  const tenantId = params.get('tenant') ?? '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [icon, setIcon] = useState<IconKind>('clock');
  const [heading, setHeading] = useState('');
  const [detail, setDetail] = useState('');
  const [shopName, setShopName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [openShiftIn, setOpenShiftIn] = useState<string | null>(null); // clock_in time when already clocked in
  const ran = useRef(false);

  const validAction = (ACTIONS as readonly string[]).includes(action);

  // Plain functions — the React Compiler memoizes them, so no manual useCallback.
  function fail(msg: string) {
    setIcon('error');
    setHeading('Something went wrong');
    setDetail(msg);
    setPhase('error');
  }

  // Look up the open (un-clocked-out) shift for this worker.
  async function findOpenShift(name: string): Promise<OpenShift | null> {
    const { data, error } = await supabase
      .from('time_clock')
      .select('id, worker_name, clock_in, on_break, break_start, total_break_minutes')
      .eq('tenant_id', tenantId)
      .eq('worker_name', name)
      .is('clock_out', null)
      .order('clock_in', { ascending: false })
      .limit(1);
    if (error) throw error;
    return (data && data[0] ? (data[0] as OpenShift) : null);
  }

  async function doClockOut(name: string, shift: OpenShift) {
    const now = new Date().toISOString();
    let breakMins = shift.total_break_minutes ?? 0;
    // Close any open break first.
    if (shift.on_break && shift.break_start) {
      breakMins += Math.max(1, Math.floor((Date.now() - new Date(shift.break_start).getTime()) / 60000));
    }
    const grossMins = Math.floor((Date.now() - new Date(shift.clock_in).getTime()) / 60000);
    const netMins = Math.max(0, grossMins - breakMins);
    const { error } = await supabase
      .from('time_clock')
      .update({ clock_out: now, on_break: false, total_break_minutes: breakMins, total_hours: Math.round((netMins / 60) * 10000) / 10000 })
      .eq('id', shift.id);
    if (error) throw error;
    setIcon('clock_out');
    setHeading(`${name} clocked out`);
    setDetail(`${fmtDuration(netMins)} worked`);
    setPhase('success');
  }

  async function runAction(name: string) {
    setPhase('working');
    try {
      const dept = (() => { try { return localStorage.getItem('crew_dept') || null; } catch { return null; } })();

      if (action === 'clock_in') {
        const open = await findOpenShift(name);
        if (open) {
          setOpenShiftIn(open.clock_in);
          setIcon('clock');
          setHeading(`Already clocked in`);
          setDetail(`${name} has been clocked in since ${fmtTime(open.clock_in)}.`);
          setPhase('already_in');
          return;
        }
        const now = new Date().toISOString();
        const { error } = await supabase.from('time_clock').insert({
          worker_name: name,
          tenant_id: tenantId,
          clock_in: now,
          clock_out: null,
          date: now.split('T')[0],
          status: 'active',
          ...(dept ? { dept, current_dept: dept } : {}),
        });
        if (error) throw error;
        setIcon('clock_in');
        setHeading(`${name} clocked in`);
        setDetail(`Clocked in at ${fmtTime(now)}`);
        setPhase('success');
        return;
      }

      if (action === 'clock_out') {
        const open = await findOpenShift(name);
        if (!open) {
          setIcon('error');
          setHeading('No active clock-in found');
          setDetail(`${name} is not currently clocked in.`);
          setPhase('error');
          return;
        }
        await doClockOut(name, open);
        return;
      }

      if (action === 'break_start') {
        const open = await findOpenShift(name);
        if (!open) {
          setIcon('error');
          setHeading('No active clock-in found');
          setDetail(`${name} must be clocked in before starting a break.`);
          setPhase('error');
          return;
        }
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('time_clock')
          .update({ on_break: true, break_start: now })
          .eq('id', open.id);
        if (error) throw error;
        setIcon('break');
        setHeading('Break started');
        setDetail(`Enjoy your break, ${name}.`);
        setPhase('success');
        return;
      }

      if (action === 'break_end') {
        const open = await findOpenShift(name);
        if (!open || !open.on_break || !open.break_start) {
          setIcon('error');
          setHeading('No active break found');
          setDetail(`${name} is not currently on a break.`);
          setPhase('error');
          return;
        }
        const now = new Date().toISOString();
        const duration = Math.max(1, Math.floor((Date.now() - new Date(open.break_start).getTime()) / 60000));
        const total = (open.total_break_minutes ?? 0) + duration;
        const { error } = await supabase
          .from('time_clock')
          .update({ on_break: false, break_end: now, total_break_minutes: total })
          .eq('id', open.id);
        if (error) throw error;
        setIcon('break');
        setHeading('Break ended');
        setDetail(`${fmtDuration(duration)} — welcome back, ${name}.`);
        setPhase('success');
        return;
      }

      fail('Unknown action.');
    } catch (e) {
      console.error('scan action failed:', e);
      fail('Could not reach the clock. Please try again or use the crew app.');
    }
  }

  // Initial load: validate params, look up the tenant, then either prompt for a
  // name or run the action with the saved name. All state updates happen inside
  // the async flow so nothing is set synchronously in the effect body.
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      if (!validAction || !tenantId) {
        fail('This QR code is missing or has an invalid action.');
        return;
      }
      try {
        const { data, error } = await supabase
          .from('tenants')
          .select('id, shop_name')
          .eq('id', tenantId)
          .single();
        if (error || !data) { fail('Shop not found for this QR code.'); return; }
        setShopName((data as { shop_name: string | null }).shop_name);
      } catch (e) {
        console.error('tenant lookup failed:', e);
        fail('Could not look up the shop. Please try again.');
        return;
      }

      let savedName = '';
      try { savedName = localStorage.getItem('crew_name')?.trim() || ''; } catch { /* ignore */ }
      if (savedName) {
        void runAction(savedName);
      } else {
        setPhase('need_name');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-return to the crew app a few seconds after a successful action.
  useEffect(() => {
    if (phase !== 'success') return;
    const t = setTimeout(() => { router.push('/app/crew'); }, 3000);
    return () => clearTimeout(t);
  }, [phase, router]);

  function submitName() {
    const name = nameInput.trim();
    if (!name) return;
    try { localStorage.setItem('crew_name', name); } catch { /* ignore */ }
    void runAction(name);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050608', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 28, fontFamily: 'inherit' }}>
      <div style={{ background: '#0a0d10', border: '1px solid rgba(94,234,212,0.2)', borderRadius: 20, padding: '40px 30px', maxWidth: 420, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: TEAL }}>
          inlineIQ
        </div>
        {shopName && (
          <div style={{ fontSize: 13, color: '#8BA5A0', marginTop: -10 }}>{shopName}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
          <StatusIcon kind={phase === 'loading' || phase === 'working' ? 'clock' : icon} spinning={phase === 'loading' || phase === 'working'} />
        </div>

        {phase === 'loading' && <h1 style={hStyle}>Reading QR code…</h1>}
        {phase === 'working' && <h1 style={hStyle}>One moment…</h1>}

        {phase === 'need_name' && (
          <>
            <h1 style={hStyle}>What&rsquo;s your name?</h1>
            <p style={pStyle}>We&rsquo;ll remember it on this device for next time.</p>
            <input
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitName(); }}
              placeholder="Your name"
              autoFocus
              style={{ width: '100%', padding: '12px 14px', borderRadius: 10, background: '#11161a', border: '1px solid rgba(94,234,212,0.25)', color: '#E2E8F0', fontSize: 15, fontFamily: 'inherit', outline: 'none', textAlign: 'center' }}
            />
            <button onClick={submitName} disabled={!nameInput.trim()} style={{ ...primaryBtn, opacity: nameInput.trim() ? 1 : 0.5 }}>
              Continue
            </button>
          </>
        )}

        {(phase === 'success' || phase === 'error' || phase === 'already_in') && (
          <>
            <h1 style={hStyle}>{heading}</h1>
            {detail && <p style={pStyle}>{detail}</p>}
          </>
        )}

        {phase === 'already_in' && openShiftIn && (
          <button onClick={() => { let n = ''; try { n = localStorage.getItem('crew_name')?.trim() || ''; } catch {} if (n) { setPhase('working'); void (async () => { try { const s = await findOpenShift(n); if (s) await doClockOut(n, s); else fail('No active clock-in found.'); } catch { fail('Could not clock out.'); } })(); } }} style={primaryBtn}>
            Clock out instead
          </button>
        )}

        {phase === 'success' && (
          <button onClick={() => router.push('/app/crew')} style={primaryBtn}>Done</button>
        )}

        {phase === 'error' && (
          <button onClick={() => { ran.current = false; window.location.reload(); }} style={primaryBtn}>Try again</button>
        )}

        <Link href="/app/crew" style={{ fontSize: 13, color: '#8BA5A0', textDecoration: 'none', marginTop: 4 }}>
          Back to crew app
        </Link>
      </div>
    </div>
  );
}

const hStyle: React.CSSProperties = { fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 };
const pStyle: React.CSSProperties = { fontSize: 14, color: '#8BA5A0', margin: 0, lineHeight: 1.6 };
const primaryBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '12px 24px', borderRadius: 10, background: 'rgba(94,234,212,0.12)',
  border: '1px solid rgba(94,234,212,0.3)', color: TEAL, fontSize: 15, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit', width: '100%',
};

function StatusIcon({ kind, spinning }: { kind: IconKind; spinning?: boolean }) {
  const size = 56;
  const color = kind === 'error' ? '#FBBF24' : TEAL;
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const wrap = (children: React.ReactNode) => (
    <div style={spinning ? { animation: 'scanSpin 1s linear infinite' } : undefined}>
      <style>{'@keyframes scanSpin { to { transform: rotate(360deg); } }'}</style>
      <svg {...common}>{children}</svg>
    </div>
  );
  switch (kind) {
    case 'clock_in':
      return wrap(<><circle cx="12" cy="12" r="10" /><polyline points="8 12 11 15 16 9" /></>);
    case 'clock_out':
      return wrap(<><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>);
    case 'break':
      return wrap(<><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" /><line x1="6" y1="2" x2="6" y2="4" /><line x1="10" y1="2" x2="10" y2="4" /><line x1="14" y1="2" x2="14" y2="4" /></>);
    case 'error':
      return wrap(<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>);
    case 'clock':
    default:
      return wrap(<><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>);
  }
}

export default function ScanPage() {
  return (
    <Suspense>
      <ScanContent />
    </Suspense>
  );
}
