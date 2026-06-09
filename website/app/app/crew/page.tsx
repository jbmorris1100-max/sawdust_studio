'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { upsertPushSubscription } from '@/lib/usePushNotifications';
import { trialDaysLeft, getDepartments, type Tenant } from '@/lib/auth';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import PushPrompt from '@/components/PushPrompt';
import OfflineBanner from '@/components/OfflineBanner';
import CraftsmanBuilds from './CraftsmanBuilds';
import FinishingView from './FinishingView';
import AssemblyCrewView from './AssemblyCrewView';
import PushPicker from '@/components/PushPicker';
import { pushPart, deptDisplay } from '@/lib/partActions';
import PartPushButton from '@/components/PartPushButton';
import ViewDrawingsButton from '@/components/ViewDrawingsButton';
import MessageThread from '@/components/MessageThread';
import { enqueue, pendingCount } from '@/lib/offlineQueue';
import { sendNotify } from '@/lib/notify';

// ── Crew tenant resolver ───────────────────────────────────────────────────────
// Crew never need to log in. Resolution order:
//   1. invite-link tenant in localStorage (crew_tenant_id) → load by id, no login
//   2. logged-in session (e.g. a supervisor previewing the crew view)
//   3. neither → redirect to /join ("ask your supervisor for the crew link")
function useCrewTenant() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tenant,  setTenant]  = useState<Tenant | null>(null);
  const [email,   setEmail]   = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. Invite-link tenant (no login required)
      let inviteId = '';
      try { inviteId = localStorage.getItem('crew_tenant_id') || localStorage.getItem('@inline_join_tenant_id') || ''; } catch (_) {}
      if (inviteId) {
        try {
          const { data } = await supabase.from('tenants').select('*').eq('id', inviteId).single();
          if (!cancelled && data) {
            try { localStorage.setItem('crew_tenant_id', inviteId); } catch (_) {}
            setTenant(data as Tenant); setEmail(''); setLoading(false);
            return;
          }
        } catch (_) {}
      }
      // 2. Logged-in session
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          if (!cancelled) setEmail(session.user.email ?? '');
          const { data } = await supabase.from('tenants').select('*').eq('owner_user_id', session.user.id).single();
          if (!cancelled && data) { setTenant(data as Tenant); setLoading(false); return; }
        }
      } catch (_) {}
      // 3. Neither — send them to the join page
      if (!cancelled) router.replace('/join');
    })();
    return () => { cancelled = true; };
  }, [router]);

  return { loading, tenant, email };
}

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeEntry = {
  id: string;
  worker_name: string;
  dept: string;
  clock_in: string;
  clock_out: string | null;
  status: string | null;
  on_break: boolean | null;
  total_break_minutes: number | null;
  current_dept: string | null;
};

// Clock-in/out adjustment requests piggy-back on messages via topic + payload.
// topic-tagged messages are action items, never chat — excluded from unread.
type ClockRequestPayload = {
  requested_time: string;
  reason: string;
  worker_name: string;
  dept: string | null;
  status: 'pending' | 'approved' | 'denied';
  shift_id?: string | null;
  clock_in?: string | null;
};

type Message = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
  topic: string | null;
  payload: ClockRequestPayload | null;
};

const CLOCK_TOPICS = ['clock_in_request', 'clock_out_request'];
const isClockRequestMsg = (m: Message): boolean => !!m.topic && CLOCK_TOPICS.includes(m.topic);

type Drawing = {
  id: string;
  job_number: string | null;
  job_name: string | null;
  plan_name: string | null;
  label: string | null;
  file_url: string | null;
  external_url: string | null;
  file_name: string | null;
  file_type: string | null;
  departments: string[] | null;
  parsed: boolean | null;
  uploaded_by: string | null;
  created_at: string;
  version: number | null;
  superseded_by: string | null;
  is_current: boolean | null;
};

type PartsListPart = {
  id: string;
  cabinet_unit_id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  status: string;
  flag_type: string | null;
};

type SopItem = {
  id: string;
  title: string;
  dept: string | null;
  pdf_url: string | null;
  created_at: string;
};

type PartLog = {
  id: string;
  tenant_id: string;
  worker_name: string | null;
  job_number: string | null;
  part_name: string;
  dept: string | null;
  status: string;
  next_dept: string | null;
  notes: string | null;
  created_at: string;
};

type Job = {
  id: string;
  job_number: string;
  job_name: string | null;
  status: string;
};

type ModalType = 'clock' | 'inventory' | 'damage' | 'plans' | 'partsList' | 'sops' | 'switchDept' | 'editName' | 'buildTimer' | 'parts' | 'assemblyScan' | null;
type ClockStep = 'lookup' | 'clockin' | 'clockout';
type BuildTimerStep = 'form' | 'summary';
type AssemblyScanStep = 'scan' | 'checklist' | 'confirm';

type AssemblyCabinetUnit = {
  id: string;
  unit_label: string;
  job_number: string | null;
  cabinet_number: string | null;
  room_number: string | null;
  status: string;
};

type AssemblyScanPart = {
  id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  status: string;
  flag_type: string | null;
  production_status?: string | null;
};

// Production handoff (cut tracking)
type ProdPart = {
  id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  production_status: string | null;
  cut_by: string | null;
  cut_at: string | null;
  cut_photo_url: string | null;
};

type ProdUnit = {
  id: string;
  unit_label: string;
  job_number: string | null;
  cabinet_number: string | null;
  room_number: string | null;
  status: string;
  production_status: string | null;
  partsTotal: number;
  partsCut: number;
  jobPath: string;
  dueDate: string | null;
};

// Job-level cut list (production) — a part the crew checks off as it's cut.
type CutJobPart = {
  id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
  depth: number | null;
  quantity: number;
  checked: boolean;
  cabinet_unit_id: string;
};
type CutJobCab = { cabinetId: string; label: string; key: string; jobNumber: string | null; parts: CutJobPart[] };

// AI label-match result (from /app/api/match-label).
type ScanAiMatch = {
  part_name: string;
  cabinet_unit_id: string;
  cabinet_label: string;
  confidence: number;
};
type ScanAiResult = {
  match: ScanAiMatch | null;
  alternatives: ScanAiMatch[];
  reasoning: string;
};

// Prominent "current job" card shown above the quick actions on the crew home.
type ActiveJobCard = {
  mode: 'assembly' | 'production';
  jobNumber: string;
  jobPath: string;
  total: number;
  done: number;                                  // complete (assembly) | cut (production)
  nextUnit: { id: string; label: string } | null;
};

// A part is "cut" (visible to Assembly) once production has advanced it past cutting.
const CUT_STATUSES = ['cut', 'qa_passed', 'in_assembly', 'complete'];
function isPartCut(s: string | null | undefined): boolean {
  return !!s && CUT_STATUSES.includes(s);
}

// Production cut-view hint: which parts need a finishing step (edge banding,
// paint/stain) before assembly. Drives an amber pill on the cut-view part row.
function getFinishingFlag(partName: string, material: string | null): string | null {
  const n = (partName + ' ' + (material || '')).toLowerCase();
  if (n.includes('edge') || n.includes('banding')) return 'Edge Band';
  if (n.includes('door') || n.includes('drawer front')) return 'Paint/Stain';
  if (n.includes('face frame') || n.includes('faceframe')) return 'Paint/Stain';
  if (n.includes('end panel') || n.includes('side panel')) return 'Paint/Stain';
  return null;
}

// ── Shift event logger (fire-and-forget) ─────────────────────────────────────

async function logShiftEvent(params: {
  tenantId: string;
  timeClockId: string | null;
  workerName: string;
  eventType: string;
  dept: string | null;
  previousDept?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!params.timeClockId) return;
  try {
    await supabase.from('shift_events').insert({
      tenant_id:     params.tenantId,
      time_clock_id: params.timeClockId,
      worker_name:   params.workerName,
      event_type:    params.eventType,
      dept:          params.dept,
      previous_dept: params.previousDept ?? null,
      metadata:      params.metadata ?? {},
    });
  } catch (e) {
    console.error('[shift_event]', e);
  }
}

// ── Crew member registry (auto-registration on clock-in) ─────────────────────
// Ensures every crew member who clocks in exists in crew_members. Returns the
// crew_member id (or null) so the time_clock row can be linked to it.
//   - new name → insert an 'active' record (name, dept, joined_at, last_active)
//   - known name → bump last_active to now
async function registerCrewMember(tenantId: string, name: string, dept: string | null): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const now = new Date().toISOString();
  try {
    const { data: existing } = await supabase
      .from('crew_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('name', trimmed)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      try { await supabase.from('crew_members').update({ last_active: now }).eq('id', existing.id); } catch (_) {}
      return existing.id as string;
    }
    const { data: inserted } = await supabase
      .from('crew_members')
      .insert({ tenant_id: tenantId, name: trimmed, department: dept, status: 'active', joined_at: now, last_active: now })
      .select('id')
      .single();
    return (inserted as { id: string } | null)?.id ?? null;
  } catch (e) {
    console.error('[crew_member]', e);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// Adjustable clock time picker: [ − ] 7:45 AM [ + ]. Each tap = 1 minute; press
// and hold to scroll faster. Turns amber once the time differs from "now",
// signalling the action will become a supervisor approval request.
function ClockTimePicker({ value, base, onHold, onRelease }: {
  value: number; base: number; onHold: (deltaMin: number) => void; onRelease: () => void;
}) {
  const adjusted = Math.round(value / 60000) !== Math.round(base / 60000);
  const btn: React.CSSProperties = {
    width: 52, height: 52, borderRadius: 14, border: '1px solid var(--line-strong)',
    background: 'var(--bg-1)', color: 'var(--ink)', fontSize: 26, fontWeight: 700,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    userSelect: 'none', touchAction: 'manipulation', fontFamily: 'inherit',
  };
  return (
    <div style={{ margin: '6px 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <button type="button" aria-label="Earlier" style={btn}
          onPointerDown={(e) => { e.preventDefault(); onHold(-1); }}
          onPointerUp={onRelease} onPointerLeave={onRelease} onPointerCancel={onRelease}>−</button>
        <div style={{ minWidth: 130, textAlign: 'center', fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', color: adjusted ? '#FBBF24' : 'var(--ink)' }}>
          {formatTime(new Date(value).toISOString())}
        </div>
        <button type="button" aria-label="Later" style={btn}
          onPointerDown={(e) => { e.preventDefault(); onHold(1); }}
          onPointerUp={onRelease} onPointerLeave={onRelease} onPointerCancel={onRelease}>+</button>
      </div>
      <div style={{ textAlign: 'center', fontSize: 12, color: adjusted ? '#FBBF24' : 'var(--ink-mute)', marginTop: 8 }}>
        {adjusted ? 'Adjusted — needs supervisor approval' : 'Tap +/- to adjust'}
      </div>
    </div>
  );
}

// "Updated 2 days ago" style label for plan version timestamps.
function updatedAgo(iso: string): string {
  const days  = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (hours < 1)  return 'Updated just now';
  if (hours < 24) return `Updated ${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days === 1) return 'Updated yesterday';
  if (days < 30)  return `Updated ${days} days ago`;
  return `Updated ${new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtElapsed(startIso: string): string {
  const secs = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const IcoPdf = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IcoCsv = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/>
    <line x1="8" y1="12" x2="21" y2="12"/>
    <line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/>
    <line x1="3" y1="12" x2="3.01" y2="12"/>
    <line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);

// Map a stored file_type / filename → a short label + colour for the type chip.
function planBadgeMeta(fileType: string | null, fileName?: string | null): { label: string; color: string; bg: string } {
  const ext = (fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  const t = (fileType ?? '').toLowerCase();
  const is = (type: string, ...exts: string[]) => t === type || (!fileType && exts.includes(ext));
  if (is('csv', 'csv'))                                     return { label: 'CSV',   color: '#34D399', bg: 'rgba(52,211,153,0.1)' };
  if (is('image', 'jpg', 'jpeg', 'png', 'webp', 'gif'))     return { label: 'Image', color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' };
  if (is('svg', 'svg'))                                     return { label: 'SVG',   color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' };
  if (is('dxf', 'dxf'))                                     return { label: 'DXF',   color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' };
  if (is('xml', 'xml'))                                     return { label: 'XML',   color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' };
  if (is('html', 'html', 'htm'))                            return { label: 'HTML',  color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' };
  if (is('spreadsheet', 'xlsx', 'xls', 'xlsm'))             return { label: 'XLSX',  color: '#34D399', bg: 'rgba(52,211,153,0.1)' };
  return { label: 'PDF', color: '#F87171', bg: 'rgba(248,113,113,0.1)' };
}

function PlanTypeBadge({ fileType, fileName }: { fileType: string | null; fileName?: string | null }) {
  const { label, color, bg } = planBadgeMeta(fileType, fileName);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, background: bg, color, flexShrink: 0 }}>
      {label === 'CSV' ? <IcoCsv /> : <IcoPdf />}
      {label}
    </span>
  );
}

function partsListStatusIcon(status: string, flagType: string | null) {
  if (flagType === 'damaged')    return <span style={{ color: '#F87171' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>;
  if (flagType === 'missing')    return <span style={{ color: '#FBBF24' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span>;
  if (flagType === 'wrong_part') return <span style={{ color: '#F87171' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>;
  if (status === 'checked' || status === 'complete') return <span style={{ color: '#34D399' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>;
  return <span style={{ color: '#8BA5A0' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg></span>;
}

// ── Production cut-status badge (not_cut / cutting / cut) ───────────────────────
function CutStatusBadge({ status }: { status: string | null | undefined }) {
  if (status === 'cutting') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#FBBF24' }}>
        <style>{`@keyframes cutPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'cutPulse 1.4s ease-in-out infinite' }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Cutting
      </span>
    );
  }
  if (status && ['cut', 'qa_passed', 'in_assembly', 'complete'].includes(status)) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#2DE1C9' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Cut
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: '#8BA5A0' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
      Not cut
    </span>
  );
}

// ── Due-date badge (green 7+ · amber 3-6 · red 1-2 · pulsing red overdue) ───────
function dueBadgeMeta(dueDate: string): { label: string; color: string; overdue: boolean } {
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  const overdue = days < 0;
  const color = overdue || days <= 2 ? '#F87171' : days <= 6 ? '#FBBF24' : '#34D399';
  const label = overdue ? `${-days}d overdue` : days === 0 ? 'Due today' : `${days}d`;
  return { label, color, overdue };
}
function DueBadge({ dueDate }: { dueDate: string }) {
  const { label, color, overdue } = dueBadgeMeta(dueDate);
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${color}22`, color, ...(overdue ? { animation: 'prodPulse 1.4s ease-in-out infinite' } : {}) }}>
      {label}
    </span>
  );
}

// ── Small UI pieces ────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TrialBanner({ days }: { days: number }) {
  return (
    <div style={{ position: 'sticky', top: 64, zIndex: 50, background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.25)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}><b>{days} day{days !== 1 ? 's' : ''}</b> left in trial —</span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>Upgrade</Link>
    </div>
  );
}

function NewMsgBanner({ preview, onDismiss }: { preview: string; onDismiss: () => void }) {
  return (
    <div style={{
      position: 'sticky', top: 64, zIndex: 49,
      background: 'rgba(94,234,212,0.07)',
      borderBottom: '1px solid rgba(94,234,212,0.22)',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span style={{ fontSize: 13, color: 'var(--teal)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b>New message from Supervisor</b> — {preview}
        </span>
      </div>
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', flexShrink: 0 }}
        aria-label="Dismiss"
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}

function Toast({ msg, error, pending }: { msg: string; error?: boolean; pending?: boolean }) {
  const bg    = pending ? '#FBBF24' : error ? '#F87171' : '#34D399';
  const color = pending ? '#1a1400' : error ? '#fff' : '#001a0d';
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      zIndex: 400, background: bg, color,
      padding: '12px 24px', borderRadius: 10, fontWeight: 700, fontSize: 14,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
    }}>
      {msg}
    </div>
  );
}

function ModalOverlay({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 500, padding: 32, maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-field" style={{ marginBottom: 16 }}>
      <label className="form-label">{label}</label>
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CrewPage() {
  const { loading: sessionLoading, tenant, email } = useCrewTenant();
  // Department list for every crew dropdown — from tenant, falling back to defaults.
  const deptOptions = getDepartments(tenant);
  // AI push-suggestion mode (shared via the tenant row). 'learn' = no suggestions.
  const aiMode = (tenant?.ai_mode ?? 'learn') as 'learn' | 'assist' | 'autonomous';

  // Page data
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [dataLoading,  setDataLoading]  = useState(true);

  // Crew identity (persisted in localStorage)
  const [crewName, setCrewName] = useState('');
  const [crewDept, setCrewDept] = useState('');
  // Ref so realtime closure always reads current dept without re-subscribing
  const crewDeptRef = useRef('');
  useEffect(() => { crewDeptRef.current = crewDept; }, [crewDept]);

  // Self-heal stale/null-dept push subscriptions: once the crew's dept and
  // tenant are known and notifications are already granted, re-tag this
  // device's subscription with the current dept. Idempotent and best-effort —
  // never blocks the UI. (Fixes rows created before dept tracking existed.)
  useEffect(() => {
    if (!crewDept || !tenant?.id) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    let cancelled = false;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!sub || cancelled) return;
        await upsertPushSubscription({
          tenantId: tenant.id, userType: 'crew',
          userName: crewName || undefined, dept: crewDept, subscription: sub,
        });
      } catch (e) {
        console.error('Push dept sync failed:', e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crewDept, tenant?.id]);

  // New-message notification banner
  const [msgNotification, setMsgNotification] = useState<string | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Universal file viewer (Part 2) — inline, no new tabs
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);

  // Modal state
  const [modal,     setModal]     = useState<ModalType>(null);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState<{ msg: string; error?: boolean; pending?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clock modal
  const [clockStep,  setClockStep]  = useState<ClockStep>('lookup');
  const [clockName,  setClockName]  = useState('');
  const [clockDept,  setClockDept]  = useState('');
  const [openEntry,  setOpenEntry]  = useState<TimeEntry | null>(null);
  const [checking,   setChecking]   = useState(false);

  // Inventory modal
  const [invItem,   setInvItem]   = useState('');
  const [invDept,   setInvDept]   = useState('');
  const [invJobNum, setInvJobNum] = useState('');

  // Damage modal
  const [dmgWhat,         setDmgWhat]         = useState('');
  const [dmgDept,         setDmgDept]         = useState('');
  const [dmgType,         setDmgType]         = useState<'damage' | 'change_order'>('damage');
  const [dmgPhoto,        setDmgPhoto]        = useState<File | null>(null);
  const [dmgPhotoPreview, setDmgPhotoPreview] = useState<string | null>(null);
  const [dmgScanStep,     setDmgScanStep]     = useState<'camera' | 'preview'>('camera');
  const [dmgShowDetails,  setDmgShowDetails]  = useState(false);
  const [dmgFlash,        setDmgFlash]        = useState(false);

  // Plans modal
  const [drawings,     setDrawings]     = useState<Drawing[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [showOldPlans, setShowOldPlans] = useState(false);

  // Parts List modal (assembly checklist launched from a parsed CSV plan)
  const [partsListJob,      setPartsListJob]      = useState<string | null>(null);
  const [partsListUnits,    setPartsListUnits]    = useState<AssemblyCabinetUnit[]>([]);
  const [partsListParts,    setPartsListParts]    = useState<PartsListPart[]>([]);
  const [partsListLoading,  setPartsListLoading]  = useState(false);
  const [partsListExpanded, setPartsListExpanded] = useState<Record<string, boolean>>({});

  // SOPs modal
  const [sops,        setSops]        = useState<SopItem[]>([]);
  const [sopsLoading, setSopsLoading] = useState(false);

  // Craftsman build timer (persisted via localStorage)
  const [buildId,        setBuildId]        = useState<string | null>(null);
  const [buildStart,     setBuildStart]     = useState<string | null>(null);
  const [buildMaterial,  setBuildMaterial]  = useState<string | null>(null);
  const [buildMatType,   setBuildMatType]   = useState<string | null>(null);
  const [buildJob,       setBuildJob]       = useState<string | null>(null);
  const [timerTick,      setTimerTick]      = useState(0);
  const [buildTimerStep, setBuildTimerStep] = useState<BuildTimerStep>('form');
  const [buildSummary,   setBuildSummary]   = useState<{ material: string; duration: string; job: string | null } | null>(null);
  const [timerStopping,  setTimerStopping]  = useState(false);

  // Build timer modal form fields
  const [bmMaterial, setBmMaterial] = useState('');
  const [bmMatType,  setBmMatType]  = useState('Raw Lumber');
  const [bmQty,      setBmQty]      = useState('');
  const [bmUnit,     setBmUnit]     = useState('Board Feet');
  const [bmJobNum,   setBmJobNum]   = useState('');


  // Parts / QC modal
  const [partsMode,      setPartsMode]      = useState<'log' | 'qc'>('log');
  const [partName,       setPartName]       = useState('');
  const [partJobNum,     setPartJobNum]     = useState('');
  const [partDept,       setPartDept]       = useState('');
  const [partStatus,     setPartStatus]     = useState('In Progress');
  const [partNextDept,   setPartNextDept]   = useState('');
  const [partNotes,      setPartNotes]      = useState('');
  const [partsQcList,    setPartsQcList]    = useState<PartLog[]>([]);
  const [qcLoading,      setQcLoading]      = useState(false);
  const [qcActioning,    setQcActioning]    = useState<Record<string, boolean>>({});
  const [partPhoto,        setPartPhoto]        = useState<File | null>(null);
  const [partPhotoPreview, setPartPhotoPreview] = useState<string | null>(null);
  const [partScanStep,     setPartScanStep]     = useState<'camera' | 'preview'>('camera');
  const [partShowDetails,  setPartShowDetails]  = useState(false);
  const [partFlash,        setPartFlash]        = useState(false);
  const [jobs,             setJobs]             = useState<Job[]>([]);
  const [partJobId,        setPartJobId]        = useState('');

  // Active time clock tracking
  const [activeTimeClockId, setActiveTimeClockId] = useState<string | null>(null);

  // ── Clock-in gate ───────────────────────────────────────────────────────────
  // The crew cannot start any work action without an open shift. We resolve the
  // crew member's open shift once on mount (and after each clock in/out) so the
  // per-action check is instant — no DB round-trip per tap. gateOpen drives the
  // "you need to clock in" modal.
  const [clockShift, setClockShift] = useState<TimeEntry | null>(null);
  const [gateOpen,   setGateOpen]   = useState(false);
  const isClockedIn = !!clockShift;

  // Break tracking
  const [onBreak,        setOnBreak]        = useState(false);
  const [breakStartTime, setBreakStartTime] = useState<string | null>(null);
  const [breakTick,      setBreakTick]      = useState(0);
  const [breakSaving,    setBreakSaving]    = useState(false);

  // Assembly Scan modal state
  const [assemblyScanStep,      setAssemblyScanStep]      = useState<AssemblyScanStep>('scan');
  const [assemblyScanInput,     setAssemblyScanInput]     = useState('');
  const [assemblyScanUnit,      setAssemblyScanUnit]      = useState<AssemblyCabinetUnit | null>(null);
  const [assemblyScanParts,     setAssemblyScanParts]     = useState<AssemblyScanPart[]>([]);
  const [assemblyScanChecked,   setAssemblyScanChecked]   = useState<Record<string, boolean>>({});
  const [assemblyScanFlags,     setAssemblyScanFlags]     = useState<Record<string, { type: string; notes: string }>>({});
  const [assemblyScanFlagging,  setAssemblyScanFlagging]  = useState<string | null>(null);
  const [assemblyScanFlagType,  setAssemblyScanFlagType]  = useState('damaged');
  const [assemblyScanFlagNotes, setAssemblyScanFlagNotes] = useState('');
  const [assemblyScanSearching, setAssemblyScanSearching] = useState(false);
  const [assemblyScanNotFound,  setAssemblyScanNotFound]  = useState(false);
  const [assemblyScanConfirming,setAssemblyScanConfirming]= useState(false);
  const [assemblyScanDone,      setAssemblyScanDone]      = useState(false);
  // Assembly gating: cabinet whose parts aren't cut yet (blocks the checklist)
  const [assemblyNotReady,      setAssemblyNotReady]      = useState<{ unit: AssemblyCabinetUnit; parts: AssemblyScanPart[] } | null>(null);
  // AI fuzzy-match result + live decode feedback
  const [scanAiResult,   setScanAiResult]   = useState<ScanAiResult | null>(null);
  const [scanShowAlts,   setScanShowAlts]   = useState(false);
  const [scanFlash,      setScanFlash]      = useState(false);
  // Auto-detect couldn't decide Assembly vs Production/QC → ask the crew.
  const [scanChoiceUnit, setScanChoiceUnit] = useState<(AssemblyCabinetUnit & { production_status?: string | null }) | null>(null);
  const zxingRef    = useRef<{ reset: () => void } | null>(null);
  const scanBusyRef = useRef(false);

  // ── Production handoff (cut tracking) ──────────────────────────────────────
  const [prodUnits,    setProdUnits]    = useState<ProdUnit[]>([]);
  const [prodLoading,  setProdLoading]  = useState(false);

  // Production job folder — the currently selected job in the cut list.
  const [prodSelectedJob, setProdSelectedJob] = useState<string>('');
  const [cutUnit,        setCutUnit]        = useState<ProdUnit | null>(null);
  const [cutParts,       setCutParts]       = useState<ProdPart[]>([]);
  const [cutLoading,     setCutLoading]     = useState(false);
  const [cutPartExpanded,setCutPartExpanded]= useState<Record<string, boolean>>({});
  const [cutActioning,   setCutActioning]   = useState<Record<string, boolean>>({});
  const [cutBulkBusy,    setCutBulkBusy]    = useState(false);

  // ── Job-level cut list (production) ────────────────────────────────────────
  // Tapping a Production job opens a full-screen, job-level cut list: all
  // cabinets (collapsed), check parts off across cabinets, and when a cabinet's
  // last part is checked a "fully cut" popup offers Push (now) or Hold (batch).
  const [cutJob,         setCutJob]         = useState<{ jobPath: string; jobNumber: string | null } | null>(null);
  const [cutJobCabs,     setCutJobCabs]     = useState<CutJobCab[]>([]);
  const [cutJobLoading,  setCutJobLoading]  = useState(false);
  const [cutCabExpanded, setCutCabExpanded] = useState<Record<string, boolean>>({});
  const [heldCabs,       setHeldCabs]       = useState<Record<string, boolean>>({});
  const [fullyCutCab,    setFullyCutCab]    = useState<{ cabinetId: string; label: string } | null>(null);
  const [destForCabs,    setDestForCabs]    = useState<string[] | null>(null);
  const [pushGroupOpen,  setPushGroupOpen]  = useState(false);
  const [groupSel,       setGroupSel]       = useState<Record<string, boolean>>({});
  const [longPressPart,  setLongPressPart]  = useState<{ part: CutJobPart; cabinetId: string } | null>(null);
  const [cutJobBusy,     setCutJobBusy]     = useState(false);
  const longPressTimerCut = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);

  // Camera (shared between damage + parts modals — only one open at a time)
  const videoRef         = useRef<HTMLVideoElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const [cameraError,    setCameraError]    = useState<string | null>(null);
  const [cameraStarting, setCameraStarting] = useState(false);

  // Switch department modal
  const [switchDeptVal, setSwitchDeptVal] = useState('');

  // Edit name modal
  const [editNameVal,  setEditNameVal]  = useState('');
  const [nameSaving,   setNameSaving]   = useState(false);

  // Thread view state
  const [openThread,  setOpenThread]  = useState<string | null>(null);
  const openThreadRef = useRef<string | null>(null);
  useEffect(() => { openThreadRef.current = openThread; }, [openThread]);
  const [replyBody,   setReplyBody]   = useState('');
  // Mark every supervisor message visible to this crew member as read in
  // Supabase (read_at). Stored in the DB — not localStorage — so the unread
  // badge stays at zero across reloads/devices. Clock-in/out request messages
  // are action items, not chat, so they're never touched here.
  function markSupRead() {
    const now = new Date().toISOString();
    const dept = crewDeptRef.current;
    setMessages((prev) => prev.map((m) =>
      (m.sender_name === 'Supervisor' && !m.read_at && !isClockRequestMsg(m) && (m.dept === null || m.dept === dept))
        ? { ...m, read_at: now } : m));
    const t = tenant;
    if (!t) return;
    void (async () => {
      try {
        let q = supabase.from('messages').update({ read_at: now })
          .eq('tenant_id', t.id).eq('sender_name', 'Supervisor').is('read_at', null);
        q = dept ? q.or(`dept.is.null,dept.eq.${dept}`) : q.is('dept', null);
        await q;
      } catch { /* optimistic update already applied; realtime will reconcile */ }
    })();
  }
  const [replySaving, setReplySaving] = useState(false);

  // Header clock-in indicator tooltip (tap to reveal clocked-in time).
  const [clockTipOpen, setClockTipOpen] = useState(false);

  // Adjustable clock in/out time. clockAdjustMs = the time the crew wants
  // recorded; clockBaseMs = the "now" captured when the step opened. When they
  // differ (at minute resolution) the action becomes an approval request.
  const [clockAdjustMs, setClockAdjustMs] = useState(0);
  const [clockBaseMs,   setClockBaseMs]   = useState(0);
  const [adjustReason,  setAdjustReason]  = useState('');
  const [requestSending, setRequestSending] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Messages screen — full-screen overlay that slides up from the bottom.
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [msgMenuOpen,  setMsgMenuOpen]  = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-device "Clear conversation" — hides messages older than this timestamp
  // from the crew's view only. localStorage, never the database, so the
  // supervisor still sees everything. Keyed per tenant.
  const [msgClearedAt, setMsgClearedAt] = useState('');
  useEffect(() => {
    if (!tenant?.id) return;
    try { setMsgClearedAt(localStorage.getItem(`messages_cleared_${tenant.id}`) || ''); } catch { /* ignore */ }
  }, [tenant?.id]);

  function openMessages() { markSupRead(); setOpenThread(null); setMessagesOpen(true); }
  function openSupervisorThread() { markSupRead(); setOpenThread('supervisor'); }
  function closeMessages() { setMessagesOpen(false); setMsgMenuOpen(false); setOpenThread(null); setReplyBody(''); }
  function clearConversation() {
    if (!tenant?.id) return;
    const now = new Date().toISOString();
    try { localStorage.setItem(`messages_cleared_${tenant.id}`, now); } catch { /* ignore */ }
    setMsgClearedAt(now);
    setMsgMenuOpen(false);
    showToast('Conversation cleared');
  }

  // Load localStorage identity + restore in-progress timers
  useEffect(() => {
    const n = localStorage.getItem('crew_name') ?? '';
    const d = localStorage.getItem('crew_dept') ?? '';
    setCrewName(n);
    setCrewDept(d);
    const id    = localStorage.getItem('craftsman_build_id');
    const start = localStorage.getItem('craftsman_build_start');
    const mat   = localStorage.getItem('craftsman_build_material');
    const type  = localStorage.getItem('craftsman_build_mattype');
    const job   = localStorage.getItem('craftsman_build_job');
    if (id && start) {
      setBuildId(id);
      setBuildStart(start);
      setBuildMaterial(mat);
      setBuildMatType(type);
      setBuildJob(job || null);
    }
    // Restore active clock-in and break state
    const activeId   = localStorage.getItem('active_time_clock_id');
    const breakStart = localStorage.getItem('break_start_time');
    const onBreakVal = localStorage.getItem('on_break');
    if (activeId) setActiveTimeClockId(activeId);
    if (onBreakVal === 'true' && breakStart) {
      setOnBreak(true);
      setBreakStartTime(breakStart);
    }
  }, []);

  // Tick every second while a build timer is running
  useEffect(() => {
    if (!buildStart) return;
    const iv = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [buildStart]);

  // Tick every second while on break
  useEffect(() => {
    if (!onBreak) return;
    const iv = setInterval(() => setBreakTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [onBreak]);

  // Load page data — fetch all tenant messages and filter client-side by dept
  useEffect(() => {
    if (!tenant) return;
    async function load() {
      try {
        const { data: msgData } = await supabase
          .from('messages')
          .select('id, sender_name, dept, body, created_at, read_at, topic, payload')
          .eq('tenant_id', tenant!.id)
          .order('created_at', { ascending: false })
          .limit(200);
        if (msgData) setMessages(msgData as Message[]);
      } catch (_) {}
      setDataLoading(false);
    }
    load();
  }, [tenant]);

  // Realtime subscription for messages
  useEffect(() => {
    if (!tenant) return;
    const tenantId = tenant.id;

    const msgCh = supabase
      .channel('rt-crew-messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const msg = payload.new as Message;
            setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev]);
            // Notify crew of supervisor messages directed at their dept or broadcast
            const currentDept = crewDeptRef.current;
            const isRelevant = msg.dept === null || msg.dept === currentDept;
            if (msg.sender_name === 'Supervisor' && isRelevant) {
              // Only show banner when crew is NOT already viewing the Supervisor thread
              if (openThreadRef.current !== 'supervisor') {
                const preview = msg.body.length > 70 ? msg.body.slice(0, 67) + '…' : msg.body;
                setMsgNotification(preview);
                if (notifTimer.current) clearTimeout(notifTimer.current);
                notifTimer.current = setTimeout(() => setMsgNotification(null), 7000);
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            setMessages((prev) => prev.map((m) => m.id === payload.new.id ? (payload.new as Message) : m));
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(msgCh); };
  }, [tenant]);

  // Start / stop the camera stream whenever the camera step becomes active/inactive.
  // The assembly scan uses the ZXing reader (live QR/barcode decode); the damage
  // and part-log cameras use plain getUserMedia for photo capture.
  useEffect(() => {
    const isPhotoCamera =
      (modal === 'damage' && dmgScanStep === 'camera') ||
      (modal === 'parts'  && partsMode === 'log' && partScanStep === 'camera');
    const isScanCamera = modal === 'assemblyScan' && assemblyScanStep === 'scan';
    if (isPhotoCamera) {
      void startCamera();
    } else if (isScanCamera) {
      void startZxingScanner();
    } else {
      stopCamera();
    }
    return () => { stopCamera(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, dmgScanStep, partScanStep, partsMode, assemblyScanStep]);

  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Amber "(pending sync)" toast for actions queued while offline.
  const showPending = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, pending: true });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // Resolve the current crew member's open shift (clock_out IS NULL) into
  // clockShift. Drives both the header clock indicator and the clock-in gate;
  // cached in state so per-action gate checks never hit the network. Called on
  // mount and after any event that changes clocked-in status.
  const reloadClock = useCallback(async () => {
    if (!tenant) return;
    const name = crewName.trim();
    if (!name) { setClockShift(null); return; }
    try {
      const { data } = await supabase
        .from('time_clock')
        .select('id, worker_name, dept, clock_in, clock_out, status')
        .eq('tenant_id', tenant.id)
        .eq('worker_name', name)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle();
      setClockShift((data as TimeEntry | null) ?? null);
    } catch (_) { /* gate falls open on error so work is never hard-blocked by a network hiccup */ }
  }, [tenant, crewName]);

  // Load the gate / indicator state on mount and whenever identity/tenant changes.
  useEffect(() => { void reloadClock(); }, [reloadClock]);

  const reloadMessages = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('id, sender_name, dept, body, created_at, read_at, topic, payload')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (data) setMessages(data as Message[]);
    } catch (_) {}
  }, [tenant]);

  // ── Never-miss-a-message: re-fetch on focus + on app open ──────────────────
  // A push notification can arrive while the app is closed or backgrounded; the
  // realtime channel won't replay it. So we always re-fetch the latest messages
  // when the page mounts and whenever it regains visibility. We also clear the
  // service-worker "has_new_messages" flag that the SW set on push receipt.
  useEffect(() => {
    if (!tenant) return;

    async function clearSwMessageFlag() {
      try {
        const cache = await caches.open('inlineiq-flags');
        await cache.delete('/has_new_messages');
      } catch { /* cache unavailable — ignore */ }
    }

    function refresh() {
      void reloadMessages();
      void reloadClock();   // keep the header clock indicator fresh (e.g. after a supervisor approval)
      void clearSwMessageFlag();
    }

    // Run once on mount (catches messages that landed while the app was closed).
    refresh();

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [tenant, reloadMessages, reloadClock]);

  // If the crew tapped a message push (or any ?open=messages link), jump
  // straight to the Messages screen instead of the home screen.
  useEffect(() => {
    if (!tenant) return;
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('open') === 'messages') {
        markSupRead();
        setOpenThread('supervisor');
        setMessagesOpen(true);
        // Strip the param so a refresh doesn't re-open it.
        params.delete('open');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  // ── Production cut-list loader ─────────────────────────────────────────────
  const loadProduction = useCallback(async () => {
    if (!tenant) return;
    setProdLoading(true);
    try {
      const { data: units } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, job_number, cabinet_number, room_number, status, production_status')
        .eq('tenant_id', tenant.id)
        .neq('status', 'complete')
        .order('job_number', { ascending: true });
      let unitList = (units as Omit<ProdUnit, 'partsTotal' | 'partsCut' | 'jobPath' | 'dueDate'>[]) ?? [];

      // Completed jobs disappear from every crew view.
      try {
        const { data: jrows } = await supabase.from('jobs').select('job_number').eq('tenant_id', tenant.id).eq('status', 'active');
        const activeSet = new Set(((jrows as { job_number: string }[] | null) ?? []).map((j) => j.job_number));
        unitList = unitList.filter((u) => !u.job_number || activeSet.has(u.job_number));
      } catch { /* jobs table optional */ }

      // assigned_dept is the single source of truth: a cabinet is in the cut list
      // when it still has at least one part assigned to production.
      const ids = unitList.map((u) => u.id);
      const counts: Record<string, { total: number; cut: number; remaining: number }> = {};
      if (ids.length > 0) {
        const { data: parts } = await supabase
          .from('parts').select('cabinet_unit_id, assigned_dept, checked').in('cabinet_unit_id', ids);
        ((parts as { cabinet_unit_id: string; assigned_dept: string | null; checked: boolean | null }[]) ?? []).forEach((p) => {
          if (p.assigned_dept !== 'production') return;
          const e = (counts[p.cabinet_unit_id] ??= { total: 0, cut: 0, remaining: 0 });
          e.total++;
          e.remaining++;
          if (p.checked) e.cut++;
        });
      }

      // job_path + due_date map (best-effort — column may not exist pre-migration)
      const jobNums = Array.from(new Set(unitList.map((u) => u.job_number).filter(Boolean))) as string[];
      const jobMap: Record<string, { jobPath: string; dueDate: string | null }> = {};
      if (jobNums.length > 0) {
        try {
          const { data: jrows } = await supabase
            .from('jobs').select('job_number, job_path, due_date')
            .eq('tenant_id', tenant.id).in('job_number', jobNums);
          ((jrows as { job_number: string; job_path: string | null; due_date: string | null }[]) ?? []).forEach((j) => {
            jobMap[j.job_number] = { jobPath: j.job_path || `Job ${j.job_number}`, dueDate: j.due_date ?? null };
          });
        } catch (_) {}
      }

      // Only cabinets that still have production parts to cut belong in the cut
      // list. Once all parts are cut OR pushed to another dept, the cabinet (and
      // eventually its job) drops out automatically.
      setProdUnits(unitList
        .filter((u) => (counts[u.id]?.remaining ?? 0) > 0)
        .map((u) => {
          const c = counts[u.id] ?? { total: 0, cut: 0, remaining: 0 };
          const jm = u.job_number ? jobMap[u.job_number] : undefined;
          return { ...u, partsTotal: c.total, partsCut: c.cut, jobPath: jm?.jobPath || (u.job_number ? `Job ${u.job_number}` : 'Unassigned'), dueDate: jm?.dueDate ?? null };
        }));
    } catch (_) { /* column may not exist until production_handoff.sql is run */ }
    setProdLoading(false);
  }, [tenant]);

  // Load the cut-list whenever this crew member is acting as Production
  useEffect(() => {
    if (crewDept === 'Production' && tenant) void loadProduction();
  }, [crewDept, tenant, loadProduction]);

  // Realtime: refresh the cut-list as cabinets/parts change
  useEffect(() => {
    if (!tenant || crewDept !== 'Production') return;
    const tenantId = tenant.id;
    const ch = supabase
      .channel('rt-prod-handoff')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void loadProduction(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenantId}` }, () => { void loadProduction(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant, crewDept, loadProduction]);

  // Collapse a Production job that no longer has uncut work. Default is
  // all-collapsed (no auto-open) so the job list shows as a tidy folder list.
  useEffect(() => {
    if (!prodSelectedJob) return;
    const paths = new Set(prodUnits.map((u) => u.jobPath));
    if (!paths.has(prodSelectedJob)) setProdSelectedJob('');
  }, [prodUnits, prodSelectedJob]);

  function saveIdentity(name: string, dept: string) {
    localStorage.setItem('crew_name', name);
    localStorage.setItem('crew_dept', dept);
    setCrewName(name);
    setCrewDept(dept);
  }

  // "Not [name]?" — clear the saved identity so a different crew member can use
  // this same device, then drop straight into the clock-in lookup with a blank name.
  function switchUser() {
    try {
      localStorage.removeItem('crew_name');
      localStorage.removeItem('crew_dept');
    } catch (_) {}
    setCrewName('');
    setCrewDept('');
    setClockName('');
    setClockDept('');
    setOpenEntry(null);
    setClockStep('lookup');
    setModal('clock');
  }

  // Gate any work action behind an open shift. Returns true if the crew member
  // is clocked in; otherwise shows the clock-in gate modal and returns false.
  // Uses the cached clockShift so the check is instant (no per-action DB call).
  function requireClockIn(): boolean {
    if (isClockedIn) return true;
    setGateOpen(true);
    return false;
  }

  // ── Open modal helpers ──────────────────────────────────────────────────────

  function openClock() {
    setClockStep('lookup');
    setClockName(crewName);
    setClockDept(crewDept);
    setOpenEntry(null);
    setAdjustReason('');
    setModal('clock');
    // Known crew member → skip the name prompt and go straight to the adjustable
    // clock in/out screen by resolving their open-shift status immediately.
    if (crewName.trim()) void handleClockLookup(crewName);
  }

  // ── Adjustable-time helpers ─────────────────────────────────────────────────
  // Seed the time picker with "now" (to the minute) when entering an in/out step.
  function seedClockTime() {
    const nowMs = Math.floor(Date.now() / 60000) * 60000;
    setClockBaseMs(nowMs);
    setClockAdjustMs(nowMs);
    setAdjustReason('');
  }
  function adjustClock(deltaMin: number) {
    setClockAdjustMs((ms) => ms + deltaMin * 60000);
  }
  function stopHold() {
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; }
  }
  function startHold(deltaMin: number) {
    adjustClock(deltaMin);          // immediate tap
    stopHold();
    holdTimer.current = setInterval(() => adjustClock(deltaMin), 110); // hold = faster
  }

  function openInventory() {
    setInvItem('');
    setInvDept(crewDept);
    setInvJobNum('');
    setModal('inventory');
  }

  function openDamage() {
    setDmgWhat('');
    setDmgDept(crewDept);
    setDmgType('damage');
    setDmgPhoto(null);
    setDmgPhotoPreview(null);
    setDmgScanStep('camera');
    setDmgShowDetails(false);
    setCameraError(null);
    setCameraStarting(false);
    setModal('damage');
  }
  // Open the damage report flow prefilled for a specific part (from the cutlist
  // long-press sheet). Closes the cut list so the modal is visible on top.
  function openDamageForPart(partName: string) {
    setCutJob(null);
    setDmgWhat(partName);
    setDmgDept('Production');
    setDmgType('damage');
    setDmgPhoto(null);
    setDmgPhotoPreview(null);
    setDmgScanStep('preview');
    setDmgShowDetails(true);
    setCameraError(null);
    setCameraStarting(false);
    setModal('damage');
  }

  function openSwitchDept() {
    setSwitchDeptVal(crewDept);
    setModal('switchDept');
  }

  async function handleSwitchDept() {
    const newDept = switchDeptVal;
    console.log('[switchDept] fired, newDept=', newDept, 'current=', crewDept);
    if (!newDept) return;
    // 1. Persist and update React state immediately
    saveIdentity(crewName, newDept);
    // 2. Reset any open message thread so the inbox re-renders for new dept
    setOpenThread(null);
    setReplyBody('');
    // 3. Re-fetch messages — the initial load was capped at 50 rows across all
    //    departments, so messages for the newly selected dept may not be loaded yet
    await reloadMessages();
    // Sync device_tokens
    try {
      await supabase.from('device_tokens')
        .update({ dept: newDept })
        .eq('name', crewName)
        .eq('tenant_id', tenant!.id);
    } catch (_) {}
    // Update current_dept on active clock row
    const tcId = activeTimeClockId;
    if (tcId) {
      try { await supabase.from('time_clock').update({ current_dept: newDept }).eq('id', tcId); } catch (_) {}
      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: tcId,
        workerName: crewName, eventType: 'dept_switch',
        dept: newDept, previousDept: crewDept || null,
      });
    }
    // Re-tag this device's push subscription with the new dept so notifications
    // follow the crew member. Best-effort — never blocks the dept switch.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await upsertPushSubscription({
            tenantId: tenant!.id, userType: 'crew',
            userName: crewName || undefined, dept: newDept, subscription: sub,
          });
        }
      }
    } catch (_) { /* push update failed — dept switch already applied */ }
    closeModal();
    showToast(`Department changed to ${newDept}`);
  }

  function openEditName() {
    setEditNameVal(crewName);
    setModal('editName');
  }

  async function handleSaveName() {
    const newName = editNameVal.trim();
    if (!newName || nameSaving) return;
    const oldName = crewName;
    setNameSaving(true);
    try {
      saveIdentity(newName, crewDept);
      // Update any open clock-in row so time reports stay correct
      if (oldName && oldName !== newName && tenant) {
        await supabase
          .from('time_clock')
          .update({ worker_name: newName })
          .eq('tenant_id', tenant.id)
          .eq('worker_name', oldName)
          .is('clock_out', null);
        await reloadClock();
      }
      closeModal();
      showToast('Name updated');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setNameSaving(false);
    }
  }

  async function openPlans() {
    setDrawings([]);
    setShowOldPlans(false);
    setModal('plans');
    setPlansLoading(true);
    try {
      const { data } = await supabase
        .from('job_drawings')
        .select('id, tenant_id, job_number, job_name, plan_name, label, file_url, external_url, file_name, file_type, departments, parsed, uploaded_by, created_at, version, superseded_by, is_current')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false });
      if (data) {
        // Visible if routed to "all" departments or to this crew's department.
        const visible = (data as Drawing[]).filter((d) => {
          const depts = d.departments ?? ['all'];
          return depts.includes('all') || (!!crewDept && depts.includes(crewDept));
        });
        setDrawings(visible);
      }
    } catch (_) {}
    setPlansLoading(false);
  }

  // Silently record that this crew member viewed a plan (Crew Viewed Confirmation).
  function recordPlanView(planId: string) {
    if (!tenant || !crewName) return;
    try {
      void supabase.from('plan_views').insert({
        tenant_id:   tenant.id,
        plan_id:     planId,
        viewer_name: crewName,
      });
    } catch (_) { /* view tracking best-effort */ }
  }

  // Open a plan file in the viewer and log the view.
  function openPlanFile(plan: Drawing, file: ViewerFile) {
    recordPlanView(plan.id);
    setViewerFile(file);
  }

  // Load a cabinet unit + its parts into the assembly scan checklist.
  async function loadCabinetUnit(cabinetUnitId: string, force = false) {
    const [unitRes, partsRes] = await Promise.all([
      supabase.from('cabinet_units')
        .select('id, unit_label, job_number, cabinet_number, room_number, status, production_status')
        .eq('id', cabinetUnitId).single(),
      supabase.from('parts')
        .select('id, part_name, material, width, height, depth, quantity, status, flag_type, production_status')
        .eq('cabinet_unit_id', cabinetUnitId).order('part_name'),
    ]);
    if (unitRes.error) throw unitRes.error;

    const unit  = unitRes.data as AssemblyCabinetUnit & { production_status?: string | null };
    const parts = (partsRes.data as AssemblyScanPart[]) ?? [];

    // ── Production gate ──────────────────────────────────────────────────────
    // Assembly may only open the checklist once Production has cut the cabinet.
    // Cabinets already in assembly/flagged/complete are grandfathered in. The
    // auto-detect router passes force=true once the crew has chosen the flow.
    const alreadyStarted = ['in_assembly', 'flagged', 'complete'].includes(unit.status);
    const cabinetCut = isPartCut(unit.production_status);
    const allPartsCut = parts.length > 0 && parts.every((p) => isPartCut(p.production_status));
    if (!force && !alreadyStarted && !cabinetCut && !allPartsCut) {
      setAssemblyNotReady({ unit, parts });
      return;
    }
    setAssemblyNotReady(null);

    setAssemblyScanUnit(unit);
    setAssemblyScanParts(parts);
    await supabase.from('cabinet_units').update({ status: 'in_assembly' }).eq('id', cabinetUnitId);

    const init: Record<string, boolean> = {};
    parts.forEach((p) => { init[p.id] = false; });
    setAssemblyScanChecked(init);
    setAssemblyScanStep('checklist');
    parts.forEach((p, i) => {
      setTimeout(() => { setAssemblyScanChecked((prev) => ({ ...prev, [p.id]: true })); }, 150 + i * 100);
    });
  }

  async function openPartsList(jobNumber: string) {
    setPartsListJob(jobNumber || null);
    setPartsListUnits([]);
    setPartsListParts([]);
    setPartsListExpanded({});
    setModal('partsList');
    setPartsListLoading(true);
    try {
      const { data: units } = await supabase
        .from('cabinet_units')
        .select('id, unit_label, job_number, cabinet_number, room_number, status')
        .eq('tenant_id', tenant!.id)
        .eq('job_number', jobNumber)
        .order('room_number', { ascending: true });
      const unitList = (units as AssemblyCabinetUnit[]) ?? [];
      let partList: PartsListPart[] = [];
      if (unitList.length > 0) {
        const ids = unitList.map((u) => u.id);
        const { data: parts } = await supabase
          .from('parts')
          .select('id, cabinet_unit_id, part_name, material, width, height, depth, quantity, status, flag_type')
          .in('cabinet_unit_id', ids)
          .order('part_name');
        partList = (parts as PartsListPart[]) ?? [];
      }
      setPartsListUnits(unitList);
      setPartsListParts(partList);
    } catch (_) {}
    setPartsListLoading(false);
  }

  // Launch the scan flow pre-loaded with a specific cabinet (from the parts list).
  async function openScanForUnit(unitId: string) {
    if (!requireClockIn()) return;
    setAssemblyScanInput('');
    setAssemblyScanFlags({});
    setAssemblyScanFlagging(null);
    setAssemblyScanNotFound(false);
    setAssemblyScanDone(false);
    setAssemblyScanUnit(null);
    setAssemblyScanParts([]);
    setAssemblyScanStep('checklist'); // prevents the scan-step camera from auto-starting
    setModal('assemblyScan');
    setAssemblyScanSearching(true);
    try {
      await loadCabinetUnit(unitId);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load cabinet', true);
      setAssemblyScanStep('scan');
    } finally {
      setAssemblyScanSearching(false);
    }
  }

  async function openParts() {
    setPartsMode('log');
    setPartName('');
    setPartJobNum('');
    setPartJobId('');
    setPartDept(crewDept);
    setPartStatus('In Progress');
    setPartNextDept('');
    setPartNotes('');
    setPartPhoto(null);
    setPartPhotoPreview(null);
    setPartScanStep('camera');
    setPartShowDetails(false);
    setCameraError(null);
    setCameraStarting(false);
    setModal('parts');
    // Fetch jobs for dropdown (best-effort)
    if (tenant) {
      supabase.from('jobs').select('id, job_number, job_name, status').eq('tenant_id', tenant.id).eq('status', 'active').order('created_at', { ascending: false })
        .then(({ data }) => { if (data) setJobs(data as Job[]); });
    }
    if (crewDept && tenant) {
      setQcLoading(true);
      try {
        const { data } = await supabase
          .from('parts_log')
          .select('*')
          .eq('tenant_id', tenant.id)
          .eq('dept', crewDept)
          .eq('status', 'QC Check')
          .order('created_at', { ascending: false });
        if (data) setPartsQcList(data as PartLog[]);
      } catch (_) {}
      setQcLoading(false);
    }
  }

  function openAssemblyScan() {
    setAssemblyScanStep('scan');
    setAssemblyScanInput('');
    setAssemblyScanUnit(null);
    setAssemblyScanParts([]);
    setAssemblyScanChecked({});
    setAssemblyScanFlags({});
    setAssemblyScanFlagging(null);
    setAssemblyScanFlagType('damaged');
    setAssemblyScanFlagNotes('');
    setAssemblyScanNotFound(false);
    setAssemblyScanDone(false);
    setAssemblyNotReady(null);
    setScanAiResult(null);
    setScanShowAlts(false);
    setScanChoiceUnit(null);
    setCameraError(null);
    setCameraStarting(false);
    setModal('assemblyScan');
  }

  // Unified "Scan" entry point. Assembly + Production/QC open the unified scan
  // flow (camera + ZXing + auto-detect). Any other dept falls back to the
  // generic part log / QC modal.
  function openScan() {
    if (!requireClockIn()) return;
    if (crewDept === 'Assembly' || crewDept === 'Production') {
      openAssemblyScan();
    } else {
      void openParts();
    }
  }

  // Persist a confirmed match so the shop learns this abbreviation permanently.
  async function saveLabelMapping(rawLower: string, cabinetUnitId: string, partName: string, confidence: number) {
    if (!tenant || !rawLower) return;
    try {
      await supabase.from('label_mappings').insert({
        tenant_id:         tenant.id,
        raw_label:         rawLower,
        matched_part_name: partName,
        cabinet_unit_id:   cabinetUnitId,
        job_number:        null,
        confidence,
        confirmed_by:      crewName || null,
      });
    } catch (_) { /* learning is best-effort */ }
  }

  // Load a cabinet from a (possibly AI) match, learn the mapping, clear AI UI.
  async function confirmScanMatch(m: ScanAiMatch, rawInput: string) {
    setScanAiResult(null);
    setScanShowAlts(false);
    setAssemblyScanSearching(true);
    try {
      await routeScanToFlow(m.cabinet_unit_id);
      await saveLabelMapping(rawInput.trim().toLowerCase(), m.cabinet_unit_id, m.part_name, m.confidence);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not load cabinet', true);
    } finally {
      setAssemblyScanSearching(false);
      scanBusyRef.current = false;
    }
  }

  // Open the Production cut flow (cut view) for a matched cabinet, closing the
  // unified scan modal first so the cut-view overlay takes over.
  async function openProductionCutFlow(unit: AssemblyCabinetUnit & { production_status?: string | null }) {
    let jobPath = unit.job_number ? `Job ${unit.job_number}` : 'Unassigned';
    try {
      if (unit.job_number && tenant) {
        const { data: j } = await supabase.from('jobs').select('job_path').eq('tenant_id', tenant.id).eq('job_number', unit.job_number).maybeSingle();
        const p = (j as { job_path: string | null } | null)?.job_path;
        if (p) jobPath = p;
      }
    } catch (_) {}
    const prodUnit: ProdUnit = {
      id: unit.id, unit_label: unit.unit_label, job_number: unit.job_number,
      cabinet_number: unit.cabinet_number, room_number: unit.room_number,
      status: unit.status, production_status: unit.production_status ?? null,
      partsTotal: 0, partsCut: 0, jobPath, dueDate: null,
    };
    setScanChoiceUnit(null);
    closeModal();
    await openCutView(prodUnit);
  }

  // Auto-detect the right flow for a scanned cabinet (FIX 2):
  //   in_assembly / flagged       → QC check (parts + flagging)
  //   cut + pending               → Assembly checklist (auto-check parts)
  //   not_cut / cutting           → Production cut view (mark parts cut)
  //   otherwise indeterminate     → ask the crew (Assembly | Production/QC)
  async function routeScanToFlow(cabinetUnitId: string) {
    if (!tenant) return;
    const { data, error } = await supabase.from('cabinet_units')
      .select('id, unit_label, job_number, cabinet_number, room_number, status, production_status')
      .eq('id', cabinetUnitId).single();
    if (error) throw error;
    const unit = data as AssemblyCabinetUnit & { production_status?: string | null };
    const status = unit.status;
    const ps = unit.production_status ?? null;
    const cut = isPartCut(ps);

    if (status === 'in_assembly' || status === 'flagged') { await loadCabinetUnit(cabinetUnitId, true); return; }
    if (cut && (status === 'pending' || status === 'complete' || !status)) { await loadCabinetUnit(cabinetUnitId, true); return; }
    if (ps === 'not_cut' || ps === 'cutting' || (!cut && ps)) { await openProductionCutFlow(unit); return; }
    if (cut) { await loadCabinetUnit(cabinetUnitId, true); return; }
    setScanChoiceUnit(unit);
  }

  // Unified scan resolver. Order: label_mappings (learned) → exact/fuzzy string
  // strategies → AI fuzzy match (match-label route) → manual fallback.
  async function handleAssemblyScanSearch(override?: string) {
    const input = (override ?? assemblyScanInput).trim();
    if (!input || !tenant) return;
    if (scanBusyRef.current) return;
    scanBusyRef.current = true;
    setAssemblyScanSearching(true);
    setAssemblyScanNotFound(false);
    setScanAiResult(null);
    setScanShowAlts(false);
    setScanChoiceUnit(null);
    const lower = input.toLowerCase();
    try {
      // Step 1: learned label mappings (instant, no AI cost)
      try {
        const { data: lm } = await supabase
          .from('label_mappings')
          .select('cabinet_unit_id')
          .eq('tenant_id', tenant.id)
          .ilike('raw_label', lower)
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        const lmId = (lm as { cabinet_unit_id: string | null } | null)?.cabinet_unit_id;
        if (lmId) { await routeScanToFlow(lmId); return; }
      } catch (_) { /* table may not exist pre-migration */ }

      // Step 2-3: exact / fuzzy string strategies
      let cabinetUnitId: string | null = null;

      const { data: sv } = await supabase
        .from('parts').select('cabinet_unit_id')
        .eq('tenant_id', tenant.id).eq('scan_value', input)
        .limit(1).maybeSingle();
      if (sv) cabinetUnitId = (sv as { cabinet_unit_id: string }).cabinet_unit_id;

      if (!cabinetUnitId) {
        const { data: pn } = await supabase
          .from('parts').select('cabinet_unit_id')
          .eq('tenant_id', tenant.id).ilike('part_name', `%${input}%`)
          .limit(1).maybeSingle();
        if (pn) cabinetUnitId = (pn as { cabinet_unit_id: string }).cabinet_unit_id;
      }

      if (!cabinetUnitId) {
        const { data: ul } = await supabase
          .from('cabinet_units').select('id')
          .eq('tenant_id', tenant.id).ilike('unit_label', `%${input}%`)
          .limit(1).maybeSingle();
        if (ul) cabinetUnitId = (ul as { id: string }).id;
      }

      if (!cabinetUnitId) {
        const segs = input.split('/').map((s) => s.trim()).filter(Boolean);
        if (segs.length >= 3) {
          const [job, room, cabinet] = segs;
          const { data: fmt } = await supabase
            .from('cabinet_units').select('id')
            .eq('tenant_id', tenant.id)
            .eq('job_number', job).eq('room_number', room).eq('cabinet_number', cabinet)
            .limit(1).maybeSingle();
          if (fmt) cabinetUnitId = (fmt as { id: string }).id;
        }
      }

      if (cabinetUnitId) {
        await routeScanToFlow(cabinetUnitId);
        void saveLabelMapping(lower, cabinetUnitId, input, 100);
        return;
      }

      // Step 4: AI fuzzy match
      try {
        const res = await fetch('/app/api/match-label', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: tenant.id, rawLabel: input, jobPath: null }),
        });
        if (res.ok) {
          const ai = (await res.json()) as ScanAiResult;
          // >= 95 → auto-load, no confirmation
          if (ai.match && ai.match.confidence >= 95) {
            await routeScanToFlow(ai.match.cabinet_unit_id);
            void saveLabelMapping(lower, ai.match.cabinet_unit_id, ai.match.part_name, ai.match.confidence);
            return;
          }
          // 85-94 → confirm; < 85 or no single match → show alternatives
          if (ai.match || (ai.alternatives && ai.alternatives.length > 0)) {
            setScanAiResult(ai);
            setScanShowAlts(!ai.match || ai.match.confidence < 85);
            return;
          }
        }
      } catch (_) { /* AI unavailable — fall through to manual */ }

      setAssemblyScanNotFound(true);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Search failed', true);
    } finally {
      setAssemblyScanSearching(false);
      scanBusyRef.current = false;
    }
  }

  function handleAssemblyScanFlag(partId: string) {
    if (assemblyScanFlagging === partId) {
      setAssemblyScanFlagging(null);
      return;
    }
    setAssemblyScanFlagging(partId);
    setAssemblyScanFlagType('damaged');
    setAssemblyScanFlagNotes('');
  }

  function handleAssemblyScanFlagConfirm(partId: string) {
    setAssemblyScanFlags((prev) => ({
      ...prev,
      [partId]: { type: assemblyScanFlagType, notes: assemblyScanFlagNotes },
    }));
    setAssemblyScanChecked((prev) => ({ ...prev, [partId]: false }));
    setAssemblyScanFlagging(null);
  }

  async function handleAssemblyScanConfirm() {
    if (!requireClockIn()) return;
    if (!assemblyScanUnit || assemblyScanConfirming || !tenant) return;

    const flaggedEntries = Object.entries(assemblyScanFlags);
    const hasFlagged     = flaggedEntries.length > 0;

    // Offline — queue the scan (part status updates + unit status + any flags).
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const updates = assemblyScanParts.map((p) => {
        const flag = assemblyScanFlags[p.id];
        return {
          id:         p.id,
          status:     flag ? flag.type : (assemblyScanChecked[p.id] ? 'checked' : 'pending'),
          checked_at: assemblyScanChecked[p.id] ? new Date().toISOString() : null,
          checked_by: crewName || null,
          flag_type:  flag?.type  || null,
          flag_notes: flag?.notes || null,
        };
      });
      const damage_reports = flaggedEntries.map(([partId, flag]) => {
        const part = assemblyScanParts.find((pp) => pp.id === partId);
        return {
          part_name:       part?.part_name ?? 'Unknown part',
          dept:            'Assembly',
          status:          'open',
          flag_type:       flag.type,
          notes:           flag.notes || null,
          cabinet_unit_id: assemblyScanUnit.id,
          job_id:          assemblyScanUnit.job_number,
          assembler_name:  crewName || null,
        };
      });
      enqueue('part_scan', {
        updates,
        cabinet_unit_id: assemblyScanUnit.id,
        // Assembled cabinets go to the supervisor QC gate, never straight to complete.
        unit_status:     hasFlagged ? 'flagged' : 'ready_for_qc',
        damage_reports,
      });
      setAssemblyScanDone(true);
      showPending('Scan saved (pending sync)');
      setTimeout(() => { setAssemblyScanDone(false); closeModal(); }, 2000);
      return;
    }

    setAssemblyScanConfirming(true);
    try {

      // Update all part statuses
      await Promise.all(assemblyScanParts.map((p) => {
        const flag      = assemblyScanFlags[p.id];
        const newStatus = flag ? flag.type : (assemblyScanChecked[p.id] ? 'checked' : 'pending');
        return supabase.from('parts').update({
          status:      newStatus,
          checked_at:  assemblyScanChecked[p.id] ? new Date().toISOString() : null,
          checked_by:  crewName || null,
          flag_type:   flag?.type   || null,
          flag_notes:  flag?.notes  || null,
        }).eq('id', p.id);
      }));

      // Update cabinet unit status. Assembled cabinets do NOT go straight to
      // complete — they move to the supervisor QC gate (ready_for_qc).
      const unitUpdate: Record<string, unknown> = hasFlagged
        ? { status: 'flagged' }
        : { status: 'ready_for_qc', assigned_dept: 'qc' };
      await supabase.from('cabinet_units').update(unitUpdate).eq('id', assemblyScanUnit.id);

      // Notify the supervisor that this cabinet is waiting for QC.
      if (!hasFlagged) {
        const jl = assemblyScanUnit.job_number ? `Job ${assemblyScanUnit.job_number}` : '';
        const body = `${assemblyScanUnit.unit_label}${jl ? ` — ${jl}` : ''} is ready for QC`;
        sendNotify({ tenant_id: tenant!.id, target: 'supervisor', title: 'Ready for QC', body, url: '/app/supervisor' });
        try {
          await supabase.from('notifications').insert({ tenant_id: tenant!.id, target_type: 'supervisor', title: 'Ready for QC', body, url: '/app/supervisor' });
        } catch (_) { /* bell log best-effort */ }
        void logShiftEvent({
          tenantId: tenant!.id, timeClockId: activeTimeClockId,
          workerName: crewName || 'Crew', eventType: 'assembly_complete', dept: crewDept,
          metadata: { unit_id: assemblyScanUnit.id, unit_label: assemblyScanUnit.unit_label, job_number: assemblyScanUnit.job_number, worker_name: crewName || 'Crew' },
        });
      }

      // Create damage reports for flagged parts
      if (hasFlagged) {
        const reports = flaggedEntries.map(([partId, flag]) => {
          const part = assemblyScanParts.find((p) => p.id === partId);
          return {
            part_name:       part?.part_name ?? 'Unknown part',
            dept:            'Assembly',
            status:          'open',
            tenant_id:       tenant!.id,
            flag_type:       flag.type,
            notes:           flag.notes || null,
            cabinet_unit_id: assemblyScanUnit!.id,
            job_id:          assemblyScanUnit!.job_number,
            assembler_name:  crewName || null,
          };
        });
        const { error } = await supabase.from('damage_reports').insert(reports);
        if (error) throw error;
        sendNotify({
          tenant_id: tenant!.id,
          target: 'supervisor',
          title: 'Damage Report',
          body: `${crewName || 'Crew'} reported damage in Assembly`,
          url: '/app/supervisor',
        });
      }

      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: activeTimeClockId,
        workerName: crewName || 'Crew', eventType: 'part_scanned',
        dept: crewDept,
        metadata: {
          cabinet_unit_label: assemblyScanUnit!.unit_label,
          job_number: assemblyScanUnit!.job_number,
          parts_count: assemblyScanParts.length,
          flags_count: flaggedEntries.length,
        },
      });
      setAssemblyScanDone(true);
      setTimeout(() => {
        setAssemblyScanDone(false);
        closeModal();
      }, 2000);

    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Confirm failed', true);
    } finally {
      setAssemblyScanConfirming(false);
    }
  }

  // ── Production: Cabinet Cut View ───────────────────────────────────────────
  async function openCutView(unit: ProdUnit) {
    setCutUnit(unit);
    setCutParts([]);
    setCutPartExpanded({});
    setCutLoading(true);
    try {
      // Fetch every part on this cabinet, then keep the production-owned ones that
      // still need cutting. Filtering client-side avoids PostgREST .or()/null edge
      // cases that previously returned "No parts on this cabinet" for valid units.
      const { data } = await supabase
        .from('parts')
        .select('id, part_name, material, width, height, depth, quantity, production_status, cut_by, cut_at, cut_photo_url, assigned_dept')
        .eq('cabinet_unit_id', unit.id)
        .order('part_name');
      const rows = (data as (ProdPart & { assigned_dept: string | null })[]) ?? [];
      // assigned_dept is the source of truth: show only parts still in production.
      const visible = rows.filter((p) => p.assigned_dept === 'production');
      setCutParts(visible);
    } catch (_) {}
    setCutLoading(false);
  }
  function closeCutView() { setCutUnit(null); setCutParts([]); setCutPartExpanded({}); }

  // ── Job-level cut list ─────────────────────────────────────────────────────
  async function openCutJob(units: ProdUnit[], jobPath: string) {
    if (!requireClockIn()) return;
    const jobNumber = units.find((u) => u.job_number)?.job_number ?? null;
    setCutJob({ jobPath, jobNumber });
    setCutJobCabs([]);
    setCutCabExpanded({});
    setHeldCabs({});
    setCutJobLoading(true);
    try {
      const cabIds = units.map((u) => u.id);
      const { data } = await supabase
        .from('parts')
        .select('id, part_name, material, width, height, depth, quantity, checked, cabinet_unit_id, assigned_dept')
        .in('cabinet_unit_id', cabIds)
        .order('part_name');
      const rows = (data as (CutJobPart & { assigned_dept: string | null })[] | null) ?? [];
      const byCab: Record<string, CutJobPart[]> = {};
      rows.filter((p) => p.assigned_dept === 'production').forEach((p) => {
        (byCab[p.cabinet_unit_id] ??= []).push({ ...p, checked: !!p.checked });
      });
      const cabs: CutJobCab[] = units
        .filter((u) => (byCab[u.id]?.length ?? 0) > 0)
        .map((u) => ({ cabinetId: u.id, label: u.unit_label, key: u.cabinet_number || u.unit_label, jobNumber: u.job_number, parts: byCab[u.id] ?? [] }));
      setCutJobCabs(cabs);
    } catch { /* best-effort */ }
    setCutJobLoading(false);
  }
  function closeCutJob() {
    setCutJob(null); setCutJobCabs([]); setCutCabExpanded({}); setHeldCabs({});
    setFullyCutCab(null); setDestForCabs(null); setPushGroupOpen(false); setLongPressPart(null);
    void loadProduction();
  }

  // Check/uncheck a part as it's cut. Sets both `checked` (the cutlist tick) and
  // production_status so the supervisor pipeline + job progress stay in sync.
  // When the cabinet's last unchecked part is checked, the "fully cut" popup fires.
  async function toggleCutPart(cabinetId: string, partId: string) {
    const cab = cutJobCabs.find((c) => c.cabinetId === cabinetId);
    const part = cab?.parts.find((p) => p.id === partId);
    if (!cab || !part) return;
    const next = !part.checked;
    const now = new Date().toISOString();
    setCutJobCabs((cabs) => cabs.map((c) => c.cabinetId !== cabinetId ? c : { ...c, parts: c.parts.map((p) => p.id === partId ? { ...p, checked: next } : p) }));
    // Fully-cut popup when this check completes the cabinet.
    if (next && cab.parts.every((p) => p.id === partId || p.checked)) {
      setFullyCutCab({ cabinetId, label: cab.label });
    }
    try {
      await supabase.from('parts')
        .update(next
          ? { checked: true, production_status: 'cut', cut_by: crewName || null, cut_at: now }
          : { checked: false, production_status: 'not_cut' })
        .eq('id', partId).eq('tenant_id', tenant!.id);
    } catch { /* optimistic; realtime will reconcile */ }
  }

  // Push every part of the given cabinets to a destination dept and drop them.
  async function pushCutCabinets(cabinetIds: string[], toDept: string) {
    if (cutJobBusy) return;
    setCutJobBusy(true);
    try {
      for (const cid of cabinetIds) {
        const cab = cutJobCabs.find((c) => c.cabinetId === cid);
        if (!cab) continue;
        for (const p of cab.parts) {
          try {
            await pushPart({ tenantId: tenant!.id, partId: p.id, partName: p.part_name, cabinetUnitId: cid, jobNumber: cab.jobNumber, fromDept: 'production', toDept, workerName: crewName, timeClockId: activeTimeClockId });
          } catch { /* best-effort per part */ }
        }
      }
      setCutJobCabs((cabs) => cabs.filter((c) => !cabinetIds.includes(c.cabinetId)));
      setHeldCabs((h) => { const n = { ...h }; cabinetIds.forEach((id) => delete n[id]); return n; });
      showToast(`Pushed ${cabinetIds.length} cabinet${cabinetIds.length === 1 ? '' : 's'} to ${deptDisplay(toDept)}`);
      void loadProduction();
    } finally {
      setCutJobBusy(false);
      setDestForCabs(null);
    }
  }

  // Push a single part to a dept (from the long-press sheet). Part leaves the cutlist.
  async function pushSingleCutPart(cabinetId: string, part: CutJobPart, toDept: string) {
    setLongPressPart(null);
    try {
      await pushPart({ tenantId: tenant!.id, partId: part.id, partName: part.part_name, cabinetUnitId: cabinetId, jobNumber: cutJob?.jobNumber ?? null, fromDept: 'production', toDept, workerName: crewName, timeClockId: activeTimeClockId });
      setCutJobCabs((cabs) => cabs.map((c) => c.cabinetId !== cabinetId ? c : { ...c, parts: c.parts.filter((p) => p.id !== part.id) }).filter((c) => c.parts.length > 0));
      showToast(`Sent to ${deptDisplay(toDept)}`);
      void loadProduction();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Push failed', true);
    }
  }

  async function handlePartPhoto(partId: string, file: File) {
    try {
      const url = await uploadPhoto(file, 'part-photos');
      if (!url) return;
      setCutParts((ps) => ps.map((p) => p.id === partId ? { ...p, cut_photo_url: url } : p));
      const { error } = await supabase.from('parts').update({ cut_photo_url: url }).eq('id', partId);
      if (error) throw error;
      showToast('Photo saved');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Photo upload failed', true);
    }
  }

  async function openSOPs() {
    setSops([]);
    setModal('sops');
    setSopsLoading(true);
    try {
      const { data } = await supabase
        .from('sops')
        .select('id, title, dept, pdf_url, created_at')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false });
      if (data) {
        setSops((data as SopItem[]).filter((s) => s.dept === null || s.dept === crewDept));
      }
    } catch (_) {}
    setSopsLoading(false);
  }

  // ── Craftsman build timer ──────────────────────────────────────────────────

  function openBuildTimerModal() {
    setBmMaterial('');
    setBmMatType('Raw Lumber');
    setBmQty('');
    setBmUnit('Board Feet');
    setBmJobNum('');
    setBuildTimerStep('form');
    setBuildSummary(null);
    setModal('buildTimer');
  }

  async function handleStartTimer() {
    if (!requireClockIn()) return;
    const mat = bmMaterial.trim();
    console.log('[BuildTimer] handleStartTimer called', { mat, saving, crewName, tenantId: tenant?.id });
    if (!mat || saving) return;
    setSaving(true);
    try {
      const now   = new Date().toISOString();
      const date  = new Date().toISOString().split('T')[0];
      const notes = `[${bmMatType}] ${mat}${bmQty.trim() ? ` — ${bmQty.trim()} ${bmUnit}` : ''}`;
      // Insert only the columns guaranteed to exist; notes/job_number added by migration
      const basePayload = {
        worker_name: crewName || 'Craftsman',
        dept:        'Craftsman',
        clock_in:    now,
        date,
        status:      'craftsman_build',
        tenant_id:   tenant!.id,
      };
      console.log('[BuildTimer] inserting payload:', { ...basePayload, notes, job_number: bmJobNum.trim() || null });
      const { data, error } = await supabase
        .from('time_clock')
        .insert(basePayload)
        .select('id')
        .single();
      if (error) {
        console.error('[BuildTimer] insert error:', error);
        throw error;
      }
      // Patch notes + job_number if columns exist (craftsman_features.sql migration)
      try {
        await supabase.from('time_clock').update({
          notes,
          job_number: bmJobNum.trim() || null,
        }).eq('id', data.id);
      } catch {
        console.warn('[BuildTimer] notes/job_number columns not yet migrated — timer started without them');
      }
      localStorage.setItem('craftsman_build_id',       data.id);
      localStorage.setItem('craftsman_build_start',    now);
      localStorage.setItem('craftsman_build_material', mat);
      localStorage.setItem('craftsman_build_mattype',  bmMatType);
      localStorage.setItem('craftsman_build_job',      bmJobNum.trim());
      setBuildId(data.id);
      setBuildStart(now);
      setBuildMaterial(mat);
      setBuildMatType(bmMatType);
      setBuildJob(bmJobNum.trim() || null);
      closeModal();
      showToast('Build timer started');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Start failed';
      console.error('[BuildTimer] fatal error:', err);
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleStopTimer() {
    if (!buildId || !buildStart || timerStopping) return;
    setTimerStopping(true);
    try {
      const now        = new Date().toISOString();
      const totalHours = (Date.now() - new Date(buildStart).getTime()) / 3600000;
      const { error }  = await supabase
        .from('time_clock')
        .update({ clock_out: now, total_hours: Math.round(totalHours * 10000) / 10000 })
        .eq('id', buildId);
      if (error) throw error;
      const duration = fmtElapsed(buildStart);
      const mat      = buildMaterial ?? '';
      const job      = buildJob;
      localStorage.removeItem('craftsman_build_id');
      localStorage.removeItem('craftsman_build_start');
      localStorage.removeItem('craftsman_build_material');
      localStorage.removeItem('craftsman_build_mattype');
      localStorage.removeItem('craftsman_build_job');
      setBuildId(null);
      setBuildStart(null);
      setBuildMaterial(null);
      setBuildMatType(null);
      setBuildJob(null);
      setBuildSummary({ material: mat, duration, job });
      setBuildTimerStep('summary');
      setModal('buildTimer');
      await reloadClock();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Stop failed';
      showToast(msg, true);
    } finally {
      setTimerStopping(false);
    }
  }

  function stopCamera() {
    stopZxingScanner();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function closeModal() {
    setModal(null);
    setSaving(false);
    setAssemblyNotReady(null);
    stopHold();
    stopCamera();
  }

  // ── Clock handlers ──────────────────────────────────────────────────────────

  async function handleClockLookup(nameOverride?: string) {
    const name = (nameOverride ?? clockName).trim();
    if (!name) return;
    setChecking(true);
    try {
      const { data } = await supabase
        .from('time_clock')
        .select('id, worker_name, dept, clock_in, clock_out, status')
        .eq('tenant_id', tenant!.id)
        .eq('worker_name', name)
        .is('clock_out', null)
        .order('clock_in', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        setOpenEntry(data as TimeEntry);
        seedClockTime();
        setClockStep('clockout');
      } else {
        // Known crew member? Pre-fill their department from the roster.
        try {
          const { data: member } = await supabase
            .from('crew_members')
            .select('department')
            .eq('tenant_id', tenant!.id)
            .ilike('name', name)
            .limit(1)
            .maybeSingle();
          const dept = (member as { department: string | null } | null)?.department;
          if (dept) setClockDept(dept);
        } catch (_) { /* roster lookup is best-effort */ }
        seedClockTime();
        setClockStep('clockin');
      }
    } catch (_) {
      showToast('Error checking status', true);
    }
    setChecking(false);
  }

  async function handleClockIn() {
    const name = clockName.trim();
    const dept = clockDept;
    if (!name || !dept || saving) return;
    const now  = new Date().toISOString();
    const date = now.split('T')[0];

    // Offline — queue the clock-in and mark active locally so the timer runs.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueue('clock_in', { worker_name: name, dept, clock_in: now, date });
      const pendingId = `pending-${Date.now()}`;
      try { localStorage.setItem('active_time_clock_id', pendingId); } catch (_) {}
      setActiveTimeClockId(pendingId);
      setClockShift({ id: pendingId, worker_name: name, dept, clock_in: now, clock_out: null, status: 'active', on_break: false, total_break_minutes: 0, current_dept: dept });
      saveIdentity(name, dept);
      closeModal();
      showPending(`${name} clocked in (pending sync)`);
      return;
    }

    setSaving(true);
    try {
      // Auto-register (or refresh) this crew member so the supervisor roster
      // always reflects everyone who has ever clocked in.
      const crewMemberId = await registerCrewMember(tenant!.id, name, dept);
      const payload = {
        worker_name: name,
        dept,
        clock_in:    now,
        clock_out:   null,
        date,
        status:      'active',
        tenant_id:   tenant!.id,
      };
      const { data: insertedRow, error } = await supabase
        .from('time_clock').insert({ ...payload, current_dept: dept, crew_member_id: crewMemberId }).select('id').single();
      if (error) throw error;
      const clockId = (insertedRow as { id: string }).id;
      localStorage.setItem('active_time_clock_id', clockId);
      setActiveTimeClockId(clockId);
      // Open the gate immediately so work actions are unblocked without a refetch.
      setClockShift({ id: clockId, worker_name: name, dept, clock_in: now, clock_out: null, status: 'active', on_break: false, total_break_minutes: 0, current_dept: dept });
      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: clockId,
        workerName: name, eventType: 'clock_in', dept,
      });
      saveIdentity(name, dept);
      await reloadClock();
      closeModal();
      showToast(`${name} clocked in`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleBreakStart() {
    if (!openEntry || breakSaving) return;
    setBreakSaving(true);
    try {
      const now = new Date().toISOString();
      await supabase.from('time_clock').update({ on_break: true, break_start: now }).eq('id', openEntry.id);
      void logShiftEvent({
        tenantId: tenant!.id,
        timeClockId: activeTimeClockId ?? openEntry.id,
        workerName: openEntry.worker_name,
        eventType: 'break_start',
        dept: crewDept || openEntry.dept,
      });
      setOnBreak(true);
      setBreakStartTime(now);
      localStorage.setItem('on_break', 'true');
      localStorage.setItem('break_start_time', now);
      closeModal();
      showToast('Break started');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', true);
    } finally {
      setBreakSaving(false);
    }
  }

  async function handleBreakEnd() {
    if (!openEntry || breakSaving || !breakStartTime) return;
    setBreakSaving(true);
    try {
      const duration = Math.max(1, Math.floor((Date.now() - new Date(breakStartTime).getTime()) / 60000));
      const now = new Date().toISOString();
      const existing = openEntry.total_break_minutes ?? 0;
      await supabase.from('time_clock').update({
        on_break: false, break_end: now,
        total_break_minutes: existing + duration,
      }).eq('id', openEntry.id);
      void logShiftEvent({
        tenantId: tenant!.id,
        timeClockId: activeTimeClockId ?? openEntry.id,
        workerName: openEntry.worker_name,
        eventType: 'break_end',
        dept: crewDept || openEntry.dept,
        metadata: { duration_minutes: duration },
      });
      setOnBreak(false);
      setBreakStartTime(null);
      localStorage.removeItem('on_break');
      localStorage.removeItem('break_start_time');
      closeModal();
      showToast(`Break ended — ${duration} min`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed', true);
    } finally {
      setBreakSaving(false);
    }
  }

  async function handleClockOut() {
    if (!openEntry || saving) return;

    // Offline — queue the clock-out and clear local active state.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const now = new Date().toISOString();
      enqueue('clock_out', { worker_name: openEntry.worker_name, clock_out: now });
      try { localStorage.removeItem('active_time_clock_id'); } catch (_) {}
      setActiveTimeClockId(null);
      setClockShift(null); // close the gate — work actions now require a fresh clock-in
      setOnBreak(false);
      setBreakStartTime(null);
      try { localStorage.removeItem('on_break'); localStorage.removeItem('break_start_time'); } catch (_) {}
      closeModal();
      showPending(`${openEntry.worker_name} clocked out (pending sync)`);
      return;
    }

    setSaving(true);
    try {
      // Auto-end break if active
      let extraBreakMins = 0;
      if (onBreak && breakStartTime) {
        extraBreakMins = Math.max(1, Math.floor((Date.now() - new Date(breakStartTime).getTime()) / 60000));
        const existing = openEntry.total_break_minutes ?? 0;
        await supabase.from('time_clock').update({
          on_break: false, break_end: new Date().toISOString(),
          total_break_minutes: existing + extraBreakMins,
        }).eq('id', openEntry.id);
        void logShiftEvent({
          tenantId: tenant!.id,
          timeClockId: activeTimeClockId ?? openEntry.id,
          workerName: openEntry.worker_name,
          eventType: 'break_end',
          dept: crewDept || openEntry.dept,
          metadata: { duration_minutes: extraBreakMins },
        });
        setOnBreak(false);
        setBreakStartTime(null);
        localStorage.removeItem('on_break');
        localStorage.removeItem('break_start_time');
      }

      const now        = new Date().toISOString();
      const totalMs    = Date.now() - new Date(openEntry.clock_in).getTime();
      const totalHours = totalMs / 3_600_000;
      const totalBreakMins = (openEntry.total_break_minutes ?? 0) + extraBreakMins;
      const netHours   = totalHours - totalBreakMins / 60;

      const { error } = await supabase.from('time_clock').update({
        clock_out: now, on_break: false,
        total_hours: Math.round(netHours * 10000) / 10000,
      }).eq('id', openEntry.id);
      if (error) throw error;

      void logShiftEvent({
        tenantId: tenant!.id,
        timeClockId: activeTimeClockId ?? openEntry.id,
        workerName: openEntry.worker_name,
        eventType: 'clock_out',
        dept: openEntry.current_dept ?? openEntry.dept,
        metadata: {
          total_hours: Math.round(totalHours * 100) / 100,
          total_break_minutes: totalBreakMins,
          net_productive_hours: Math.round(netHours * 100) / 100,
        },
      });

      localStorage.removeItem('active_time_clock_id');
      setActiveTimeClockId(null);
      setClockShift(null); // close the gate — work actions now require a fresh clock-in
      await reloadClock();
      closeModal();
      showToast(`${openEntry.worker_name} clocked out`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  // ── Clock adjustment request ────────────────────────────────────────────────
  // When the crew adjusts the time, we DON'T touch time_clock — we file a request
  // on the messages table (topic + payload) for the supervisor to approve/deny,
  // and fire a push so they can review it immediately. Nothing is registered yet.
  async function handleClockRequest(kind: 'clock_in_request' | 'clock_out_request') {
    if (requestSending) return;
    const reason = adjustReason.trim();
    if (!reason) { showToast('Add a reason for the adjustment', true); return; }
    const name = (clockName.trim() || crewName.trim());
    const dept = clockDept || crewDept || null;
    if (!name || !tenant) return;
    const requestedISO = new Date(clockAdjustMs).toISOString();
    const reqTimeLabel = formatTime(requestedISO);

    const isIn = kind === 'clock_in_request';
    const minutesAgo = Math.round((clockBaseMs - clockAdjustMs) / 60000);
    const agoLabel = minutesAgo === 0 ? 'now'
      : minutesAgo > 0 ? `${minutesAgo} min ago` : `in ${-minutesAgo} min`;

    const body = isIn
      ? `Clock-In Request — ${name}\nRequested time: ${reqTimeLabel} (${agoLabel})\nDept: ${dept ?? '—'}\nReason: ${reason}`
      : `Clock-Out Request — ${name}\nRequested time: ${reqTimeLabel}\nCurrently: ${formatTime(new Date(clockBaseMs).toISOString())}\nDept: ${dept ?? '—'}\nReason: ${reason}`;

    const payload: ClockRequestPayload = {
      requested_time: requestedISO,
      reason,
      worker_name: name,
      dept,
      status: 'pending',
      shift_id: !isIn && openEntry ? openEntry.id : null,
      clock_in: !isIn && openEntry ? openEntry.clock_in : null,
    };

    setRequestSending(true);
    try {
      const { error } = await supabase.from('messages').insert({
        sender_name: name,
        dept,
        body,
        tenant_id: tenant.id,
        topic: kind,
        payload,
      });
      if (error) throw error;
      // Push the supervisor so they can review immediately.
      sendNotify({
        tenant_id: tenant.id,
        target: 'supervisor',
        title: 'Clock-in request',
        body: `${isIn ? 'Clock-in' : 'Clock-out'} request from ${name} — ${reqTimeLabel} — tap to review`,
        url: '/app/supervisor',
      });
      closeModal();
      showToast('Request sent to supervisor');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not send request', true);
    } finally {
      setRequestSending(false);
    }
  }

  // ── Inventory handler ───────────────────────────────────────────────────────

  async function handleInventorySubmit() {
    const item = invItem.trim();
    const dept = invDept.trim();
    if (!item || !dept || saving) return;

    // Offline — queue the inventory need.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      enqueue('inventory_need', { item, dept, qty: 1, job_number: invJobNum.trim() || null });
      saveIdentity(crewName, dept);
      closeModal();
      showPending('Inventory need saved (pending sync)');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('inventory_needs').insert({
        item,
        dept,
        qty: 1,
        status: 'pending',
        ...(invJobNum.trim() && { job_number: invJobNum.trim() }),
        tenant_id: tenant!.id,
      });
      if (error) throw error;
      sendNotify({
        tenant_id: tenant!.id,
        target: 'supervisor',
        title: 'Inventory Needed',
        body: `${item} needed in ${dept}`,
        url: '/app/supervisor',
      });
      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: activeTimeClockId,
        workerName: crewName, eventType: 'inventory_logged',
        dept: dept || crewDept, metadata: { item, job_number: invJobNum.trim() || null },
      });
      saveIdentity(crewName, dept);
      closeModal();
      showToast('Inventory need logged');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Insert failed';
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  // ── Photo upload helper ──────────────────────────────────────────────────────

  async function uploadPhoto(file: File, bucket: string): Promise<string | null> {
    const ext  = file.name.split('.').pop() ?? 'jpg';
    const path = `${tenant!.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  // ── Camera functions ────────────────────────────────────────────────────────

  async function startCamera() {
    setCameraStarting(true);
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported — tap below to upload a photo instead');
      setCameraStarting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraStarting(false);
    } catch (err) {
      const isDenied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCameraError(isDenied
        ? 'Camera access denied — tap below to upload a photo instead'
        : 'Camera not available — tap below to upload a photo instead');
      setCameraStarting(false);
    }
  }

  // Live QR / barcode scanner (ZXing). Opens the rear camera, decodes
  // continuously, and on a hit flashes the viewfinder + auto-runs the match.
  async function startZxingScanner() {
    setCameraStarting(true);
    setCameraError(null);
    setScanAiResult(null);
    setScanShowAlts(false);
    scanBusyRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera not supported — type the label below instead');
      setCameraStarting(false);
      return;
    }
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/library');
      const reader = new BrowserMultiFormatReader();
      zxingRef.current = reader as unknown as { reset: () => void };
      if (!videoRef.current) { setCameraStarting(false); return; }
      await reader.decodeFromConstraints(
        { video: { facingMode: 'environment' } },
        videoRef.current,
        (result) => {
          if (!result || scanBusyRef.current) return;
          const text = result.getText().trim();
          if (!text) return;
          setScanFlash(true);
          setTimeout(() => setScanFlash(false), 350);
          setAssemblyScanInput(text);
          void handleAssemblyScanSearch(text);
        }
      );
      setCameraStarting(false);
    } catch (err) {
      const isDenied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setCameraError(isDenied
        ? 'Camera access denied — type the label below instead'
        : 'Camera not available — type the label below instead');
      setCameraStarting(false);
    }
  }

  function stopZxingScanner() {
    try { zxingRef.current?.reset(); } catch (_) {}
    zxingRef.current = null;
    scanBusyRef.current = false;
  }

  async function captureFromVideo(): Promise<File | null> {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 960;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
        'image/jpeg', 0.92
      );
    });
  }

  async function captureDmgPhoto() {
    const file = await captureFromVideo();
    stopCamera();
    if (file) { setDmgPhoto(file); setDmgPhotoPreview(URL.createObjectURL(file)); setDmgScanStep('preview'); }
  }

  async function capturePartPhoto() {
    const file = await captureFromVideo();
    stopCamera();
    if (file) { setPartPhoto(file); setPartPhotoPreview(URL.createObjectURL(file)); setPartScanStep('preview'); }
  }

  // ── Damage handler ──────────────────────────────────────────────────────────

  async function handleDamageSubmit() {
    if (saving) return;

    // Offline — queue the report text now; the photo needs a live connection.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const dept = dmgDept.trim() || crewDept || 'Unknown';
      enqueue('damage_report', { part_name: dmgWhat.trim() || 'Damage report', dept, notes: null });
      saveIdentity(crewName, dept);
      closeModal();
      showPending(dmgPhoto ? 'Report saved — photo will upload when online' : 'Damage report saved (pending sync)');
      return;
    }

    setSaving(true);
    try {
      let photoUrl: string | null = null;
      if (dmgPhoto) {
        try { photoUrl = await uploadPhoto(dmgPhoto, 'damage-photos'); }
        catch (_) { /* photo upload failed — continue without it */ }
      }
      const dept = dmgDept.trim() || crewDept || 'Unknown';
      const typeLabel = dmgType === 'change_order' ? 'Change Order' : 'Damage';
      const { error } = await supabase.from('damage_reports').insert({
        part_name:   dmgWhat.trim() || `${typeLabel} report`,
        dept,
        notes:       null,
        photo_url:   photoUrl,
        status:      'open',
        report_type: dmgType,
        tenant_id:   tenant!.id,
      });
      if (error) throw error;
      sendNotify({
        tenant_id: tenant!.id,
        target: 'supervisor',
        title: `${typeLabel} Report`,
        body: `${crewName || 'Crew'} reported a ${typeLabel.toLowerCase()} in ${dept}`,
        url: '/app/supervisor',
      });
      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: activeTimeClockId,
        workerName: crewName, eventType: 'damage_reported',
        dept: dept || crewDept, metadata: { description: dmgWhat.trim() || 'Damage report' },
      });
      saveIdentity(crewName, dept);
      closeModal();
      setDmgFlash(true);
      setTimeout(() => setDmgFlash(false), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Insert failed';
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  // ── Crew reply inside a thread ──────────────────────────────────────────────

  async function handleCrewReply(overrideBody?: string) {
    const body = (overrideBody ?? replyBody).trim();
    if (!body || !openThread || replySaving) return;
    setReplySaving(true);
    // Replies always go to crew's own dept so supervisor sees them in the correct thread
    const dept = crewDept || null;
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: Message = {
      id: optimisticId,
      sender_name: crewName || 'Crew',
      dept,
      body,
      created_at: new Date().toISOString(),
      read_at: null,
      topic: null,
      payload: null,
    };
    setMessages((prev) => [optimistic, ...prev]);
    setReplyBody('');
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({ sender_name: crewName || 'Crew', dept, body, tenant_id: tenant!.id })
        .select('id, sender_name, dept, body, created_at, read_at, topic, payload')
        .single();
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === optimisticId ? (data as Message) : m));
      sendNotify({
        tenant_id: tenant!.id,
        target: 'supervisor',
        title: 'New Message',
        body: `${crewName || 'Crew'}: ${body.slice(0, 50)}`,
        url: '/app/supervisor',
      });
      void logShiftEvent({
        tenantId: tenant!.id, timeClockId: activeTimeClockId,
        workerName: crewName || 'Crew', eventType: 'message_sent',
        dept: crewDept, metadata: { dept_target: dept },
      });
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      const msg = err instanceof Error ? err.message : 'Send failed';
      showToast(msg, true);
      setReplyBody(body);
    } finally {
      setReplySaving(false);
    }
  }

  // ── Parts / QC handlers ────────────────────────────────────────────────────

  async function handlePartSubmit() {
    if (saving) return;
    setSaving(true);
    try {
      let photoUrl: string | null = null;
      if (partPhoto) {
        try { photoUrl = await uploadPhoto(partPhoto, 'part-photos'); }
        catch (_) { /* photo upload failed — continue without it */ }
      }
      // Resolve job number — from DB job selection or manual entry
      const resolvedJobNum = partJobId
        ? (jobs.find((j) => j.id === partJobId)?.job_number ?? null)
        : (partJobNum.trim() || null);
      const payload: Record<string, unknown> = {
        part_name:   partName.trim() || 'Part',
        job_number:  resolvedJobNum,
        dept:        partDept || crewDept || 'Unknown',
        status:      partStatus,
        next_dept:   partStatus === 'Moving to Next Stage' ? (partNextDept || null) : null,
        notes:       partNotes.trim() || null,
        worker_name: crewName || null,
        tenant_id:   tenant!.id,
      };
      if (photoUrl !== null) payload.photo_url = photoUrl;
      const { error } = await supabase.from('parts_log').insert(payload);
      if (error) throw error;
      closeModal();
      setPartFlash(true);
      setTimeout(() => setPartFlash(false), 2000);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Insert failed', true);
    } finally {
      setSaving(false);
    }
  }

  async function handleQcAction(id: string, newStatus: 'Passed QC' | 'Failed QC / Rework') {
    if (!requireClockIn()) return;
    setQcActioning((prev) => ({ ...prev, [id]: true }));
    setPartsQcList((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from('parts_log').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      showToast(newStatus === 'Passed QC' ? 'Part approved' : 'Marked for rework');
    } catch (err: unknown) {
      try {
        const { data } = await supabase.from('parts_log').select('*').eq('id', id).single();
        if (data) setPartsQcList((prev) => [data as PartLog, ...prev]);
      } catch (_) {}
      showToast(err instanceof Error ? err.message : 'Update failed', true);
    } finally {
      setQcActioning((prev) => { const n = { ...prev }; delete n[id]; return n; });
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/');
  };

  if (sessionLoading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);
  // This crew member's own open shift drives both the header clock indicator and
  // the clock-in gate. clockShift is resolved by worker_name on mount and kept in
  // sync on clock in/out (see reloadClock / handleClockIn / handleClockOut).
  const myShift = clockShift;

  // Strict dept isolation: only crew's own dept + broadcasts (dept = null)
  // NEVER include messages from other departments. Messages older than the
  // local "cleared_at" timestamp are hidden from this device's crew view only.
  const relevantMsgs = messages.filter(
    (m) =>
      (m.dept === null || m.dept === crewDept) &&
      (!msgClearedAt || m.created_at > msgClearedAt)
  );

  // Supervisor thread: all messages where dept = crewDept OR dept IS NULL.
  // Clock-in/out requests are action items, not chat, so they're hidden here.
  const supervisorMsgs = relevantMsgs
    .filter((m) => !isClockRequestMsg(m))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const supervisorLastMsg = supervisorMsgs[0] ?? null;
  const supUnread = relevantMsgs.filter((m) => m.sender_name === 'Supervisor' && !m.read_at && !isClockRequestMsg(m)).length;

  // Conversation messages sorted oldest-first for display
  const openThreadMsgs = openThread === 'supervisor' ? [...supervisorMsgs].reverse() : [];

  // Group drawings by job number for plans modal. Superseded versions are hidden
  // unless the crew member toggles "Show older versions".
  const supersededCount = drawings.filter((d) => d.is_current === false).length;
  const visibleDrawings = showOldPlans ? drawings : drawings.filter((d) => d.is_current !== false);
  const drawingGroups: Record<string, Drawing[]> = {};
  visibleDrawings.forEach((d) => {
    const key = d.job_number || 'Unknown';
    if (!drawingGroups[key]) drawingGroups[key] = [];
    drawingGroups[key].push(d);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  // Exactly 6 cards in a fixed order. Slot 2 ("Scan") is replaced by the build
  // timer for the Craftsman dept; every other dept keeps the unified Scan card.
  type QuickAction = { label: string; color: string; bg: string; onClick: () => void; icon: React.ReactNode };

  const scanCard: QuickAction = crewDept === 'Craftsman'
    ? {
        label: buildStart ? 'Stop Build Timer' : 'Start Build Timer',
        color: buildStart ? '#F87171' : '#2DE1C9',
        bg:    buildStart ? 'rgba(248,113,113,0.08)' : 'rgba(45,225,201,0.08)',
        onClick: buildStart ? () => { void handleStopTimer(); } : openBuildTimerModal,
        icon: buildStart
          ? <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          : <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      }
    : {
        label: 'Scan',
        color: '#5EEAD4', bg: 'rgba(94,234,212,0.08)',
        onClick: openScan,
        icon: (
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
            <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
            <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
            <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
            <line x1="7" y1="12" x2="17" y2="12"/>
          </svg>
        ),
      };

  const quickActions: QuickAction[] = [
    {
      label: 'Clock In / Out',
      color: '#2DE1C9', bg: 'rgba(45,225,201,0.08)',
      onClick: openClock,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    },
    scanCard,
    {
      label: 'Report Damage',
      color: '#F87171', bg: 'rgba(248,113,113,0.08)',
      onClick: openDamage,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    },
    {
      label: 'Log Inventory',
      color: '#5EEAD4', bg: 'rgba(94,234,212,0.08)',
      onClick: openInventory,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
    },
    {
      label: 'View Plans',
      color: '#A78BFA', bg: 'rgba(167,139,250,0.08)',
      onClick: openPlans,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
    },
    {
      label: 'View SOPs',
      color: '#5EEAD4', bg: 'rgba(94,234,212,0.08)',
      onClick: openSOPs,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
    },
  ];

  return (
    <>
      {/* Brand background graphic — fixed, centered, 30% behind all content.
          Opacity lives on this element (not the page root) so content stays
          fully opaque; pointerEvents:none so it never blocks clicks. */}
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundImage: "url('/bg-graphic.png')",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center center',
        backgroundSize: 'cover',
        opacity: 0.30,
        zIndex: 0,
        pointerEvents: 'none',
      }} />
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', minHeight: 64, display: 'flex', alignItems: 'center', padding: '0 32px', paddingTop: 'max(env(safe-area-inset-top), 8px)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)', fontSize: 13 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </Link>
            <span style={{ color: 'var(--line-strong)' }}>|</span>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>
              <LogoMark size={22} />
              inline<b style={{ color: 'var(--teal)' }}>IQ</b>
            </Link>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{email}</span>
            <button onClick={handleSignOut} className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>Sign out</button>
          </div>
        </div>

        {isTrial && <TrialBanner days={days} />}
        {msgNotification && <NewMsgBanner preview={msgNotification} onDismiss={() => { setMsgNotification(null); if (notifTimer.current) clearTimeout(notifTimer.current); }} />}

        <OfflineBanner tenantId={tenant?.id} onSynced={() => { void reloadClock(); }} />

        {tenant && <PushPrompt tenantId={tenant.id} userType="crew" userName={crewName || undefined} dept={crewDept || undefined} />}

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
              {/* Crew View label + relocated, subtle name + edit pencil */}
              <div>
                <div className="eyebrow">Crew View</div>
                {crewName && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
                    <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{crewName}</span>
                    <button
                      onClick={openEditName}
                      title="Edit name"
                      aria-label="Edit your name"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2, display: 'flex', lineHeight: 1 }}
                    >
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  </div>
                )}
              </div>
              {/* Clock-in indicator + Switch Role */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setClockTipOpen((o) => !o)}
                    onBlur={() => { setTimeout(() => setClockTipOpen(false), 150); }}
                    title={isClockedIn ? `Clocked in since ${formatTime(myShift!.clock_in)}` : 'Not clocked in'}
                    aria-label={isClockedIn ? `Clocked in since ${formatTime(myShift!.clock_in)}` : 'Not clocked in'}
                    style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', color: isClockedIn ? '#22c55e' : 'var(--ink-mute)', padding: 2, display: 'flex', lineHeight: 1 }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span style={{ position: 'absolute', top: -1, right: -1, width: 8, height: 8, borderRadius: '50%', background: isClockedIn ? '#22c55e' : '#6b7280', boxShadow: isClockedIn ? '0 0 6px #22c55e' : 'none' }} />
                  </button>
                  {clockTipOpen && (
                    <div style={{ position: 'absolute', top: 28, right: 0, zIndex: 30, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600, color: 'var(--ink)', background: '#11151a', border: '1px solid var(--line-strong)', borderRadius: 8, padding: '7px 11px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
                      {isClockedIn ? `Clocked in since ${formatTime(myShift!.clock_in)}` : 'Not clocked in'}
                    </div>
                  )}
                </div>
                <Link
                  href="/app"
                  style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                  Switch Role
                </Link>
              </div>
            </div>
            <h2 style={{ fontSize: 28 }}>{tenant?.shop_name ?? 'My Shop'}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {crewDept && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}>
                    {crewDept}
                  </span>
                )}
                <button
                  onClick={openSwitchDept}
                  style={{ fontSize: 12, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
                >
                  {crewDept ? 'Switch dept' : 'Set dept'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Department work view ────────────────────────────────────────────
              Each department renders its own queue of parts driven entirely by
              parts.assigned_dept. Production uses the Cut List accordion below;
              Craftsman, Finishing and Assembly each get their own folder view. */}
          {crewDept === 'Craftsman' && tenant ? (
            <CraftsmanBuilds tenantId={tenant.id} crewName={crewName} timeClockId={activeTimeClockId} showToast={showToast} isClockedIn={isClockedIn} onRequireClock={() => setGateOpen(true)} aiMode={aiMode} />
          ) : crewDept === 'Finishing' && tenant ? (
            <FinishingView tenantId={tenant.id} showToast={showToast} crewName={crewName} isClockedIn={isClockedIn} onRequireClock={() => setGateOpen(true)} aiMode={aiMode} />
          ) : crewDept === 'Assembly' && tenant ? (
            <AssemblyCrewView tenantId={tenant.id} crewName={crewName} showToast={showToast} isClockedIn={isClockedIn} onRequireClock={() => setGateOpen(true)} />
          ) : null}

          {/* Quick actions */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Quick Actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {quickActions.map(({ label, color, bg, onClick, icon }) => (
                <button
                  key={label}
                  onClick={onClick}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 10, padding: '18px 16px', minHeight: 96,
                    background: 'var(--bg-1)', border: '1px solid var(--line)',
                    borderRadius: 14, cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    textAlign: 'center', fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-strong)'; (e.currentTarget as HTMLButtonElement).style.background = '#0e1418'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-1)'; }}
                >
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
                </button>
              ))}
            </div>

            {/* Full-width Messages button — always accessible */}
            <button
              onClick={openMessages}
              style={{
                marginTop: 12, width: '100%', minHeight: 64,
                display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px',
                background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 14,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
                transition: 'border-color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-strong)'; (e.currentTarget as HTMLButtonElement).style.background = '#0e1418'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-1)'; }}
            >
              <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(45,225,201,0.08)', color: '#2DE1C9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <span style={{ flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Messages</span>
              {supUnread > 0 && (
                <span style={{ flexShrink: 0, minWidth: 22, textAlign: 'center', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 12, background: 'var(--teal)', color: '#04201c' }}>
                  {supUnread}
                </span>
              )}
            </button>
          </div>

          {/* ── Production · Cut List ──────────────────────────────────────────── */}
          {crewDept === 'Production' && (
            <div style={{ marginBottom: 40 }}>
              <style>{`@keyframes prodPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Production · Cut List</div>
              </div>

              {prodLoading && prodUnits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading cut list…</div>
              ) : (() => {
                // prodUnits only contains cabinets that still have production parts
                // to cut, so every job here is active. Render as a collapsed folder
                // list — tap a job to expand its cabinets (one open at a time).
                const groups: Record<string, ProdUnit[]> = {};
                prodUnits.forEach((u) => { (groups[u.jobPath] ??= []).push(u); });
                const jobPaths = Object.keys(groups);
                if (jobPaths.length === 0) {
                  return <div style={{ textAlign: 'center', padding: '28px 0', color: 'var(--ink-mute)', fontSize: 13 }}>No active work assigned. New jobs will appear here automatically.</div>;
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {jobPaths.map((jp) => {
                      const units = groups[jp];
                      const due = units.find((u) => u.dueDate)?.dueDate ?? null;
                      // Job progress = parts checked / total across all cabinets.
                      const total = units.reduce((s, u) => s + u.partsTotal, 0);
                      const cut   = units.reduce((s, u) => s + u.partsCut, 0);
                      const pct   = total > 0 ? Math.round((cut / total) * 100) : 0;
                      return (
                        <div key={jp} style={{ border: '1px solid var(--line)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-1)' }}>
                          <button onClick={() => void openCutJob(units, jp)}
                            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                              <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{jp.split('/').join(' / ')}</span>
                              {due && <DueBadge dueDate={due} />}
                              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{cut}/{total} cut</span>
                              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 6 15 12 9 18"/></svg>
                            </div>
                            <div style={{ height: 6, borderRadius: 20, background: 'var(--bg-2, #11151a)', overflow: 'hidden', width: '100%' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#2DE1C9' : '#60A5FA', transition: 'width 0.3s ease' }} />
                            </div>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ── Craftsman active build timer bar ───────────────────────────────── */}
          {crewDept === 'Craftsman' && buildStart && (
            <div style={{ marginBottom: 24, padding: '14px 18px', borderRadius: 12, background: 'rgba(45,225,201,0.06)', border: '1px solid rgba(45,225,201,0.22)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
              <style>{`@keyframes craftsPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2DE1C9', flexShrink: 0, animation: 'craftsPulse 2s ease-in-out infinite' }} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#2DE1C9', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                    {fmtElapsed(buildStart)}
                    {/* timerTick drives re-renders */}
                    <span style={{ display: 'none' }}>{timerTick}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 4 }}>
                    {buildMaterial}{buildJob ? ` · Job ${buildJob}` : ''}
                  </div>
                </div>
              </div>
              <button
                onClick={handleStopTimer}
                disabled={timerStopping}
                style={{ fontSize: 12, fontWeight: 700, color: '#F87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8, padding: '7px 16px', cursor: timerStopping ? 'not-allowed' : 'pointer', opacity: timerStopping ? 0.5 : 1, fontFamily: 'inherit' }}
              >
                {timerStopping ? 'Stopping…' : 'Stop Build'}
              </button>
            </div>
          )}

          {/* Messages moved to a slide-up overlay (see MessagesScreen below),
              surfaced by the floating teal "New message from Supervisor" pill. */}

          {/* ── Minimal app footer ───────────────────────────────────────── */}
          <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'center', gap: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
            <span>© 2026 InlineIQ</span>
            <span>·</span>
            <Link href="/terms" style={{ color: 'var(--ink-mute)', textDecoration: 'none' }}>Terms</Link>
            <span>·</span>
            <Link href="/privacy" style={{ color: 'var(--ink-mute)', textDecoration: 'none' }}>Privacy</Link>
          </div>

        </main>
      </div>

      {/* ── Floating "New message from Supervisor" pill ───────────────────────
          Fixed above the footer, shown only while there are unread supervisor
          messages and the Messages screen isn't already open. */}
      {supUnread > 0 && !messagesOpen && (
        <button
          onClick={openMessages}
          aria-label="New message from Supervisor"
          style={{
            position: 'fixed', left: 16, right: 16, bottom: 'calc(20px + env(safe-area-inset-bottom))', zIndex: 180,
            margin: '0 auto', maxWidth: 420,
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 16px', borderRadius: 999,
            background: 'rgba(45,225,201,0.14)', border: '1px solid rgba(45,225,201,0.4)',
            backdropFilter: 'blur(8px)', cursor: 'pointer', textAlign: 'left',
            fontFamily: 'inherit', boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: 'var(--teal)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            New message from Supervisor
          </span>
          <span style={{ flexShrink: 0, minWidth: 20, textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'var(--teal)', color: '#04201c' }}>
            {supUnread}
          </span>
        </button>
      )}

      {/* ── Messages screen — full-screen slide-up overlay ──────────────────── */}
      {messagesOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column' }} onClick={(e) => { if (e.target === e.currentTarget) closeMessages(); }}>
          <style>{`@keyframes msgSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}`}</style>
          <div
            style={{
              marginTop: 'auto', width: '100%', maxWidth: 560, alignSelf: 'center',
              height: '92dvh', maxHeight: '92dvh', background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20,
              border: '1px solid var(--line-strong)', borderBottom: 'none',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              paddingBottom: 'env(safe-area-inset-bottom)',
              animation: 'msgSlideUp 0.25s ease-out',
            }}
          >
            {/* Header */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px', borderBottom: '1px solid var(--line)' }}>
              {openThread !== null && (
                <button
                  onClick={() => { setOpenThread(null); setReplyBody(''); setMsgMenuOpen(false); }}
                  aria-label="Back to inbox"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}
                >
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
              )}
              <div style={{ flex: 1, fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
                {openThread !== null ? 'Supervisor' : 'Messages'}
              </div>
              {openThread !== null && (
                <button
                  onClick={() => setMsgMenuOpen((o) => !o)}
                  aria-label="Conversation menu"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}
                >
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
              )}
              <button onClick={closeMessages} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>

              {/* Clear-conversation menu (three-dot or long-press) */}
              {msgMenuOpen && (
                <div style={{ position: 'absolute', top: 54, right: 14, zIndex: 5, width: 260, background: '#11151a', border: '1px solid var(--line-strong)', borderRadius: 14, padding: 16, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>Clear conversation?</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', lineHeight: 1.5, marginBottom: 14 }}>
                    This only clears your view. Supervisor can still see messages.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={clearConversation} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer', background: '#F87171', color: '#1a0606', fontWeight: 700, fontSize: 13, fontFamily: 'inherit' }}>Clear</button>
                    <button onClick={() => setMsgMenuOpen(false)} style={{ flex: 1, padding: '9px 0', borderRadius: 9, border: '1px solid var(--line-strong)', cursor: 'pointer', background: 'none', color: 'var(--ink-mute)', fontWeight: 600, fontSize: 13, fontFamily: 'inherit' }}>Cancel</button>
                  </div>
                </div>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: openThread !== null ? '12px 16px' : '8px' }}>
              {openThread === null ? (
                /* Inbox — single Supervisor thread row */
                <button
                  onClick={openSupervisorThread}
                  onContextMenu={(e) => { e.preventDefault(); setMsgMenuOpen(true); }}
                  onPointerDown={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); longPressTimer.current = setTimeout(() => setMsgMenuOpen(true), 550); }}
                  onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 12px', borderRadius: 12, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%' }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: supUnread > 0 ? 'var(--teal)' : 'transparent' }} />
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(94,234,212,0.12)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 17, fontWeight: 700 }}>S</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>Supervisor</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        {supervisorLastMsg && <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{formatDate(supervisorLastMsg.created_at)}</span>}
                        {supUnread > 0 && <span style={{ minWidth: 20, textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'var(--teal)', color: '#04201c' }}>{supUnread}</span>}
                      </div>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {supervisorLastMsg ? (supervisorLastMsg.body.length > 65 ? supervisorLastMsg.body.slice(0, 62) + '…' : supervisorLastMsg.body) : 'No messages yet'}
                    </div>
                  </div>
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginLeft: 4 }}><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              ) : (
                <MessageThread
                  messages={openThreadMsgs}
                  selfKind="crew"
                  sending={replySaving}
                  placeholder="Message Supervisor…"
                  onSend={(t) => handleCrewReply(t)}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Clock Modal ─────────────────────────────────────────────────────── */}
      {modal === 'clock' && (
        <ModalOverlay onClose={closeModal} title={clockStep === 'clockout' ? 'Clock Out' : clockStep === 'clockin' ? 'Clock In' : 'Clock In / Out'}>
          {clockStep === 'lookup' && (
            <>
              <Field label="Your Name">
                <input className="form-input" placeholder="e.g. Mike Torres" value={clockName} onChange={(e) => setClockName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleClockLookup(); }} autoFocus />
              </Field>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', opacity: (!clockName.trim() || checking) ? 0.5 : 1 }}
                onClick={() => void handleClockLookup()}
                disabled={!clockName.trim() || checking}
              >
                {checking ? 'Checking…' : 'Look Up Status'}
              </button>
            </>
          )}

          {clockStep === 'clockin' && (() => {
            const adjusted = Math.round(clockAdjustMs / 60000) !== Math.round(clockBaseMs / 60000);
            return (
            <>
              {!clockDept && (
                <Field label="Department">
                  <select className="form-input" value={clockDept} onChange={(e) => setClockDept(e.target.value)} autoFocus style={{ cursor: 'pointer' }}>
                    <option value="">Select department…</option>
                    {deptOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </Field>
              )}

              <ClockTimePicker value={clockAdjustMs} base={clockBaseMs} onHold={startHold} onRelease={stopHold} />

              {adjusted && (
                <Field label="Reason for adjustment">
                  <input
                    className="form-input"
                    placeholder="e.g. Forgot to clock in at arrival"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                  />
                </Field>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setClockStep('lookup')}>Back</button>
                {adjusted ? (
                  <button
                    style={{ flex: 2, justifyContent: 'center', display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 10, height: 44, background: '#FBBF24', color: '#1a1400', border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: (!clockDept || !adjustReason.trim() || requestSending) ? 'default' : 'pointer', opacity: (!clockDept || !adjustReason.trim() || requestSending) ? 0.5 : 1 }}
                    onClick={() => void handleClockRequest('clock_in_request')}
                    disabled={!clockDept || !adjustReason.trim() || requestSending}
                  >
                    {requestSending ? 'Sending…' : 'Submit Clock-In Request'}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary"
                    style={{ flex: 2, justifyContent: 'center', opacity: (!clockDept || saving) ? 0.5 : 1 }}
                    onClick={handleClockIn}
                    disabled={!clockDept || saving}
                  >
                    {saving ? 'Clocking In…' : 'Clock In'}
                  </button>
                )}
              </div>
            </>
            );
          })()}

          {clockStep === 'clockout' && openEntry && (
            <>
              <style>{`@keyframes breakPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
              <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(45,225,201,0.05)', border: '1px solid rgba(45,225,201,0.15)', marginBottom: 18 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{openEntry.worker_name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 4 }}>{openEntry.dept}</div>
                <div style={{ fontSize: 13, color: '#2DE1C9', marginTop: 6 }}>Clocked in since {formatTime(openEntry.clock_in)}</div>
              </div>

              {/* Break status */}
              {onBreak && breakStartTime && (
                <div style={{ padding: '12px 16px', borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FBBF24', animation: 'breakPulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#FBBF24' }}>On Break</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#FBBF24', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtElapsed(breakStartTime)}
                      <span style={{ display: 'none' }}>{breakTick}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {onBreak ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%', justifyContent: 'center', opacity: breakSaving ? 0.5 : 1 }}
                    onClick={() => void handleBreakEnd()}
                    disabled={breakSaving}
                  >
                    {breakSaving ? 'Ending…' : 'End Break'}
                  </button>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setClockStep('lookup')}>Back</button>
                    <button
                      className="btn btn-ghost"
                      style={{ flex: 2, justifyContent: 'center', opacity: (saving || breakSaving) ? 0.5 : 1, color: '#F87171', borderColor: 'rgba(248,113,113,0.3)' }}
                      onClick={() => void handleClockOut()}
                      disabled={saving || breakSaving}
                    >
                      {saving ? 'Clocking Out…' : 'Clock Out'}
                    </button>
                  </div>
                </div>
              ) : (() => {
                const adjusted = Math.round(clockAdjustMs / 60000) !== Math.round(clockBaseMs / 60000);
                return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ClockTimePicker value={clockAdjustMs} base={clockBaseMs} onHold={startHold} onRelease={stopHold} />

                  {adjusted && (
                    <Field label="Reason for adjustment">
                      <input
                        className="form-input"
                        placeholder="e.g. Forgot to clock out when I left"
                        value={adjustReason}
                        onChange={(e) => setAdjustReason(e.target.value)}
                      />
                    </Field>
                  )}

                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setClockStep('lookup')}>Back</button>
                    {adjusted ? (
                      <button
                        style={{ flex: 2, justifyContent: 'center', display: 'flex', alignItems: 'center', padding: '0 18px', borderRadius: 10, height: 44, background: '#FBBF24', color: '#1a1400', border: 'none', fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: (!adjustReason.trim() || requestSending) ? 'default' : 'pointer', opacity: (!adjustReason.trim() || requestSending) ? 0.5 : 1 }}
                        onClick={() => void handleClockRequest('clock_out_request')}
                        disabled={!adjustReason.trim() || requestSending}
                      >
                        {requestSending ? 'Sending…' : 'Submit Clock-Out Request'}
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        style={{ flex: 2, justifyContent: 'center', opacity: saving ? 0.5 : 1 }}
                        onClick={() => void handleClockOut()}
                        disabled={saving}
                      >
                        {saving ? 'Clocking Out…' : 'Clock Out'}
                      </button>
                    )}
                  </div>

                  {!adjusted && (
                    <button
                      style={{
                        width: '100%', padding: '10px 0', borderRadius: 10,
                        background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)',
                        color: '#FBBF24', fontSize: 13, fontWeight: 700, cursor: breakSaving ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', opacity: breakSaving ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                      }}
                      onClick={() => void handleBreakStart()}
                      disabled={breakSaving}
                    >
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2"/>
                        <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
                        <line x1="12" y1="12" x2="12" y2="16"/>
                        <line x1="10" y1="14" x2="14" y2="14"/>
                      </svg>
                      {breakSaving ? 'Starting…' : 'Start Break'}
                    </button>
                  )}
                </div>
                );
              })()}
            </>
          )}
        </ModalOverlay>
      )}

      {/* ── Inventory Modal ──────────────────────────────────────────────────── */}
      {modal === 'inventory' && (
        <ModalOverlay onClose={closeModal} title="Log Inventory Need">
          <Field label="What do you need? *">
            <input className="form-input" placeholder="e.g. 3/8 bolts, oak panels, glue…" value={invItem} onChange={(e) => setInvItem(e.target.value)} autoFocus />
          </Field>
          <Field label="Department *">
            <input className="form-input" placeholder="e.g. Finish, Trim, Install…" value={invDept} onChange={(e) => setInvDept(e.target.value)} />
          </Field>
          <Field label="Job / Project (optional)">
            <input className="form-input" placeholder="e.g. P-26-1001 or Smith Kitchen" value={invJobNum} onChange={(e) => setInvJobNum(e.target.value)} />
          </Field>
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 4, opacity: (!invItem.trim() || !invDept.trim() || saving) ? 0.5 : 1 }}
            onClick={handleInventorySubmit}
            disabled={!invItem.trim() || !invDept.trim() || saving}
          >
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </ModalOverlay>
      )}

      {/* ── Damage Modal ─────────────────────────────────────────────────────── */}
      {modal === 'damage' && (
        <ModalOverlay onClose={closeModal} title="Report Damage">
          {dmgScanStep === 'camera' ? (
            /* ── Step 1: Camera ── */
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '8px 0 4px' }}>
              {/* Viewfinder */}
              <div style={{ position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '4/3', background: '#07090A', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* Live video feed */}
                {!cameraError && (
                  <video ref={videoRef} autoPlay playsInline muted
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                )}
                {/* Starting indicator */}
                {cameraStarting && !cameraError && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(7,9,10,0.75)' }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)' }}>Starting camera…</span>
                  </div>
                )}
                {/* Error / unsupported */}
                {cameraError && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
                    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="rgba(94,234,212,0.3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    <p style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1.5, margin: 0 }}>{cameraError}</p>
                  </div>
                )}
                {/* Corner brackets overlay */}
                <div style={{ position: 'absolute', top: 14, left: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '3px 0 0 0', zIndex: 2 }} />
                <div style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 3px 0 0', zIndex: 2 }} />
                <div style={{ position: 'absolute', bottom: 14, left: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '0 0 0 3px', zIndex: 2 }} />
                <div style={{ position: 'absolute', bottom: 14, right: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 0 3px 0', zIndex: 2 }} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', margin: 0 }}>Point camera at damage</p>
              {cameraError ? (
                /* Fallback: file input */
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, fontSize: 13, color: '#5EEAD4', cursor: 'pointer' }}>
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                  Upload photo
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      if (file) { setDmgPhoto(file); setDmgPhotoPreview(URL.createObjectURL(file)); setDmgScanStep('preview'); }
                    }} />
                </label>
              ) : (
                /* Capture button */
                <button type="button" onClick={() => { void captureDmgPhoto(); }}
                  style={{ width: 62, height: 62, borderRadius: '50%', background: '#2DE1C9', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 0 5px rgba(45,225,201,0.18)', flexShrink: 0 }}>
                  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#050608" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                </button>
              )}
            </div>
          ) : (
            /* ── Step 2: Preview + submit ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Report Type — required toggle */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', fontWeight: 600, marginBottom: 6 }}>Report Type</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {([['damage', 'Damage'], ['change_order', 'Change Order']] as ['damage' | 'change_order', string][]).map(([val, label]) => {
                    const active = dmgType === val;
                    const accent = val === 'damage' ? '#F87171' : '#FBBF24';
                    return (
                      <button key={val} type="button" onClick={() => setDmgType(val)}
                        style={{ flex: 1, padding: '9px', borderRadius: 10, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', color: active ? accent : 'var(--ink-mute)', background: active ? `${accent}1f` : 'transparent', border: `1px solid ${active ? accent : 'var(--line)'}` }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <img src={dmgPhotoPreview!} alt="damage" style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)', flexShrink: 0 }} />
                <button type="button"
                  onClick={() => { setDmgPhoto(null); setDmgPhotoPreview(null); setDmgScanStep('camera'); }}
                  style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: 'var(--ink-mute)', cursor: 'pointer', marginTop: 4 }}>
                  Retake
                </button>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-primary"
                  style={{ flex: 1, justifyContent: 'center', background: '#F87171', boxShadow: 'none', opacity: saving ? 0.5 : 1 }}
                  onClick={handleDamageSubmit} disabled={saving}>
                  {saving ? 'Submitting…' : 'Submit Report'}
                </button>
                {!dmgShowDetails && (
                  <button type="button" className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setDmgShowDetails(true)}>
                    Add Details
                  </button>
                )}
              </div>
              {dmgShowDetails && (
                <>
                  <Field label="Description (optional)">
                    <textarea className="form-input" placeholder="Describe the damage…" value={dmgWhat} onChange={(e) => setDmgWhat(e.target.value)} rows={3} style={{ resize: 'vertical' }} />
                  </Field>
                  <Field label="Department (optional)">
                    <input className="form-input" placeholder="e.g. Finish, Trim, Install…" value={dmgDept} onChange={(e) => setDmgDept(e.target.value)} />
                  </Field>
                </>
              )}
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── Plans Modal ──────────────────────────────────────────────────────── */}
      {modal === 'plans' && (
        <ModalOverlay onClose={closeModal} title="Job Plans">
          {plansLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading plans…</div>
          ) : drawings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>No plans uploaded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(drawingGroups).map(([jobKey, items]) => (
                <div key={jobKey}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A78BFA', padding: '10px 0 6px', borderBottom: '1px solid var(--line)' }}>{jobKey}</div>
                  {items.map((d) => {
                    const url = d.file_url || d.external_url;
                    const name = d.plan_name || d.label || d.file_name || 'Untitled';
                    const isCsv = d.file_type === 'csv' || (d.file_name ?? '').toLowerCase().endsWith('.csv');
                    const ver = d.version ?? 1;
                    const superseded = d.is_current === false;
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)', opacity: superseded ? 0.5 : 1 }}>
                        <PlanTypeBadge fileType={d.file_type} fileName={d.file_name} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</span>
                            {ver > 1 && !superseded && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(45,225,201,0.12)', color: '#2DE1C9', flexShrink: 0 }}>v{ver}</span>
                            )}
                            {superseded && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 20, background: 'rgba(139,165,160,0.15)', color: '#8BA5A0', flexShrink: 0 }}>Old v{ver}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{d.job_name ? `${d.job_name} · ` : ''}{ver > 1 ? updatedAgo(d.created_at) : (d.uploaded_by ? `${d.uploaded_by} · ${formatDate(d.created_at)}` : formatDate(d.created_at))}</div>
                        </div>
                        {isCsv && d.parsed && d.job_number && (
                          <button
                            onClick={() => void openPartsList(d.job_number!)}
                            style={{ fontSize: 12, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', border: 'none', padding: '5px 12px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}
                          >
                            View Parts List
                          </button>
                        )}
                        {url ? (
                          <button onClick={() => openPlanFile(d, { url, name, fileType: d.file_type, parsed: !!d.parsed, jobPath: d.job_name ? `${d.job_name}/Drawings` : undefined })}
                            style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', background: 'rgba(167,139,250,0.1)', padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>Open</button>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No link</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Show older versions toggle */}
              {supersededCount > 0 && (
                <button
                  onClick={() => setShowOldPlans((v) => !v)}
                  style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', alignSelf: 'center', padding: 6 }}
                >
                  {showOldPlans ? 'Hide older versions' : `Show older versions (${supersededCount})`}
                </button>
              )}
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── Parts List Modal (assembly checklist for a parsed CSV plan) ────── */}
      {modal === 'partsList' && (
        <ModalOverlay onClose={closeModal} title={partsListJob ? `Parts List — ${partsListJob}` : 'Parts List'}>
          {partsListLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading parts…</div>
          ) : partsListUnits.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>No cabinet units for this job yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(() => {
                const byRoom: Record<string, AssemblyCabinetUnit[]> = {};
                partsListUnits.forEach((u) => {
                  const k = u.room_number ? `Room ${u.room_number}` : 'Unassigned';
                  (byRoom[k] ??= []).push(u);
                });
                return Object.entries(byRoom).map(([room, roomUnits]) => (
                  <div key={room}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A78BFA', padding: '8px 0 6px', borderBottom: '1px solid var(--line)' }}>{room}</div>
                    {roomUnits.map((unit) => {
                      const parts   = partsListParts.filter((p) => p.cabinet_unit_id === unit.id);
                      const total   = parts.length;
                      const checked = parts.filter((p) => p.status !== 'pending').length;
                      const open    = !!partsListExpanded[unit.id];
                      const flagged = parts.some((p) => p.flag_type) || unit.status === 'flagged';
                      const label   = unit.cabinet_number ? `Cabinet ${unit.cabinet_number}` : unit.unit_label;
                      return (
                        <div key={unit.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <button
                            onClick={() => setPartsListExpanded((prev) => ({ ...prev, [unit.id]: !prev[unit.id] }))}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 2px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}
                          >
                            {flagged && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#F87171', flexShrink: 0 }} />}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: flagged ? '#F87171' : 'var(--ink)' }}>{label}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 1 }}>{checked}/{total} checked</div>
                            </div>
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}><polyline points="6 9 12 15 18 9"/></svg>
                          </button>
                          {open && (
                            <div style={{ padding: '0 2px 12px' }}>
                              {parts.length === 0 ? (
                                <div style={{ fontSize: 12, color: 'var(--ink-mute)', padding: '4px 0 10px' }}>No parts loaded for this cabinet.</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 12 }}>
                                  {parts.map((part) => {
                                    const dims = [part.width, part.height, part.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');
                                    return (
                                      <div key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{partsListStatusIcon(part.status, part.flag_type)}</div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 600, color: part.flag_type ? '#F87171' : 'var(--ink)' }}>
                                            {part.part_name}
                                            {part.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{part.quantity}</span>}
                                          </div>
                                          {(dims || part.material) && (
                                            <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{dims}{part.material ? (dims ? ` · ${part.material}` : part.material) : ''}</div>
                                          )}
                                          {part.flag_type && <div style={{ fontSize: 11, color: '#F87171', marginTop: 1 }}>{part.flag_type.replace('_', ' ')}</div>}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              <button
                                onClick={() => void openScanForUnit(unit.id)}
                                style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderRadius: 8, background: 'rgba(45,225,201,0.1)', border: '1px solid rgba(45,225,201,0.3)', color: '#2DE1C9', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
                                Scan / Check Cabinet
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── SOPs Modal ──────────────────────────────────────────────────────── */}
      {modal === 'sops' && (
        <ModalOverlay onClose={closeModal} title="SOPs">
          {sopsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>Loading SOPs…</div>
          ) : sops.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-mute)', fontSize: 13 }}>
              No SOPs available{crewDept ? ` for ${crewDept}` : ''}.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sops.map((s) => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid var(--line)', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{s.title}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                      {s.dept ? (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'rgba(167,139,250,0.12)', color: '#A78BFA' }}>{s.dept}</span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)' }}>All Depts</span>
                      )}
                      <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{formatDate(s.created_at)}</span>
                    </div>
                  </div>
                  {s.pdf_url ? (
                    <a href={s.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'rgba(94,234,212,0.1)', padding: '5px 12px', borderRadius: 8, textDecoration: 'none', flexShrink: 0 }}>Open</a>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No file</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </ModalOverlay>
      )}

      {/* ── Message Modal ────────────────────────────────────────────────────── */}
      {/* ── Switch Department Modal ──────────────────────────────────────── */}
      {modal === 'switchDept' && (
        <ModalOverlay onClose={closeModal} title="Switch Department">
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 20 }}>
            Choose your department. Messages and reports will be filtered accordingly.
          </p>
          <Field label="Department">
            <select
              className="form-input"
              value={switchDeptVal}
              onChange={(e) => setSwitchDeptVal(e.target.value)}
              autoFocus
              style={{ cursor: 'pointer' }}
            >
              <option value="">Select department…</option>
              {deptOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={closeModal}>Cancel</button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, justifyContent: 'center', opacity: !switchDeptVal ? 0.5 : 1 }}
              onClick={handleSwitchDept}
              disabled={!switchDeptVal}
            >
              Confirm
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Edit Name Modal ──────────────────────────────────────────────── */}
      {modal === 'editName' && (
        <ModalOverlay onClose={closeModal} title="Edit Your Name">
          <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 20 }}>
            Updates your saved name and any open clock-in session.
          </p>
          <Field label="Your Name">
            <input
              className="form-input"
              placeholder="e.g. Mike Torres"
              value={editNameVal}
              onChange={(e) => setEditNameVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); }}
              autoFocus
            />
          </Field>
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={closeModal}>Cancel</button>
            <button
              className="btn btn-primary"
              style={{ flex: 2, justifyContent: 'center', opacity: (!editNameVal.trim() || nameSaving) ? 0.5 : 1 }}
              onClick={handleSaveName}
              disabled={!editNameVal.trim() || nameSaving}
            >
              {nameSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {/* Different person on this shared device — clear identity and start fresh. */}
          <button
            onClick={switchUser}
            style={{ marginTop: 16, width: '100%', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
          >
            Not you? Switch to a different crew member
          </button>
        </ModalOverlay>
      )}

      {/* ── Build Timer Modal ───────────────────────────────────────────────── */}
      {modal === 'buildTimer' && (
        <ModalOverlay
          onClose={closeModal}
          title={buildTimerStep === 'summary' ? 'Build Complete' : 'Start Build Timer'}
        >
          {buildTimerStep === 'form' ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 20 }}>
                Track actual build time for custom work and raw lumber. Timer persists if you refresh.
              </p>
              <Field label="What are you building? *">
                <input
                  className="form-input"
                  placeholder="e.g. Custom cabinet face frames"
                  value={bmMaterial}
                  onChange={(e) => setBmMaterial(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleStartTimer(); }}
                  autoFocus
                />
              </Field>
              <Field label="Material Type">
                <select className="form-input" value={bmMatType} onChange={(e) => setBmMatType(e.target.value)} style={{ cursor: 'pointer' }}>
                  <option value="Raw Lumber">Raw Lumber</option>
                  <option value="Custom Millwork">Custom Millwork</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Quantity">
                  <input className="form-input" type="number" min="1" placeholder="e.g. 20" value={bmQty} onChange={(e) => setBmQty(e.target.value)} />
                </Field>
                <Field label="Unit">
                  <select className="form-input" value={bmUnit} onChange={(e) => setBmUnit(e.target.value)} style={{ cursor: 'pointer' }}>
                    <option value="Board Feet">Board Feet</option>
                    <option value="Sheets">Sheets</option>
                    <option value="Pieces">Pieces</option>
                  </select>
                </Field>
              </div>
              <Field label="Job / Project (optional)">
                <input className="form-input" placeholder="e.g. P-26-1001 or Smith Kitchen" value={bmJobNum} onChange={(e) => setBmJobNum(e.target.value)} />
              </Field>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 4, opacity: (!bmMaterial.trim() || saving) ? 0.5 : 1 }}
                onClick={handleStartTimer}
                disabled={!bmMaterial.trim() || saving}
              >
                {saving ? 'Starting…' : 'Start Timer'}
              </button>
            </>
          ) : buildSummary ? (
            <>
              <div style={{ textAlign: 'center', paddingBottom: 24 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(45,225,201,0.12)', border: '2px solid #2DE1C9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#2DE1C9' }}>Build Complete</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(45,225,201,0.05)', border: '1px solid rgba(45,225,201,0.15)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', marginBottom: 5 }}>Material</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{buildSummary.material}</div>
                </div>
                <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(45,225,201,0.05)', border: '1px solid rgba(45,225,201,0.15)' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', marginBottom: 5 }}>Total Build Time</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#2DE1C9', fontVariantNumeric: 'tabular-nums' }}>{buildSummary.duration}</div>
                </div>
                {buildSummary.job && (
                  <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(45,225,201,0.05)', border: '1px solid rgba(45,225,201,0.15)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', marginBottom: 5 }}>Job / Project</div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{buildSummary.job}</div>
                  </div>
                )}
              </div>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={closeModal}>Done</button>
            </>
          ) : null}
        </ModalOverlay>
      )}

      {/* ── Parts / QC Modal ─────────────────────────────────────────────────── */}
      {modal === 'parts' && (
        <ModalOverlay onClose={closeModal} title="Parts & QC">

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 24 }}>
            {(['log', 'qc'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPartsMode(m)}
                style={{
                  padding: '8px 18px', fontSize: 13, fontWeight: 600,
                  color: partsMode === m ? '#60A5FA' : 'var(--ink-mute)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: partsMode === m ? '2px solid #60A5FA' : '2px solid transparent',
                  marginBottom: -1, fontFamily: 'inherit', transition: 'color 0.15s',
                }}
              >
                {m === 'log' ? 'Log Part' : `QC Check${partsQcList.length > 0 ? ` (${partsQcList.length})` : ''}`}
              </button>
            ))}
          </div>

          {/* ── LOG PART mode — camera-first ── */}
          {partsMode === 'log' && (
            <>
              {partScanStep === 'camera' ? (
                /* Step 1: Camera */
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, padding: '4px 0' }}>
                  <div style={{ position: 'relative', width: '100%', maxWidth: 300, aspectRatio: '4/3', background: '#07090A', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {!cameraError && (
                      <video ref={videoRef} autoPlay playsInline muted
                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                    )}
                    {cameraStarting && !cameraError && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(7,9,10,0.75)' }}>
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)' }}>Starting camera…</span>
                      </div>
                    )}
                    {cameraError && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
                        <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="rgba(94,234,212,0.3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        <p style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1.5, margin: 0 }}>{cameraError}</p>
                      </div>
                    )}
                    <div style={{ position: 'absolute', top: 14, left: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '3px 0 0 0', zIndex: 2 }} />
                    <div style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 3px 0 0', zIndex: 2 }} />
                    <div style={{ position: 'absolute', bottom: 14, left: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '0 0 0 3px', zIndex: 2 }} />
                    <div style={{ position: 'absolute', bottom: 14, right: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 0 3px 0', zIndex: 2 }} />
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--ink-mute)', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em', margin: 0 }}>Point camera at part</p>
                  {cameraError ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.25)', borderRadius: 10, fontSize: 13, color: '#5EEAD4', cursor: 'pointer' }}>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                      Upload photo
                      <input type="file" accept="image/*" style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0] ?? null;
                          if (file) { setPartPhoto(file); setPartPhotoPreview(URL.createObjectURL(file)); setPartScanStep('preview'); }
                        }} />
                    </label>
                  ) : (
                    <button type="button" onClick={() => { void capturePartPhoto(); }}
                      style={{ width: 62, height: 62, borderRadius: '50%', background: '#2DE1C9', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 0 5px rgba(45,225,201,0.18)', flexShrink: 0 }}>
                      <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#050608" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </button>
                  )}
                </div>
              ) : (
                /* Step 2: Preview + submit */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <img src={partPhotoPreview!} alt="part" style={{ width: 100, height: 75, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--line)', flexShrink: 0 }} />
                    <button type="button"
                      onClick={() => { setPartPhoto(null); setPartPhotoPreview(null); setPartScanStep('camera'); }}
                      style={{ background: 'none', border: '1px solid var(--line)', borderRadius: 6, padding: '4px 12px', fontSize: 12, color: 'var(--ink-mute)', cursor: 'pointer', marginTop: 4 }}>
                      Retake
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-primary"
                      style={{ flex: 1, justifyContent: 'center', background: '#60A5FA', boxShadow: 'none', opacity: saving ? 0.5 : 1 }}
                      onClick={handlePartSubmit} disabled={saving}>
                      {saving ? 'Logging…' : 'Submit'}
                    </button>
                    {!partShowDetails && (
                      <button type="button" className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={() => setPartShowDetails(true)}>
                        Add Details
                      </button>
                    )}
                  </div>

                  {partShowDetails && (
                    <>
                      <Field label="Job">
                        <select className="form-input" value={partJobId} onChange={(e) => setPartJobId(e.target.value)} style={{ cursor: 'pointer' }}>
                          <option value="">No job selected</option>
                          <option disabled>── Shop ──</option>
                          <option value="__shop_maint__">Shop Maintenance</option>
                          <option value="__machine_maint__">Machine Maintenance</option>
                          <option value="__non_billable__">Non-Billable</option>
                          <option value="__warranty__">Warranty / Repair</option>
                          {jobs.length > 0 && <option disabled>── Jobs ──</option>}
                          {jobs.map((j) => (
                            <option key={j.id} value={j.id}>{j.job_number}{j.job_name ? ` — ${j.job_name}` : ''}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Status">
                        <select className="form-input" value={partStatus} onChange={(e) => setPartStatus(e.target.value)} style={{ cursor: 'pointer' }}>
                          <option value="In Progress">In Progress</option>
                          <option value="QC Check">QC Check</option>
                          <option value="Passed QC">Passed QC</option>
                          <option value="Failed QC / Rework">Failed QC / Rework</option>
                          <option value="Moving to Next Stage">Moving to Next Stage</option>
                        </select>
                      </Field>
                      <Field label="Notes (optional)">
                        <input className="form-input" placeholder="Any details…" value={partNotes} onChange={(e) => setPartNotes(e.target.value)} />
                      </Field>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ── QC CHECK mode ── */}
          {partsMode === 'qc' && (
            <>
              {qcLoading ? (
                <div style={{ textAlign: 'center', padding: '32px 0', fontSize: 13, color: 'var(--ink-mute)' }}>Loading parts…</div>
              ) : partsQcList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '32px 0' }}>
                  <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}><polyline points="20 6 9 17 4 12"/></svg>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#34D399', marginBottom: 6 }}>All clear</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
                    No parts awaiting QC{crewDept ? ` in ${crewDept}` : ''}.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {partsQcList.map((p) => (
                    <div
                      key={p.id}
                      style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(251,191,36,0.05)', border: '1px solid rgba(251,191,36,0.2)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.part_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 3 }}>
                            {p.job_number ? `Job ${p.job_number} · ` : ''}
                            {p.worker_name ? `${p.worker_name} · ` : ''}
                            {formatTime(p.created_at)}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: 'rgba(251,191,36,0.15)', color: '#FBBF24', flexShrink: 0 }}>
                          QC Check
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleQcAction(p.id, 'Passed QC')}
                          disabled={!!qcActioning[p.id]}
                          style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.08)', color: '#34D399', cursor: qcActioning[p.id] ? 'not-allowed' : 'pointer', opacity: qcActioning[p.id] ? 0.5 : 1, fontFamily: 'inherit' }}
                        >
                          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }}><polyline points="20 6 9 17 4 12"/></svg>
                          Approve
                        </button>
                        <button
                          onClick={() => handleQcAction(p.id, 'Failed QC / Rework')}
                          disabled={!!qcActioning[p.id]}
                          style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#F87171', cursor: qcActioning[p.id] ? 'not-allowed' : 'pointer', opacity: qcActioning[p.id] ? 0.5 : 1, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}
                        >
                          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          Rework
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </ModalOverlay>
      )}

      {/* ── Assembly Scan Modal ──────────────────────────────────────────── */}
      {modal === 'assemblyScan' && !assemblyScanDone && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(5px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          <div style={{ background: '#0a0d10', border: '1px solid var(--line-strong)', borderRadius: 20, width: '100%', maxWidth: 500, padding: 28, display: 'flex', flexDirection: 'column', gap: 0, marginTop: 16 }}>
            <style>{`@keyframes asmSweep{from{opacity:0;transform:scale(0.5)}to{opacity:1;transform:scale(1)}}`}</style>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {assemblyScanStep === 'checklist' && assemblyScanUnit && (
                  <button
                    onClick={() => { setAssemblyScanStep('scan'); setAssemblyScanUnit(null); setAssemblyScanParts([]); setAssemblyScanChecked({}); setAssemblyScanFlags({}); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 12 }}
                  >
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    Back
                  </button>
                )}
                <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>
                  {assemblyScanStep === 'scan' ? 'Assembly Scan' : assemblyScanUnit
                    ? `${assemblyScanUnit.room_number ? `Room ${assemblyScanUnit.room_number} — ` : ''}${assemblyScanUnit.cabinet_number ? `Cabinet ${assemblyScanUnit.cabinet_number}` : assemblyScanUnit.unit_label}`
                    : 'Assembly Scan'
                  }
                </div>
              </div>
              <button onClick={closeModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* ── Production gate: cabinet not cut yet ── */}
            {assemblyNotReady && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '8px 0 4px', textAlign: 'center' }}>
                <span style={{ color: '#FBBF24' }}>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </span>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Not ready yet</div>
                <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>Production is still cutting this cabinet.</div>
                <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6, margin: '10px 0', textAlign: 'left' }}>
                  {assemblyNotReady.parts.map((p) => {
                    const cut = isPartCut(p.production_status);
                    const label = p.production_status === 'cutting' ? 'Cutting' : cut ? 'Cut' : 'Not cut yet';
                    const color = p.production_status === 'cutting' ? '#FBBF24' : cut ? '#2DE1C9' : '#8BA5A0';
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 9, background: 'var(--bg-1)', border: '1px solid var(--line)' }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--ink-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.part_name}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color }}>{label}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>We&apos;ll notify you when it&apos;s ready.</div>
                <button onClick={closeModal} className="btn btn-ghost" style={{ marginTop: 6, minHeight: 44 }}>Back</button>
              </div>
            )}

            {/* ── STEP 1: Scan ── */}
            {assemblyScanStep === 'scan' && !assemblyNotReady && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Camera viewfinder */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#07090A', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {!cameraError && <video ref={videoRef} autoPlay playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                  {cameraStarting && !cameraError && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(7,9,10,0.75)' }}>
                      <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Starting camera…</span>
                    </div>
                  )}
                  {cameraError && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 }}>
                      <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="rgba(94,234,212,0.3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg>
                      <p style={{ fontSize: 11, color: 'var(--ink-mute)', textAlign: 'center', lineHeight: 1.5, margin: 0 }}>Type the label below</p>
                    </div>
                  )}
                  {/* Corner brackets */}
                  <div style={{ position: 'absolute', top: 14, left: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '3px 0 0 0', zIndex: 2 }} />
                  <div style={{ position: 'absolute', top: 14, right: 14, width: 28, height: 28, borderTop: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 3px 0 0', zIndex: 2 }} />
                  <div style={{ position: 'absolute', bottom: 14, left: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderLeft: '2px solid #5EEAD4', borderRadius: '0 0 0 3px', zIndex: 2 }} />
                  <div style={{ position: 'absolute', bottom: 14, right: 14, width: 28, height: 28, borderBottom: '2px solid #5EEAD4', borderRight: '2px solid #5EEAD4', borderRadius: '0 0 3px 0', zIndex: 2 }} />
                  {/* Teal flash on a successful QR/barcode decode */}
                  {scanFlash && <div style={{ position: 'absolute', inset: 0, background: 'rgba(45,225,201,0.4)', zIndex: 3, transition: 'opacity 0.2s' }} />}
                  {!cameraError && !cameraStarting && (
                    <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 10.5, color: 'rgba(255,255,255,0.7)', zIndex: 2 }}>Point at a QR or barcode</div>
                  )}
                </div>

                <div>
                  <input
                    className="form-input"
                    placeholder="Or type part label..."
                    value={assemblyScanInput}
                    onChange={(e) => { setAssemblyScanInput(e.target.value); setAssemblyScanNotFound(false); setScanAiResult(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleAssemblyScanSearch(); }}
                    style={{ width: '100%', fontSize: 15 }}
                  />
                  {assemblyScanNotFound && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#F87171' }}>
                      Part not found — check job / project or ask supervisor.
                    </div>
                  )}
                </div>

                {/* ── Auto-detect couldn't decide → pick the flow manually ── */}
                {scanChoiceUnit && (
                  <div style={{ border: '1px solid var(--line-strong)', borderRadius: 12, padding: 16, background: 'var(--bg-1)' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{scanChoiceUnit.unit_label}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 4, marginBottom: 14 }}>Which step is this?</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { const u = scanChoiceUnit; setScanChoiceUnit(null); void loadCabinetUnit(u.id, true); }}>Assembly</button>
                      <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => { void openProductionCutFlow(scanChoiceUnit); }}>Production / QC</button>
                    </div>
                  </div>
                )}

                {/* ── AI fuzzy-match: confirm (85-94%) or pick from alternatives (<85%) ── */}
                {scanAiResult && (scanAiResult.match || scanAiResult.alternatives.length > 0) && (
                  <div style={{ border: '1px solid rgba(45,225,201,0.3)', borderRadius: 12, padding: 16, background: 'rgba(45,225,201,0.04)' }}>
                    {scanAiResult.match && !scanShowAlts ? (
                      <>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{scanAiResult.match.part_name}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2 }}>{scanAiResult.match.cabinet_label}</div>
                        <div style={{ fontSize: 12, color: 'var(--teal)', marginTop: 6 }}>AI matched with {Math.round(scanAiResult.match.confidence)}% confidence</div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                          <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => void confirmScanMatch(scanAiResult.match!, assemblyScanInput)}>Yes, that&apos;s it</button>
                          <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setScanShowAlts(true)}>No, show options</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>We found a few possible matches:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {[...(scanAiResult.match ? [scanAiResult.match] : []), ...scanAiResult.alternatives]
                            .filter((m, i, arr) => arr.findIndex((x) => x.cabinet_unit_id === m.cabinet_unit_id && x.part_name === m.part_name) === i)
                            .map((m, i) => (
                              <button key={`${m.cabinet_unit_id}-${i}`} onClick={() => void confirmScanMatch(m, assemblyScanInput)}
                                style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 10, background: 'var(--bg-1)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'inherit', width: '100%' }}>
                                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{m.part_name}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2 }}>{m.cabinet_label} · {Math.round(m.confidence)}%</div>
                              </button>
                            ))}
                        </div>
                        <button onClick={() => { setScanAiResult(null); setScanShowAlts(false); setAssemblyScanNotFound(true); }}
                          style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontFamily: 'inherit', textDecoration: 'underline' }}>
                          None of these
                        </button>
                      </>
                    )}
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', opacity: (!assemblyScanInput.trim() || assemblyScanSearching) ? 0.5 : 1, fontSize: 15 }}
                  onClick={() => void handleAssemblyScanSearch()}
                  disabled={!assemblyScanInput.trim() || assemblyScanSearching}
                >
                  {assemblyScanSearching ? 'Searching…' : 'Find Cabinet'}
                </button>
              </div>
            )}

            {/* ── STEP 2/3: Checklist + flag ── */}
            {assemblyScanStep === 'checklist' && assemblyScanUnit && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {/* Job sub-label + drawings */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                  {assemblyScanUnit.job_number && (
                    <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Job: {assemblyScanUnit.job_number}</span>
                  )}
                  <ViewDrawingsButton tenantId={tenant!.id} jobNumber={assemblyScanUnit.job_number} cabinetKey={assemblyScanUnit.cabinet_number || assemblyScanUnit.unit_label} compact={false} />
                </div>

                {/* Parts count */}
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', marginBottom: 14 }}>
                  {Object.values(assemblyScanChecked).filter(Boolean).length - Object.keys(assemblyScanFlags).length}/{assemblyScanParts.length} parts checked
                  {Object.keys(assemblyScanFlags).length > 0 && (
                    <span style={{ marginLeft: 10, color: '#F87171' }}>· {Object.keys(assemblyScanFlags).length} flagged</span>
                  )}
                </div>

                {/* Parts list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 20 }}>
                  {assemblyScanParts.map((p) => {
                    const flag    = assemblyScanFlags[p.id];
                    const checked = assemblyScanChecked[p.id];
                    const isFlagging = assemblyScanFlagging === p.id;
                    const dims  = [p.width, p.height, p.depth].filter(Boolean).map((v) => `${v}"`).join(' x ');

                    return (
                      <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        {/* Part row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
                          {/* Status icon */}
                          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', animation: checked && !flag ? 'asmSweep 0.2s ease-out' : undefined }}>
                            {flag ? (
                              flag.type === 'damaged'    ? <span style={{ color: '#F87171' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> :
                              flag.type === 'missing'    ? <span style={{ color: '#FBBF24' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg></span> :
                                                           <span style={{ color: '#F87171' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>
                            ) : checked ? (
                              <span style={{ color: '#34D399' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
                            ) : (
                              <span style={{ color: '#8BA5A0' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg></span>
                            )}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: flag ? '#F87171' : 'var(--ink)' }}>
                              {p.part_name}
                              {p.quantity > 1 && <span style={{ fontWeight: 400, color: 'var(--ink-mute)', marginLeft: 6 }}>×{p.quantity}</span>}
                            </div>
                            {dims && <div style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{dims}</div>}
                            {flag && (
                              <div style={{ fontSize: 11, color: '#F87171', marginTop: 2 }}>
                                {flag.type.replace('_', ' ')}{flag.notes ? ` — ${flag.notes}` : ''}
                              </div>
                            )}
                          </div>

                          {/* Flag button — only if not already flagged */}
                          {!flag && (
                            <button
                              onClick={() => handleAssemblyScanFlag(p.id)}
                              title="Flag an issue"
                              style={{
                                flexShrink: 0, background: isFlagging ? 'rgba(248,113,113,0.15)' : 'none',
                                border: `1px solid ${isFlagging ? 'rgba(248,113,113,0.4)' : 'transparent'}`,
                                borderRadius: 6, padding: 5, cursor: 'pointer',
                                color: isFlagging ? '#F87171' : 'var(--ink-mute)',
                                display: 'flex', transition: 'all 0.12s',
                              }}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                            </button>
                          )}
                          {flag && (
                            <button
                              onClick={() => {
                                setAssemblyScanFlags((prev) => { const n = { ...prev }; delete n[p.id]; return n; });
                                setAssemblyScanChecked((prev) => ({ ...prev, [p.id]: true }));
                              }}
                              title="Remove flag"
                              style={{ flexShrink: 0, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#F87171', fontSize: 11, fontFamily: 'inherit', fontWeight: 700 }}
                            >
                              Unflag
                            </button>
                          )}
                          <PartPushButton
                            tenantId={tenant!.id}
                            part={{ id: p.id, part_name: p.part_name, cabinet_unit_id: assemblyScanUnit.id, job_number: assemblyScanUnit.job_number }}
                            currentDept="Assembly"
                            unitLabel={assemblyScanUnit.unit_label}
                            timeClockId={activeTimeClockId}
                            workerName={crewName}
                            onPushed={() => setAssemblyScanParts((prev) => prev.filter((x) => x.id !== p.id))}
                            onToast={showToast}
                            compact
                          />
                        </div>

                        {/* Flag options inline */}
                        {isFlagging && (
                          <div style={{ padding: '10px 12px 14px 30px', background: 'rgba(248,113,113,0.04)', borderRadius: 8, marginBottom: 6 }}>
                            <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Flag type</div>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                              {[
                                { key: 'damaged',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>, label: 'Damaged' },
                                { key: 'missing',    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/></svg>, label: 'Missing' },
                                { key: 'wrong_part', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>, label: 'Wrong Part' },
                              ].map(({ key, icon, label }) => (
                                <button
                                  key={key}
                                  onClick={() => setAssemblyScanFlagType(key)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '7px 12px', borderRadius: 8,
                                    border: `1px solid ${assemblyScanFlagType === key ? 'rgba(248,113,113,0.5)' : 'var(--line)'}`,
                                    background: assemblyScanFlagType === key ? 'rgba(248,113,113,0.12)' : 'transparent',
                                    color: assemblyScanFlagType === key ? '#F87171' : 'var(--ink-mute)',
                                    fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  {icon} {label}
                                </button>
                              ))}
                            </div>
                            <input
                              className="form-input"
                              placeholder="Notes (optional)"
                              value={assemblyScanFlagNotes}
                              onChange={(e) => setAssemblyScanFlagNotes(e.target.value)}
                              style={{ width: '100%', marginBottom: 10, fontSize: 13 }}
                            />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => setAssemblyScanFlagging(null)}
                                style={{ flex: 1, padding: '7px 0', borderRadius: 7, border: '1px solid var(--line)', background: 'none', color: 'var(--ink-mute)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleAssemblyScanFlagConfirm(p.id)}
                                style={{ flex: 2, padding: '7px 0', borderRadius: 7, border: 'none', background: 'rgba(248,113,113,0.85)', color: '#fff', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}
                              >
                                Flag Part
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Confirm & Done */}
                {assemblyScanFlagging === null && (
                  <div style={{ paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginBottom: 14 }}>
                      {Object.keys(assemblyScanFlags).length > 0
                        ? `Cabinet ready — ${Object.values(assemblyScanChecked).filter(Boolean).length - Object.keys(assemblyScanFlags).length} parts good, ${Object.keys(assemblyScanFlags).length} issue${Object.keys(assemblyScanFlags).length !== 1 ? 's' : ''} flagged`
                        : `Cabinet ready — all ${assemblyScanParts.length} parts checked`
                      }
                    </div>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', justifyContent: 'center', fontSize: 15, opacity: assemblyScanConfirming ? 0.5 : 1 }}
                      onClick={() => void handleAssemblyScanConfirm()}
                      disabled={assemblyScanConfirming}
                    >
                      {assemblyScanConfirming ? 'Saving…' : 'Confirm & Done'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assembly scan done flash */}
      {assemblyScanDone && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,8,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, pointerEvents: 'none' }}>
          <div style={{ background: '#052E16', border: '1px solid #34D399', borderRadius: 16, padding: '22px 40px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#34D399' }}>Cabinet logged</span>
          </div>
        </div>
      )}

      {/* Hidden canvas for video frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {toast && <Toast msg={toast.msg} error={toast.error} pending={toast.pending} />}

      {/* ── Clock-in gate ──────────────────────────────────────────────────────
          Shown when a work action is attempted with no open shift. */}
      {gateOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 260, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setGateOpen(false); }}
        >
          <div style={{ width: '100%', maxWidth: 360, background: '#0a0d10', border: '1px solid rgba(94,234,212,0.18)', borderRadius: 18, padding: '28px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(251,191,36,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FBBF24' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>You need to clock in before starting work</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', marginTop: 4 }}>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => { setGateOpen(false); openClock(); }}
              >
                Clock In Now
              </button>
              <button
                className="btn btn-ghost"
                style={{ width: '100%', justifyContent: 'center' }}
                onClick={() => setGateOpen(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Success flash overlays ── */}
      {(dmgFlash || partFlash) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,8,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, pointerEvents: 'none' }}>
          <div style={{ background: '#052E16', border: '1px solid #34D399', borderRadius: 16, padding: '22px 40px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#34D399' }}>{partFlash ? 'Part Logged' : 'Damage Reported'}</span>
          </div>
        </div>
      )}

      {viewerFile && <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />}

      {/* ── Cabinet Cut View (Production) ──────────────────────────────────────── */}
      {cutUnit && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
          <style>{`@keyframes prodPulse{0%,100%{opacity:1}50%{opacity:0.35}}`}</style>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
            <button onClick={closeCutView} aria-label="Close"
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cutUnit.unit_label}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{cutUnit.jobPath.split('/').join(' / ')}</div>
            </div>
            <ViewDrawingsButton tenantId={tenant!.id} jobNumber={cutUnit.job_number} cabinetKey={cutUnit.cabinet_number || cutUnit.unit_label} compact />
          </div>

          {/* parts list — each part is cut, then pushed to its next dept */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: 'calc(24px + env(safe-area-inset-bottom))' }}>
            {cutLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>Loading parts…</div>
            ) : cutParts.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>All parts pushed — nothing left in production for this cabinet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, margin: '0 auto' }}>
                {cutParts.map((p) => {
                  const dims = [p.width, p.height, p.depth].filter((d) => d != null).join(' × ');
                  const flag = getFinishingFlag(p.part_name, p.material);
                  return (
                    <div key={p.id} style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg-1)', padding: '13px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</span>
                            {flag && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.12)', color: '#FBBF24', flexShrink: 0 }}>{flag}</span>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{dims}{p.material ? `${dims ? ' — ' : ''}${p.material}` : ''}</div>
                          {flag && <div style={{ fontSize: 11, color: '#FBBF24', marginTop: 2 }}>Needs finishing before assembly</div>}
                        </div>
                        <label title="Photo proof" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, border: '1px solid var(--line)', background: p.cut_photo_url ? 'rgba(45,225,201,0.12)' : 'var(--bg-2)', color: p.cut_photo_url ? '#2DE1C9' : 'var(--ink-mute)', cursor: 'pointer', flexShrink: 0 }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePartPhoto(p.id, f); e.target.value = ''; }} />
                        </label>
                      </div>
                      <PushPicker
                        tenantId={tenant!.id}
                        partId={p.id}
                        partName={p.part_name}
                        cabinetUnitId={cutUnit.id}
                        jobNumber={cutUnit.job_number}
                        currentDept="production"
                        workerName={crewName}
                        timeClockId={activeTimeClockId}
                        aiMode={aiMode}
                        onPushed={() => {
                          setCutParts((ps) => ps.filter((x) => x.id !== p.id));
                          void loadProduction();
                        }}
                        onToast={showToast}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Job-level Cut List (Production) ────────────────────────────────────── */}
      {cutJob && (() => {
        const totalParts = cutJobCabs.reduce((s, c) => s + c.parts.length, 0);
        const cutCount   = cutJobCabs.reduce((s, c) => s + c.parts.filter((p) => p.checked).length, 0);
        const heldIds    = Object.keys(heldCabs).filter((id) => heldCabs[id] && cutJobCabs.some((c) => c.cabinetId === id));
        const dims = (p: CutJobPart) => [p.width, p.height, p.depth].filter((d) => d != null).map((d) => `${d}"`).join(' x ');
        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 1500, background: 'var(--bg)', display: 'flex', flexDirection: 'column', paddingTop: 'env(safe-area-inset-top)' }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <button onClick={closeCutJob} aria-label="Close"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', color: 'var(--ink-dim)', border: '1px solid var(--line)', cursor: 'pointer', flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cutJob.jobPath.split('/').map((s) => s.trim()).join(' / ')}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{cutCount}/{totalParts} parts cut</div>
              </div>
              <ViewDrawingsButton tenantId={tenant!.id} jobNumber={cutJob.jobNumber} cabinetKey="" compact />
            </div>

            {/* cabinets */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, paddingBottom: heldIds.length > 0 ? 'calc(96px + env(safe-area-inset-bottom))' : 'calc(24px + env(safe-area-inset-bottom))' }}>
              {cutJobLoading ? (
                <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>Loading cut list…</div>
              ) : cutJobCabs.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--ink-mute)', padding: 32 }}>All parts cut and pushed — nothing left in this job.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640, margin: '0 auto' }}>
                  {cutJobCabs.map((c) => {
                    const open = !!cutCabExpanded[c.cabinetId];
                    const cabCut = c.parts.filter((p) => p.checked).length;
                    const held = !!heldCabs[c.cabinetId];
                    return (
                      <div key={c.cabinetId} style={{ border: `1px solid ${held ? 'rgba(251,191,36,0.4)' : 'var(--line)'}`, borderRadius: 12, background: 'var(--bg-1)', overflow: 'hidden' }}>
                        <button onClick={() => setCutCabExpanded((s) => ({ ...s, [c.cabinetId]: !s[c.cabinetId] }))}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 14px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                          <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s ease', transform: open ? 'rotate(90deg)' : 'none' }}><polyline points="9 6 15 12 9 18"/></svg>
                          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{c.label}</span>
                          {held && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 20, background: 'rgba(251,191,36,0.16)', color: '#FBBF24' }}>Held</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: cabCut === c.parts.length ? '#2DE1C9' : 'var(--ink-mute)' }}>{cabCut}/{c.parts.length}</span>
                        </button>
                        {open && (
                          <div style={{ borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
                            {c.parts.map((p) => (
                              <div key={p.id}
                                onPointerDown={() => { longPressFired.current = false; longPressTimerCut.current = setTimeout(() => { longPressFired.current = true; setLongPressPart({ part: p, cabinetId: c.cabinetId }); }, 500); }}
                                onPointerUp={() => { if (longPressTimerCut.current) clearTimeout(longPressTimerCut.current); }}
                                onPointerLeave={() => { if (longPressTimerCut.current) clearTimeout(longPressTimerCut.current); }}
                                onPointerCancel={() => { if (longPressTimerCut.current) clearTimeout(longPressTimerCut.current); }}
                                onClick={() => { if (longPressFired.current) { longPressFired.current = false; return; } void toggleCutPart(c.cabinetId, p.id); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid var(--line)', cursor: 'pointer', userSelect: 'none', touchAction: 'manipulation' }}>
                                <span style={{ width: 24, height: 24, flexShrink: 0, borderRadius: 6, border: `1px solid ${p.checked ? 'var(--teal)' : 'var(--line-strong)'}`, background: p.checked ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {p.checked && <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                </span>
                                <div style={{ minWidth: 0, flex: 1 }}>
                                  <div style={{ fontSize: 14, fontWeight: 600, color: p.checked ? 'var(--ink-mute)' : 'var(--ink)', textDecoration: p.checked ? 'line-through' : 'none' }}>{p.part_name}{p.quantity > 1 ? ` ×${p.quantity}` : ''}</div>
                                  <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{[dims(p), p.material].filter(Boolean).join(' · ')}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Push Group bottom bar */}
            {heldIds.length > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 16px calc(14px + env(safe-area-inset-bottom))', borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
                <button onClick={() => { const sel: Record<string, boolean> = {}; heldIds.forEach((id) => { sel[id] = true; }); setGroupSel(sel); setPushGroupOpen(true); }}
                  style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#FBBF24', border: 'none', color: '#1a1206', cursor: 'pointer' }}>
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  Push Group ({heldIds.length} held)
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Fully-cut popup */}
      {fullyCutCab && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => { if (e.target === e.currentTarget) setFullyCutCab(null); }}>
          <div style={{ width: '100%', maxWidth: 360, background: '#0a0d10', border: '1px solid rgba(45,225,201,0.25)', borderRadius: 18, padding: '26px 24px', display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'center' }}>
            <div style={{ alignSelf: 'center', width: 52, height: 52, borderRadius: '50%', background: 'rgba(45,225,201,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--teal)' }}>
              <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{fullyCutCab.label} is fully cut</div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => { setHeldCabs((h) => ({ ...h, [fullyCutCab.cabinetId]: true })); setFullyCutCab(null); }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>
                Hold
              </button>
              <button onClick={() => { const id = fullyCutCab.cabinetId; setFullyCutCab(null); setDestForCabs([id]); }}
                style={{ flex: 1, padding: '13px', borderRadius: 12, fontSize: 14, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
                Push
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Push Group selection modal */}
      {pushGroupOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1600, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setPushGroupOpen(false); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Push held cabinets</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '40vh', overflowY: 'auto' }}>
              {Object.keys(heldCabs).filter((id) => heldCabs[id]).map((id) => {
                const cab = cutJobCabs.find((c) => c.cabinetId === id);
                if (!cab) return null;
                const on = !!groupSel[id];
                return (
                  <button key={id} onClick={() => setGroupSel((s) => ({ ...s, [id]: !s[id] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'var(--bg-1)', border: `1px solid ${on ? 'rgba(45,225,201,0.4)' : 'var(--line)'}`, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                    <span style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, border: `1px solid ${on ? 'var(--teal)' : 'var(--line-strong)'}`, background: on ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {on && <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#04201c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{cab.label}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{cab.parts.length} part{cab.parts.length === 1 ? '' : 's'}</span>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => { const ids = Object.keys(groupSel).filter((id) => groupSel[id]); if (ids.length === 0) { showToast('Select at least one cabinet', true); return; } setPushGroupOpen(false); setDestForCabs(ids); }}
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px', borderRadius: 12, fontSize: 15, fontWeight: 800, fontFamily: 'inherit', background: '#2DE1C9', border: 'none', color: '#04201c', cursor: 'pointer' }}>
              Choose destination
            </button>
          </div>
        </div>
      )}

      {/* Destination picker (for cabinet push / group push) */}
      {destForCabs && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget && !cutJobBusy) setDestForCabs(null); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>Send {destForCabs.length} cabinet{destForCabs.length === 1 ? '' : 's'} to</div>
            {(['craftsman', 'finishing', 'assembly'] as const).map((d) => (
              <button key={d} onClick={() => void pushCutCabinets(destForCabs, d)} disabled={cutJobBusy}
                style={{ width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '15px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: cutJobBusy ? 'wait' : 'pointer' }}>
                {deptDisplay(d)}
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Long-press part action sheet */}
      {longPressPart && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1700, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={(e) => { if (e.target === e.currentTarget) setLongPressPart(null); }}>
          <div style={{ width: '100%', maxWidth: 480, background: '#0a0d10', borderTopLeftRadius: 20, borderTopRightRadius: 20, border: '1px solid var(--line-strong)', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{longPressPart.part.part_name}</div>
            {(['craftsman', 'finishing', 'assembly'] as const).map((d) => (
              <button key={d} onClick={() => void pushSingleCutPart(longPressPart.cabinetId, longPressPart.part, d)}
                style={{ width: '100%', justifyContent: 'space-between', display: 'flex', alignItems: 'center', padding: '14px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: 'var(--bg-1)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>
                Push to {deptDisplay(d)}
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
              </button>
            ))}
            <button onClick={() => { setLongPressPart(null); openDamageForPart(longPressPart.part.part_name); }}
              style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderRadius: 12, fontSize: 15, fontWeight: 700, fontFamily: 'inherit', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#F87171', cursor: 'pointer' }}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              Mark Damaged
            </button>
          </div>
        </div>
      )}
    </>
  );
}
