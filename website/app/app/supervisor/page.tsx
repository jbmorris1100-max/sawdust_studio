'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft, getDepartments, planLabel as planLabelFor, isPaidPlan, isPartnerActive, PLAN_DISPLAY } from '@/lib/auth';
import IntegrationsTab, { SourceBadge } from './IntegrationsTab';
import ReportsTab from './ReportsTab';
import SetupWizard from './SetupWizard';
import AssemblyTab from './AssemblyTab';
import CraftsmanTab from './CraftsmanTab';
import CrewTab from './CrewTab';
import QcTab from './QcTab';
import RoutingRulesPanel from './RoutingRulesPanel';
import JobDrillDown from './JobDrillDown';
import FinishSpecsModal from './FinishSpecsModal';
import FileViewer, { type ViewerFile } from '@/components/FileViewer';
import JobSearch, { type SearchTarget } from '@/components/JobSearch';
import PushPrompt from '@/components/PushPrompt';
import OfflineBanner from '@/components/OfflineBanner';
import MessageThread from '@/components/MessageThread';
import { sendNotify } from '@/lib/notify';
import { deptDisplay } from '@/lib/partActions';
import { fmtAccumulated, type ActiveProject } from '@/lib/activeProject';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrewRow = {
  id: string;
  worker_name: string;
  dept: string;
  clock_in: string;
  status: string | null;
  on_break: boolean | null;
  total_break_minutes: number | null;
  current_dept: string | null;
};

type ShiftEvent = {
  id: string;
  worker_name: string;
  event_type: string;
  dept: string | null;
  previous_dept: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

// Clock-in/out adjustment requests piggy-back on the messages table via the
// topic + payload columns. topic-tagged messages are action items (rendered as
// approve/deny cards), never chat — they don't count toward the unread badge.
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
const isClockRequest = (m: Message): boolean => !!m.topic && CLOCK_TOPICS.includes(m.topic);

// A message counts toward the unread badge only if it's genuine crew→supervisor
// chat that the supervisor hasn't opened. Excludes anything the supervisor sent,
// already-read messages, and topic-tagged action items (clock-in/out requests).
// Mirrors the canonical SQL: sender_name != 'Supervisor' AND read_at IS NULL
// AND (topic IS NULL OR topic NOT LIKE '%request%').
const isUnreadChat = (m: Message): boolean =>
  m.sender_name !== 'Supervisor' &&
  !m.read_at &&
  (m.topic === null || !m.topic.toLowerCase().includes('request'));

type InventoryNeed = {
  id: string;
  item: string;
  dept: string | null;
  job_number: string | null;
  qty: number | null;
  status: string | null;
  created_at: string;
};

type DamageReport = {
  id: string;
  part_name: string;
  job_id: string | null;
  dept: string | null;
  notes: string | null;
  photo_url: string | null;
  status: string | null;
  created_at: string;
  resolution_type: string | null;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolution_cost: number | null;
  resolved_at: string | null;
  flag_type: string | null;
  assembler_name: string | null;
  cabinet_unit_id: string | null;
  report_type: string | null;
};

type JobDrawing = {
  id: string;
  job_number: string | null;
  job_path: string | null;
  label: string | null;
  file_url: string | null;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
  file_type: string | null;
  departments: string[] | null;
  parsed: boolean | null;
  version: number | null;
  superseded_by: string | null;
  is_current: boolean | null;
};

type CsvRow = Record<string, string>;

const JOB_DRAWING_COLS =
  'id, tenant_id, job_number, job_path, label, file_url, file_name, uploaded_by, created_at, file_type, departments, parsed, version, superseded_by, is_current';

function parsePlanCSV(text: string): { headers: string[]; rows: CsvRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  function splitLine(line: string): string[] {
    const result: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = !inQuotes; }
      } else if (ch === ',' && !inQuotes) {
        result.push(field.trim()); field = '';
      } else { field += ch; }
    }
    result.push(field.trim());
    return result;
  }
  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const vals = splitLine(l);
    const row: CsvRow = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

const PLAN_IMPORT_FIELDS: { key: string; label: string; required?: boolean }[] = [
  { key: 'unit_id',   label: 'Cabinet / Unit ID', required: true },
  { key: 'part_name', label: 'Part Name',          required: true },
  { key: 'room',      label: 'Room' },
  { key: 'material',  label: 'Material' },
  { key: 'width',     label: 'Width' },
  { key: 'height',    label: 'Height' },
  { key: 'depth',     label: 'Depth' },
];

// One entry in the bulk-upload queue. Files are processed sequentially through the
// existing parse-file → map-columns → classify-units pipeline; status drives the UI.
type MultiFileStatus = 'pending' | 'processing' | 'done' | 'error';
type MultiFile = { id: string; file: File; status: MultiFileStatus; error?: string; units?: number };

// Thrown by the batch processor when a lone CSV can't be auto-mapped: instead of
// failing the file, the driver hands off to the manual column mapper (single-file
// fallback). Never thrown when more than one file is in the queue.
class ManualMapNeeded extends Error {
  constructor() { super('manual-map-needed'); this.name = 'ManualMapNeeded'; }
}

// Human-readable file size for the bulk-upload queue rows.
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
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

function DeptPills({ departments }: { departments: string[] | null }) {
  const depts = departments && departments.length ? departments : ['all'];
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {depts.map((d) => (
        <span key={d} style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)' }}>
          {d === 'all' ? 'All Depts' : d}
        </span>
      ))}
    </div>
  );
}

type SopItem = {
  id: string;
  title: string;
  dept: string | null;
  pdf_url: string | null;
  created_at: string;
};

type CraftsmanBuild = {
  id: string;
  worker_name: string;
  clock_in: string;
  clock_out: string | null;
  notes: string | null;
  job_number: string | null;
  total_hours: number | null;
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
  photo_url: string | null;
  created_at: string;
};

type Job = {
  id: string;
  tenant_id: string;
  job_number: string;
  job_name: string | null;
  status: string;
  source?: string | null;
  created_at: string;
  job_path?: string | null;
  client_name?: string | null;
  room_name?: string | null;
  due_date?: string | null;
  install_date?: string | null;
  archived?: boolean | null;
  archived_at?: string | null;
  completed_at?: string | null;
};

// Production pipeline row (Overview)
type PipelineRow = {
  jobNumber: string;
  jobPath: string;
  dueDate: string | null;
  cabinetsTotal: number;
  production: number;   // not_cut | cutting | cut (cut but not yet in assembly)
  craftsman: number;    // units actively being built
  assembly: number;     // in_assembly | flagged
  finishing: number;    // finishing
  done: number;         // complete
  cabinetsCut: number;  // production_status cut+
  splitDepts: string[]; // depts involved in any split units for this job (badge display)
};

type NotificationRow = {
  id: string;
  tenant_id: string;
  target_type: string;
  dept: string | null;
  title: string;
  body: string;
  url: string | null;
  read: boolean;
  created_at: string;
};

type Tab = 'overview' | 'crew' | 'messages' | 'needs' | 'damage' | 'plans' | 'sops' | 'ai' | 'integrations' | 'reports' | 'assembly' | 'craftsman' | 'qc' | 'settings';

type AiMode = 'learn' | 'assist' | 'autonomous';

type AutoSettings = {
  allPaused: boolean;
  autoMessage:     { enabled: boolean; thresholdHours: number };
  autoDamageFlag:  { enabled: boolean };
  autoReorderAlert:{ enabled: boolean; thresholdCount: number };
  dailySummary:    { enabled: boolean; time: string };
};

const DEFAULT_AUTO_SETTINGS: AutoSettings = {
  allPaused: false,
  autoMessage:     { enabled: false, thresholdHours: 2 },
  autoDamageFlag:  { enabled: false },
  autoReorderAlert:{ enabled: false, thresholdCount: 3 },
  dailySummary:    { enabled: false, time: '17:00' },
};

type AutoLogEntry = {
  id: string;
  action_type: string;
  triggered_by: string | null;
  message_sent: string | null;
  created_at: string;
};

type DailyLog = {
  id: string;
  tenant_id: string;
  supervisor_name: string | null;
  responses: Record<string, string>;
  created_at: string;
  date: string;
};

type BriefCard = {
  type: 'alert' | 'watch' | 'info';
  title: string;
  detail: string;
};

type ProactiveFlag = {
  trigger: string;
  action: string;
  severity: 'alert' | 'watch';
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
// Map an uploaded file's extension → the file_type stored on job_drawings.
function detectPlanFileType(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'csv':  return 'csv';
    case 'pdf':  return 'pdf';
    case 'svg':  return 'svg';
    case 'html': return 'html';
    case 'dxf':  return 'dxf';
    case 'xml':  return 'xml';
    case 'xlsx':
    case 'xls':  return 'spreadsheet';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp': return 'image';
    default:     return ext || 'file';
  }
}
// Short relative time for plan-view timestamps ("2 hours ago", "Yesterday").
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days === 1) return 'Yesterday';
  if (days < 30)  return `${days} days ago`;
  return formatDate(iso);
}
// Due-date colour coding: green 7+ · amber 3-6 · red 1-2 · pulsing red overdue
function dueMeta(dateStr: string): { label: string; color: string; overdue: boolean } {
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
  const overdue = days < 0;
  const color = overdue || days <= 2 ? '#F87171' : days <= 6 ? '#FBBF24' : '#34D399';
  const label = overdue ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`;
  return { label, color, overdue };
}
function elapsed(clockIn: string) {
  const ms = Date.now() - new Date(clockIn).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── UI Components ─────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#050608' }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TrialBanner({ days }: { days: number }) {
  // In the last stretch of the trial, switch to a stronger upgrade prompt.
  const urgent = days <= 5;
  return (
    <div style={{ position: 'sticky', top: 52, zIndex: 50, background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.25)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}>
        <b>{days} day{days !== 1 ? 's' : ''}</b> left in trial{urgent ? ' — upgrade now to keep your shop running' : ' —'}
      </span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>
        {urgent ? 'Choose a plan' : 'Upgrade'}
      </Link>
    </div>
  );
}

// Soft, non-alarming banner shown once a partner's extended trial has ended —
// their lifetime discount is now active. Teal, not amber/red.
function PartnerEndedBanner({ discount }: { discount: number }) {
  return (
    <div style={{ position: 'sticky', top: 52, zIndex: 50, background: 'rgba(45,225,201,0.06)', borderBottom: '1px solid rgba(45,225,201,0.25)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
      <span style={{ fontSize: 13, color: 'var(--teal)' }}>
        Your partner trial has ended — your lifetime {discount}% discount is now active
      </span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)', textDecoration: 'underline' }}>View plans</Link>
    </div>
  );
}

function PastDueBanner({ onManage, busy }: { onManage: () => void; busy: boolean }) {
  return (
    <div style={{ position: 'sticky', top: 52, zIndex: 50, background: 'rgba(248,113,113,0.08)', borderBottom: '1px solid rgba(248,113,113,0.3)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      <span style={{ fontSize: 13, color: '#F87171' }}>Payment failed — update billing to continue using InlineIQ</span>
      <button onClick={onManage} disabled={busy} style={{ fontSize: 13, fontWeight: 700, color: '#F87171', background: 'transparent', border: '1px solid rgba(248,113,113,0.4)', borderRadius: 6, padding: '4px 12px', cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Opening…' : 'Update billing'}
      </button>
    </div>
  );
}

function Toast({ msg, error }: { msg: string; error?: boolean }) {
  return (
    <div style={{
      position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
      zIndex: 400, background: error ? '#F87171' : '#34D399',
      color: error ? '#fff' : '#001a0d',
      padding: '12px 24px', borderRadius: 10, fontWeight: 700, fontSize: 14,
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)', whiteSpace: 'nowrap',
    }}>
      {msg}
    </div>
  );
}

// Title-case every word in a string (e.g. "johnson residence" → "Johnson Residence")
function toTitleCase(str: string): string {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase());
}

// Title-case a job path segment-by-segment (e.g. "JOHNSON/kitchen" → "Johnson/Kitchen")
function titleCasePath(path: string): string {
  return path.split('/').map((seg) => toTitleCase(seg.trim())).join('/');
}

// Display label + accent color for a cabinet's assigned department (split badges).
function deptLabel(dept: string | null | undefined): string {
  if (!dept) return '';
  const d = dept.toLowerCase();
  return d.charAt(0).toUpperCase() + d.slice(1);
}
function deptColor(label: string): string {
  switch (label.toLowerCase()) {
    case 'craftsman':  return '#5EEAD4';
    case 'assembly':   return '#60A5FA';
    case 'finishing':  return '#FBBF24';
    case 'production': return '#8BA5A0';
    default:           return '#A78BFA';
  }
}

function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'open').toLowerCase();
  const map: Record<string, { color: string; bg: string }> = {
    open:     { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    pending:  { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
    ordered:  { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)' },
    reviewed: { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
    resolved: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
    received: { color: '#34D399', bg: 'rgba(52,211,153,0.1)' },
    closed:   { color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)' },
  };
  const st = map[s] ?? map.open;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'capitalize', color: st.color, background: st.bg, padding: '3px 8px', borderRadius: 6 }}>
      {s}
    </span>
  );
}

function ActionBtn({ label, color, onClick, disabled }: { label: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 11, fontWeight: 700,
        color, background: 'transparent',
        border: `1px solid ${color}40`,
        borderRadius: 6, padding: '3px 10px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        fontFamily: 'inherit',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = color + '18'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

// ── ShiftTimeline ─────────────────────────────────────────────────────────────

const EVENT_META: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  clock_in:         { color: '#5EEAD4', label: 'Clocked In',        icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  clock_out:        { color: '#5EEAD4', label: 'Clocked Out',       icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  dept_switch:      { color: '#60A5FA', label: 'Dept Switch',       icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg> },
  break_start:      { color: '#FBBF24', label: 'Break Started',     icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg> },
  break_end:        { color: '#FBBF24', label: 'Break Ended',       icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg> },
  part_scanned:     { color: '#34D399', label: 'Part Scanned',      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="17" y2="12"/></svg> },
  damage_reported:  { color: '#F87171', label: 'Damage Reported',   icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
  inventory_logged: { color: '#A78BFA', label: 'Inventory Logged',  icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg> },
  message_sent:     { color: '#8BA5A0', label: 'Message Sent',      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> },
};

function ShiftTimeline({ events, clockRow, loading }: { events: ShiftEvent[] | undefined; clockRow: CrewRow; loading: boolean }) {
  const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (loading) {
    return <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--ink-mute)' }}>Loading timeline…</div>;
  }
  if (!events || events.length === 0) {
    return <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--ink-mute)' }}>No events logged yet for this shift.</div>;
  }

  const breakMins = events
    .filter((e) => e.event_type === 'break_end')
    .reduce((sum, e) => sum + ((e.metadata?.duration_minutes as number) ?? 0), 0);

  const start   = new Date(clockRow.clock_in);
  const end     = new Date();
  const totalMs = end.getTime() - start.getTime();
  const totalM  = Math.floor(totalMs / 60000);
  const netM    = Math.max(0, totalM - breakMins);
  const fmt = (m: number) => { const h = Math.floor(m / 60); const min = m % 60; return h > 0 ? `${h}h ${String(min).padStart(2,'0')}m` : `${min}m`; };

  return (
    <div style={{ paddingTop: 10 }}>
      {events.map((ev, i) => {
        const meta = EVENT_META[ev.event_type] ?? { color: '#8BA5A0', label: ev.event_type, icon: null };
        return (
          <div key={ev.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-mute)', minWidth: 62, flexShrink: 0, paddingTop: 2 }}>
              {fmtTime(ev.created_at)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, gap: 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${meta.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color, flexShrink: 0 }}>
                {meta.icon}
              </div>
              {i < events.length - 1 && <div style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.07)', margin: '2px 0' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</span>
              {ev.event_type === 'clock_in' && ev.dept && (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6 }}>{ev.dept}</span>
              )}
              {ev.event_type === 'dept_switch' && ev.previous_dept && (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6 }}>{ev.previous_dept} to {ev.dept}</span>
              )}
              {ev.event_type === 'break_end' && (ev.metadata?.duration_minutes as number) > 0 && (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6 }}>{ev.metadata.duration_minutes as number} min</span>
              )}
              {ev.event_type === 'part_scanned' && typeof ev.metadata?.cabinet_unit_label === 'string' && (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6 }}>
                  {ev.metadata.cabinet_unit_label}
                  {typeof ev.metadata.job_number === 'string' ? `, Job ${ev.metadata.job_number}` : ''}
                </span>
              )}
              {ev.event_type === 'inventory_logged' && typeof ev.metadata?.item === 'string' && (
                <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginLeft: 6 }}>{ev.metadata.item}</span>
              )}
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 6, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'var(--ink-mute)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span>Total: {fmt(totalM)}</span>
        {breakMins > 0 && <><span>Break: {fmt(breakMins)}</span><span>Productive: {fmt(netM)}</span></>}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupervisorPage() {
  const { loading: sessionLoading, tenant, email } = useSession();

  // Trust token gate — redirect to PIN if device is not trusted. Runs on mount,
  // before the rest of the dashboard hydrates. The "I'm Supervisor" card already
  // routes through the PIN page; this guards direct navigation / bookmarks.
  useEffect(() => {
    void (async () => {
      try {
        const tenantId = localStorage.getItem('sup_last_tenant');
        const deviceId = localStorage.getItem('sup_device_id');
        const trustKey = tenantId ? `sup_trust_${tenantId}` : null;
        const token = trustKey ? localStorage.getItem(trustKey) : null;
        if (tenantId && deviceId && token) {
          const res = await fetch('/app/api/supervisor-auth', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ tenantId, action: 'check-token', token, deviceId }),
          });
          const { ok } = await res.json() as { ok: boolean };
          if (!ok) {
            window.location.replace('/app/supervisor-pin');
            return;
          }
        } else if (!tenantId) {
          window.location.replace('/app/supervisor-pin');
          return;
        }
      } catch { /* fall through — let normal auth handle it */ }
    })();
  }, []);

  // Persist the tenant id so the trust gate (above) can resolve the trust-token
  // key on future loads / direct navigation.
  useEffect(() => {
    if (!tenant) return;
    try { localStorage.setItem('sup_last_tenant', tenant.id); } catch { /* ignore */ }
  }, [tenant]);

  const [tab,         setTab]         = useState<Tab>('overview');
  const [activeCrew,  setActiveCrew]  = useState<CrewRow[]>([]);
  // Paused projects keyed by worker_name — amber indicator under each active crew row.
  const [pausedProjects, setPausedProjects] = useState<Record<string, ActiveProject>>({});
  const [messages,    setMessages]    = useState<Message[]>([]);
  const [needs,       setNeeds]       = useState<InventoryNeed[]>([]);
  const [damage,       setDamage]       = useState<DamageReport[]>([]);
  const [plans,          setPlans]          = useState<JobDrawing[]>([]);
  const [sops,           setSops]           = useState<SopItem[]>([]);
  const [craftsmanBuilds, setCraftsmanBuilds] = useState<CraftsmanBuild[]>([]);
  const [craftsTick,     setCraftsTick]     = useState(0);
  const [parts,          setParts]          = useState<PartLog[]>([]);
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);
  const [updatingPartId, setUpdatingPartId] = useState<string | null>(null);
  const [nextDeptFor,    setNextDeptFor]    = useState<Record<string, string>>({});
  const [jobs,           setJobs]           = useState<Job[]>([]);
  // job_number → accumulated labor cost (supervisor-only: pay rates fetched here,
  // never on a crew query). Only populated for jobs with a rated worker + hours.
  const [laborByJob,     setLaborByJob]     = useState<Record<string, number>>({});
  // Overview Active Jobs — only one row expanded at a time.
  const [expandedJobId,  setExpandedJobId]  = useState<string | null>(null);
  // Job completion / archive (Overview)
  const [completeJobTarget, setCompleteJobTarget] = useState<Job | null>(null);
  const [completingJob,     setCompletingJob]     = useState(false);
  const [archiveOpen,       setArchiveOpen]       = useState(false);
  const [deleteArchiveTarget, setDeleteArchiveTarget] = useState<Job | null>(null);
  const [finishSpecsJob, setFinishSpecsJob] = useState<Job | null>(null);

  // Production pipeline (Overview)
  const [pipeline, setPipeline] = useState<PipelineRow[]>([]);
  // Overview Production Pipeline: which job row is expanded to its part-level
  // drill-down (one at a time; tap again to collapse).
  const [expandedJob, setExpandedJob] = useState<string | null>(null);

  // Active craftsman unit count — drives the Craftsman tab badge. Kept at page
  // level (not inside the tab) so the badge shows even when the tab is inactive,
  // and refreshed in realtime as units are assigned / completed.
  const [craftsmanCount, setCraftsmanCount] = useState(0);
  const [qcCount, setQcCount] = useState(0);

  // Notification center (header bell)
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notifOpen,      setNotifOpen]    = useState(false);

  // Plans upload
  const [planFile,      setPlanFile]      = useState<File | null>(null);
  const [planDropHover, setPlanDropHover] = useState(false);
  const [planJobNum,    setPlanJobNum]    = useState('');   // resolved job_number for the upload
  // Job/Project smart selector: '' = none · '__new__' = create · else a jobs.id
  const [planJobId,     setPlanJobId]     = useState<string>('');
  const [planJobQuery,  setPlanJobQuery]  = useState('');   // text shown in the selector input
  const [planJobOpen,   setPlanJobOpen]   = useState(false);
  const [planNewClient, setPlanNewClient] = useState('');   // create-new: Client Name (required)
  const [planNewRoom,   setPlanNewRoom]   = useState('');   // create-new: Room/Area (optional)
  // Carries the resolved job context through the version-conflict prompt.
  const [pendingJobCtx, setPendingJobCtx] = useState<{ jobNumber: string; jobPath: string | null } | null>(null);
  const [planLabel,     setPlanLabel]     = useState('');
  const [planUploading, setPlanUploading] = useState(false);
  const [planDepts,     setPlanDepts]     = useState<string[]>(['all']);
  // Version-conflict prompt when a plan with the same job + name already exists.
  const [versionConflict, setVersionConflict] = useState<JobDrawing | null>(null);
  // Per-plan "viewed by" expansion + cached view rows (Crew Viewed Confirmation).
  const [expandedViewsId, setExpandedViewsId] = useState<string | null>(null);
  const [planViews,       setPlanViews]       = useState<Record<string, { viewer_name: string; viewed_at: string }[]>>({});
  const [crewRoster,      setCrewRoster]      = useState<string[]>([]);

  // Plans CSV → cabinet_units + parts mapper
  const [planCsvHeaders,      setPlanCsvHeaders]      = useState<string[]>([]);
  const [planCsvRows,         setPlanCsvRows]         = useState<CsvRow[]>([]);
  const [planColumnMap,       setPlanColumnMap]       = useState<Record<string, string>>({ unit_id: '', part_name: '', room: '', material: '', width: '', height: '', depth: '' });
  const [planPendingId,       setPlanPendingId]       = useState<string | null>(null);
  const [planPendingJobNum,   setPlanPendingJobNum]   = useState<string>('');
  const [planParsing,         setPlanParsing]         = useState(false);
  // AI auto-detection of CSV columns
  const [planAiMapped,        setPlanAiMapped]        = useState(false);   // show "AI mapped…" banner
  const [planAiMissing,       setPlanAiMissing]       = useState<string[]>([]); // required keys AI couldn't map
  const [planCountdown,       setPlanCountdown]       = useState<number | null>(null); // auto-submit countdown

  // Bulk (multi-file) upload — sequential queue, processed non-interactively.
  const [multiQueue,      setMultiQueue]      = useState<MultiFile[]>([]);
  const [multiProcessing, setMultiProcessing] = useState(false);
  const [multiCurrentIdx, setMultiCurrentIdx] = useState(0);            // 1-based index shown in "Processing N of M"
  const [multiDropHover,  setMultiDropHover]  = useState(false);
  const [multiSummary,    setMultiSummary]    = useState<{ files: number; units: number; jobs: number; failed: number } | null>(null);

  // SOPs upload
  const [sopFile,       setSopFile]       = useState<File | null>(null);
  const [sopTitle,      setSopTitle]      = useState('');
  const [sopDept,       setSopDept]       = useState('');
  const [sopUploading,  setSopUploading]  = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  // Per-row action loading — track by id
  const [actioning, setActioning] = useState<Record<string, boolean>>({});

  // Message compose
  const [msgBody,    setMsgBody]    = useState('');
  const [msgDept,    setMsgDept]    = useState('');
  const [sending,    setSending]    = useState(false);
  const [hoverThread, setHoverThread] = useState<string | null>(null);
  // Inbox "New Message" composer + in-conversation three-dot menu.
  const [composeOpen, setComposeOpen] = useState(false);
  const [convMenuOpen, setConvMenuOpen] = useState(false);
  // Mark every unread crew message in a thread as read in Supabase (persists across
  // devices/sessions). Optimistically clears them locally so the counter drops instantly;
  // realtime UPDATE events keep other open sessions in sync.
  async function markThreadRead(key: string) {
    const dept = key === '__broadcast__' ? null : key;
    const unread = messages.filter(
      (m) => (m.dept ?? '__broadcast__') === key && m.sender_name !== 'Supervisor' && !m.read_at,
    );
    if (unread.length === 0) return;
    const now = new Date().toISOString();
    const ids = new Set(unread.map((m) => m.id));
    setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, read_at: now } : m)));
    if (!tenant) return;
    try {
      let q = supabase
        .from('messages')
        .update({ read_at: now })
        .eq('tenant_id', tenant.id)
        .neq('sender_name', 'Supervisor')
        .is('read_at', null);
      q = dept === null ? q.is('dept', null) : q.eq('dept', dept);
      await q;
    } catch { /* optimistic update already applied; realtime will reconcile */ }
  }

  // ── Clock-in/out request resolution ─────────────────────────────────────────
  // Approve/deny a crew clock adjustment request (topic = clock_*_request).
  // Approve → record at the requested time; Deny → record at the current time.
  // Either way we reply to the crew member, mark the request read, and stamp the
  // payload status so the action card flips to a resolved state.
  const [resolvingReq, setResolvingReq] = useState<string | null>(null);

  async function replyToCrew(dept: string | null, body: string) {
    if (!tenant) return;
    try {
      const { data } = await supabase.from('messages').insert({
        sender_name: 'Supervisor', dept, body, tenant_id: tenant.id,
      }).select('id, sender_name, dept, body, created_at, read_at, topic, payload').single();
      if (data) setMessages((prev) => prev.some((m) => m.id === (data as Message).id) ? prev : [data as Message, ...prev]);
      sendNotify({
        tenant_id: tenant.id, target: 'crew',
        ...(dept ? { dept_target: dept } : {}),
        title: 'Clock update', body, url: '/app/crew',
      });
    } catch { /* best-effort reply */ }
  }

  async function resolveClockRequest(m: Message, approve: boolean) {
    if (!tenant || !m.payload || resolvingReq) return;
    const p = m.payload;
    const isClockIn = m.topic === 'clock_in_request';
    const nowISO = new Date().toISOString();
    setResolvingReq(m.id);
    try {
      if (isClockIn) {
        const clockInTime = approve ? p.requested_time : nowISO;
        const { error } = await supabase.from('time_clock').insert({
          worker_name: p.worker_name,
          dept: p.dept,
          clock_in: clockInTime,
          clock_out: null,
          date: clockInTime.split('T')[0],
          status: 'active',
          tenant_id: tenant.id,
        });
        if (error) throw error;
        await replyToCrew(p.dept, approve
          ? `Clock-in approved for ${formatTime(clockInTime)}`
          : `Clock-in request denied — clocked in at current time ${formatTime(nowISO)}`);
      } else {
        const clockOutTime = approve ? p.requested_time : nowISO;
        const clockInRef = p.clock_in ?? null;
        const totalHours = clockInRef
          ? (new Date(clockOutTime).getTime() - new Date(clockInRef).getTime()) / 3_600_000
          : null;
        if (p.shift_id) {
          const { error } = await supabase.from('time_clock').update({
            clock_out: clockOutTime,
            on_break: false,
            ...(totalHours != null ? { total_hours: Math.round(totalHours * 10000) / 10000 } : {}),
          }).eq('id', p.shift_id);
          if (error) throw error;
        }
        await replyToCrew(p.dept, approve
          ? `Clock-out approved for ${formatTime(clockOutTime)}`
          : `Clock-out request denied — clocked out at current time ${formatTime(nowISO)}`);
      }
      const newPayload: ClockRequestPayload = { ...p, status: approve ? 'approved' : 'denied' };
      await supabase.from('messages').update({ read_at: nowISO, payload: newPayload }).eq('id', m.id);
      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, read_at: nowISO, payload: newPayload } : x));
      showToast(approve ? 'Approved' : 'Denied');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not resolve request', true);
    } finally {
      setResolvingReq(null);
    }
  }

  // Message thread view — null = inbox, string = dept key ('__broadcast__' for null-dept)
  const [openThread, setOpenThread] = useState<string | null>(null);

  // ── AI tab ──────────────────────────────────────────────────────────────────
  const [aiMode,       setAiMode]       = useState<AiMode>('learn');
  const [autoSettings, setAutoSettings] = useState<AutoSettings>(DEFAULT_AUTO_SETTINGS);
  const [autoLog,      setAutoLog]      = useState<AutoLogEntry[]>([]);
  const [dailyLogs,    setDailyLogs]    = useState<DailyLog[]>([]);
  const [todayLog,     setTodayLog]     = useState<DailyLog | null>(null);
  const [editingLog,   setEditingLog]   = useState(false);
  const [savingLog,    setSavingLog]    = useState(false);
  const [logForm,      setLogForm]      = useState({
    production_rating: '3',
    production_comment: '',
    crew_issues: '',
    material_costs_flag: 'no',
    material_costs_detail: '',
    time_variance: '',
    biggest_challenge: '',
    additional_comments: '',
  });
  const [brief,        setBrief]        = useState<BriefCard[] | null>(null);
  const [briefTs,      setBriefTs]      = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError,   setBriefError]   = useState<string | null>(null);
  const briefAutoRun   = useRef(false);

  // Universal file viewer (Part 2) + job search routing (Part 1)
  const [viewerFile, setViewerFile] = useState<ViewerFile | null>(null);
  const handleSearchSelect = useCallback((t: SearchTarget) => {
    if (t.kind === 'file') {
      setViewerFile({ url: t.url, name: t.name, fileType: t.fileType, parsed: t.parsed, jobPath: t.jobPath ?? undefined });
    } else if (t.kind === 'cutlist' || t.kind === 'drawings' || t.kind === 'job') {
      setTab('plans');
    } else if (t.kind === 'cabinet') {
      setTab('assembly');
    }
  }, []);

  // Damage filter tab
  const [damageFilter, setDamageFilter] = useState<'all' | 'damage' | 'change_order' | 'missing' | 'wrong_part'>('all');

  // Resolution modal
  const [resolvingId,   setResolvingId]   = useState<string | null>(null);
  const [resType,       setResType]       = useState('Repaired in shop');
  const [resNotes,      setResNotes]      = useState('');
  const [resBy,         setResBy]         = useState('Supervisor');
  const [resCost,       setResCost]       = useState('');
  // "Replace Part" routing — where a Finishing/Assembly part returns to.
  const [resReturnDept, setResReturnDept] = useState('Production');
  const [resSubmitting, setResSubmitting] = useState(false);
  const [moreOpen,         setMoreOpen]         = useState(false);
  const [expandedCrewId,   setExpandedCrewId]   = useState<string | null>(null);
  const [crewTimelines,    setCrewTimelines]     = useState<Record<string, ShiftEvent[]>>({});
  const [timelineLoading,  setTimelineLoading]  = useState<Record<string, boolean>>({});
  const [wizardVisible, setWizardVisible] = useState(false);
  const wizardChecked = useRef(false);

  // Supervisor inventory form
  const [supInvItem,    setSupInvItem]    = useState('');
  const [supInvDept,    setSupInvDept]    = useState('Production');
  const [supInvQty,     setSupInvQty]     = useState(1);
  const [supInvJobNum,  setSupInvJobNum]  = useState('');
  const [supInvNotes,   setSupInvNotes]   = useState('');
  const [supInvSaving,  setSupInvSaving]  = useState(false);
  const [showResolvedNeeds, setShowResolvedNeeds] = useState(false);

  // Supervisor damage form
  const [supDmgDesc,    setSupDmgDesc]    = useState('');
  const [supDmgDept,    setSupDmgDept]    = useState('Production');
  const [supDmgJobNum,  setSupDmgJobNum]  = useState('');
  const [supDmgPhoto,   setSupDmgPhoto]   = useState<File | null>(null);
  const [supDmgPreview, setSupDmgPreview] = useState<string | null>(null);
  const [supDmgSaving,  setSupDmgSaving]  = useState(false);

  // Toast
  const [toast,     setToast]     = useState<{ msg: string; error?: boolean } | null>(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Departments (Settings tab) ───────────────────────────────────────────────
  // `departments` is the committed list every dropdown reads from. `deptDraft`
  // is the editable buffer in the Settings tab, persisted on Save.
  const [departments, setDepartments] = useState<string[]>([]);
  const [deptDraft,   setDeptDraft]   = useState<string[]>([]);
  const [deptInput,   setDeptInput]   = useState('');
  const [deptErr,     setDeptErr]     = useState('');
  const [deptSaving,  setDeptSaving]  = useState(false);

  useEffect(() => {
    if (!tenant) return;
    const d = getDepartments(tenant);
    setDepartments(d);
    setDeptDraft(d);
  }, [tenant]);

  const deptDirty = JSON.stringify(deptDraft) !== JSON.stringify(departments);

  function addDeptToDraft() {
    const v = deptInput.trim();
    if (!v) { setDeptErr('Enter a department name'); return; }
    if (v.length > 20) { setDeptErr('Max 20 characters'); return; }
    if (deptDraft.some((d) => d.toLowerCase() === v.toLowerCase())) { setDeptErr('That department already exists'); return; }
    setDeptDraft((prev) => [...prev, v]);
    setDeptInput(''); setDeptErr('');
  }

  async function saveDepartments() {
    if (!tenant || deptSaving) return;
    const cleaned = deptDraft.map((d) => d.trim()).filter(Boolean);
    if (cleaned.length === 0) { setDeptErr('Keep at least one department'); return; }
    setDeptSaving(true);
    try {
      const { error } = await supabase.from('tenants').update({ departments: cleaned }).eq('id', tenant.id);
      if (error) throw error;
      setDepartments(cleaned);
      setDeptDraft(cleaned);
      showToast('Departments saved');
    } catch (_) {
      showToast('Could not save departments', true);
    } finally {
      setDeptSaving(false);
    }
  }

  // ── Data load ───────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!tenant) return;
    try {
      const [crewRes, msgRes, needsRes, damageRes] = await Promise.all([
        supabase.from('time_clock').select('id, worker_name, dept, clock_in, status, current_dept, on_break, total_break_minutes').eq('tenant_id', tenant.id).is('clock_out', null).order('clock_in', { ascending: true }),
        supabase.from('messages').select('id, sender_name, dept, body, created_at, read_at, topic, payload').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('inventory_needs').select('id, item, dept, job_number, qty, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('damage_reports').select('id, part_name, job_id, dept, notes, photo_url, status, created_at, resolution_type, resolution_notes, resolved_by, resolution_cost, resolved_at, report_type').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (crewRes.data) {
        // A worker can have more than one open time_clock row (e.g. a normal
        // clock-in plus a craftsman build). Keep only the most recent open row per
        // worker so Active Crew shows each person once, under their current dept.
        const deduped = Object.values(
          (crewRes.data as CrewRow[]).reduce((acc, row) => {
            const existing = acc[row.worker_name];
            if (!existing || new Date(row.clock_in) > new Date(existing.clock_in)) acc[row.worker_name] = row;
            return acc;
          }, {} as Record<string, CrewRow>),
        );
        setActiveCrew(deduped);
      }
      if (msgRes.data)    setMessages(msgRes.data as Message[]);
      if (needsRes.data)  setNeeds(needsRes.data as InventoryNeed[]);
      if (damageRes.data) setDamage(damageRes.data as DamageReport[]);
    } catch (_) {}
    try {
      const { data: pausedRows } = await supabase
        .from('crew_active_projects')
        .select('id, tenant_id, worker_name, dept, cabinet_unit_id, unit_label, job_number, time_clock_id, session_start, accumulated_seconds, status')
        .eq('tenant_id', tenant.id).eq('status', 'paused');
      const map: Record<string, ActiveProject> = {};
      ((pausedRows as ActiveProject[] | null) ?? []).forEach((p) => { map[p.worker_name] = p; });
      setPausedProjects(map);
    } catch (_) { /* table optional until migration runs */ }
    try {
      const [plansRes, sopsRes, buildsRes, partsRes, jobsRes] = await Promise.all([
        supabase.from('job_drawings').select(JOB_DRAWING_COLS).eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('sops').select('id, title, dept, pdf_url, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('time_clock').select('id, worker_name, clock_in, clock_out, notes, job_number, total_hours').eq('tenant_id', tenant.id).eq('status', 'craftsman_build').order('clock_in', { ascending: false }).limit(50),
        supabase.from('parts_log').select('*').eq('tenant_id', tenant.id).not('status', 'in', '("Archived")').order('created_at', { ascending: false }).limit(100),
        supabase.from('jobs').select('*').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200),
      ]);
      if (plansRes.data)  setPlans(plansRes.data as JobDrawing[]);
      if (sopsRes.data)   setSops(sopsRes.data as SopItem[]);
      if (buildsRes.data) setCraftsmanBuilds(buildsRes.data as CraftsmanBuild[]);
      if (partsRes.data)  setParts(partsRes.data as PartLog[]);
      if (jobsRes.data)   setJobs(jobsRes.data as Job[]);
    } catch (_) {}
    try {
      const today        = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
      const { data: logData } = await supabase
        .from('ai_daily_logs')
        .select('*')
        .eq('tenant_id', tenant.id)
        .gte('date', sevenDaysAgo)
        .order('date', { ascending: false });
      if (logData) {
        setDailyLogs(logData as DailyLog[]);
        const tl = (logData as DailyLog[]).find((l) => l.date === today) ?? null;
        setTodayLog(tl);
        if (tl) setLogForm(tl.responses as typeof logForm);
      }
    } catch (_) {}
    try {
      const { data: logEntries } = await supabase
        .from('ai_autonomous_log')
        .select('id, action_type, triggered_by, message_sent, created_at')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (logEntries) setAutoLog(logEntries as AutoLogEntry[]);
    } catch (_) {}
    setDataLoading(false);
  }, [tenant]);

  // ── Production pipeline loader ─────────────────────────────────────────────
  const loadPipeline = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data: cabs } = await supabase
        .from('cabinet_units')
        .select('job_number, status, is_split, assigned_dept')
        .eq('tenant_id', tenant.id)
        .limit(5000);
      const rows = (cabs as { job_number: string | null; status: string | null; is_split?: boolean | null; assigned_dept?: string | null }[]) ?? [];
      if (rows.length === 0) { setPipeline([]); return; }

      // Archived jobs never appear in the pipeline.
      const archivedJobNums = new Set<string>();
      try {
        const { data: aj } = await supabase.from('jobs').select('job_number, archived').eq('tenant_id', tenant.id);
        ((aj as { job_number: string; archived?: boolean | null }[]) ?? []).forEach((j) => { if (j.archived) archivedJobNums.add(j.job_number); });
      } catch (_) { /* archived column may not exist yet */ }

      // job_number → { job_path, due_date } (best-effort)
      const jobMeta: Record<string, { jobPath: string; dueDate: string | null }> = {};
      try {
        const { data: jrows } = await supabase
          .from('jobs').select('job_number, job_path, due_date, status')
          .eq('tenant_id', tenant.id).eq('status', 'active').limit(500);
        ((jrows as { job_number: string; job_path: string | null; due_date: string | null }[]) ?? []).forEach((j) => {
          jobMeta[j.job_number] = { jobPath: j.job_path || j.job_number, dueDate: j.due_date ?? null };
        });
      } catch (_) {}

      // assigned_dept is the single source of truth for which dept a cabinet sits
      // in. Terminal cabinet statuses (ready_for_qc / complete) take precedence.
      const byJob: Record<string, PipelineRow> = {};
      rows.forEach((c) => {
        const jn = c.job_number ?? 'unassigned';
        if (c.job_number && archivedJobNums.has(c.job_number)) return;
        const meta = jobMeta[jn];
        const rawPath = meta?.jobPath || jn;          // no "Job " prefix
        const key = rawPath.toLowerCase();            // group by lowercased path → merges case duplicates
        const row = (byJob[key] ??= { jobNumber: jn, jobPath: titleCasePath(rawPath), dueDate: meta?.dueDate ?? null, cabinetsTotal: 0, production: 0, craftsman: 0, assembly: 0, finishing: 0, done: 0, cabinetsCut: 0, splitDepts: [] });
        row.cabinetsTotal++;
        const dept = (c.assigned_dept ?? 'production').toLowerCase();
        if (c.status === 'complete' || dept === 'complete') row.done++;
        else if (c.status === 'ready_for_qc' || c.status === 'in_assembly' || c.status === 'flagged' || dept === 'assembly' || dept === 'qc') row.assembly++;
        else if (dept === 'finishing' || c.status === 'finishing') row.finishing++;
        else if (dept === 'craftsman') row.craftsman++;
        else row.production++;
        // Track the depts a split touches so the row can badge them (e.g. [Craftsman] [Assembly]).
        if (c.is_split) {
          const label = deptLabel(c.assigned_dept);
          if (label && !row.splitDepts.includes(label)) row.splitDepts.push(label);
        }
      });
      // "Cut" = cabinets that have left production for a downstream dept.
      Object.values(byJob).forEach((r) => { r.cabinetsCut = r.craftsman + r.assembly + r.finishing + r.done; });
      setPipeline(Object.values(byJob).sort((a, b) => {
        const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
        const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
        return ad - bd;
      }));
    } catch (_) { /* column may not exist until migrations run */ }
  }, [tenant]);

  useEffect(() => { void loadPipeline(); }, [loadPipeline]);

  // ── Craftsman tab badge count (active units, realtime) ─────────────────────
  // Counts active cabinets assigned to craftsman OR owning a craftsman part
  // (splits), deduped — mirrors what the Craftsman tab actually shows.
  const loadCraftsmanCount = useCallback(async () => {
    if (!tenant) return;
    try {
      const [assignedRes, partRes] = await Promise.all([
        supabase.from('cabinet_units').select('id, status').eq('tenant_id', tenant.id).eq('assigned_dept', 'craftsman').neq('status', 'complete'),
        supabase.from('parts').select('cabinet_unit_id').eq('tenant_id', tenant.id).eq('assigned_dept', 'craftsman'),
      ]);
      const active = new Set<string>();
      ((assignedRes.data as { id: string }[] | null) ?? []).forEach((u) => active.add(u.id));
      const partCabIds = Array.from(new Set(((partRes.data as { cabinet_unit_id: string | null }[] | null) ?? []).map((p) => p.cabinet_unit_id).filter(Boolean))) as string[];
      const extraIds = partCabIds.filter((id) => !active.has(id));
      if (extraIds.length > 0) {
        const { data: extra } = await supabase.from('cabinet_units').select('id, status').eq('tenant_id', tenant.id).in('id', extraIds).neq('status', 'complete');
        ((extra as { id: string }[] | null) ?? []).forEach((u) => active.add(u.id));
      }
      setCraftsmanCount(active.size);
    } catch (_) { /* table/column may not exist until migrations run */ }
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void loadCraftsmanCount();
    const ch = supabase
      .channel('rt-sup-craftsman-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenant.id}` }, () => { void loadCraftsmanCount(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `tenant_id=eq.${tenant.id}` }, () => { void loadCraftsmanCount(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant, loadCraftsmanCount]);

  // QC queue badge — cabinets crew have sent to QC.
  const loadQcCount = useCallback(async () => {
    if (!tenant) return;
    try {
      const { count } = await supabase.from('cabinet_units')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenant.id).eq('status', 'ready_for_qc');
      setQcCount(count ?? 0);
    } catch { /* best-effort */ }
  }, [tenant]);
  useEffect(() => {
    if (!tenant) return;
    void loadQcCount();
    const ch = supabase
      .channel('rt-sup-qc-count')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenant.id}` }, () => { void loadQcCount(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant, loadQcCount]);

  // ── Notification center ─────────────────────────────────────────────────────
  const loadNotifications = useCallback(async () => {
    if (!tenant) return;
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('tenant_id', tenant.id)
        .in('target_type', ['supervisor', 'all'])
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(100);
      if (data) setNotifications(data as NotificationRow[]);
    } catch (_) { /* table may not exist until migration runs */ }
  }, [tenant]);

  useEffect(() => {
    if (!tenant) return;
    void loadNotifications();
    const ch = supabase
      .channel('rt-sup-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `tenant_id=eq.${tenant.id}` }, () => { void loadNotifications(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenant, loadNotifications]);

  const notifUnread = notifications.filter((n) => !n.read).length;

  async function markNotificationRead(n: NotificationRow) {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x));
      try { await supabase.from('notifications').update({ read: true }).eq('id', n.id); } catch (_) {}
    }
    if (n.url) { setNotifOpen(false); window.location.href = n.url; }
  }

  async function markAllNotificationsRead() {
    if (!tenant) return;
    if (!notifications.some((n) => !n.read)) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    // Clear every unread notification for this tenant (not just the loaded page).
    try { await supabase.from('notifications').update({ read: true }).eq('tenant_id', tenant.id).eq('read', false); } catch (_) {}
  }

  // ── Labor cost per job (Overview) ───────────────────────────────────────────
  // Sums hours × hourly_rate per job_number. Pay rates are supervisor-only, so
  // this query runs only on the supervisor page. Best-effort, tenant-scoped.
  useEffect(() => {
    if (!tenant) return;
    let cancelled = false;
    (async () => {
      try {
        const [tcRes, cmRes] = await Promise.all([
          supabase.from('time_clock')
            .select('worker_name, job_number, total_hours, clock_in, clock_out')
            .eq('tenant_id', tenant.id).not('job_number', 'is', null).limit(5000),
          supabase.from('crew_members')
            .select('name, hourly_rate').eq('tenant_id', tenant.id),
        ]);
        if (cancelled) return;
        const rates: Record<string, number> = {};
        ((cmRes.data as { name: string | null; hourly_rate: number | null }[]) ?? []).forEach((r) => {
          if (r.name && r.hourly_rate != null) rates[r.name.toLowerCase()] = r.hourly_rate;
        });
        const byJob: Record<string, number> = {};
        ((tcRes.data as { worker_name: string | null; job_number: string | null; total_hours: number | null; clock_in: string; clock_out: string | null }[]) ?? []).forEach((e) => {
          if (!e.job_number || !e.worker_name) return;
          const rate = rates[e.worker_name.toLowerCase()];
          if (rate == null) return; // only rated workers contribute
          const hours = e.total_hours ?? (e.clock_out ? Math.max(0, (new Date(e.clock_out).getTime() - new Date(e.clock_in).getTime()) / 3_600_000) : 0);
          if (hours <= 0) return;
          byJob[e.job_number] = (byJob[e.job_number] ?? 0) + hours * rate;
        });
        setLaborByJob(byJob);
      } catch (_) { /* best-effort — overview labor is optional */ }
    })();
    return () => { cancelled = true; };
  }, [tenant]);

  // ── AI handlers ────────────────────────────────────────────────────────────

  const generateBrief = useCallback(async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const cutoff24h     = new Date(Date.now() - 86400000).toISOString();
      const recentMsgs    = messages.filter((m) => m.created_at >= cutoff24h);
      const openNeedsNow  = needs.filter((n) => !['resolved', 'closed', 'received', 'cancelled'].includes((n.status ?? 'open').toLowerCase()));
      const openDamageNow = damage.filter((d) => !['resolved', 'closed'].includes((d.status ?? 'open').toLowerCase()));
      const res = await fetch('/app/api/ai-brief', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          crew:     activeCrew,
          needs:    openNeedsNow,
          damage:   openDamageNow,
          messages: recentMsgs,
          builds:   craftsmanBuilds,
          logs:     dailyLogs,
          tenantId: tenant?.id,
        }),
      });
      const data = await res.json() as { insights?: BriefCard[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setBrief(data.insights ?? []);
      setBriefTs(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
    } catch (err: unknown) {
      setBriefError(err instanceof Error ? err.message : 'Failed to generate brief');
    } finally {
      setBriefLoading(false);
    }
  }, [activeCrew, needs, damage, messages, craftsmanBuilds, dailyLogs]);

  async function handleSaveDailyLog() {
    if (!tenant) return;
    setSavingLog(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      if (todayLog) {
        const { data, error } = await supabase
          .from('ai_daily_logs')
          .update({ responses: logForm, supervisor_name: email })
          .eq('id', todayLog.id)
          .select()
          .single();
        if (error) throw error;
        setTodayLog(data as DailyLog);
        setDailyLogs((prev) => prev.map((l) => l.id === todayLog.id ? data as DailyLog : l));
      } else {
        const { data, error } = await supabase
          .from('ai_daily_logs')
          .insert({ tenant_id: tenant.id, supervisor_name: email, responses: logForm, date: today })
          .select()
          .single();
        if (error) throw error;
        setTodayLog(data as DailyLog);
        setDailyLogs((prev) => [data as DailyLog, ...prev]);
      }
      setEditingLog(false);
      showToast('Check-in saved');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Save failed', true);
    } finally {
      setSavingLog(false);
    }
  }

  // Load / persist autonomous settings in localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai_auto_settings');
      if (stored) setAutoSettings(JSON.parse(stored) as AutoSettings);
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('ai_auto_settings', JSON.stringify(autoSettings)); } catch {}
  }, [autoSettings]);

  // AI mode is stored on the tenant (DB) so the crew PWA — a different device
  // with no access to this browser's localStorage — can gate push suggestions.
  useEffect(() => {
    const m = (tenant as { ai_mode?: AiMode } | null)?.ai_mode;
    if (m === 'learn' || m === 'assist' || m === 'autonomous') setAiMode(m);
  }, [tenant]);
  const changeAiMode = useCallback((m: AiMode) => {
    setAiMode(m);
    const t = tenant;
    if (!t) return;
    void supabase.from('tenants').update({ ai_mode: m }).eq('id', t.id).then(() => {}, () => {});
  }, [tenant]);

  // Auto-generate brief once when AI/Assist tab is first opened this session
  useEffect(() => {
    if (tab === 'ai' && aiMode === 'assist' && !brief && !briefLoading && !briefAutoRun.current) {
      briefAutoRun.current = true;
      void generateBrief();
    }
  }, [tab, aiMode, brief, briefLoading, generateBrief]);

  // Tick every minute to refresh elapsed times in Craftsman Activity panel
  useEffect(() => {
    const iv = setInterval(() => setCraftsTick((t) => t + 1), 60000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Setup wizard check ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenant || wizardChecked.current) return;
    if (tenant.setup_complete) { wizardChecked.current = true; return; }
    wizardChecked.current = true;
    (async () => {
      const [{ count: jobCount }, { count: clockCount }] = await Promise.all([
        supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
        supabase.from('time_clock').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.id),
      ]);
      if ((jobCount ?? 0) === 0 && (clockCount ?? 0) === 0) setWizardVisible(true);
    })();
  }, [tenant]);

  // ── Trial-expiring push (day 25 → 5 left, day 28 → 2 left) ──────────────────
  // Fires at most once per day per threshold (localStorage last_trial_notification).
  useEffect(() => {
    // Only nag *free* trials to upgrade — a paid subscriber inside their trial
    // window has already converted and must not get "upgrade now" pushes.
    if (!tenant || tenant.subscription_status !== 'trial' || isPaidPlan(tenant.plan ?? null)) return;
    const d = trialDaysLeft(tenant.trial_ends_at ?? null);
    let note: { title: string; body: string } | null = null;
    if (d === 5) note = { title: 'Trial ends in 5 days', body: 'Upgrade to keep your shop running on InlineIQ' };
    else if (d === 2) note = { title: 'Trial ends in 2 days', body: "Don't lose your shop data — upgrade now" };
    if (!note) return;
    const today = new Date().toISOString().slice(0, 10);
    const stamp = `${today}:${d}`;
    try {
      if (localStorage.getItem('last_trial_notification') === stamp) return;
      localStorage.setItem('last_trial_notification', stamp);
    } catch { /* ignore */ }
    sendNotify({ tenant_id: tenant.id, target: 'supervisor', title: note.title, body: note.body, url: '/pricing' });
  }, [tenant]);

  // ── Job-due-soon push (exactly 3 days out) ──────────────────────────────────
  // Fires once per job per day (localStorage notified_jobs map: jobId → date).
  useEffect(() => {
    if (!tenant || jobs.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    let notified: Record<string, string> = {};
    try { notified = JSON.parse(localStorage.getItem('notified_jobs') ?? '{}'); } catch { notified = {}; }
    let changed = false;
    jobs.forEach((j) => {
      if (!j.due_date) return;
      const days = Math.ceil((new Date(j.due_date).getTime() - Date.now()) / 86400000);
      if (days !== 3) return;
      if (notified[j.id] === today) return;
      notified[j.id] = today;
      changed = true;
      const path = j.job_path || j.job_name || `Job ${j.job_number}`;
      sendNotify({ tenant_id: tenant.id, target: 'supervisor', title: 'Job due soon', body: `${path} is due in 3 days`, url: '/app/supervisor' });
    });
    if (changed) { try { localStorage.setItem('notified_jobs', JSON.stringify(notified)); } catch { /* ignore */ } }
  }, [tenant, jobs]);

  // ── Realtime subscriptions ──────────────────────────────────────────────────

  useEffect(() => {
    if (!tenant) return;
    const tenantId = tenant.id;

    const clockCh = supabase
      .channel('rt-clock')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_clock', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as CrewRow & { clock_out: string | null; status: string | null };
          if (row.status === 'craftsman_build') {
            setCraftsmanBuilds((prev) => prev.some((b) => b.id === row.id) ? prev : [row as unknown as CraftsmanBuild, ...prev]);
          } else if (!row.clock_out) {
            // Dedupe by worker — replace any existing open row for this worker,
            // keeping the most recent clock_in, so a second open row never doubles
            // the entry in the Active Crew table.
            setActiveCrew((prev) => {
              const existing = prev.find((r) => r.worker_name === row.worker_name);
              if (existing && new Date(existing.clock_in) >= new Date(row.clock_in)) return prev;
              return [...prev.filter((r) => r.worker_name !== row.worker_name), row];
            });
          }
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as CrewRow & { clock_out: string | null; total_hours: number | null; job_number: string | null; status: string | null };
          if (row.status === 'craftsman_build') {
            setCraftsmanBuilds((prev) => prev.map((b) => b.id === row.id ? row as unknown as CraftsmanBuild : b));
          } else if (row.clock_out) {
            setActiveCrew((prev) => prev.filter((r) => r.id !== row.id));
            callAnalytics(tenantId, 'shift_complete', {
              hours:   row.total_hours ?? null,
              dept:    row.dept,
              had_job: !!row.job_number,
            });
          } else {
            setActiveCrew((prev) => prev.map((r) => r.id === row.id ? { ...r, ...row } : r));
          }
        } else if (payload.eventType === 'DELETE') {
          setActiveCrew((prev) => prev.filter((r) => r.id !== payload.old.id));
          setCraftsmanBuilds((prev) => prev.filter((b) => b.id !== payload.old.id));
        }
      })
      .subscribe();

    const msgCh = supabase
      .channel('rt-messages')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setMessages((prev) => prev.some((m) => m.id === payload.new.id) ? prev : [payload.new as Message, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setMessages((prev) => prev.map((m) => m.id === payload.new.id ? payload.new as Message : m));
        } else if (payload.eventType === 'DELETE') {
          setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
        }
      })
      .subscribe();

    const needsCh = supabase
      .channel('rt-needs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_needs', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setNeeds((prev) => prev.some((n) => n.id === payload.new.id) ? prev : [payload.new as InventoryNeed, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setNeeds((prev) => prev.map((n) => n.id === payload.new.id ? payload.new as InventoryNeed : n));
        } else if (payload.eventType === 'DELETE') {
          setNeeds((prev) => prev.filter((n) => n.id !== payload.old.id));
        }
      })
      .subscribe();

    const damageCh = supabase
      .channel('rt-damage')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'damage_reports', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setDamage((prev) => prev.some((d) => d.id === payload.new.id) ? prev : [payload.new as DamageReport, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setDamage((prev) => prev.map((d) => d.id === payload.new.id ? payload.new as DamageReport : d));
        } else if (payload.eventType === 'DELETE') {
          setDamage((prev) => prev.filter((d) => d.id !== payload.old.id));
        }
      })
      .subscribe();

    const partsCh = supabase
      .channel('rt-parts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts_log', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          const row = payload.new as PartLog;
          if (row.status !== 'Archived') {
            setParts((prev) => prev.some((p) => p.id === row.id) ? prev : [row, ...prev]);
          }
        } else if (payload.eventType === 'UPDATE') {
          const row = payload.new as PartLog;
          if (row.status === 'Archived') {
            setParts((prev) => prev.filter((p) => p.id !== row.id));
          } else {
            setParts((prev) => prev.map((p) => p.id === row.id ? row : p));
          }
        } else if (payload.eventType === 'DELETE') {
          setParts((prev) => prev.filter((p) => p.id !== payload.old.id));
        }
      })
      .subscribe();

    const jobsCh = supabase
      .channel('rt-jobs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setJobs((prev) => prev.some((j) => j.id === payload.new.id) ? prev : [payload.new as Job, ...prev]);
        } else if (payload.eventType === 'UPDATE') {
          setJobs((prev) => prev.map((j) => j.id === payload.new.id ? payload.new as Job : j));
        } else if (payload.eventType === 'DELETE') {
          setJobs((prev) => prev.filter((j) => j.id !== payload.old.id));
        }
      })
      .subscribe();

    // Production pipeline — refresh bars as cabinets move through stages
    const cabinetsCh = supabase
      .channel('rt-pipeline-cabinets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cabinet_units', filter: `tenant_id=eq.${tenantId}` }, () => { void loadPipeline(); })
      .subscribe();

    // Paused projects — keep the amber "Paused" indicators live under crew rows.
    const projectsCh = supabase
      .channel('rt-active-projects')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_active_projects', filter: `tenant_id=eq.${tenantId}` }, () => {
        void (async () => {
          try {
            const { data } = await supabase
              .from('crew_active_projects')
              .select('id, tenant_id, worker_name, dept, cabinet_unit_id, unit_label, job_number, time_clock_id, session_start, accumulated_seconds, status')
              .eq('tenant_id', tenantId).eq('status', 'paused');
            const map: Record<string, ActiveProject> = {};
            ((data as ActiveProject[] | null) ?? []).forEach((p) => { map[p.worker_name] = p; });
            setPausedProjects(map);
          } catch (_) { /* best-effort */ }
        })();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(clockCh);
      supabase.removeChannel(msgCh);
      supabase.removeChannel(needsCh);
      supabase.removeChannel(damageCh);
      supabase.removeChannel(partsCh);
      supabase.removeChannel(jobsCh);
      supabase.removeChannel(cabinetsCh);
      supabase.removeChannel(projectsCh);
    };
  }, [tenant, loadPipeline]);

  // ── Crew timeline ──────────────────────────────────────────────────────────

  async function fetchCrewTimeline(clockId: string) {
    if (crewTimelines[clockId] !== undefined || timelineLoading[clockId]) return;
    setTimelineLoading((prev) => ({ ...prev, [clockId]: true }));
    try {
      const { data } = await supabase
        .from('shift_events')
        .select('id, worker_name, event_type, dept, previous_dept, metadata, created_at')
        .eq('time_clock_id', clockId)
        .order('created_at', { ascending: true });
      if (data) setCrewTimelines((prev) => ({ ...prev, [clockId]: data as ShiftEvent[] }));
    } catch (_) {}
    setTimelineLoading((prev) => ({ ...prev, [clockId]: false }));
  }

  function toggleCrewTimeline(clockId: string) {
    if (expandedCrewId === clockId) {
      setExpandedCrewId(null);
    } else {
      setExpandedCrewId(clockId);
      void fetchCrewTimeline(clockId);
    }
  }

  // ── Job handlers ────────────────────────────────────────────────────────────

  async function handleDeleteJob(id: string) {
    const prev = jobs.find((j) => j.id === id);
    setJobs((jj) => jj.filter((j) => j.id !== id));
    try {
      const { error } = await supabase.from('jobs').delete().eq('id', id);
      if (error) throw error;
    } catch (err: unknown) {
      if (prev) setJobs((jj) => [prev, ...jj]);
      showToast(err instanceof Error ? err.message : 'Delete failed', true);
    }
  }

  // Complete a job: mark it (and all its cabinets) complete, then archive it.
  async function handleCompleteJob(job: Job) {
    if (completingJob || !tenant) return;
    setCompletingJob(true);
    const now = new Date().toISOString();
    try {
      const { error } = await supabase
        .from('jobs')
        .update({ status: 'complete', completed_at: now, archived: true, archived_at: now })
        .eq('id', job.id);
      if (error) throw error;
      // Mark every cabinet on this job complete (completed_at best-effort).
      try {
        await supabase.from('cabinet_units')
          .update({ status: 'complete', completed_at: now })
          .eq('tenant_id', tenant.id).eq('job_number', job.job_number);
      } catch (_) {
        try { await supabase.from('cabinet_units').update({ status: 'complete' }).eq('tenant_id', tenant.id).eq('job_number', job.job_number); } catch (__) {}
      }
      setJobs((jj) => jj.map((j) => j.id === job.id ? { ...j, status: 'complete', completed_at: now, archived: true, archived_at: now } : j));
      setCompleteJobTarget(null);
      void loadPipeline();
      showToast(`${jobLabel(job)} completed and archived`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Complete failed', true);
    } finally {
      setCompletingJob(false);
    }
  }

  // Restore an archived job back to Active Jobs.
  async function handleRestoreJob(job: Job) {
    const now = new Date().toISOString();
    setJobs((jj) => jj.map((j) => j.id === job.id ? { ...j, status: 'active', archived: false, archived_at: null } : j));
    try {
      const { error } = await supabase.from('jobs').update({ status: 'active', archived: false, archived_at: null }).eq('id', job.id);
      if (error) throw error;
      void loadPipeline();
      showToast(`${jobLabel(job)} restored`);
    } catch (err: unknown) {
      setJobs((jj) => jj.map((j) => j.id === job.id ? { ...j, status: 'complete', archived: true, archived_at: now } : j));
      showToast(err instanceof Error ? err.message : 'Restore failed', true);
    }
  }

  // ── Message send ────────────────────────────────────────────────────────────

  async function handleSendMessage(overrideBody?: string) {
    const body = (overrideBody ?? msgBody).trim();
    // In a thread: dept is fixed to that thread; in inbox: use the dropdown value
    const dept = openThread !== null
      ? (openThread === '__broadcast__' ? null : openThread)
      : (msgDept || null);
    if (!body || sending) return;
    setSending(true);

    const optimistic: Message = {
      id:          `opt-${Date.now()}`,
      sender_name: 'Supervisor',
      dept,
      body,
      created_at:  new Date().toISOString(),
      read_at:     null,
      topic:       null,
      payload:     null,
    };
    setMessages((prev) => [optimistic, ...prev]);
    setMsgBody('');

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_name: 'Supervisor',
        dept,
        body,
        tenant_id: tenant!.id,
      }).select('id, sender_name, dept, body, created_at, read_at, topic, payload').single();
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? data as Message : m));
      // Notify crew of the new message (fire-and-forget).
      // A dept-scoped message only pings that dept's crew; a broadcast (dept === null) pings all crew.
      sendNotify({
        tenant_id: tenant!.id,
        target: 'crew',
        ...(dept ? { dept_target: dept } : {}),
        title: 'New Message',
        body: `Supervisor: ${body.slice(0, 50)}`,
        url: '/app/crew',
      });
      showToast('Message sent');
    } catch (err: unknown) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setMsgBody(body);
      const msg = err instanceof Error ? err.message : 'Send failed';
      showToast(msg, true);
    } finally {
      setSending(false);
    }
  }

  // ── Message delete ──────────────────────────────────────────────────────────

  async function handleDeleteMessage(id: string) {
    console.log('[handleDeleteMessage] id:', id);
    try {
      const { error, count } = await supabase.from('messages').delete({ count: 'exact' }).eq('id', id);
      console.log('[handleDeleteMessage] result:', { error: error?.message ?? null, count });
      if (error) throw error;
      if (count === 0) throw new Error('Delete blocked — no rows affected (missing RLS DELETE policy on messages)');
      setMessages((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      console.error('[handleDeleteMessage] failed:', msg);
      showToast(msg, true);
    }
  }

  async function handleDeleteThread(deptKey: string, label: string) {
    if (!window.confirm(`Delete all ${label} messages? This cannot be undone.`)) return;
    console.log('[handleDeleteThread] dept:', deptKey, 'tenant:', tenant?.id);
    try {
      let query = supabase.from('messages').delete({ count: 'exact' }).eq('tenant_id', tenant!.id);
      if (deptKey === '__broadcast__') {
        query = query.is('dept', null);
      } else {
        query = query.eq('dept', deptKey);
      }
      const { error, count } = await query;
      console.log('[handleDeleteThread] result:', { error: error?.message ?? null, count });
      if (error) throw error;
      if (count === 0) throw new Error('Delete blocked — no rows affected (missing RLS DELETE policy on messages)');
      setMessages((prev) => prev.filter((m) => (m.dept ?? '__broadcast__') !== deptKey));
      setOpenThread(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      console.error('[handleDeleteThread] failed:', msg);
      showToast(msg, true);
    }
  }

  // ── Supervisor inventory submit ──────────────────────────────────────────────

  async function handleSupInventorySubmit() {
    const item = supInvItem.trim();
    if (!item || supInvSaving) return;
    setSupInvSaving(true);
    const optimisticId = crypto.randomUUID();
    const optimistic: InventoryNeed = {
      id: optimisticId,
      item,
      dept: supInvDept,
      job_number: supInvJobNum.trim() || null,
      qty: supInvQty,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    setNeeds((prev) => [optimistic, ...prev]);
    try {
      const { data, error } = await supabase.from('inventory_needs').insert({
        item,
        dept: supInvDept,
        qty: supInvQty,
        status: 'pending',
        tenant_id: tenant!.id,
        ...(supInvJobNum.trim() && { job_number: supInvJobNum.trim() }),
        ...(supInvNotes.trim() && { notes: supInvNotes.trim() }),
      }).select('id, item, dept, job_number, qty, status, created_at').single();
      if (error) throw error;
      setNeeds((prev) => prev.map((n) => n.id === optimisticId ? (data as InventoryNeed) : n));
      sendNotify({
        tenant_id: tenant!.id,
        target: 'supervisor',
        title: 'Inventory Needed',
        body: `${item} needed in ${supInvDept}`,
        url: '/app/supervisor',
      });
      setSupInvItem('');
      setSupInvDept('Production');
      setSupInvQty(1);
      setSupInvJobNum('');
      setSupInvNotes('');
      showToast('Inventory need logged');
    } catch (err: unknown) {
      setNeeds((prev) => prev.filter((n) => n.id !== optimisticId));
      const msg = err instanceof Error ? err.message : 'Insert failed';
      showToast(msg, true);
    } finally {
      setSupInvSaving(false);
    }
  }

  // ── Supervisor damage submit ────────────────────────────────────────────────

  function handleSupDmgPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setSupDmgPhoto(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setSupDmgPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    } else {
      setSupDmgPreview(null);
    }
  }

  async function handleSupDamageSubmit() {
    const desc = supDmgDesc.trim();
    if (!desc || supDmgSaving) return;
    setSupDmgSaving(true);
    const optimisticId = crypto.randomUUID();
    const optimistic: DamageReport = {
      id: optimisticId,
      part_name: desc,
      job_id: supDmgJobNum.trim() || null,
      dept: supDmgDept,
      notes: null,
      photo_url: supDmgPreview,
      status: 'open',
      created_at: new Date().toISOString(),
      flag_type: null,
      assembler_name: null,
      cabinet_unit_id: null,
      report_type: 'damage',
      resolution_type: null,
      resolution_notes: null,
      resolved_by: null,
      resolution_cost: null,
      resolved_at: null,
    };
    setDamage((prev) => [optimistic, ...prev]);
    try {
      let photoUrl: string | null = null;
      if (supDmgPhoto) {
        const ext = supDmgPhoto.name.split('.').pop() ?? 'jpg';
        const path = `${tenant!.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage.from('damage-photos').upload(path, supDmgPhoto, { upsert: true });
        if (uploadErr) throw uploadErr;
        const { data: { publicUrl } } = supabase.storage.from('damage-photos').getPublicUrl(path);
        photoUrl = publicUrl;
      }
      const { data, error } = await supabase.from('damage_reports').insert({
        part_name: desc,
        dept: supDmgDept,
        status: 'open',
        tenant_id: tenant!.id,
        report_type: 'damage',
        ...(supDmgJobNum.trim() && { job_id: supDmgJobNum.trim() }),
        ...(photoUrl && { photo_url: photoUrl }),
      }).select('id, part_name, job_id, dept, notes, photo_url, status, created_at, report_type').single();
      if (error) throw error;
      setDamage((prev) => prev.map((d) => d.id === optimisticId ? (data as DamageReport) : d));
      sendNotify({
        tenant_id: tenant!.id,
        target: 'supervisor',
        title: 'Damage Report',
        body: `Supervisor reported damage in ${supDmgDept}`,
        url: '/app/supervisor',
      });
      setSupDmgDesc('');
      setSupDmgDept('Production');
      setSupDmgJobNum('');
      setSupDmgPhoto(null);
      setSupDmgPreview(null);
      showToast('Damage report submitted');
    } catch (err: unknown) {
      setDamage((prev) => prev.filter((d) => d.id !== optimisticId));
      showToast(err instanceof Error ? err.message : 'Insert failed', true);
    } finally {
      setSupDmgSaving(false);
    }
  }

  // ── Inventory status update ─────────────────────────────────────────────────

  async function handleNeedStatus(id: string, status: string) {
    setActioning((prev) => ({ ...prev, [id]: true }));
    const prev = needs.find((n) => n.id === id);
    setNeeds((ns) => ns.map((n) => n.id === id ? { ...n, status } : n));
    try {
      const { error } = await supabase.from('inventory_needs').update({ status }).eq('id', id);
      if (error) throw error;
      showToast(`Marked as ${status}`);
      if (status === 'received' && tenant) {
        callAnalytics(tenant.id, 'inventory_fulfilled', { dept: prev?.dept ?? null });
      }
    } catch (err: unknown) {
      if (prev) setNeeds((ns) => ns.map((n) => n.id === id ? prev : n));
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setActioning((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ── Damage status update ────────────────────────────────────────────────────

  function openResolutionModal(id: string) {
    const report = damage.find((d) => d.id === id);
    setResolvingId(id);
    setResType('Repaired in shop');
    setResNotes('');
    setResBy('Supervisor');
    setResCost('');
    // Default the return dept to the report's source dept (or Production).
    setResReturnDept(report?.dept ? deptDisplay(report.dept) : 'Production');
  }

  // The report being resolved (for the modal's "Replace Part" routing UI).
  const resolvingReport = resolvingId ? damage.find((d) => d.id === resolvingId) ?? null : null;
  const resolvingSourceDept = (resolvingReport?.dept ?? '').toLowerCase();

  // Route a replacement part back into production per the spec:
  //   Production  → uncheck the part, reset to not_cut → it reappears in the cut list
  //   Craftsman   → return to the craftsman queue
  //   Finishing / Assembly → move to the supervisor-chosen dept
  // Notifies the destination crew and logs a part_dept_event. Best-effort: a
  // failure here never blocks the report from being marked resolved.
  async function routeReplacementPart(report: DamageReport): Promise<void> {
    if (!tenant) return;
    const source = (report.dept ?? '').toLowerCase();
    try {
      // Find the damaged part (by cabinet when known, else by name within the job).
      let q = supabase.from('parts')
        .select('id, cabinet_unit_id, job_number, part_name')
        .eq('tenant_id', tenant.id)
        .ilike('part_name', report.part_name)
        .limit(1);
      if (report.cabinet_unit_id) q = q.eq('cabinet_unit_id', report.cabinet_unit_id);
      const { data: partRow } = await q.maybeSingle();
      const part = partRow as { id: string; cabinet_unit_id: string; job_number: string | null; part_name: string } | null;
      if (!part) return;

      let destDept: string;
      const update: Record<string, unknown> = { status: 'pending' };
      if (source === 'production') {
        destDept = 'production';
        update.assigned_dept = 'production';
        update.checked = false;
        update.production_status = 'not_cut';
      } else if (source === 'craftsman') {
        destDept = 'craftsman';
        update.assigned_dept = 'craftsman';
      } else {
        // Finishing or Assembly — supervisor picks the destination.
        destDept = resReturnDept.toLowerCase();
        update.assigned_dept = destDept;
      }

      await supabase.from('parts').update(update).eq('id', part.id).eq('tenant_id', tenant.id);

      // Log the transition (best-effort).
      try {
        await supabase.from('part_dept_events').insert({
          tenant_id: tenant.id, part_id: part.id, cabinet_unit_id: part.cabinet_unit_id,
          job_number: part.job_number, from_dept: source || null, to_dept: destDept,
          worker_name: resBy.trim() || 'Supervisor',
        });
      } catch { /* best-effort */ }

      // Recompute the cabinet's assigned_dept now that a part has moved.
      try {
        const { recomputeCabinet } = await import('@/lib/partActions');
        await recomputeCabinet(tenant.id, part.cabinet_unit_id);
      } catch { /* best-effort — recompute is non-blocking */ }

      // Notify the destination dept's crew.
      sendNotify({
        tenant_id: tenant.id, target: 'crew', dept_target: deptDisplay(destDept),
        title: `Replacement needed in ${deptDisplay(destDept)}`,
        body: `${part.part_name}${part.job_number ? ` — Job ${part.job_number}` : ''}`,
        url: '/app/crew',
      });
    } catch { /* best-effort */ }
  }

  async function handleResolutionConfirm() {
    if (!resolvingId || !resNotes.trim() || resSubmitting) return;
    const id = resolvingId;
    setResSubmitting(true);
    const prev = damage.find((d) => d.id === id);
    const isReplace = resType === 'Replaced part';
    setDamage((ds) => ds.map((d) => d.id === id ? { ...d, status: 'resolved' } : d));
    setResolvingId(null);
    // Replace Part — route the replacement back into production before recording.
    if (isReplace && prev) { await routeReplacementPart(prev as DamageReport); }
    try {
      const { error } = await supabase.from('damage_reports').update({
        status:           'resolved',
        resolution_type:  isReplace ? 'replace_part' : resType,
        resolution_notes: resNotes.trim(),
        resolved_by:      resBy.trim() || 'Supervisor',
        resolution_cost:  resCost ? parseFloat(resCost) : null,
        resolved_at:      new Date().toISOString(),
        ...(isReplace && { return_dept: resReturnDept.toLowerCase() }),
      }).eq('id', id);
      if (error) throw error;
      showToast(isReplace ? `Replacement routed to ${resReturnDept}` : 'Damage report resolved');
      if (tenant && prev) {
        const createdAt = (prev as DamageReport).created_at;
        const daysOpen  = createdAt ? Math.round((Date.now() - new Date(createdAt).getTime()) / 86400000) : null;
        callAnalytics(tenant.id, 'damage_resolved', {
          resolution_type: resType,
          dept:            (prev as DamageReport).dept ?? null,
          days_open:       daysOpen,
        });
      }
    } catch (_) {
      // Columns may not exist yet — fall back to status-only update
      try {
        const { error: fallbackErr } = await supabase
          .from('damage_reports').update({ status: 'resolved' }).eq('id', id);
        if (fallbackErr) throw fallbackErr;
        showToast('Resolved — run damage_resolution.sql to save full details');
      } catch (err2: unknown) {
        if (prev) setDamage((ds) => ds.map((d) => d.id === id ? prev : d));
        showToast(err2 instanceof Error ? err2.message : 'Update failed', true);
      }
    } finally {
      setResSubmitting(false);
    }
  }

  async function handleDamageStatus(id: string, status: string) {
    setActioning((prev) => ({ ...prev, [id]: true }));
    const prev = damage.find((d) => d.id === id);
    setDamage((ds) => ds.map((d) => d.id === id ? { ...d, status } : d));
    try {
      const { error } = await supabase.from('damage_reports').update({ status }).eq('id', id);
      if (error) throw error;
      showToast(`Marked as ${status}`);
    } catch (err: unknown) {
      if (prev) setDamage((ds) => ds.map((d) => d.id === id ? prev : d));
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setActioning((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ── Plans ───────────────────────────────────────────────────────────────────

  // Departments multi-select: "all" and specific depts are mutually exclusive.
  function togglePlanDept(dept: string) {
    setPlanDepts((prev) => {
      if (dept === 'all') return ['all'];
      const base = prev.filter((d) => d !== 'all');
      const next = base.includes(dept) ? base.filter((d) => d !== dept) : [...base, dept];
      return next.length === 0 ? ['all'] : next;
    });
  }

  // Plan name a plan would carry — used for both upload and duplicate detection.
  function planNameFor(): string {
    return planLabel.trim() || planFile?.name || '';
  }

  // Human-friendly label for a job in the selector ("Client / Room").
  function jobLabel(j: Job): string {
    if (j.job_path) return titleCasePath(j.job_path).split('/').join(' / ');
    return toTitleCase(j.job_name || j.job_number);
  }

  // Resolve the job_path used to group a plan: prefer the value stored on the
  // drawing, else look it up from the jobs table by job_number, else fall back.
  function planJobPath(p: JobDrawing): string {
    if (p.job_path && p.job_path.trim()) return p.job_path;
    const job = jobs.find((j) => j.job_number === p.job_number);
    if (job) return job.job_path || job.job_name || job.job_number;
    return p.job_number || 'No Job / Project';
  }

  // Reset the Job/Project selector back to its empty state.
  function resetPlanJobSelector() {
    setPlanJobId('');
    setPlanJobQuery('');
    setPlanJobNum('');
    setPlanNewClient('');
    setPlanNewRoom('');
    setPlanJobOpen(false);
  }

  // Upload is allowed once a job is chosen: an existing one, or a new one with a client name.
  const planJobReady = planJobId === '__new__' ? !!planNewClient.trim() : !!planJobNum.trim();

  // Pick an existing job from the selector dropdown.
  function selectPlanJob(j: Job) {
    setPlanJobId(j.id);
    setPlanJobNum(j.job_number);
    setPlanJobQuery(jobLabel(j));
    setPlanJobOpen(false);
    // Auto-fill the room context from the job when available (job_path drives grouping).
    setPlanNewRoom(j.room_name ?? '');
  }

  // Find a current plan with the same job + name (case-insensitive) → version conflict.
  function findDuplicatePlan(jobNumber: string): JobDrawing | null {
    const job  = jobNumber.trim().toLowerCase();
    const name = planNameFor().toLowerCase();
    if (!job || !name) return null;
    return plans.find((p) =>
      (p.is_current !== false) &&
      (p.job_number ?? '').toLowerCase() === job &&
      (p.label ?? p.file_name ?? '').toLowerCase() === name,
    ) ?? null;
  }

  // Resolve the Job/Project selector into a concrete { jobNumber, jobPath },
  // creating a new job record when "Create new job" is chosen. Returns null (and
  // toasts the reason) when the selection is incomplete. Shared by the single
  // upload and the bulk (multi-file) upload so both resolve the job identically.
  async function resolvePlanJobContext(): Promise<{ jobNumber: string; jobPath: string | null } | null> {
    if (!tenant) return null;
    if (planJobId === '__new__') {
      // Create a new job record first, then attach the file(s) to it.
      const client = toTitleCase(planNewClient.trim());
      const room   = toTitleCase(planNewRoom.trim());
      if (!client) { showToast('Client name is required for a new job', true); return null; }
      const jobPath = room ? `${client}/${room}` : client;
      try {
        const insert: Record<string, unknown> = {
          job_number:  jobPath,
          job_name:    room ? `${client} — ${room}` : client,
          client_name: client,
          job_path:    jobPath,
          status:      'active',
          tenant_id:   tenant.id,
        };
        if (room) insert.room_name = room;
        const { data, error } = await supabase
          .from('jobs')
          .insert(insert)
          .select('id, job_number, job_name, status, source, created_at, job_path, client_name, room_name, due_date, install_date')
          .single();
        if (error) throw error;
        const created = data as Job;
        setJobs((prev) => [created, ...prev]);
        return { jobNumber: created.job_number, jobPath: created.job_path ?? jobPath };
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Could not create job', true);
        return null;
      }
    } else if (planJobId) {
      const job = jobs.find((j) => j.id === planJobId);
      if (!job) { showToast('Select a job or create a new one', true); return null; }
      return { jobNumber: job.job_number, jobPath: job.job_path ?? job.job_name ?? null };
    }
    showToast('Select a job or create a new one', true);
    return null;
  }

  // Resolve the job context (existing or freshly-created) then upload.
  async function handlePlanUpload() {
    if (!planFile || planUploading || !tenant) return;
    try {
      const ctx = await resolvePlanJobContext();
      if (!ctx) return;
      const { jobNumber, jobPath } = ctx;

      // A current plan with the same job + name already exists → ask how to proceed.
      const dup = findDuplicatePlan(jobNumber);
      if (dup) { setPendingJobCtx({ jobNumber, jobPath }); setVersionConflict(dup); return; }
      await performPlanUpload(null, jobNumber, jobPath);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Upload failed', true);
    }
  }

  // Perform the actual upload. When `replace` is provided, the new file becomes
  // version N+1 and the old record is marked superseded.
  async function performPlanUpload(replace: JobDrawing | null, jobNumber: string, jobPath: string | null) {
    if (!planFile || !jobNumber.trim() || planUploading) return;
    setVersionConflict(null);
    setPendingJobCtx(null);
    setPlanUploading(true);
    try {
      const ext      = (planFile.name.split('.').pop() ?? 'bin').toLowerCase();
      const fileType = detectPlanFileType(ext);
      const path     = `${tenant!.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('job-plans').upload(path, planFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('job-plans').getPublicUrl(path);
      const departments = planDepts.length ? planDepts : ['all'];
      const newVersion = replace ? (replace.version ?? 1) + 1 : 1;
      const insert: Record<string, unknown> = {
        tenant_id:   tenant!.id,
        job_id:      jobNumber.trim(),          // job_id is NOT NULL — mirror the job/project value
        job_number:  jobNumber.trim(),
        label:       planLabel.trim() || planFile.name,  // label is NOT NULL — fall back to the file name
        file_url:    publicUrl,
        file_name:   planFile.name,
        file_type:   fileType,
        departments,
        uploaded_by: 'Supervisor',
        version:     newVersion,
        is_current:  true,
      };
      if (jobPath) insert.job_path = jobPath;   // denormalized for consistent grouping
      const { data: inserted, error: dbErr } = await supabase.from('job_drawings').insert(insert).select(JOB_DRAWING_COLS).single();
      if (dbErr) throw dbErr;

      // Supersede the old version: point it at the new record and hide it from "current".
      if (replace) {
        try {
          await supabase.from('job_drawings')
            .update({ is_current: false, superseded_by: (inserted as JobDrawing).id })
            .eq('id', replace.id);
        } catch (_) { /* best-effort */ }
        setPlans((prev) => prev.map((p) => p.id === replace.id ? { ...p, is_current: false, superseded_by: (inserted as JobDrawing).id } : p));
      }
      setPlans((prev) => [inserted as JobDrawing, ...prev]);

      if (fileType === 'csv') {
        // Parse the CSV and reveal the column mapper to finish creating units + parts.
        const text = await planFile.text();
        const { headers, rows } = parsePlanCSV(text);
        if (headers.length === 0) {
          showToast('CSV looks empty — nothing to map', true);
        } else {
          setPlanCsvHeaders(headers);
          setPlanCsvRows(rows);
          setPlanColumnMap({ unit_id: '', part_name: '', room: '', material: '', width: '', height: '', depth: '' });
          setPlanAiMapped(false);
          setPlanAiMissing([]);
          setPlanCountdown(null);
          setPlanPendingId((inserted as JobDrawing).id);
          setPlanPendingJobNum(jobNumber.trim());
          showToast('CSV uploaded — map the columns to build the cut list');
          // Fire-and-forget AI auto-detection to pre-fill the mapper.
          void runAiColumnMapping(headers, rows);
        }
        setPlanFile(null);
        setPlanLabel('');
      } else {
        setPlanFile(null);
        resetPlanJobSelector();
        setPlanLabel('');
        setPlanDepts(['all']);
        showToast(newVersion > 1 ? `Version ${newVersion} uploaded` : 'Plan uploaded');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      showToast(msg, true);
    } finally {
      setPlanUploading(false);
    }
  }

  // Restore a superseded plan as the current version (supervisor action).
  async function handleRestoreVersion(plan: JobDrawing) {
    try {
      // Demote whatever is currently current for this job + name.
      const job  = (plan.job_number ?? '').toLowerCase();
      const name = (plan.label ?? plan.file_name ?? '').toLowerCase();
      const current = plans.find((p) =>
        p.id !== plan.id && p.is_current !== false &&
        (p.job_number ?? '').toLowerCase() === job &&
        (p.label ?? p.file_name ?? '').toLowerCase() === name,
      );
      const nextVersion = Math.max(...plans
        .filter((p) => (p.job_number ?? '').toLowerCase() === job && (p.label ?? p.file_name ?? '').toLowerCase() === name)
        .map((p) => p.version ?? 1)) + 1;
      if (current) {
        await supabase.from('job_drawings').update({ is_current: false, superseded_by: plan.id }).eq('id', current.id);
      }
      await supabase.from('job_drawings').update({ is_current: true, superseded_by: null, version: nextVersion }).eq('id', plan.id);
      setPlans((prev) => prev.map((p) => {
        if (p.id === plan.id)            return { ...p, is_current: true, superseded_by: null, version: nextVersion };
        if (current && p.id === current.id) return { ...p, is_current: false, superseded_by: plan.id };
        return p;
      }));
      showToast(`Restored as version ${nextVersion}`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Restore failed', true);
    }
  }

  // Lazy-load the crew who have viewed a plan (Crew Viewed Confirmation).
  async function togglePlanViews(planId: string) {
    if (expandedViewsId === planId) { setExpandedViewsId(null); return; }
    setExpandedViewsId(planId);
    // Load the crew roster once so we can flag who has never viewed.
    if (crewRoster.length === 0 && tenant) {
      try {
        const { data } = await supabase
          .from('crew_members').select('name').eq('tenant_id', tenant.id).eq('status', 'active');
        setCrewRoster(((data as { name: string }[]) ?? []).map((r) => r.name));
      } catch (_) { /* roster optional */ }
    }
    if (planViews[planId]) return;
    try {
      const { data } = await supabase
        .from('plan_views')
        .select('viewer_name, viewed_at')
        .eq('plan_id', planId)
        .order('viewed_at', { ascending: false });
      // Keep only the most recent view per crew member.
      const seen = new Set<string>();
      const rows = ((data as { viewer_name: string; viewed_at: string }[]) ?? []).filter((r) => {
        if (seen.has(r.viewer_name)) return false;
        seen.add(r.viewer_name); return true;
      });
      setPlanViews((prev) => ({ ...prev, [planId]: rows }));
    } catch (_) {
      setPlanViews((prev) => ({ ...prev, [planId]: [] }));
    }
  }

  // Ask Claude to map CSV headers → cabinet fields, then pre-fill the dropdowns.
  // Silent on any failure: the mapper just stays empty for manual selection.
  async function runAiColumnMapping(headers: string[], rows: CsvRow[]) {
    try {
      const res = await fetch('/app/api/map-columns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ headers, sampleRows: rows.slice(0, 3) }),
      });
      if (!res.ok) return;
      const ai = await res.json() as Record<string, string | null>;

      // Only accept values that are real headers; translate cabinet_unit_id → unit_id.
      const pick = (v: string | null | undefined) =>
        (typeof v === 'string' && headers.includes(v)) ? v : '';
      const next = {
        unit_id:   pick(ai.cabinet_unit_id),
        part_name: pick(ai.part_name),
        room:      pick(ai.room),
        material:  pick(ai.material),
        width:     pick(ai.width),
        height:    pick(ai.height),
        depth:     pick(ai.depth),
      };

      const missing = (['unit_id', 'part_name'] as const).filter((k) => !next[k]);
      setPlanColumnMap(next);
      setPlanAiMissing(missing);
      setPlanAiMapped(true);
      // Everything required is mapped → offer a 3s auto-submit the supervisor can cancel.
      if (missing.length === 0) setPlanCountdown(3);
    } catch {
      // Fall back to the empty mapper silently — no error shown to the user.
    }
  }

  // Drive the auto-submit countdown once the AI maps everything successfully.
  // Each tick either decrements or, at zero, fires the parse — all inside the
  // timeout so the effect body itself never calls setState synchronously.
  useEffect(() => {
    if (planCountdown === null || planCountdown <= 0) return;
    const t = setTimeout(() => {
      if (planCountdown <= 1) {
        setPlanCountdown(null);
        void handlePlanParse();
      } else {
        setPlanCountdown(planCountdown - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [planCountdown]); // eslint-disable-line react-hooks/exhaustive-deps

  function cancelPlanMapper() {
    setPlanCsvHeaders([]);
    setPlanCsvRows([]);
    setPlanPendingId(null);
    setPlanPendingJobNum('');
    setPlanAiMapped(false);
    setPlanAiMissing([]);
    setPlanCountdown(null);
  }

  async function handlePlanParse() {
    if (!planColumnMap.unit_id || !planColumnMap.part_name || !planPendingId || planParsing) return;
    setPlanParsing(true);
    try {
      const jobNumber = planPendingJobNum;
      const job = jobs.find((j) => j.job_number === jobNumber); // optional link to jobs row

      // Group rows by unit-ID value
      const unitGroups: Record<string, CsvRow[]> = {};
      planCsvRows.forEach((row) => {
        const v = row[planColumnMap.unit_id]?.trim();
        if (!v) return;
        (unitGroups[v] ??= []).push(row);
      });

      let unitsInserted = 0;
      let partsInserted = 0;

      for (const [unitVal, rows] of Object.entries(unitGroups)) {
        const segments = unitVal.split('/').map((s) => s.trim());
        let room_number: string | null = null;
        let cabinet_number: string | null = null;
        const unit_label = unitVal;
        if (segments.length >= 3) {
          room_number    = segments[1] || null;
          cabinet_number = segments[2] || null;
        } else if (planColumnMap.room && rows[0]?.[planColumnMap.room]) {
          room_number = rows[0][planColumnMap.room]?.trim() || null;
        }

        const { data: unitData, error: unitErr } = await supabase
          .from('cabinet_units')
          .insert({
            tenant_id:      tenant!.id,
            job_id:         job?.id ?? null,
            job_number:     jobNumber,
            room_number,
            cabinet_number,
            unit_label,
            status:         'pending',
          })
          .select('id')
          .single();
        if (unitErr) throw unitErr;
        unitsInserted++;

        const partRows = rows.map((row) => ({
          tenant_id:       tenant!.id,
          cabinet_unit_id: unitData.id,
          job_number:      jobNumber,
          part_name:       row[planColumnMap.part_name]?.trim() || 'Unknown part',
          material:        planColumnMap.material ? (row[planColumnMap.material]?.trim() || null) : null,
          width:           planColumnMap.width   ? (parseFloat(row[planColumnMap.width]  ?? '') || null) : null,
          height:          planColumnMap.height  ? (parseFloat(row[planColumnMap.height] ?? '') || null) : null,
          depth:           planColumnMap.depth   ? (parseFloat(row[planColumnMap.depth]  ?? '') || null) : null,
          quantity:        1,
          status:          'pending',
        }));
        const { error: partsErr } = await supabase.from('parts').insert(partRows);
        if (partsErr) throw partsErr;
        partsInserted += partRows.length;
      }

      await supabase.from('job_drawings').update({ parsed: true }).eq('id', planPendingId);
      setPlans((prev) => prev.map((p) => p.id === planPendingId ? { ...p, parsed: true } : p));

      // Fire-and-forget AI classification — assigns each new unit to craftsman vs
      // standard production. Never awaited, never blocks the upload flow.
      try {
        void fetch('/app/api/classify-units', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenantId: tenant!.id, jobNumber }),
        }).catch(() => {});
      } catch { /* classification unavailable — ignore */ }

      cancelPlanMapper();
      resetPlanJobSelector();
      setPlanDepts(['all']);
      showToast(`Cut list parsed — ${unitsInserted} cabinet units and ${partsInserted} parts created`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Parse failed', true);
    } finally {
      setPlanParsing(false);
    }
  }

  // ── Bulk (multi-file) upload ──────────────────────────────────────────────
  // Each file runs through the same parse-file → map-columns → classify-units
  // pipeline as the single upload, but non-interactively: the AI column mapping
  // is auto-applied, and a file whose required columns can't be detected is
  // surfaced as an error rather than blocking the queue.

  // Create cabinet_units + parts from parsed CSV rows using a resolved column map.
  // Returns the number of units created. Mirrors the unit/part build in
  // handlePlanParse but takes an explicit map so it can run without the UI mapper.
  async function importCsvUnits(
    rows: CsvRow[],
    map: { unit_id: string; part_name: string; room: string; material: string; width: string; height: string; depth: string },
    jobNumber: string,
  ): Promise<number> {
    const job = jobs.find((j) => j.job_number === jobNumber); // optional link to jobs row
    const unitGroups: Record<string, CsvRow[]> = {};
    rows.forEach((row) => {
      const v = row[map.unit_id]?.trim();
      if (!v) return;
      (unitGroups[v] ??= []).push(row);
    });

    let unitsInserted = 0;
    for (const [unitVal, groupRows] of Object.entries(unitGroups)) {
      const segments = unitVal.split('/').map((s) => s.trim());
      let room_number: string | null = null;
      let cabinet_number: string | null = null;
      if (segments.length >= 3) {
        room_number    = segments[1] || null;
        cabinet_number = segments[2] || null;
      } else if (map.room && groupRows[0]?.[map.room]) {
        room_number = groupRows[0][map.room]?.trim() || null;
      }

      const { data: unitData, error: unitErr } = await supabase
        .from('cabinet_units')
        .insert({
          tenant_id:      tenant!.id,
          job_id:         job?.id ?? null,
          job_number:     jobNumber,
          room_number,
          cabinet_number,
          unit_label:     unitVal,
          status:         'pending',
        })
        .select('id')
        .single();
      if (unitErr) throw unitErr;
      unitsInserted++;

      const partRows = groupRows.map((row) => ({
        tenant_id:       tenant!.id,
        cabinet_unit_id: unitData.id,
        job_number:      jobNumber,
        part_name:       row[map.part_name]?.trim() || 'Unknown part',
        material:        map.material ? (row[map.material]?.trim() || null) : null,
        width:           map.width  ? (parseFloat(row[map.width]  ?? '') || null) : null,
        height:          map.height ? (parseFloat(row[map.height] ?? '') || null) : null,
        depth:           map.depth  ? (parseFloat(row[map.depth]  ?? '') || null) : null,
        quantity:        1,
        status:          'pending',
      }));
      const { error: partsErr } = await supabase.from('parts').insert(partRows);
      if (partsErr) throw partsErr;
    }
    return unitsInserted;
  }

  // Upload + record one file, then (for CSVs) auto-map and build the cut list.
  // Throws on any failure so the batch driver can mark the row as an error. When
  // `manualFallback` is set (single-file upload), a CSV whose columns can't be
  // auto-detected opens the manual column mapper instead of erroring.
  async function processBatchFile(file: File, jobNumber: string, jobPath: string | null, manualFallback = false): Promise<number> {
    const ext      = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const fileType = detectPlanFileType(ext);
    const path     = `${tenant!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('job-plans').upload(path, file, { upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl } } = supabase.storage.from('job-plans').getPublicUrl(path);

    const insert: Record<string, unknown> = {
      tenant_id:   tenant!.id,
      job_id:      jobNumber.trim(),          // job_id is NOT NULL — mirror the job/project value
      job_number:  jobNumber.trim(),
      label:       file.name,                 // label is NOT NULL — bulk uploads use the file name
      file_url:    publicUrl,
      file_name:   file.name,
      file_type:   fileType,
      departments: planDepts.length ? planDepts : ['all'],
      uploaded_by: 'Supervisor',
      version:     1,
      is_current:  true,
    };
    if (jobPath) insert.job_path = jobPath;
    const { data: inserted, error: dbErr } = await supabase.from('job_drawings').insert(insert).select(JOB_DRAWING_COLS).single();
    if (dbErr) throw dbErr;
    const drawing = inserted as JobDrawing;
    setPlans((prev) => [drawing, ...prev]);

    // Non-CSV files are just stored — no cut list to build.
    if (fileType !== 'csv') return 0;

    const text = await file.text();
    const { headers, rows } = parsePlanCSV(text);
    if (headers.length === 0) throw new Error('CSV looks empty — nothing to map');

    // Auto-detect the column mapping via the AI mapper (map-columns endpoint).
    let ai: Record<string, string | null> = {};
    try {
      const res = await fetch('/app/api/map-columns', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ headers, sampleRows: rows.slice(0, 3) }),
      });
      if (res.ok) ai = await res.json() as Record<string, string | null>;
    } catch { /* fall through — validated below */ }

    const pick = (v: string | null | undefined) => (typeof v === 'string' && headers.includes(v)) ? v : '';
    const map = {
      unit_id:   pick(ai.cabinet_unit_id),
      part_name: pick(ai.part_name),
      room:      pick(ai.room),
      material:  pick(ai.material),
      width:     pick(ai.width),
      height:    pick(ai.height),
      depth:     pick(ai.depth),
    };
    if (!map.unit_id || !map.part_name) {
      // Single-file upload → hand off to the manual mapper (pre-filled with
      // whatever the AI did detect). Multi-file → surface as a queue error.
      if (manualFallback) {
        setPlanCsvHeaders(headers);
        setPlanCsvRows(rows);
        setPlanColumnMap({ unit_id: map.unit_id, part_name: map.part_name, room: map.room, material: map.material, width: map.width, height: map.height, depth: map.depth });
        setPlanAiMapped(true);
        setPlanAiMissing((['unit_id', 'part_name'] as const).filter((k) => !map[k]));
        setPlanCountdown(null);
        setPlanPendingId(drawing.id);
        setPlanPendingJobNum(jobNumber);
        throw new ManualMapNeeded();
      }
      throw new Error('Couldn’t auto-detect Cabinet ID / Part Name columns — upload this file on its own to map manually');
    }

    const units = await importCsvUnits(rows, map, jobNumber);

    try {
      await supabase.from('job_drawings').update({ parsed: true }).eq('id', drawing.id);
      setPlans((prev) => prev.map((p) => p.id === drawing.id ? { ...p, parsed: true } : p));
    } catch { /* parsed flag is best-effort */ }

    // Fire-and-forget AI classification — assigns each new unit to craftsman vs
    // standard production. Never awaited, never blocks the queue.
    try {
      void fetch('/app/api/classify-units', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: tenant!.id, jobNumber }),
      }).catch(() => {});
    } catch { /* classification unavailable — ignore */ }

    return units;
  }

  // Drive the bulk upload: resolve the job once, then process files sequentially
  // so the API isn't hammered. Each file's outcome updates its queue row; the run
  // ends with a summary and one failure never stops the rest.
  async function runMultiUpload(files: File[]) {
    if (!tenant || multiProcessing || files.length === 0) return;
    const ctx = await resolvePlanJobContext();
    if (!ctx) return;
    const { jobNumber, jobPath } = ctx;

    // A lone file can fall back to the manual column mapper for CSVs that can't
    // be auto-detected; multi-file runs treat that case as a queue error.
    const single = files.length === 1;
    const queue: MultiFile[] = files.map((f, i) => ({ id: `${Date.now()}-${i}-${f.name}`, file: f, status: 'pending' as const }));
    setMultiSummary(null);
    setMultiQueue(queue);
    setMultiProcessing(true);

    let totalUnits = 0;
    let okCount    = 0;
    let failCount  = 0;
    const jobsTouched = new Set<string>();

    for (let i = 0; i < queue.length; i++) {
      setMultiCurrentIdx(i + 1);
      setMultiQueue((prev) => prev.map((q, idx) => idx === i ? { ...q, status: 'processing' } : q));
      try {
        const units = await processBatchFile(queue[i].file, jobNumber, jobPath, single);
        totalUnits += units;
        okCount++;
        jobsTouched.add(jobNumber);
        setMultiQueue((prev) => prev.map((q, idx) => idx === i ? { ...q, status: 'done', units } : q));
      } catch (err: unknown) {
        // Single CSV needs manual mapping → clear the queue and let the mapper
        // card below take over (it builds the cut list on confirm).
        if (err instanceof ManualMapNeeded) {
          setMultiQueue([]);
          setMultiProcessing(false);
          setMultiCurrentIdx(0);
          return;
        }
        failCount++;
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setMultiQueue((prev) => prev.map((q, idx) => idx === i ? { ...q, status: 'error', error: msg } : q));
      }
    }

    setMultiProcessing(false);
    setMultiCurrentIdx(0);
    setMultiSummary({ files: okCount, units: totalUnits, jobs: jobsTouched.size, failed: failCount });
    resetPlanJobSelector();
    setPlanDepts(['all']);
  }

  async function handlePlanDelete(id: string) {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from('job_drawings').delete().eq('id', id);
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, true);
      const { data } = await supabase.from('job_drawings').select(JOB_DRAWING_COLS).eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
      if (data) setPlans(data as JobDrawing[]);
    }
  }

  // ── SOPs ────────────────────────────────────────────────────────────────────

  async function handleSopUpload() {
    if (!sopFile || !sopTitle.trim() || sopUploading) return;
    setSopUploading(true);
    try {
      const path = `${tenant!.id}/${Date.now()}.pdf`;
      const { error: uploadErr } = await supabase.storage.from('sop-files').upload(path, sopFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('sop-files').getPublicUrl(path);
      const { error: dbErr } = await supabase.from('sops').insert({
        tenant_id: tenant!.id,
        title: sopTitle.trim(),
        dept: sopDept || null,
        pdf_url: publicUrl,
        created_by: 'Supervisor',
        steps: [],
      });
      if (dbErr) throw dbErr;
      setSopFile(null);
      setSopTitle('');
      setSopDept('');
      showToast('SOP uploaded');
      const { data } = await supabase.from('sops').select('id, title, dept, pdf_url, created_at').eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
      if (data) setSops(data as SopItem[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      showToast(msg, true);
    } finally {
      setSopUploading(false);
    }
  }

  async function handleSopDelete(id: string) {
    setSops((prev) => prev.filter((s) => s.id !== id));
    try {
      const { error } = await supabase.from('sops').delete().eq('id', id);
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, true);
      const { data } = await supabase.from('sops').select('id, title, dept, pdf_url, created_at').eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
      if (data) setSops(data as SopItem[]);
    }
  }

  // ── Analytics fire-and-forget ───────────────────────────────────────────────

  function callAnalytics(tId: string, event_type: string, payload: Record<string, unknown>) {
    void fetch('/app/api/analytics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: tId, event_type, payload }),
    }).catch(() => {});
  }

  // ── Parts status update ─────────────────────────────────────────────────────

  async function handlePartStatusUpdate(partId: string, newStatus: string, nextDept?: string) {
    const snapshot = parts;
    setUpdatingPartId(partId);
    // Optimistic — remove Archived/Passed QC from list, otherwise update in-place
    if (newStatus === 'Archived') {
      setParts((prev) => prev.filter((p) => p.id !== partId));
    } else {
      setParts((prev) => prev.map((p) =>
        p.id === partId ? { ...p, status: newStatus, ...(nextDept !== undefined && { next_dept: nextDept }) } : p
      ));
    }
    setExpandedPartId(null);
    try {
      const update: Record<string, string> = { status: newStatus };
      if (nextDept !== undefined) update.next_dept = nextDept;
      const { error } = await supabase.from('parts_log').update(update).eq('id', partId);
      if (error) throw error;
      showToast('Status updated');
      if (tenant && (newStatus === 'Passed QC' || newStatus === 'Failed QC / Rework')) {
        const part = snapshot.find((p) => p.id === partId);
        callAnalytics(tenant.id, 'qc_result', {
          result: newStatus === 'Passed QC' ? 'pass' : 'fail',
          dept:   part?.dept ?? null,
        });
      }
    } catch (err: unknown) {
      setParts(snapshot);
      showToast(err instanceof Error ? err.message : 'Update failed', true);
    } finally {
      setUpdatingPartId(null);
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────────

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/');
  };

  // ── Billing actions ─────────────────────────────────────────────────────────
  // Open the Stripe customer portal (manage card / invoices / cancel). Posts the
  // current access token; opens the returned URL in a new tab.
  const openBillingPortal = useCallback(async () => {
    if (!tenant) return;
    setBillingBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast('Please sign in again', true); return; }
      const res = await fetch('/app/api/stripe/portal', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not open billing');
      window.open(json.url, '_blank', 'noopener');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not open billing', true);
    } finally {
      setBillingBusy(false);
    }
  }, [tenant, showToast]);

  // Start (or change to) a paid plan via Stripe Checkout.
  const startCheckout = useCallback(async (tier: 'shop' | 'operations', billing: 'monthly' | 'annual') => {
    if (!tenant) return;
    setBillingBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { showToast('Please sign in again', true); return; }
      const res = await fetch('/app/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ tier, billing, tenant_id: tenant.id }),
      });
      const json = await res.json() as { url?: string; error?: string };
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Could not start checkout');
      window.location.assign(json.url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not start checkout', true);
      setBillingBusy(false);
    }
  }, [tenant, showToast]);

  // These must be above the early return so useMemo is never called conditionally
  const openNeeds  = needs.filter((n)  => !['resolved', 'closed', 'received', 'cancelled'].includes((n.status  ?? 'open').toLowerCase()));
  const openDamage = damage.filter((d) => !['resolved', 'closed'].includes((d.status ?? 'open').toLowerCase()));
  // Inventory view split: active = pending/ordered (default + badge); resolved =
  // received/cancelled (revealed via the archive toggle). craftsman_material is
  // never shown in the inventory tab. All rows stay in the DB regardless.
  const activeNeeds   = needs.filter((n) => ['pending', 'ordered'].includes((n.status ?? 'pending').toLowerCase()));
  const resolvedNeeds = needs.filter((n) => ['received', 'cancelled'].includes((n.status ?? '').toLowerCase()));

  const proactiveFlags = useMemo((): ProactiveFlag[] => {
    const flags: ProactiveFlag[] = [];
    const now = Date.now();
    activeCrew.forEach((c) => {
      const hrs = (now - new Date(c.clock_in).getTime()) / 3600000;
      if (hrs > 12) flags.push({
        trigger: `${c.worker_name} (${c.dept}) has been clocked in for ${Math.floor(hrs)}h`,
        action:  'Verify they clocked out properly or check in with them.',
        severity: 'watch',
      });
    });
    const itemCounts: Record<string, number> = {};
    openNeeds.forEach((n) => {
      const k = n.item.toLowerCase().trim();
      itemCounts[k] = (itemCounts[k] ?? 0) + 1;
    });
    Object.entries(itemCounts).forEach(([item, count]) => {
      if (count >= 2) flags.push({
        trigger: `"${item}" has been requested ${count} times`,
        action:  'Consolidate orders or mark duplicates resolved.',
        severity: 'watch',
      });
    });
    openDamage.forEach((d) => {
      const ageHrs = (now - new Date(d.created_at).getTime()) / 3600000;
      if (ageHrs > 48) flags.push({
        trigger: `Damage report on "${d.part_name}" has been open for ${Math.floor(ageHrs / 24)} days`,
        action:  'Review and update the status of this damage report.',
        severity: 'alert',
      });
    });
    const activeDepts = new Set(activeCrew.map((c) => c.dept));
    departments.forEach((dept) => {
      if (!activeDepts.has(dept)) flags.push({
        trigger: `No ${dept} crew clocked in today`,
        action:  `Check if ${dept} is scheduled today.`,
        severity: 'watch',
      });
    });
    return flags;
  }, [activeCrew, openNeeds, openDamage, departments]);

  if (sessionLoading) return <Spinner />;

  // A *free* trial = trialing status with no paid plan yet. A paid subscription
  // inside its 30-day trial window reports Stripe status 'trialing' (→ 'trial')
  // too, but the tenant already has a paid plan + card on file, so the upgrade
  // banner/countdown must not show for them.
  const isTrial = tenant?.subscription_status === 'trial' && !isPaidPlan(tenant?.plan ?? null);
  const isPastDue = tenant?.subscription_status === 'past_due';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);
  // Partner accounts: while inside their partner trial, suppress the trial
  // banner entirely. Once it ends, show the soft lifetime-discount banner.
  const partnerActive = tenant ? isPartnerActive(tenant) : false;
  const partnerEnded = !!tenant?.is_partner && !partnerActive;

  // True unread = crew messages (sender ≠ Supervisor) the supervisor hasn't opened yet
  // (read_at IS NULL). Persisted in Supabase, so it survives across devices/sessions.
  // Unread = crew chat messages the supervisor hasn't opened yet. Clock-in/out
  // requests are action items, not chat, so they're excluded from the badge.
  const unreadMessages = messages.filter(isUnreadChat).length;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview',      label: 'Overview' },
    { key: 'crew',          label: 'Crew' },
    { key: 'assembly',      label: 'Assembly' },
    { key: 'qc',            label: 'QC',          count: qcCount > 0 ? qcCount : undefined },
    { key: 'craftsman',     label: 'Craftsman',   count: craftsmanCount > 0 ? craftsmanCount : undefined },
    { key: 'messages',      label: 'Messages',    count: unreadMessages > 0 ? unreadMessages : undefined },
    { key: 'needs',         label: 'Inventory',   count: activeNeeds.length },
    { key: 'damage',        label: 'Damage',      count: openDamage.length },
    { key: 'plans',         label: 'Plans',       count: plans.length > 0 ? plans.length : undefined },
    { key: 'sops',          label: 'SOPs',        count: sops.length > 0 ? sops.length : undefined },
    { key: 'ai',            label: 'AI' },
    { key: 'integrations',  label: 'Integrations' },
    { key: 'reports',       label: 'Reports' },
    { key: 'settings',      label: 'Settings' },
  ];

  // ── Left sidebar (desktop) — thin-stroke icon per tab, grouped into sections.
  // Reads label/count straight from `tabs`; the sidebar simply renders from it.
  const tabByKey = Object.fromEntries(tabs.map((t) => [t.key, t])) as Record<Tab, { key: Tab; label: string; count?: number }>;
  const navIcon: Record<Tab, React.ReactNode> = {
    overview:     (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>),
    crew:         (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>),
    assembly:     (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>),
    qc:           (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>),
    craftsman:    (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>),
    messages:     (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>),
    needs:        (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>),
    damage:       (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>),
    plans:        (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>),
    sops:         (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>),
    ai:           (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>),
    integrations: (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>),
    reports:      (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>),
    settings:     (<svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>),
  };
  const navGroups: { label: string | null; keys: Tab[] }[] = [
    { label: null,             keys: ['overview'] },
    { label: 'Shop Floor',     keys: ['crew', 'assembly', 'qc', 'craftsman'] },
    { label: 'Communications', keys: ['messages', 'needs', 'damage'] },
    { label: 'Resources',      keys: ['plans', 'sops'] },
    { label: 'System',         keys: ['ai', 'integrations', 'reports', 'settings'] },
  ];

  // ── Thread computation for Messages tab ────────────────────────────────────
  // Groups messages by dept; null dept = broadcast (__broadcast__ key)
  const threadMap: Record<string, Message[]> = {};
  messages.forEach((msg) => {
    const key = msg.dept ?? '__broadcast__';
    if (!threadMap[key]) threadMap[key] = [];
    threadMap[key].push(msg);
  });
  const msgThreads = Object.entries(threadMap)
    .map(([deptKey, msgs]) => ({
      deptKey,
      label: deptKey === '__broadcast__' ? 'All Departments (Broadcast)' : deptKey,
      count: msgs.length,
      lastMsg: msgs.reduce((l, m) => new Date(m.created_at) > new Date(l.created_at) ? m : l),
    }))
    .sort((a, b) => new Date(b.lastMsg.created_at).getTime() - new Date(a.lastMsg.created_at).getTime());

  const openThreadMsgs = openThread
    ? (threadMap[openThread] ?? []).slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    : [];
  const openThreadLabel = openThread === '__broadcast__' ? 'All Departments' : (openThread ?? '');

  const todayStart      = new Date(); todayStart.setHours(0, 0, 0, 0);
  const activeBuilds    = craftsmanBuilds.filter((b) => !b.clock_out);
  const completedBuilds = craftsmanBuilds.filter((b) => b.clock_out && new Date(b.clock_in) >= todayStart);

  const thStyle: React.CSSProperties = { padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' };
  const tdStyle: React.CSSProperties = { padding: '12px 20px', fontSize: 13, color: 'var(--ink-dim)' };
  const tdBold:  React.CSSProperties = { ...tdStyle, fontSize: 14, fontWeight: 600, color: 'var(--ink)' };

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
      <div className="app-shell" style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', minHeight: 52, display: 'flex', alignItems: 'center', padding: '0 20px', paddingTop: 'env(safe-area-inset-top)', justifyContent: 'space-between' }}>
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
          <button onClick={handleSignOut} className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>Sign out</button>
        </div>

        {isTrial && !partnerActive && <TrialBanner days={days} />}
        {partnerEnded && <PartnerEndedBanner discount={tenant?.partner_discount ?? 0} />}
        {isPastDue && <PastDueBanner onManage={() => void openBillingPortal()} busy={billingBusy} />}

        <OfflineBanner tenantId={tenant?.id} onSynced={loadAll} />

        {tenant && <PushPrompt tenantId={tenant.id} userType="supervisor" userName="Supervisor" />}

        {/* Responsive nav: fixed left sidebar on desktop, hidden on mobile (the
            bottom nav + More drawer handle mobile, unchanged). */}
        <style>{`
          @media (max-width: 767px) { .sup-sidebar { display: none !important; } .sup-main { margin-left: 0 !important; } }
          @media (min-width: 768px) { .sup-sidebar { display: flex !important; } .sup-main { margin-left: 220px !important; } }
          .sup-nav-item:not(.active):hover { background: rgba(255,255,255,0.03) !important; color: var(--ink) !important; }
        `}</style>

        <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>

          {/* ── Left sidebar (desktop only) ── */}
          <aside className="sup-sidebar" style={{ position: 'fixed', top: 52, left: 0, bottom: 0, width: 220, zIndex: 40, background: 'rgba(5,6,8,0.95)', borderRight: '1px solid var(--line)', backdropFilter: 'blur(14px)', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', paddingTop: 8, paddingBottom: 24 }}>
            {navGroups.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', padding: '16px 18px 6px', opacity: 0.5 }}>{group.label}</div>
                )}
                {group.keys.map((key) => {
                  const t = tabByKey[key];
                  if (!t) return null;
                  const active = tab === key;
                  return (
                    <button
                      key={key}
                      className={active ? 'sup-nav-item active' : 'sup-nav-item'}
                      onClick={() => { setTab(key); setOpenThread(null); setMsgBody(''); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: active ? 'rgba(45,225,201,0.08)' : 'none', borderLeft: active ? '3px solid var(--teal)' : '3px solid transparent', borderTop: 'none', borderRight: 'none', borderBottom: 'none', color: active ? 'var(--teal)' : 'var(--ink-mute)', fontSize: 13.5, fontWeight: active ? 700 : 500, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'color 0.15s, background 0.15s', whiteSpace: 'nowrap' }}
                    >
                      <span style={{ display: 'flex', flexShrink: 0 }}>{navIcon[key]}</span>
                      {t.label}
                      {t.count !== undefined && t.count > 0 && (
                        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: active ? 'rgba(45,225,201,0.15)' : 'rgba(255,255,255,0.06)', color: active ? 'var(--teal)' : 'var(--ink-mute)' }}>
                          {t.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </aside>

        <main className="sup-main" style={{ flex: 1, minWidth: 0, padding: '40px 24px 96px', overflowX: 'hidden' }}>

          {/* Header */}
          <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Supervisor Dashboard</div>
              <h2 style={{ fontSize: 28 }}>{tenant?.shop_name ?? 'My Shop'}</h2>
              <Link
                href="/app"
                style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, textDecoration: 'none' }}
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                Switch Role
              </Link>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Notification bell */}
              <button
                onClick={() => { setNotifOpen(true); void markAllNotificationsRead(); }}
                aria-label="Notifications"
                style={{ position: 'relative', background: 'none', border: '1px solid var(--line)', borderRadius: 10, cursor: 'pointer', color: 'var(--ink-dim)', padding: '8px 10px', display: 'flex', alignItems: 'center' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
                {notifUnread > 0 && (
                  <span style={{ position: 'absolute', top: -6, right: -6, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#F87171', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {notifUnread > 9 ? '9+' : notifUnread}
                  </span>
                )}
              </button>
              <button onClick={loadAll} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Refresh
              </button>
            </div>
          </div>

          {/* KPI strip — 2×2 on mobile, 4×1 on desktop */}
          <div className="kpi-grid" style={{ gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Crew Clocked In',      value: dataLoading ? '—' : String(activeCrew.length),  color: '#2DE1C9' },
              { label: 'Unread Messages',       value: dataLoading ? '—' : String(unreadMessages),     color: '#5EEAD4' },
              { label: 'Open Inventory Needs',  value: dataLoading ? '—' : String(openNeeds.length),   color: '#FBBF24' },
              { label: 'Open Damage Reports',   value: dataLoading ? '—' : String(openDamage.length),  color: '#F87171' },
            ].map(({ label, value, color }) => (
              <div key={label} className="portal-card kpi-card">
                <div className="portal-stat-value" style={{ color }}>{value}</div>
                <div className="portal-stat-label">{label}</div>
              </div>
            ))}
          </div>

          {/* Universal job search — always visible (Part 1) */}
          {tenant && (
            <div style={{ marginBottom: 24 }}>
              <JobSearch tenantId={tenant.id} onSelect={handleSearchSelect} />
            </div>
          )}

          {/* ── Overview tab ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <style>{`@keyframes craftsPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

              {/* ── Production Pipeline ── */}
              {pipeline.length > 0 && (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Production Pipeline</span>
                  </div>
                  {pipeline.map((p) => {
                    const total = p.cabinetsTotal || 1;
                    const seg = (n: number) => `${(n / total) * 100}%`;
                    const isExpanded = expandedJob === p.jobNumber;
                    return (
                      <div key={p.jobNumber}>
                      <button onClick={() => setExpandedJob((cur) => cur === p.jobNumber ? null : p.jobNumber)}
                        style={{ width: '100%', textAlign: 'left', background: isExpanded ? 'rgba(45,225,201,0.04)' : 'none', border: 'none', borderBottom: '1px solid var(--line)', cursor: 'pointer', padding: '14px 20px', fontFamily: 'inherit' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}><polyline points="9 18 15 12 9 6"/></svg>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.jobPath.split('/').join(' / ')}</span>
                          {p.dueDate && (() => { const m = dueMeta(p.dueDate); return (
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${m.color}22`, color: m.color, ...(m.overdue ? { animation: 'craftsPulse 1.4s ease-in-out infinite' } : {}) }}>Due {m.label}</span>
                          ); })()}
                          {/* Split dept badges — which depts share this job's split cabinets */}
                          {p.splitDepts.map((d) => {
                            const c = deptColor(d);
                            return (
                              <span key={d} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${c}22`, color: c, border: `1px solid ${c}40` }}>{d}</span>
                            );
                          })}
                          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)' }}>{p.cabinetsTotal} cabinet{p.cabinetsTotal === 1 ? '' : 's'}</span>
                        </div>
                        {/* 5-segment pipeline bar: Production | Craftsman | Assembly | Finishing | Done */}
                        <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
                          <div title="Production" style={{ width: seg(p.production), background: '#2DE1C9', transition: 'width .3s' }} />
                          <div title="Craftsman"  style={{ width: seg(p.craftsman),  background: '#A78BFA', transition: 'width .3s' }} />
                          <div title="Assembly"   style={{ width: seg(p.assembly),   background: '#3B82F6', transition: 'width .3s' }} />
                          <div title="Finishing"  style={{ width: seg(p.finishing),  background: '#F97316', transition: 'width .3s' }} />
                          <div title="Done"       style={{ width: seg(p.done),       background: '#34D399', transition: 'width .3s' }} />
                        </div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 7 }}>
                          {p.cabinetsCut}/{p.cabinetsTotal} cabinets cut · {p.craftsman} in craftsman · {p.assembly} in assembly{p.finishing > 0 ? ` · ${p.finishing} finishing` : ''}{p.done > 0 ? ` · ${p.done} done` : ''}
                        </div>
                      </button>
                      {isExpanded && tenant && (
                        <JobDrillDown tenantId={tenant.id} jobNumber={p.jobNumber} showToast={showToast} />
                      )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Active crew clock-in table */}
              <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                  Active Crew — Clocked In Now
                </div>
                {dataLoading ? (
                  <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
                ) : activeCrew.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No crew currently clocked in.</div>
                ) : (
                  <>
                    {/* Desktop — table */}
                    <div className="crew-table-wrap">
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--line)' }}>
                            {['Name', 'Department', 'Clocked In', ''].map((h) => (
                              <th key={h} style={thStyle}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {activeCrew.map((row) => (
                            <>
                              <tr key={row.id} style={{ borderBottom: expandedCrewId === row.id ? 'none' : '1px solid var(--line)' }}>
                                <td style={tdBold}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {row.worker_name}
                                    {row.on_break && (
                                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.15)', color: '#FBBF24', whiteSpace: 'nowrap' }}>ON BREAK</span>
                                    )}
                                  </div>
                                </td>
                                <td style={tdStyle}>
                                  {row.current_dept || row.dept}
                                  {pausedProjects[row.worker_name] && (
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', marginTop: 3 }}>
                                      Paused: {pausedProjects[row.worker_name].unit_label} · {fmtAccumulated(pausedProjects[row.worker_name].accumulated_seconds ?? 0)}
                                    </div>
                                  )}
                                </td>
                                <td style={tdStyle}>{formatTime(row.clock_in)}</td>
                                <td style={{ ...tdStyle, textAlign: 'right' }}>
                                  <button
                                    onClick={() => toggleCrewTimeline(row.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', alignItems: 'center' }}
                                    title="View shift timeline"
                                  >
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                      style={{ transition: 'transform 0.2s', transform: expandedCrewId === row.id ? 'rotate(180deg)' : 'none' }}>
                                      <polyline points="6 9 12 15 18 9"/>
                                    </svg>
                                  </button>
                                </td>
                              </tr>
                              {expandedCrewId === row.id && (
                                <tr key={`${row.id}-timeline`} style={{ borderBottom: '1px solid var(--line)' }}>
                                  <td colSpan={4} style={{ padding: '4px 20px 16px' }}>
                                    <ShiftTimeline
                                      events={crewTimelines[row.id]}
                                      clockRow={row}
                                      loading={!!timelineLoading[row.id]}
                                    />
                                  </td>
                                </tr>
                              )}
                            </>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {/* Mobile — cards */}
                    <div className="crew-cards-wrap">
                      {activeCrew.map((row) => (
                        <div key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{row.worker_name}</div>
                                {row.on_break && (
                                  <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(251,191,36,0.15)', color: '#FBBF24' }}>ON BREAK</span>
                                )}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{row.current_dept || row.dept}</div>
                              {pausedProjects[row.worker_name] && (
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', marginTop: 2 }}>
                                  Paused: {pausedProjects[row.worker_name].unit_label} · {fmtAccumulated(pausedProjects[row.worker_name].accumulated_seconds ?? 0)}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-dim)' }}>{formatTime(row.clock_in)}</div>
                              <button
                                onClick={() => toggleCrewTimeline(row.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}
                              >
                                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                                  style={{ transition: 'transform 0.2s', transform: expandedCrewId === row.id ? 'rotate(180deg)' : 'none' }}>
                                  <polyline points="6 9 12 15 18 9"/>
                                </svg>
                              </button>
                            </div>
                          </div>
                          {expandedCrewId === row.id && (
                            <div style={{ padding: '0 16px 14px' }}>
                              <ShiftTimeline
                                events={crewTimelines[row.id]}
                                clockRow={row}
                                loading={!!timelineLoading[row.id]}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Craftsman Build Activity */}
              {(activeBuilds.length > 0 || completedBuilds.length > 0 || !dataLoading) && (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2DE1C9' }}>Craftsman Build Activity</span>
                    {activeBuilds.length > 0 && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(45,225,201,0.12)', color: '#2DE1C9' }}>
                        {activeBuilds.length} active
                      </span>
                    )}
                    {/* craftsTick drives elapsed recalc every minute */}
                    <span style={{ display: 'none' }}>{craftsTick}</span>
                  </div>

                  {dataLoading ? (
                    <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
                  ) : activeBuilds.length === 0 && completedBuilds.length === 0 ? (
                    <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No craftsman build activity today.</div>
                  ) : (
                    <>
                      {activeBuilds.length > 0 && (
                        <>
                          <div style={{ padding: '8px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Active</div>
                          {activeBuilds.map((b) => (
                            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--line)' }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2DE1C9', flexShrink: 0, animation: 'craftsPulse 2s ease-in-out infinite' }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{b.worker_name}</div>
                                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {b.notes ?? 'Craftsman Build'}{b.job_number ? ` · Job ${b.job_number}` : ''}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#2DE1C9', fontVariantNumeric: 'tabular-nums' }}>{elapsed(b.clock_in)}</div>
                                <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>Craftsman Build</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                      {completedBuilds.length > 0 && (
                        <>
                          <div style={{ padding: '8px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Completed Today</div>
                          {completedBuilds.map((b) => (
                            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--line)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{b.worker_name}</div>
                                <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {b.notes ?? 'Craftsman Build'}{b.job_number ? ` · Job ${b.job_number}` : ''}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 700, color: '#34D399' }}>
                                  {b.total_hours != null ? `${b.total_hours.toFixed(2)}h` : elapsed(b.clock_in)}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 2 }}>Craftsman Build</div>
                              </div>
                            </div>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Parts & QC */}
              {parts.length > 0 && (() => {
                const STATUS_META: Record<string, { color: string; bg: string; order: number }> = {
                  'QC Check':             { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)',    order: 0 },
                  'Failed QC / Rework':   { color: '#F87171', bg: 'rgba(248,113,113,0.1)',   order: 1 },
                  'In Progress':          { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)',    order: 2 },
                  'Moving to Next Stage': { color: '#60A5FA', bg: 'rgba(96,165,250,0.1)',    order: 3 },
                  'Passed QC':            { color: '#34D399', bg: 'rgba(52,211,153,0.1)',    order: 4 },
                };
                const NEXT_DEPTS = Array.from(new Set([...departments, 'Installation']));
                const grouped: Record<string, PartLog[]> = {};
                parts.forEach((p) => {
                  const k = p.status;
                  if (!grouped[k]) grouped[k] = [];
                  grouped[k].push(p);
                });
                const sortedStatuses = Object.keys(grouped).sort(
                  (a, b) => (STATUS_META[a]?.order ?? 9) - (STATUS_META[b]?.order ?? 9)
                );
                const qcCount = (grouped['QC Check'] ?? []).length;
                return (
                  <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#60A5FA' }}>Parts & QC</span>
                      {qcCount > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(251,191,36,0.15)', color: '#FBBF24' }}>
                          {qcCount} need QC
                        </span>
                      )}
                    </div>
                    {sortedStatuses.map((status) => {
                      const meta = STATUS_META[status] ?? { color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)', order: 9 };
                      return (
                        <div key={status}>
                          <div style={{ padding: '8px 20px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: meta.color }}>
                            {status}
                          </div>
                          {grouped[status].map((p) => {
                            const isOpen = expandedPartId === p.id;
                            const isUpdating = updatingPartId === p.id;
                            const pendingNextDept = nextDeptFor[p.id] ?? '';
                            return (
                              <div key={p.id} style={{ borderBottom: '1px solid var(--line)', opacity: isUpdating ? 0.5 : 1, transition: 'opacity 0.15s' }}>
                                {/* Collapsed header row — always visible */}
                                <div
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => setExpandedPartId(isOpen ? null : p.id)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setExpandedPartId(isOpen ? null : p.id); }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 20px', cursor: 'pointer', userSelect: 'none' }}
                                >
                                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.part_name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>
                                      {p.job_number ? `Job ${p.job_number} · ` : ''}
                                      {p.dept ?? '—'}{' · '}
                                      {p.worker_name ?? 'Unknown'}{' · '}
                                      {formatTime(p.created_at)}
                                    </div>
                                  </div>
                                  {/* Chevron */}
                                  <svg
                                    width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                                    style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                                  >
                                    <polyline points="6 9 12 15 18 9" />
                                  </svg>
                                </div>

                                {/* Expanded detail panel */}
                                {isOpen && (
                                  <div style={{ padding: '0 20px 16px 42px', background: 'rgba(255,255,255,0.02)' }}>
                                    {/* Detail grid */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: 14 }}>
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Part</div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{p.part_name}</div>
                                      </div>
                                      {p.job_number && (
                                        <div>
                                          <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Job / Project</div>
                                          <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{p.job_number}</div>
                                        </div>
                                      )}
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Department</div>
                                        <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{p.dept ?? '—'}</div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Worker</div>
                                        <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{p.worker_name ?? '—'}</div>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Status</div>
                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: meta.bg, color: meta.color }}>{p.status}</span>
                                      </div>
                                      <div>
                                        <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Logged</div>
                                        <div style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{formatTime(p.created_at)}</div>
                                      </div>
                                      {p.next_dept && (
                                        <div>
                                          <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Next Dept</div>
                                          <div style={{ fontSize: 13, color: '#60A5FA' }}>{p.next_dept}</div>
                                        </div>
                                      )}
                                    </div>

                                    {/* Notes */}
                                    {p.notes && (
                                      <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6, fontSize: 13, color: 'var(--ink-dim)', borderLeft: '3px solid var(--line-strong)' }}>
                                        {p.notes}
                                      </div>
                                    )}

                                    {/* Photo */}
                                    {p.photo_url && (
                                      <div style={{ marginBottom: 14 }}>
                                        <a href={p.photo_url} target="_blank" rel="noopener noreferrer">
                                          <img src={p.photo_url} alt="part" style={{ height: 80, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)', cursor: 'zoom-in' }} />
                                        </a>
                                      </div>
                                    )}

                                    {/* Next dept selector for Moving to Next Stage */}
                                    <div style={{ marginBottom: 10 }}>
                                      <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>Move to next stage — select dept first:</div>
                                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {NEXT_DEPTS.map((d) => (
                                          <button
                                            key={d}
                                            onClick={() => setNextDeptFor((prev) => ({ ...prev, [p.id]: d }))}
                                            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${pendingNextDept === d ? '#60A5FA' : 'var(--line)'}`, background: pendingNextDept === d ? 'rgba(96,165,250,0.15)' : 'none', color: pendingNextDept === d ? '#60A5FA' : 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }}
                                          >
                                            {d}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Action buttons */}
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                      <button
                                        onClick={() => { void handlePartStatusUpdate(p.id, 'Passed QC'); }}
                                        disabled={isUpdating}
                                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: 'none', background: 'rgba(52,211,153,0.15)', color: '#34D399', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Approve
                                      </button>
                                      <button
                                        onClick={() => { void handlePartStatusUpdate(p.id, 'Failed QC / Rework'); }}
                                        disabled={isUpdating}
                                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: 'none', background: 'rgba(248,113,113,0.15)', color: '#F87171', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Send to Rework
                                      </button>
                                      <button
                                        onClick={() => {
                                          if (!pendingNextDept) { showToast('Select a next department first', true); return; }
                                          void handlePartStatusUpdate(p.id, 'Moving to Next Stage', pendingNextDept);
                                        }}
                                        disabled={isUpdating}
                                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: 'none', background: pendingNextDept ? 'rgba(96,165,250,0.15)' : 'rgba(255,255,255,0.06)', color: pendingNextDept ? '#60A5FA' : 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Mark Complete
                                      </button>
                                      <button
                                        onClick={() => { void handlePartStatusUpdate(p.id, 'Archived'); }}
                                        disabled={isUpdating}
                                        style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontFamily: 'inherit' }}
                                      >
                                        Dismiss
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* ── Jobs ── */}
              <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A78BFA' }}>Active Jobs</span>
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{jobs.filter((j) => j.status === 'active' && !j.archived).length} jobs</span>
                </div>

                {jobs.filter((j) => j.status === 'active' && !j.archived).length === 0 ? (
                  <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--ink-mute)' }}>No active jobs. Upload a CSV cut list in the Plans tab to get started.</div>
                ) : (
                  jobs.filter((j) => j.status === 'active' && !j.archived).map((j) => {
                    const open = expandedJobId === j.id;
                    return (
                    <div key={j.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      {/* header row — tap the job name to expand / collapse */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px' }}>
                        <button
                          onClick={() => setExpandedJobId((cur) => (cur === j.id ? null : j.id))}
                          aria-expanded={open}
                          style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', padding: 0 }}
                        >
                          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6"/></svg>
                          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{j.job_path ? titleCasePath(j.job_path).split('/').join(' / ') : j.job_number}</span>
                          {j.job_name && !j.job_path && <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{toTitleCase(j.job_name)}</span>}
                        </button>
                        <button
                          onClick={() => setCompleteJobTarget(j)}
                          className="btn btn-ghost"
                          style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: 'var(--teal)', borderColor: 'rgba(45,225,201,0.3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          title="Complete job"
                        >
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          Complete
                        </button>
                        <button
                          onClick={() => { void handleDeleteJob(j.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', alignItems: 'center' }}
                          title="Delete job"
                        >
                          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      </div>
                      {/* expanded body — details + finish specs */}
                      {open && (
                        <div style={{ margin: '0 20px 12px', padding: '12px 14px', borderLeft: '2px solid var(--teal)', background: 'rgba(45,225,201,0.05)', borderRadius: '0 8px 8px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            {j.due_date && (() => { const m = dueMeta(j.due_date); return (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: `${m.color}22`, color: m.color, ...(m.overdue ? { animation: 'craftsPulse 1.4s ease-in-out infinite' } : {}) }}>
                                Due {m.label}
                              </span>
                            ); })()}
                            {j.install_date && j.install_date !== j.due_date && (
                              <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Install {new Date(j.install_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                            )}
                            <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>Job #{j.job_number}</span>
                            {(() => { const c = laborByJob[j.job_number]; return c && c > 0 ? (
                              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)' }}>Labor to date: ${c.toFixed(2)}</span>
                            ) : null; })()}
                            <SourceBadge source={j.source} />
                          </div>
                          <div>
                            <button
                              onClick={() => setFinishSpecsJob(j)}
                              className="btn btn-ghost"
                              style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#A78BFA', borderColor: 'rgba(167,139,250,0.3)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                              title="Finish specs"
                            >
                              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7Z"/><path d="M9 21h6"/></svg>
                              Finish Specs
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    );
                  })
                )}
              </div>

              {/* ── Archived Jobs ── */}
              {(() => {
                const archived = jobs
                  .filter((j) => j.archived === true)
                  .sort((a, b) => new Date(b.archived_at ?? b.completed_at ?? 0).getTime() - new Date(a.archived_at ?? a.completed_at ?? 0).getTime());
                if (archived.length === 0) return null;
                return (
                  <div className="portal-card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
                    <button
                      onClick={() => setArchiveOpen((o) => !o)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Archived Jobs ({archived.length})</span>
                      <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ transform: archiveOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}><path d="M6 9l6 6 6-6"/></svg>
                    </button>
                    {archiveOpen && archived.map((j) => {
                      const cabinetCount = pipeline.find((p) => p.jobNumber === j.job_number)?.cabinetsTotal;
                      const labor = laborByJob[j.job_number];
                      return (
                        <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-dim)' }}>{jobLabel(j)}</div>
                            <div style={{ fontSize: 11.5, color: 'var(--ink-mute)', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                              {j.completed_at && <span>Completed {new Date(j.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
                              {cabinetCount != null && <span>{cabinetCount} cabinet{cabinetCount === 1 ? '' : 's'}</span>}
                              {labor != null && labor > 0 && <span style={{ color: 'var(--teal)' }}>Labor ${labor.toFixed(2)}</span>}
                            </div>
                          </div>
                          <button onClick={() => { void handleRestoreJob(j); }} className="btn btn-ghost" style={{ flexShrink: 0, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>Restore</button>
                          <button onClick={() => setDeleteArchiveTarget(j)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }} title="Delete permanently">
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

            </div>
          )}

          {/* ── Crew tab ──────────────────────────────────────────────────────── */}
          {tab === 'crew' && tenant && (
            <CrewTab tenant={tenant} departments={departments} showToast={showToast} />
          )}

          {/* ── Messages tab — Inbox ──────────────────────────────────────────── */}
          {tab === 'messages' && openThread === null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* New Message — opens a conversation for the chosen department */}
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() => setComposeOpen((o) => !o)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                  New Message
                </button>
                {composeOpen && (
                  <div className="portal-card" style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <select
                      className="form-input"
                      value={msgDept}
                      onChange={(e) => setMsgDept(e.target.value)}
                      style={{ flex: '1 1 220px', cursor: 'pointer' }}
                    >
                      <option value="">All Departments (broadcast)</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary"
                      style={{ flexShrink: 0 }}
                      onClick={() => { const key = msgDept || '__broadcast__'; markThreadRead(key); setOpenThread(key); setComposeOpen(false); setConvMenuOpen(false); setMsgBody(''); }}
                    >
                      Open conversation
                    </button>
                  </div>
                )}
              </div>

              {/* Thread list — one row per department, fully tappable, no delete here */}
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : msgThreads.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No messages yet. Tap New Message to start a conversation.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {msgThreads.map(({ deptKey, label, lastMsg }, i) => {
                    const unread = threadMap[deptKey].filter(isUnreadChat).length;
                    const pendingReqs = threadMap[deptKey].filter((m) => isClockRequest(m) && (m.payload?.status ?? 'pending') === 'pending').length;
                    const initial = (label.trim()[0] ?? '?').toUpperCase();
                    return (
                      <div
                        key={deptKey}
                        role="button"
                        tabIndex={0}
                        onClick={() => { markThreadRead(deptKey); setOpenThread(deptKey); setConvMenuOpen(false); setMsgBody(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { markThreadRead(deptKey); setOpenThread(deptKey); setConvMenuOpen(false); setMsgBody(''); } }}
                        onMouseEnter={() => setHoverThread(deptKey)}
                        onMouseLeave={() => setHoverThread(null)}
                        style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '14px 20px', cursor: 'pointer', borderBottom: i < msgThreads.length - 1 ? '1px solid var(--line)' : 'none', background: hoverThread === deptKey ? 'rgba(94,234,212,0.03)' : 'none', transition: 'background 0.1s' }}
                      >
                        {/* Unread dot */}
                        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: unread > 0 ? 'var(--teal)' : 'transparent' }} />
                        {/* Dept-initial avatar */}
                        <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(94,234,212,0.12)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18, fontWeight: 700 }}>
                          {initial}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: lastMsg.sender_name === 'Supervisor' ? 'var(--teal)' : 'var(--ink-dim)', fontWeight: 600 }}>{lastMsg.sender_name}:</span>{' '}
                            {lastMsg.body.length > 80 ? lastMsg.body.slice(0, 77) + '…' : lastMsg.body}
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{relativeTime(lastMsg.created_at)}</span>
                          {unread > 0 && (
                            <span style={{ minWidth: 20, textAlign: 'center', fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 10, background: 'var(--teal)', color: '#04201c' }}>{unread}</span>
                          )}
                          {pendingReqs > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: 'rgba(251,191,36,0.14)', color: '#FBBF24' }}>
                              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                              {pendingReqs}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Messages tab — Conversation ───────────────────────────────────── */}
          {tab === 'messages' && openThread !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, overflowX: 'hidden', maxWidth: '100%' }}>

              {/* Header: < Back · dept name (center) · three-dot menu */}
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => { setOpenThread(null); setMsgBody(''); setConvMenuOpen(false); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 13, transition: 'color 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-mute)'; }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Back
                </button>
                <span style={{ flex: 1, textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
                  {openThreadLabel}
                </span>
                <button
                  onClick={() => setConvMenuOpen((o) => !o)}
                  aria-label="Conversation menu"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex' }}
                >
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
                </button>
                {convMenuOpen && (
                  <div style={{ position: 'absolute', top: 32, right: 0, zIndex: 20, minWidth: 200, background: '#11151a', border: '1px solid var(--line-strong)', borderRadius: 12, padding: 6, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
                    <button
                      onClick={() => { setConvMenuOpen(false); void handleDeleteThread(openThread, openThreadLabel); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#F87171', fontSize: 13.5, fontWeight: 600, fontFamily: 'inherit' }}
                    >
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      Delete all messages
                    </button>
                  </div>
                )}
              </div>

              {/* Clock-in/out adjustment requests — action cards (not chat) */}
              {openThreadMsgs.filter(isClockRequest).map((m) => {
                const p = m.payload;
                if (!p) return null;
                const status = p.status ?? 'pending';
                const isIn = m.topic === 'clock_in_request';
                return (
                  <div key={m.id} style={{ borderRadius: 14, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)', borderLeft: '3px solid #FBBF24', padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#FBBF24' }}>
                        {isIn ? 'Clock-In Request' : 'Clock-Out Request'}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{p.worker_name}</div>
                    <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 4 }}>
                      Requested time: <b style={{ color: 'var(--ink)' }}>{formatTime(p.requested_time)}</b>
                      {!isIn && p.clock_in && <> · in since {formatTime(p.clock_in)}</>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 2 }}>Dept: {p.dept ?? '—'}</div>
                    {p.reason && <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 6 }}>Reason: {p.reason}</div>}
                    {status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                        <button
                          onClick={() => void resolveClockRequest(m, true)}
                          disabled={resolvingReq === m.id}
                          style={{ flex: 1, padding: '9px 0', borderRadius: 9, background: '#2DE1C9', color: '#001a0d', border: 'none', fontWeight: 700, fontSize: 13, cursor: resolvingReq === m.id ? 'wait' : 'pointer', opacity: resolvingReq === m.id ? 0.6 : 1 }}
                        >
                          {resolvingReq === m.id ? '…' : 'Approve'}
                        </button>
                        <button
                          onClick={() => void resolveClockRequest(m, false)}
                          disabled={resolvingReq === m.id}
                          style={{ flex: 1, padding: '9px 0', borderRadius: 9, background: 'transparent', color: '#F87171', border: '1px solid rgba(248,113,113,0.4)', fontWeight: 700, fontSize: 13, cursor: resolvingReq === m.id ? 'wait' : 'pointer', opacity: resolvingReq === m.id ? 0.6 : 1 }}
                        >
                          Deny
                        </button>
                      </div>
                    ) : (
                      <div style={{ marginTop: 12, fontSize: 12.5, fontWeight: 700, color: status === 'approved' ? '#2DE1C9' : '#F87171' }}>
                        {status === 'approved' ? 'Approved' : 'Denied'}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* iMessage-style conversation + pinned input (chat only — requests above) */}
              <div className="portal-card" style={{ padding: '14px 16px', overflowX: 'hidden', maxWidth: '100%' }}>
                <MessageThread
                  messages={openThreadMsgs.filter((m) => !isClockRequest(m))}
                  selfKind="supervisor"
                  sending={sending}
                  placeholder={`Message ${openThreadLabel}…`}
                  onSend={(t) => handleSendMessage(t)}
                />
              </div>
            </div>
          )}

          {/* ── Inventory tab ─────────────────────────────────────────────────── */}
          {tab === 'needs' && (
            <>
            <div className="portal-card" style={{ padding: '20px 24px' }}>
              <div style={{ marginBottom: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Log Inventory Need
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <input
                  placeholder="Item description *"
                  value={supInvItem}
                  onChange={(e) => setSupInvItem(e.target.value)}
                  style={{ gridColumn: '1 / -1', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                />
                <select
                  value={supInvDept}
                  onChange={(e) => setSupInvDept(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                >
                  {[...departments, 'All Departments'].map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)' }}>Qty</label>
                  <input
                    type="number"
                    min={1}
                    value={supInvQty}
                    onChange={(e) => setSupInvQty(Math.max(1, parseInt(e.target.value) || 1))}
                    style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                    placeholder="Qty"
                  />
                </div>
                <input
                  placeholder="Job / Project (optional)"
                  value={supInvJobNum}
                  onChange={(e) => setSupInvJobNum(e.target.value)}
                  style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                />
                <input
                  placeholder="Notes (optional)"
                  value={supInvNotes}
                  onChange={(e) => setSupInvNotes(e.target.value)}
                  style={{ gridColumn: '1 / -1', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                />
              </div>
              <button
                onClick={handleSupInventorySubmit}
                disabled={!supInvItem.trim() || supInvSaving}
                style={{ padding: '9px 20px', borderRadius: 8, background: supInvItem.trim() && !supInvSaving ? '#2DE1C9' : 'var(--line)', color: supInvItem.trim() && !supInvSaving ? '#001a0d' : 'var(--ink-mute)', border: 'none', fontWeight: 700, fontSize: 13, cursor: supInvItem.trim() && !supInvSaving ? 'pointer' : 'default' }}
              >
                {supInvSaving ? 'Saving…' : 'Log Inventory Need'}
              </button>
            </div>
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Inventory Needs
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : activeNeeds.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No active inventory needs. Resolved items are hidden.</div>
              ) : (
                <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Item', 'Department', 'Job / Project', 'Qty', 'Date', 'Status', ''].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeNeeds.map((n) => {
                      const s = (n.status ?? 'pending').toLowerCase();
                      const busy = actioning[n.id];
                      return (
                        <tr key={n.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={tdBold}>{n.item}</td>
                          <td style={tdStyle}>{n.dept ?? '—'}</td>
                          <td style={tdStyle}>{n.job_number ?? '—'}</td>
                          <td style={tdStyle}>{n.qty ?? '—'}</td>
                          <td style={tdStyle}>{formatDate(n.created_at)}</td>
                          <td style={{ ...tdStyle }}><StatusBadge status={n.status} /></td>
                          <td style={{ ...tdStyle, paddingRight: 20 }}>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {s !== 'ordered' && (
                                <ActionBtn label="Mark Ordered" color="#5EEAD4" onClick={() => handleNeedStatus(n.id, 'ordered')} disabled={busy} />
                              )}
                              <ActionBtn label="Received" color="#34D399" onClick={() => handleNeedStatus(n.id, 'received')} disabled={busy} />
                              <ActionBtn label="Cancel" color="#F87171" onClick={() => handleNeedStatus(n.id, 'cancelled')} disabled={busy} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              )}

              {/* Archive toggle — reveals received / cancelled items (kept in DB) */}
              {resolvedNeeds.length > 0 && (
                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
                  <button
                    onClick={() => setShowResolvedNeeds((v) => !v)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', padding: 0 }}
                  >
                    {showResolvedNeeds ? 'Hide resolved' : `Show resolved items (${resolvedNeeds.length})`}
                  </button>
                </div>
              )}
              {showResolvedNeeds && resolvedNeeds.length > 0 && (
                <div className="table-scroll">
                <table style={{ width: '100%', borderCollapse: 'collapse', borderTop: '1px solid var(--line)', minWidth: 560 }}>
                  <tbody>
                    {resolvedNeeds.map((n) => (
                      <tr key={n.id} style={{ borderBottom: '1px solid var(--line)', opacity: 0.5 }}>
                        <td style={{ ...tdBold, textDecoration: 'line-through' }}>{n.item}</td>
                        <td style={tdStyle}>{n.dept ?? '—'}</td>
                        <td style={tdStyle}>{n.job_number ?? '—'}</td>
                        <td style={tdStyle}>{n.qty ?? '—'}</td>
                        <td style={tdStyle}>{formatDate(n.created_at)}</td>
                        <td style={{ ...tdStyle }}><StatusBadge status={n.status} /></td>
                        <td style={{ ...tdStyle, paddingRight: 20 }} />
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </div>
            </>
          )}

          {/* ── Damage tab ────────────────────────────────────────────────────── */}
          {tab === 'damage' && (
            <>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
              {([
                { key: 'all',          label: 'All' },
                { key: 'damage',       label: 'Damage' },
                { key: 'change_order', label: 'Change Orders' },
                { key: 'missing',      label: 'Missing Parts' },
                { key: 'wrong_part',   label: 'Wrong Part' },
              ] as { key: typeof damageFilter; label: string }[]).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setDamageFilter(key)}
                  style={{
                    padding: '8px 14px', fontSize: 12, fontWeight: 600,
                    color: damageFilter === key ? 'var(--teal)' : 'var(--ink-mute)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: damageFilter === key ? '2px solid var(--teal)' : '2px solid transparent',
                    marginBottom: -1, fontFamily: 'inherit', transition: 'color 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="portal-card" style={{ padding: '20px 24px', marginBottom: 10 }}>
              <div style={{ marginBottom: 14, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Report Damage
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  placeholder="Describe the damage..."
                  value={supDmgDesc}
                  onChange={(e) => setSupDmgDesc(e.target.value)}
                  rows={3}
                  style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <select
                    value={supDmgDept}
                    onChange={(e) => setSupDmgDept(e.target.value)}
                    style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Job / Project (optional)"
                    value={supDmgJobNum}
                    onChange={(e) => setSupDmgJobNum(e.target.value)}
                    style={{ padding: '9px 12px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontSize: 13 }}
                  />
                </div>
                <div>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleSupDmgPhotoChange}
                    style={{ fontSize: 13, color: 'var(--ink-dim)' }}
                  />
                  {supDmgPreview && (
                    <img src={supDmgPreview} alt="preview" style={{ marginTop: 8, width: 120, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }} />
                  )}
                </div>
                <button
                  onClick={handleSupDamageSubmit}
                  disabled={!supDmgDesc.trim() || supDmgSaving}
                  style={{ padding: '9px 20px', borderRadius: 8, background: supDmgDesc.trim() && !supDmgSaving ? '#F87171' : 'var(--line)', color: supDmgDesc.trim() && !supDmgSaving ? '#fff' : 'var(--ink-mute)', border: 'none', fontWeight: 700, fontSize: 13, cursor: supDmgDesc.trim() && !supDmgSaving ? 'pointer' : 'default', alignSelf: 'flex-start' }}
                >
                  {supDmgSaving ? 'Submitting…' : 'Report Damage'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : damage.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No damage reports logged.</div>
              ) : (() => {
                const filtered = damage.filter((d) => {
                  if (damageFilter === 'all') return true;
                  // report_type splits human "Damage" vs "Change Order" (legacy rows
                  // with no report_type count as damage); missing/wrong_part are scan flags.
                  if (damageFilter === 'damage')       return (d.report_type ?? 'damage') === 'damage';
                  if (damageFilter === 'change_order') return d.report_type === 'change_order';
                  if (damageFilter === 'missing')      return d.flag_type === 'missing';
                  if (damageFilter === 'wrong_part')   return d.flag_type === 'wrong_part';
                  return true;
                });
                if (filtered.length === 0) {
                  return <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No reports match this filter.</div>;
                }
                return filtered.map((d) => {
                  const s = (d.status ?? 'open').toLowerCase();
                  const isOpen = !['resolved', 'closed'].includes(s);
                  const busy = actioning[d.id];
                  const flagColors: Record<string, { c: string; bg: string }> = {
                    damaged:    { c: '#F87171', bg: 'rgba(248,113,113,0.12)' },
                    missing:    { c: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
                    wrong_part: { c: '#F87171', bg: 'rgba(248,113,113,0.12)' },
                  };
                  const fc = d.flag_type ? (flagColors[d.flag_type] ?? null) : null;
                  return (
                    <div key={d.id} className="portal-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{d.part_name}</span>
                            <StatusBadge status={d.status} />
                            {/* Report type — Change Order (amber) vs Damage (red) */}
                            {d.report_type === 'change_order' ? (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: '#FBBF24', background: 'rgba(251,191,36,0.12)' }}>Change Order</span>
                            ) : (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: '#F87171', background: 'rgba(248,113,113,0.12)' }}>Damage</span>
                            )}
                            {fc && (
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: fc.c, background: fc.bg, textTransform: 'capitalize' }}>
                                {(d.flag_type ?? '').replace('_', ' ')}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {d.dept           && <span>{d.dept}</span>}
                            {d.job_id         && <span>Job: {d.job_id}</span>}
                            {d.assembler_name && <span>by {d.assembler_name}</span>}
                            <span>{formatDate(d.created_at)}</span>
                          </div>
                          {d.notes && (
                            <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: '8px 0 0', lineHeight: 1.5 }}>{d.notes}</p>
                          )}
                        </div>
                        {d.photo_url && (
                          <a href={d.photo_url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0 }}>
                            <img src={d.photo_url} alt="damage" style={{ width: 80, height: 60, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line)' }} />
                          </a>
                        )}
                      </div>
                      {isOpen && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
                          {s !== 'reviewed' && (
                            <ActionBtn label="Mark Reviewed" color="#A78BFA" onClick={() => handleDamageStatus(d.id, 'reviewed')} disabled={busy} />
                          )}
                          <ActionBtn label="Resolve" color="#34D399" onClick={() => openResolutionModal(d.id)} disabled={busy} />
                          <ActionBtn label="Close" color="#8BA5A0" onClick={() => handleDamageStatus(d.id, 'closed')} disabled={busy} />
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            </>
          )}
          {/* ── Plans tab ────────────────────────────────────────────────────── */}
          {tab === 'plans' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 4 }}>Upload Plans</div>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                  Plans is the home for every file — PDFs, layouts, and CSV cut lists. Drop one file or many at once; each is processed in turn and CSV cut lists have their columns mapped automatically.
                </p>

                <div style={{ marginBottom: 12 }}>
                  {/* Job / Project — smart selector */}
                  <div style={{ position: 'relative' }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Job / Project *</label>
                    <input
                      className="form-input"
                      placeholder="Select or search a job…"
                      value={planJobId === '__new__' ? '' : planJobQuery}
                      readOnly={planJobId === '__new__'}
                      onChange={(e) => { setPlanJobQuery(e.target.value); setPlanJobId(''); setPlanJobNum(''); setPlanJobOpen(true); }}
                      onFocus={() => { if (planJobId !== '__new__') setPlanJobOpen(true); }}
                      onBlur={() => setTimeout(() => setPlanJobOpen(false), 150)}
                    />
                    {planJobOpen && planJobId !== '__new__' && (() => {
                      const q = planJobQuery.trim().toLowerCase();
                      const sorted = [...jobs].sort((a, b) => jobLabel(a).localeCompare(jobLabel(b)));
                      const matches = (planJobId || q === '') ? sorted : sorted.filter((j) =>
                        (j.job_path  ?? '').toLowerCase().includes(q) ||
                        (j.job_name  ?? '').toLowerCase().includes(q) ||
                        (j.job_number ?? '').toLowerCase().includes(q)
                      );
                      return (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, maxHeight: 240, overflowY: 'auto', background: 'var(--bg-2, #14181c)', border: '1px solid var(--line)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
                          {matches.length === 0 && (
                            <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink-mute)' }}>No matching jobs</div>
                          )}
                          {matches.map((j) => (
                            <button
                              key={j.id}
                              type="button"
                              onMouseDown={(e) => { e.preventDefault(); selectPlanJob(j); }}
                              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', background: planJobId === j.id ? 'rgba(94,234,212,0.08)' : 'none', border: 'none', borderBottom: '1px solid var(--line)', color: 'var(--ink-dim)', fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
                            >
                              {jobLabel(j)}
                            </button>
                          ))}
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); setPlanJobId('__new__'); setPlanJobNum(''); setPlanJobQuery(''); setPlanNewClient(''); setPlanNewRoom(''); setPlanJobOpen(false); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'rgba(167,139,250,0.06)', border: 'none', color: '#A78BFA', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }}
                          >
                            + Create new job
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Create-new-job inline fields */}
                {planJobId === '__new__' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12, padding: '12px 14px', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 10, background: 'rgba(167,139,250,0.04)' }}>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A78BFA' }}>New Job</span>
                      <button type="button" onClick={resetPlanJobSelector} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Choose existing instead</button>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Client Name *</label>
                      <input className="form-input" placeholder="e.g. Johnson" value={planNewClient} onChange={(e) => setPlanNewClient(e.target.value)} onBlur={(e) => setPlanNewClient(toTitleCase(e.target.value))} autoFocus />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Room / Area</label>
                      <input className="form-input" placeholder="e.g. Kitchen (optional)" value={planNewRoom} onChange={(e) => setPlanNewRoom(e.target.value)} onBlur={(e) => setPlanNewRoom(toTitleCase(e.target.value))} />
                    </div>
                  </div>
                )}

                {/* Departments multi-select */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 7 }}>Visible to departments</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {([{ key: 'all', label: 'All Departments' }, ...departments.map((d) => ({ key: d, label: d }))]).map(({ key, label }) => {
                      const isAll   = key === 'all';
                      const checked = isAll ? planDepts.includes('all') : planDepts.includes(key);
                      return (
                        <label
                          key={key}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 7,
                            padding: '7px 12px', borderRadius: 8,
                            border: `1px solid ${checked ? 'rgba(94,234,212,0.4)' : 'var(--line)'}`,
                            background: checked ? 'rgba(94,234,212,0.08)' : 'transparent',
                            color: checked ? 'var(--teal)' : 'var(--ink-dim)',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePlanDept(key)}
                            style={{ accentColor: '#2DE1C9', cursor: 'pointer' }}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Unified drop zone — one file or many, processed sequentially */}
                <div style={{ marginBottom: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Files (PDF, CSV, SVG, XML, images, or spreadsheet) — one or many *</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); if (!multiProcessing && planJobReady) setMultiDropHover(true); }}
                    onDragLeave={() => setMultiDropHover(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setMultiDropHover(false);
                      if (multiProcessing || !planJobReady) return;
                      const fs = Array.from(e.dataTransfer.files ?? []);
                      if (fs.length) void runMultiUpload(fs);
                    }}
                    style={{
                      position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      gap: 8, width: '100%', padding: 28, borderRadius: 12,
                      cursor: (multiProcessing || !planJobReady) ? 'default' : 'pointer',
                      border: `1.5px dashed ${multiDropHover ? '#5EEAD4' : '#2DE1C9'}`,
                      background: multiDropHover ? '#13302d' : '#0f1f1e',
                      opacity: (multiProcessing || !planJobReady) ? 0.6 : 1,
                      transition: 'border-color 120ms ease, background 120ms ease',
                    }}
                  >
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.csv,.svg,.html,.xml,.xlsx,.xls,.jpg,.jpeg,.png,.webp"
                      disabled={multiProcessing || !planJobReady}
                      onChange={(e) => {
                        const fs = Array.from(e.target.files ?? []);
                        e.target.value = '';
                        if (fs.length) void runMultiUpload(fs);
                      }}
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: (multiProcessing || !planJobReady) ? 'default' : 'pointer' }}
                    />
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2DE1C9" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span style={{ fontSize: 14, color: '#2DE1C9' }}>Drop files here or tap to browse</span>
                    <span style={{ fontSize: 11, color: '#8BA5A0', textAlign: 'center' }}>PDF, CSV, SVG, XML, images, spreadsheets — one or many at once. For shop drawings, use PDF not DXF.</span>
                  </div>
                  {!planJobReady && (
                    <div style={{ fontSize: 11.5, color: '#FBBF24', marginTop: 8 }}>Choose a Job / Project above before uploading.</div>
                  )}
                </div>

                {/* Progress indicator while the queue runs */}
                {multiProcessing && multiQueue.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, fontSize: 12.5, fontWeight: 600, color: '#5EEAD4' }}>
                    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, animation: 'spin 0.9s linear infinite' }}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Processing {multiCurrentIdx} of {multiQueue.length} files…
                  </div>
                )}

                {/* Completion summary */}
                {!multiProcessing && multiSummary && (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)' }}>
                    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: '#34D399' }}>
                      {multiSummary.files} file{multiSummary.files !== 1 ? 's' : ''} uploaded — {multiSummary.units} cabinet unit{multiSummary.units !== 1 ? 's' : ''} created across {multiSummary.jobs} job{multiSummary.jobs !== 1 ? 's' : ''}
                      {multiSummary.failed > 0 ? ` · ${multiSummary.failed} failed` : ''}
                    </span>
                  </div>
                )}

                {/* File queue */}
                {multiQueue.length > 0 && (
                  <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
                    {multiQueue.map((q) => {
                      const tone =
                        q.status === 'done'       ? { color: '#34D399', label: 'Done' } :
                        q.status === 'error'      ? { color: '#F87171', label: 'Error' } :
                        q.status === 'processing' ? { color: '#2DE1C9', label: 'Processing' } :
                                                    { color: '#8BA5A0', label: 'Pending' };
                      return (
                        <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone.color, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.file.name}</div>
                            <div style={{ fontSize: 11, color: q.status === 'error' ? '#F87171' : 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {q.status === 'error'
                                ? q.error
                                : q.status === 'done'
                                  ? `${formatBytes(q.file.size)}${typeof q.units === 'number' && q.units > 0 ? ` · ${q.units} unit${q.units !== 1 ? 's' : ''}` : ''}`
                                  : formatBytes(q.file.size)}
                            </div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: tone.color, flexShrink: 0 }}>{tone.label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CSV column mapper — appears after a CSV upload */}
              {planCsvHeaders.length > 0 && planPendingId && (
                <div className="portal-card" style={{ border: '1px solid rgba(52,211,153,0.3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#34D399' }}>
                      Map Cut List Columns — {planCsvRows.length} rows
                    </div>
                    <button onClick={cancelPlanMapper} style={{ background: 'none', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>Skip</button>
                  </div>

                  {/* AI mapping banner */}
                  {planAiMapped && planAiMissing.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'rgba(94,234,212,0.08)', border: '1px solid rgba(94,234,212,0.3)', marginBottom: 12 }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21.4 8 14 2 9.4h7.6z"/>
                      </svg>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#5EEAD4' }}>AI mapped your columns — review and confirm</span>
                    </div>
                  )}
                  {planAiMapped && planAiMissing.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 8, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', marginBottom: 12 }}>
                      <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                      </svg>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#FBBF24' }}>AI mapped what it could — finish the highlighted fields below</span>
                    </div>
                  )}

                  <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6 }}>
                    Match your CSV columns to cabinet fields. Cabinet / Unit ID and Part Name are required.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    {PLAN_IMPORT_FIELDS.map(({ key, label, required }) => {
                      const amber = planAiMissing.includes(key);
                      return (
                      <div key={key}>
                        <label style={{ fontSize: 12, color: amber ? '#FBBF24' : (required ? 'var(--ink-dim)' : 'var(--ink-mute)'), fontWeight: required ? 700 : 500, display: 'block', marginBottom: 4 }}>
                          {label}{required ? ' *' : ''}
                        </label>
                        <select
                          className="form-input"
                          value={planColumnMap[key] || ''}
                          onChange={(e) => {
                            setPlanColumnMap((prev) => ({ ...prev, [key]: e.target.value }));
                            // A manual edit means the supervisor is reviewing — stop any auto-submit
                            // and clear the amber flag for the field they just resolved.
                            setPlanCountdown(null);
                            setPlanAiMissing((prev) => prev.filter((k) => k !== key));
                          }}
                          style={{ width: '100%', cursor: 'pointer', borderColor: amber ? '#FBBF24' : undefined }}
                        >
                          <option value="">{amber ? 'Couldn’t detect — please select' : (required ? '— select column —' : '(skip)')}</option>
                          {planCsvHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                      );
                    })}
                  </div>
                  {planCountdown !== null ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                        onClick={() => { setPlanCountdown(null); void handlePlanParse(); }}
                        disabled={planParsing}
                      >
                        {planParsing ? 'Building cut list…' : `Auto-creating in ${planCountdown}s — create now`}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setPlanCountdown(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary"
                      style={{ opacity: (!planColumnMap.unit_id || !planColumnMap.part_name || planParsing) ? 0.5 : 1 }}
                      onClick={handlePlanParse}
                      disabled={!planColumnMap.unit_id || !planColumnMap.part_name || planParsing}
                    >
                      {planParsing ? 'Building cut list…' : `Create cabinet units & parts from ${planCsvRows.length} rows`}
                    </button>
                  )}
                </div>
              )}

              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : plans.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No plans uploaded yet.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {(() => {
                    // Group by job_path so every file for the same job lands together,
                    // regardless of how the job was named when each file was uploaded.
                    const groups: Record<string, JobDrawing[]> = {};
                    plans.forEach((p) => {
                      const k = planJobPath(p);
                      if (!groups[k]) groups[k] = [];
                      groups[k].push(p);
                    });
                    return Object.entries(groups).map(([jobKey, items]) => (
                      <div key={jobKey}>
                        <div style={{ padding: '10px 20px', background: 'rgba(167,139,250,0.05)', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A78BFA' }}>
                          {titleCasePath(jobKey).split('/').join(' / ')}
                        </div>
                        {items.map((p) => {
                          const superseded = p.is_current === false;
                          const ver = p.version ?? 1;
                          const views = planViews[p.id];
                          const viewedNames = new Set((views ?? []).map((v) => v.viewer_name));
                          const neverViewed = crewRoster.filter((n) => !viewedNames.has(n));
                          return (
                          <div key={p.id} style={{ borderBottom: '1px solid var(--line)', opacity: superseded ? 0.6 : 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px' }}>
                            <PlanTypeBadge fileType={p.file_type} fileName={p.file_name} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label || p.file_name || 'Untitled'}</span>
                                {ver > 1 && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(94,234,212,0.12)', color: 'var(--teal)', flexShrink: 0 }}>v{ver}</span>
                                )}
                                {superseded && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(139,165,160,0.15)', color: '#8BA5A0', flexShrink: 0 }}>Superseded</span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
                                <DeptPills departments={p.departments} />
                                {p.file_type === 'csv' && p.parsed && (
                                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(52,211,153,0.12)', color: '#34D399' }}>Parsed</span>
                                )}
                                <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{formatDate(p.created_at)}</span>
                                {!superseded && (
                                  <button
                                    onClick={() => void togglePlanViews(p.id)}
                                    style={{ fontSize: 11, color: 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textDecorationStyle: 'dotted', padding: 0 }}
                                  >
                                    {views ? `Viewed by ${viewedNames.size} crew member${viewedNames.size !== 1 ? 's' : ''}` : 'View status'}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                              {p.file_url && (
                                <button onClick={() => setViewerFile({ url: p.file_url!, name: p.file_name || p.label || 'file', fileType: p.file_type, parsed: !!p.parsed, jobPath: p.job_number ? `Job ${p.job_number}` : undefined })}
                                  style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', background: 'rgba(167,139,250,0.1)', padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>View</button>
                              )}
                              {superseded && (
                                <button onClick={() => void handleRestoreVersion(p)}
                                  style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'rgba(94,234,212,0.1)', padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>Make current</button>
                              )}
                              <ActionBtn label="Delete" color="#F87171" onClick={() => handlePlanDelete(p.id)} />
                            </div>
                          </div>
                          {/* Viewed-by expansion */}
                          {expandedViewsId === p.id && (
                            <div style={{ padding: '0 20px 14px 58px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {(views ?? []).map((v) => (
                                <div key={v.viewer_name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                                  <span style={{ color: 'var(--ink-dim)' }}>{v.viewer_name}</span>
                                  <span style={{ color: 'var(--ink-mute)' }}>{relativeTime(v.viewed_at)}</span>
                                </div>
                              ))}
                              {neverViewed.map((n) => (
                                <div key={n} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
                                  <span style={{ color: '#FBBF24' }}>{n}</span>
                                  <span style={{ color: '#FBBF24', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FBBF24' }} />Never viewed
                                  </span>
                                </div>
                              ))}
                              {(views ?? []).length === 0 && neverViewed.length === 0 && (
                                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No crew roster yet.</span>
                              )}
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
            </div>
          )}

          {/* ── SOPs tab ─────────────────────────────────────────────────────── */}
          {tab === 'sops' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Upload SOP</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Title *</label>
                    <input className="form-input" placeholder="e.g. Finishing Safety Protocol" value={sopTitle} onChange={(e) => setSopTitle(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Department</label>
                    <select className="form-input" value={sopDept} onChange={(e) => setSopDept(e.target.value)} style={{ cursor: 'pointer' }}>
                      <option value="">All Departments</option>
                      {departments.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>PDF File *</label>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={(e) => setSopFile(e.target.files?.[0] ?? null)}
                    style={{ fontSize: 13, color: 'var(--ink-dim)', width: '100%' }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  style={{ opacity: (!sopFile || !sopTitle.trim() || sopUploading) ? 0.5 : 1, padding: '10px 24px' }}
                  onClick={handleSopUpload}
                  disabled={!sopFile || !sopTitle.trim() || sopUploading}
                >
                  {sopUploading ? 'Uploading…' : 'Upload SOP'}
                </button>
              </div>

              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : sops.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No SOPs uploaded yet.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {(() => {
                    const groups: Record<string, SopItem[]> = {};
                    sops.forEach((s) => {
                      const k = s.dept || 'All Departments';
                      if (!groups[k]) groups[k] = [];
                      groups[k].push(s);
                    });
                    return Object.entries(groups).map(([deptKey, items]) => (
                      <div key={deptKey}>
                        <div style={{ padding: '10px 20px', background: 'rgba(94,234,212,0.05)', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)' }}>
                          {deptKey}
                        </div>
                        {items.map((s) => (
                          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, background: 'rgba(248,113,113,0.1)', color: '#F87171', flexShrink: 0 }}>PDF</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                              <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{formatDate(s.created_at)}</div>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                              {s.pdf_url && (
                                <a href={s.pdf_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', background: 'rgba(94,234,212,0.1)', padding: '5px 12px', borderRadius: 8, textDecoration: 'none' }}>View</a>
                              )}
                              <ActionBtn label="Delete" color="#F87171" onClick={() => handleSopDelete(s.id)} />
                            </div>
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}

          {/* ── AI tab ──────────────────────────────────────────────────────────── */}
          {tab === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* Routing Rules — supervisor-editable dept assignments the classifier applies first */}
              {tenant && <RoutingRulesPanel tenantId={tenant.id} showToast={showToast} />}

              {/* Mode selector */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {([
                  { key: 'learn',      label: 'Learn' },
                  { key: 'assist',     label: 'Assist' },
                  { key: 'autonomous', label: 'Autonomous' },
                ] as { key: AiMode; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => changeAiMode(key)}
                    style={{
                      padding: '8px 20px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                      border: aiMode === key
                        ? (key === 'autonomous' ? '1px solid #F87171' : '1px solid var(--teal)')
                        : '1px solid var(--line)',
                      background: aiMode === key
                        ? (key === 'autonomous' ? 'rgba(248,113,113,0.1)' : 'rgba(94,234,212,0.1)')
                        : 'transparent',
                      color: aiMode === key
                        ? (key === 'autonomous' ? '#F87171' : 'var(--teal)')
                        : 'var(--ink-mute)',
                      cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
                    }}
                  >{label}</button>
                ))}
                <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-mute)', alignSelf: 'center' }}>
                  {aiMode === 'learn' ? 'Teach the AI about your shop through daily check-ins'
                   : aiMode === 'assist' ? 'AI-generated insights from live shop data'
                   : 'Automated actions that run without manual input'}
                </div>
              </div>

              {/* ── LEARN mode ───────────────────────────────────────────────── */}
              {aiMode === 'learn' && (() => {
                const showForm = !todayLog || editingLog;
                return (
                  <>
                    {/* Daily check-in form or today's submitted response */}
                    <div className="portal-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 4 }}>Daily Check-in</div>
                          <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>
                            {todayLog && !editingLog
                              ? `Submitted today · ${new Date(todayLog.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
                              : 'Helps AI understand patterns over time'}
                          </div>
                        </div>
                        {todayLog && !editingLog && (
                          <button
                            onClick={() => setEditingLog(true)}
                            className="btn btn-ghost"
                            style={{ fontSize: 12, padding: '6px 14px' }}
                          >Edit</button>
                        )}
                      </div>

                      {showForm ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          {/* Q1: Production rating */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 8 }}>1. How did production go today?</label>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              {['1','2','3','4','5'].map((v) => (
                                <button
                                  key={v}
                                  onClick={() => setLogForm((f) => ({ ...f, production_rating: v }))}
                                  style={{
                                    width: 40, height: 40, borderRadius: 8, border: logForm.production_rating === v ? '2px solid var(--teal)' : '1px solid var(--line)',
                                    background: logForm.production_rating === v ? 'rgba(94,234,212,0.15)' : 'transparent',
                                    color: logForm.production_rating === v ? 'var(--teal)' : 'var(--ink-mute)',
                                    fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >{v}</button>
                              ))}
                              <span style={{ fontSize: 12, color: 'var(--ink-mute)', alignSelf: 'center', marginLeft: 4 }}>
                                {['','Rough day','Below average','Average','Good day','Great day'][parseInt(logForm.production_rating)]}
                              </span>
                            </div>
                            <input className="form-input" placeholder="Optional comment…" value={logForm.production_comment} onChange={(e) => setLogForm((f) => ({ ...f, production_comment: e.target.value }))} />
                          </div>

                          {/* Q2: Crew issues */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>2. Any crew issues or standouts today?</label>
                            <textarea className="form-input" placeholder="e.g. Jason was late, Maria finished ahead of schedule…" value={logForm.crew_issues} onChange={(e) => setLogForm((f) => ({ ...f, crew_issues: e.target.value }))} rows={2} style={{ resize: 'none' }} />
                          </div>

                          {/* Q3: Material costs */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>3. Any unexpected material costs?</label>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                              {(['no','yes'] as const).map((v) => (
                                <button
                                  key={v}
                                  onClick={() => setLogForm((f) => ({ ...f, material_costs_flag: v }))}
                                  style={{
                                    padding: '6px 16px', borderRadius: 7, border: logForm.material_costs_flag === v ? '2px solid var(--teal)' : '1px solid var(--line)',
                                    background: logForm.material_costs_flag === v ? 'rgba(94,234,212,0.15)' : 'transparent',
                                    color: logForm.material_costs_flag === v ? 'var(--teal)' : 'var(--ink-mute)',
                                    fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
                                  }}
                                >{v}</button>
                              ))}
                            </div>
                            {logForm.material_costs_flag === 'yes' && (
                              <input className="form-input" placeholder="Describe the unexpected costs…" value={logForm.material_costs_detail} onChange={(e) => setLogForm((f) => ({ ...f, material_costs_detail: e.target.value }))} />
                            )}
                          </div>

                          {/* Q4: Time variance */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>4. Did any jobs run over or under estimated time?</label>
                            <textarea className="form-input" placeholder="e.g. Cabinet install ran 2h over, finishing crew finished 1h early…" value={logForm.time_variance} onChange={(e) => setLogForm((f) => ({ ...f, time_variance: e.target.value }))} rows={2} style={{ resize: 'none' }} />
                          </div>

                          {/* Q5: Biggest challenge */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>5. What&apos;s your biggest challenge this week?</label>
                            <input className="form-input" placeholder="e.g. Staffing shortage, supply delays…" value={logForm.biggest_challenge} onChange={(e) => setLogForm((f) => ({ ...f, biggest_challenge: e.target.value }))} />
                          </div>

                          {/* Q6: Additional comments */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 6 }}>6. Additional comments</label>
                            <textarea className="form-input" placeholder="Anything else worth noting…" value={logForm.additional_comments} onChange={(e) => setLogForm((f) => ({ ...f, additional_comments: e.target.value }))} rows={3} style={{ resize: 'none' }} />
                          </div>

                          <div style={{ display: 'flex', gap: 10 }}>
                            <button
                              className="btn btn-primary"
                              style={{ opacity: savingLog ? 0.5 : 1 }}
                              onClick={handleSaveDailyLog}
                              disabled={savingLog}
                            >
                              {savingLog ? 'Saving…' : (todayLog ? 'Save Changes' : 'Submit Check-in')}
                            </button>
                            {editingLog && (
                              <button className="btn btn-ghost" onClick={() => setEditingLog(false)}>Cancel</button>
                            )}
                          </div>
                        </div>
                      ) : (
                        /* Submitted-today view */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                          {[
                            { label: 'Production Rating', value: `${todayLog!.responses.production_rating}/5 — ${['','Rough day','Below average','Average','Good day','Great day'][parseInt(todayLog!.responses.production_rating ?? '3')]}` },
                            todayLog!.responses.production_comment ? { label: 'Comment', value: todayLog!.responses.production_comment } : null,
                            todayLog!.responses.crew_issues ? { label: 'Crew Issues', value: todayLog!.responses.crew_issues } : null,
                            { label: 'Unexpected Material Costs', value: todayLog!.responses.material_costs_flag === 'yes' ? `Yes — ${todayLog!.responses.material_costs_detail ?? ''}` : 'No' },
                            todayLog!.responses.time_variance ? { label: 'Time Variance', value: todayLog!.responses.time_variance } : null,
                            todayLog!.responses.biggest_challenge ? { label: 'Biggest Challenge', value: todayLog!.responses.biggest_challenge } : null,
                            todayLog!.responses.additional_comments ? { label: 'Additional Comments', value: todayLog!.responses.additional_comments } : null,
                          ].filter(Boolean).map((item) => (
                            <div key={item!.label} style={{ display: 'flex', gap: 12, padding: '12px 16px', borderRadius: 8, background: 'rgba(94,234,212,0.04)', border: '1px solid var(--line)' }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', minWidth: 160, flexShrink: 0 }}>{item!.label}</div>
                              <div style={{ fontSize: 13, color: 'var(--ink)' }}>{item!.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Past check-ins log */}
                    {dailyLogs.filter((l) => !todayLog || l.id !== todayLog.id).length > 0 && (
                      <div className="portal-card">
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Past Check-ins</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 400, overflowY: 'auto' }}>
                          {dailyLogs
                            .filter((l) => !todayLog || l.id !== todayLog.id)
                            .map((l) => (
                              <div key={l.id} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid var(--line)', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)', minWidth: 90, flexShrink: 0 }}>{new Date(l.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600, marginBottom: 3 }}>
                                    Production {l.responses.production_rating ?? '?'}/5
                                    {l.responses.production_comment ? ` — ${l.responses.production_comment}` : ''}
                                  </div>
                                  {l.responses.crew_issues && (
                                    <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>Crew: {l.responses.crew_issues}</div>
                                  )}
                                  {l.responses.biggest_challenge && (
                                    <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>Challenge: {l.responses.biggest_challenge}</div>
                                  )}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ── ASSIST mode ──────────────────────────────────────────────── */}
              {aiMode === 'assist' && (
                <>
                  {/* Morning brief */}
                  <div className="portal-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: briefLoading || !brief ? 0 : 16 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 4 }}>Morning Brief</div>
                        {briefTs && !briefLoading && (
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)' }}>Generated at {briefTs}</div>
                        )}
                      </div>
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 12, padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 6, opacity: briefLoading ? 0.5 : 1 }}
                        onClick={() => { void generateBrief(); }}
                        disabled={briefLoading}
                      >
                        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                        {brief ? 'Regenerate Brief' : 'Generate Brief'}
                      </button>
                    </div>

                    {briefLoading && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 0', color: 'var(--ink-mute)', fontSize: 13 }}>
                        <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(94,234,212,0.2)', borderTopColor: '#5EEAD4', animation: 'spin 0.7s linear infinite', flexShrink: 0 }} />
                        Analyzing shop data…
                        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                      </div>
                    )}

                    {briefError && !briefLoading && (
                      <div style={{ padding: '14px 16px', borderRadius: 8, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 13, color: '#F87171', marginTop: 12 }}>
                        {briefError}
                      </div>
                    )}

                    {brief && !briefLoading && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {brief.map((card, i) => {
                          const colors = {
                            alert: { border: 'rgba(248,113,113,0.3)', bg: 'rgba(248,113,113,0.06)', badge: '#F87171', badgeBg: 'rgba(248,113,113,0.15)' },
                            watch: { border: 'rgba(251,191,36,0.3)',  bg: 'rgba(251,191,36,0.06)',  badge: '#FBBF24', badgeBg: 'rgba(251,191,36,0.15)'  },
                            info:  { border: 'rgba(94,234,212,0.25)', bg: 'rgba(94,234,212,0.05)', badge: '#5EEAD4', badgeBg: 'rgba(94,234,212,0.12)'  },
                          }[card.type] ?? { border: 'var(--line)', bg: 'transparent', badge: '#8BA5A0', badgeBg: 'rgba(95,111,108,0.1)' };
                          return (
                            <div key={i} style={{ padding: '14px 16px', borderRadius: 10, background: colors.bg, border: `1px solid ${colors.border}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', padding: '3px 8px', borderRadius: 5, background: colors.badgeBg, color: colors.badge, flexShrink: 0, marginTop: 1 }}>
                                {card.type}
                              </span>
                              <div>
                                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>{card.title}</div>
                                <div style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.5 }}>{card.detail}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!brief && !briefLoading && !briefError && (
                      <div style={{ padding: '20px 0', fontSize: 13, color: 'var(--ink-mute)', textAlign: 'center' }}>
                        Click &ldquo;Generate Brief&rdquo; to get AI-powered insights on today&apos;s shop activity.
                      </div>
                    )}
                  </div>

                  {/* Proactive flags */}
                  <div className="portal-card">
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>
                      Proactive Flags
                      {proactiveFlags.length > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(251,191,36,0.15)', color: '#FBBF24' }}>
                          {proactiveFlags.length}
                        </span>
                      )}
                    </div>

                    {proactiveFlags.length === 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', fontSize: 13, color: 'var(--ink-mute)' }}>
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                        No flags — shop looks healthy based on current data.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {proactiveFlags.map((flag, i) => {
                          const isAlert = flag.severity === 'alert';
                          return (
                            <div key={i} style={{ padding: '12px 16px', borderRadius: 10, background: isAlert ? 'rgba(248,113,113,0.06)' : 'rgba(251,191,36,0.06)', border: `1px solid ${isAlert ? 'rgba(248,113,113,0.25)' : 'rgba(251,191,36,0.25)'}` }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={isAlert ? '#F87171' : '#FBBF24'} strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                                <div style={{ fontSize: 13, fontWeight: 700, color: isAlert ? '#F87171' : '#FBBF24' }}>{flag.trigger}</div>
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--ink-dim)', paddingLeft: 22 }}>{flag.action}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ── AUTONOMOUS mode ───────────────────────────────────────────── */}
              {aiMode === 'autonomous' && (
                <>
                  {/* Warning banner */}
                  <div style={{ padding: '14px 18px', borderRadius: 10, background: 'rgba(248,113,113,0.07)', border: '1px solid rgba(248,113,113,0.3)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#F87171' }}>Autonomous mode takes real actions in your shop.</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 3 }}>Review settings carefully before enabling actions. Each toggle sends real messages or logs entries.</div>
                    </div>
                    <button
                      onClick={() => setAutoSettings((s) => ({ ...s, allPaused: !s.allPaused }))}
                      style={{
                        marginLeft: 'auto', flexShrink: 0, padding: '6px 16px', fontSize: 12, fontWeight: 700,
                        borderRadius: 7, border: autoSettings.allPaused ? '1px solid #34D399' : '1px solid rgba(248,113,113,0.5)',
                        background: autoSettings.allPaused ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)',
                        color: autoSettings.allPaused ? '#34D399' : '#F87171',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {autoSettings.allPaused ? 'Resume All' : 'Pause All'}
                    </button>
                  </div>

                  {autoSettings.allPaused && (
                    <div style={{ textAlign: 'center', padding: '10px 0', fontSize: 13, fontWeight: 700, color: '#FBBF24', letterSpacing: '0.04em' }}>
                      ALL AUTONOMOUS ACTIONS PAUSED
                    </div>
                  )}

                  {/* Settings panel */}
                  <div className="portal-card">
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>Actions &amp; Settings</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

                      {/* a. Auto-message crew */}
                      {[
                        {
                          key: 'autoMessage' as const,
                          title: 'Auto-message crew',
                          desc: 'If a department has no activity for the threshold period, AI sends a check-in message to that department.',
                          extra: (
                            autoSettings.autoMessage.enabled && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                <label style={{ fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>Threshold:</label>
                                <input
                                  type="number" min="1" max="24"
                                  className="form-input"
                                  style={{ width: 72 }}
                                  value={autoSettings.autoMessage.thresholdHours}
                                  onChange={(e) => setAutoSettings((s) => ({ ...s, autoMessage: { ...s.autoMessage, thresholdHours: Number(e.target.value) || 2 } }))}
                                />
                                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>hours of inactivity</span>
                              </div>
                            )
                          ),
                        },
                        {
                          key: 'autoDamageFlag' as const,
                          title: 'Auto-flag damage reports',
                          desc: 'Unresolved damage reports older than 48 hours trigger a reminder message to the supervisor.',
                          extra: null,
                        },
                        {
                          key: 'autoReorderAlert' as const,
                          title: 'Auto-reorder alert',
                          desc: 'If the same inventory item is requested repeatedly, an alert is sent to the supervisor.',
                          extra: (
                            autoSettings.autoReorderAlert.enabled && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                <label style={{ fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>Trigger after:</label>
                                <input
                                  type="number" min="2" max="10"
                                  className="form-input"
                                  style={{ width: 72 }}
                                  value={autoSettings.autoReorderAlert.thresholdCount}
                                  onChange={(e) => setAutoSettings((s) => ({ ...s, autoReorderAlert: { ...s.autoReorderAlert, thresholdCount: Number(e.target.value) || 3 } }))}
                                />
                                <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>requests for same item</span>
                              </div>
                            )
                          ),
                        },
                        {
                          key: 'dailySummary' as const,
                          title: 'Daily summary',
                          desc: 'AI generates an end-of-day summary and saves it to the daily log at the configured time.',
                          extra: (
                            autoSettings.dailySummary.enabled && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                                <label style={{ fontSize: 12, color: 'var(--ink-mute)', whiteSpace: 'nowrap' }}>Generate at:</label>
                                <input
                                  type="time"
                                  className="form-input"
                                  style={{ width: 110 }}
                                  value={autoSettings.dailySummary.time}
                                  onChange={(e) => setAutoSettings((s) => ({ ...s, dailySummary: { ...s.dailySummary, time: e.target.value } }))}
                                />
                              </div>
                            )
                          ),
                        },
                      ].map((action, idx, arr) => {
                        const isEnabled = (autoSettings[action.key] as { enabled: boolean }).enabled;
                        return (
                          <div key={action.key} style={{ padding: '16px 0', borderBottom: idx < arr.length - 1 ? '1px solid var(--line)' : 'none' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                              <button
                                onClick={() => {
                                  const cur = autoSettings[action.key] as { enabled: boolean };
                                  setAutoSettings((s) => ({ ...s, [action.key]: { ...cur, enabled: !cur.enabled } }));
                                }}
                                style={{
                                  flexShrink: 0, marginTop: 2,
                                  width: 40, height: 22, borderRadius: 11,
                                  background: isEnabled ? '#2DE1C9' : 'rgba(255,255,255,0.1)',
                                  border: 'none', cursor: 'pointer', position: 'relative', transition: 'background 0.2s',
                                }}
                                aria-label={`Toggle ${action.title}`}
                              >
                                <span style={{
                                  position: 'absolute', top: 3, left: isEnabled ? 21 : 3,
                                  width: 16, height: 16, borderRadius: '50%',
                                  background: isEnabled ? '#050608' : 'rgba(255,255,255,0.5)',
                                  transition: 'left 0.2s',
                                }} />
                              </button>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, color: isEnabled ? 'var(--ink)' : 'var(--ink-mute)', marginBottom: 3 }}>
                                  {action.title}
                                  {isEnabled && autoSettings.allPaused && (
                                    <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#FBBF24', background: 'rgba(251,191,36,0.12)', padding: '2px 6px', borderRadius: 4 }}>PAUSED</span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--ink-mute)', lineHeight: 1.5 }}>{action.desc}</div>
                                {action.extra}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Action log */}
                  <div className="portal-card">
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>
                      Action Log
                      {autoLog.length > 0 && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'rgba(94,234,212,0.12)', color: 'var(--teal)' }}>
                          {autoLog.length}
                        </span>
                      )}
                    </div>

                    {autoLog.length === 0 ? (
                      <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '8px 0' }}>
                        No autonomous actions taken yet. Enable actions above and they will appear here.
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, maxHeight: 400, overflowY: 'auto' }}>
                        {autoLog.map((entry, idx) => {
                          const typeColors: Record<string, { color: string; bg: string }> = {
                            auto_message:      { color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)'  },
                            damage_flag:       { color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
                            reorder_alert:     { color: '#FBBF24', bg: 'rgba(251,191,36,0.1)'  },
                            daily_summary:     { color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
                          };
                          const tc = typeColors[entry.action_type] ?? { color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)' };
                          return (
                            <div key={entry.id} style={{ padding: '12px 0', borderBottom: idx < autoLog.length - 1 ? '1px solid var(--line)' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, background: tc.bg, color: tc.color, flexShrink: 0, marginTop: 1, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {entry.action_type.replace(/_/g, ' ')}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                {entry.triggered_by && (
                                  <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginBottom: 3 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--ink-mute)' }}>Triggered by:</span> {entry.triggered_by}
                                  </div>
                                )}
                                {entry.message_sent && (
                                  <div style={{ fontSize: 12, color: 'var(--ink-dim)', fontStyle: 'italic' }}>&ldquo;{entry.message_sent}&rdquo;</div>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0, marginTop: 1 }}>
                                {formatTime(entry.created_at)} {formatDate(entry.created_at)}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Assembly tab ─────────────────────────────────────────────── */}
          {tab === 'assembly' && tenant && (
            <AssemblyTab
              tenantId={tenant.id}
              showToast={showToast}
              jobs={jobs}
              departments={departments}
            />
          )}

          {/* ── Craftsman tab ────────────────────────────────────────────── */}
          {tab === 'craftsman' && tenant && (
            <CraftsmanTab
              tenantId={tenant.id}
              showToast={showToast}
              jobs={jobs}
            />
          )}

          {/* ── QC tab ───────────────────────────────────────────────────── */}
          {tab === 'qc' && tenant && (
            <QcTab
              tenantId={tenant.id}
              showToast={showToast}
              jobs={jobs}
              departments={departments}
            />
          )}

          {/* ── Integrations tab ─────────────────────────────────────────── */}
          {tab === 'integrations' && tenant && (
            <IntegrationsTab
              tenantId={tenant.id}
              shopName={tenant.shop_name}
              showToast={showToast}
              jobs={jobs}
              setJobs={setJobs}
            />
          )}

          {/* ── Reports tab ──────────────────────────────────────────────── */}
          {tab === 'reports' && tenant && (
            <ReportsTab tenantId={tenant.id} showToast={showToast} onGoToCrew={() => setTab('crew')} />
          )}

          {/* ── Settings tab ─────────────────────────────────────────────── */}
          {tab === 'settings' && tenant && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 640 }}>
              {/* ── Billing ───────────────────────────────────────────────── */}
              {(() => {
                const status = tenant.subscription_status;
                const onTrial = status === 'trial';
                const paid = isPaidPlan(tenant.plan ?? null);
                const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
                  trial:     { label: 'Trial',     color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
                  active:    { label: 'Active',    color: '#5EEAD4', bg: 'rgba(94,234,212,0.12)' },
                  past_due:  { label: 'Past Due',  color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
                  cancelled: { label: 'Cancelled', color: '#8BA5A0', bg: 'rgba(139,165,160,0.14)' },
                  expired:   { label: 'Expired',   color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
                };
                const badge = STATUS_BADGE[status] ?? STATUS_BADGE.trial;
                const planName = planLabelFor(tenant.plan ?? null);
                const priceStr = tenant.plan ? PLAN_DISPLAY[tenant.plan].price : 'Free trial';
                const isOps = tenant.plan === 'operations_monthly' || tenant.plan === 'operations_annual';
                const renewDate = tenant.current_period_end
                  ? new Date(tenant.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : null;
                const trialDate = tenant.trial_ends_at
                  ? new Date(tenant.trial_ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : null;
                return (
                  <div className="portal-card">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>Billing</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: badge.color, background: badge.bg, padding: '3px 9px', borderRadius: 6 }}>{badge.label}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
                      <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--ink)' }}>{planName}</span>
                      <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>{priceStr}</span>
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 6 }}>
                      {onTrial && trialDate && <>Trial ends {trialDate} · <b>{days} day{days !== 1 ? 's' : ''} remaining</b></>}
                      {!onTrial && paid && renewDate && (
                        tenant.cancel_at_period_end
                          ? <>Cancels on {renewDate}</>
                          : <>Next billing date {renewDate}</>
                      )}
                      {status === 'past_due' && <span style={{ color: '#F87171' }}>Payment failed — update your billing info to continue.</span>}
                    </div>

                    {/* Actions for an existing paid subscription */}
                    {paid && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                        <button onClick={() => void openBillingPortal()} disabled={billingBusy} className="btn btn-primary" style={{ padding: '0 18px', opacity: billingBusy ? 0.6 : 1, cursor: billingBusy ? 'wait' : 'pointer' }}>
                          {billingBusy ? 'Opening…' : 'Manage billing'}
                        </button>
                        <button onClick={() => void openBillingPortal()} disabled={billingBusy} className="btn btn-ghost" style={{ padding: '0 18px' }}>View invoices</button>
                        {!isOps && (
                          <button onClick={() => void startCheckout('operations', PLAN_DISPLAY[tenant.plan!].billing ?? 'monthly')} disabled={billingBusy} className="btn btn-ghost" style={{ padding: '0 18px' }}>Upgrade to Operations</button>
                        )}
                      </div>
                    )}

                    {/* Actions while on a free trial — start a subscription early.
                        A paid subscriber inside their trial window is excluded
                        (they already have a plan; the `paid` block above applies). */}
                    {onTrial && !paid && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginBottom: 12 }}>Start your subscription early to lock in your plan — you keep all {days} trial day{days !== 1 ? 's' : ''}.</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                          <button onClick={() => void startCheckout('shop', 'monthly')} disabled={billingBusy} className="btn btn-primary" style={{ padding: '0 18px', opacity: billingBusy ? 0.6 : 1, cursor: billingBusy ? 'wait' : 'pointer' }}>
                            Shop — $599/mo
                          </button>
                          <button onClick={() => void startCheckout('operations', 'monthly')} disabled={billingBusy} className="btn btn-ghost" style={{ padding: '0 18px' }}>
                            Operations — $799/mo
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Cancelled / expired — point back to pricing */}
                    {!paid && !onTrial && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                        <Link href="/pricing" className="btn btn-primary" style={{ padding: '0 18px' }}>Choose a plan</Link>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 6 }}>Departments</div>
                <p style={{ fontSize: 13, color: 'var(--ink-dim)', lineHeight: 1.6, marginBottom: 16 }}>
                  These departments power every department dropdown across the app — clock in, messages, inventory, damage, and assembly. Changes apply everywhere once saved.
                </p>

                {/* Current departments as removable pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {deptDraft.length === 0 && (
                    <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No departments yet — add one below.</span>
                  )}
                  {deptDraft.map((d) => (
                    <span key={d} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, color: 'var(--teal)', background: 'rgba(94,234,212,0.1)', border: '1px solid var(--line-strong)', borderRadius: 20, padding: '6px 8px 6px 14px' }}>
                      {d}
                      <button
                        onClick={() => { setDeptDraft((prev) => prev.filter((x) => x !== d)); setDeptErr(''); }}
                        aria-label={`Remove ${d}`}
                        style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: 'none', color: 'var(--ink-mute)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
                      >
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add department input */}
                <div style={{ display: 'flex', gap: 8, marginBottom: deptErr ? 6 : 14 }}>
                  <input
                    className="form-input"
                    value={deptInput}
                    maxLength={20}
                    placeholder="e.g. CNC, Hardware, Install Crew"
                    onChange={(e) => { setDeptInput(e.target.value); setDeptErr(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDeptToDraft(); } }}
                    style={{ flex: 1 }}
                  />
                  <button
                    onClick={addDeptToDraft}
                    disabled={!deptInput.trim()}
                    className="btn btn-ghost"
                    style={{ padding: '0 18px', whiteSpace: 'nowrap', opacity: deptInput.trim() ? 1 : 0.5, cursor: deptInput.trim() ? 'pointer' : 'not-allowed' }}
                  >
                    Add Department
                  </button>
                </div>
                {deptErr && <div style={{ fontSize: 12.5, color: 'var(--danger)', marginBottom: 14 }}>{deptErr}</div>}

                {/* Save */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
                  <button
                    onClick={saveDepartments}
                    disabled={!deptDirty || deptSaving || deptDraft.length === 0}
                    className="btn btn-primary"
                    style={{ padding: '0 22px', opacity: (!deptDirty || deptSaving || deptDraft.length === 0) ? 0.5 : 1, cursor: (!deptDirty || deptSaving || deptDraft.length === 0) ? 'not-allowed' : 'pointer' }}
                  >
                    {deptSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                  {deptDirty && !deptSaving && (
                    <span style={{ fontSize: 12.5, color: 'var(--ink-mute)' }}>Unsaved changes</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Minimal app footer ───────────────────────────────────────── */}
          <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'center', gap: 10, fontSize: 12, color: 'var(--ink-mute)' }}>
            <span>© 2026 InlineIQ</span>
            <span>·</span>
            <Link href="/terms" style={{ color: 'var(--ink-mute)', textDecoration: 'none' }}>Terms</Link>
            <span>·</span>
            <Link href="/privacy" style={{ color: 'var(--ink-mute)', textDecoration: 'none' }}>Privacy</Link>
            <span>·</span>
            <Link href="/admin/partners" style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)', textDecoration: 'none' }}>Admin Access</Link>
          </div>

          {/* Mobile bottom-nav spacer — pushes content above the fixed bar */}
          <div className="block md:hidden" style={{ height: 'calc(64px + env(safe-area-inset-bottom))' }} />

        </main>
        </div>

        {/* ── Mobile Bottom Nav ──────────────────────────────────────── */}
        <div
          className="flex md:hidden"
          style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50,
            background: 'rgba(5,6,8,0.96)', backdropFilter: 'blur(14px)',
            borderTop: '1px solid rgba(94,234,212,0.12)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {(
            [
              { key: 'overview' as const, label: 'Home', icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              )},
              { key: 'messages' as const, label: 'Messages', icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              )},
              { key: 'needs' as const, label: 'Inventory', icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                </svg>
              )},
              { key: 'damage' as const, label: 'Damage', icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.3 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              )},
              { key: 'more' as const, label: 'More', icon: (
                <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/>
                </svg>
              )},
            ] as { key: Tab | 'more'; label: string; icon: React.ReactNode }[]
          ).map(({ key, label, icon }) => {
            const isMore   = key === 'more';
            const isActive = isMore ? moreOpen : (tab === key && !moreOpen);
            return (
              <button
                key={key}
                onClick={() => {
                  if (isMore) {
                    setMoreOpen((o) => !o);
                  } else {
                    setTab(key as Tab);
                    setOpenThread(null);
                    setMsgBody('');
                    setMoreOpen(false);
                  }
                }}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 3,
                  padding: '10px 4px', background: 'none', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                  color: isActive ? '#2DE1C9' : '#9AAAA7',
                  transition: 'color 0.15s',
                }}
              >
                {icon}
                <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.03em', lineHeight: 1 }}>{label}</span>
              </button>
            );
          })}
        </div>

        {/* ── More Drawer ────────────────────────────────────────────── */}
        {moreOpen && (
          <>
            {/* Backdrop */}
            <div
              className="block md:hidden"
              onClick={() => setMoreOpen(false)}
              style={{
                position: 'fixed', inset: 0, zIndex: 55,
                background: 'rgba(0,0,0,0.6)',
              }}
            />
            {/* Sheet */}
            <div
              className="flex md:hidden"
              style={{
                position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 56,
                background: '#0a0d10',
                borderTop: '1px solid rgba(94,234,212,0.15)',
                borderTopLeftRadius: 20, borderTopRightRadius: 20,
                paddingBottom: 'calc(env(safe-area-inset-bottom) + 8px)',
                flexDirection: 'column',
              }}
            >
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(94,234,212,0.2)', margin: '14px auto 10px' }} />
              {(
                [
                  { key: 'crew' as Tab, label: 'Crew', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                      <circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                  )},
                  { key: 'assembly' as Tab, label: 'Assembly', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2"/>
                      <line x1="8" y1="21" x2="16" y2="21"/>
                      <line x1="12" y1="17" x2="12" y2="21"/>
                    </svg>
                  )},
                  { key: 'craftsman' as Tab, label: 'Craftsman', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                    </svg>
                  )},
                  { key: 'qc' as Tab, label: 'QC', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11l3 3L22 4"/>
                      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                    </svg>
                  )},
                  { key: 'plans' as Tab, label: 'Plans', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  )},
                  { key: 'sops' as Tab, label: 'SOPs', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                  )},
                  { key: 'ai' as Tab, label: 'AI', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                    </svg>
                  )},
                  { key: 'integrations' as Tab, label: 'Integrations', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                    </svg>
                  )},
                  { key: 'reports' as Tab, label: 'Reports', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10"/>
                      <line x1="12" y1="20" x2="12" y2="4"/>
                      <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                  )},
                  { key: 'settings' as Tab, label: 'Settings', icon: (
                    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                  )},
                ] as { key: Tab; label: string; icon: React.ReactNode }[]
              ).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => { setTab(key); setOpenThread(null); setMsgBody(''); setMoreOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    width: '100%', padding: '15px 24px',
                    background: 'none', border: 'none',
                    borderBottom: '1px solid rgba(94,234,212,0.07)',
                    cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 15, fontWeight: tab === key ? 700 : 500,
                    textAlign: 'left',
                    color: tab === key ? '#2DE1C9' : '#9AAAA7',
                  }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

      </div>

      {/* ── Damage Resolution Modal ── */}
      {resolvingId && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
        }}>
          <div style={{
            background: '#1E2A2A', borderRadius: 14, padding: '28px 32px',
            width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            <h3 style={{ margin: 0, color: '#E2E8E8', fontSize: 17, fontWeight: 700 }}>
              Resolve Damage Report
            </h3>

            {/* Resolution type */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: '#9CA3AF', fontSize: 13 }}>Resolution Type</label>
              <select
                value={resType}
                onChange={(e) => setResType(e.target.value)}
                style={{
                  background: '#111A1A', color: '#E2E8E8', border: '1px solid #2D3F3F',
                  borderRadius: 8, padding: '8px 12px', fontSize: 14,
                }}
              >
                <option value="Repaired in shop">Repaired in shop</option>
                <option value="Replaced part">Replaced part</option>
                <option value="Client accepted as-is">Client accepted as-is</option>
                <option value="Warranty claim filed">Warranty claim filed</option>
                <option value="Written off">Written off</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Replace Part routing */}
            {resType === 'Replaced part' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderRadius: 10, background: 'rgba(94,234,212,0.06)', border: '1px solid rgba(94,234,212,0.2)' }}>
                {resolvingSourceDept === 'production' ? (
                  <div style={{ color: '#9CDDD3', fontSize: 13 }}>The part will be unchecked and reappear in the <b>Production</b> cut list. Production crew will be notified.</div>
                ) : resolvingSourceDept === 'craftsman' ? (
                  <div style={{ color: '#9CDDD3', fontSize: 13 }}>The part will return to the <b>Craftsman</b> queue. Craftsman crew will be notified.</div>
                ) : (
                  <>
                    <label style={{ color: '#9CA3AF', fontSize: 13 }}>Send replacement to</label>
                    <select
                      value={resReturnDept}
                      onChange={(e) => setResReturnDept(e.target.value)}
                      style={{ background: '#111A1A', color: '#E2E8E8', border: '1px solid #2D3F3F', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
                    >
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}

            {/* Resolution notes */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ color: '#9CA3AF', fontSize: 13 }}>
                Notes <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <textarea
                rows={3}
                value={resNotes}
                onChange={(e) => setResNotes(e.target.value)}
                placeholder="Describe how the damage was resolved…"
                style={{
                  background: '#111A1A', color: '#E2E8E8', border: '1px solid #2D3F3F',
                  borderRadius: 8, padding: '8px 12px', fontSize: 14, resize: 'vertical',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* Resolved by + cost row */}
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ color: '#9CA3AF', fontSize: 13 }}>Resolved By</label>
                <input
                  type="text"
                  value={resBy}
                  onChange={(e) => setResBy(e.target.value)}
                  placeholder="Supervisor"
                  style={{
                    background: '#111A1A', color: '#E2E8E8', border: '1px solid #2D3F3F',
                    borderRadius: 8, padding: '8px 12px', fontSize: 14,
                  }}
                />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ color: '#9CA3AF', fontSize: 13 }}>Cost (optional)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={resCost}
                  onChange={(e) => setResCost(e.target.value)}
                  placeholder="0.00"
                  style={{
                    background: '#111A1A', color: '#E2E8E8', border: '1px solid #2D3F3F',
                    borderRadius: 8, padding: '8px 12px', fontSize: 14,
                  }}
                />
              </div>
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setResolvingId(null)}
                disabled={resSubmitting}
                style={{
                  background: '#2D3F3F', color: '#9CA3AF', border: 'none',
                  borderRadius: 8, padding: '9px 20px', fontSize: 14, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleResolutionConfirm}
                disabled={resSubmitting || !resNotes.trim()}
                style={{
                  background: resSubmitting || !resNotes.trim() ? '#2D4A3E' : '#34D399',
                  color: resSubmitting || !resNotes.trim() ? '#5F8F7A' : '#051A12',
                  border: 'none', borderRadius: 8, padding: '9px 20px',
                  fontSize: 14, fontWeight: 600, cursor: resSubmitting || !resNotes.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {resSubmitting ? 'Saving…' : 'Confirm Resolution'}
              </button>
            </div>
          </div>
        </div>
      )}

      {wizardVisible && tenant && (
        <SetupWizard tenant={tenant} onComplete={() => setWizardVisible(false)} />
      )}

      {/* ── Notification drawer (right on desktop, bottom sheet on mobile) ── */}
      {notifOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 310, display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => { if (e.target === e.currentTarget) setNotifOpen(false); }}>
          <style>{`@keyframes notifIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
          <div className="notif-drawer" style={{ width: '100%', maxWidth: 400, height: '100%', background: '#0a0d10', borderLeft: '1px solid var(--line-strong)', display: 'flex', flexDirection: 'column', animation: 'notifIn 0.22s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Notifications</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {notifUnread > 0 && (
                  <button onClick={() => { void markAllNotificationsRead(); }} style={{ fontSize: 12.5, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Mark all read</button>
                )}
                <button onClick={() => setNotifOpen(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2, display: 'flex' }}>
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {notifications.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '60px 24px', textAlign: 'center' }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  <div style={{ fontSize: 14, color: 'var(--ink-mute)' }}>No notifications yet</div>
                </div>
              ) : (
                notifications.map((n) => {
                  const mins  = Math.floor((Date.now() - new Date(n.created_at).getTime()) / 60000);
                  const rel = mins < 1 ? 'Just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins / 60)} hr ago` : `${Math.floor(mins / 1440)}d ago`;
                  return (
                    <button
                      key={n.id}
                      onClick={() => { void markNotificationRead(n); }}
                      style={{ display: 'flex', gap: 11, width: '100%', textAlign: 'left', padding: '14px 18px', background: n.read ? 'none' : 'rgba(45,225,201,0.04)', border: 'none', borderBottom: '1px solid var(--line)', borderLeft: n.read ? '3px solid transparent' : '3px solid var(--teal)', cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: n.read ? 'transparent' : 'var(--teal)' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: n.read ? 500 : 700, color: 'var(--ink)' }}>{n.title}</div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-mute)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}>{rel}</div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Finish specs editor ── */}
      {finishSpecsJob && tenant && (
        <FinishSpecsModal
          tenantId={tenant.id}
          jobNumber={finishSpecsJob.job_number}
          jobPath={finishSpecsJob.job_path ?? null}
          onClose={() => setFinishSpecsJob(null)}
          showToast={showToast}
        />
      )}

      {/* ── Complete-job confirmation ── */}
      {completeJobTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }} onClick={() => { if (!completingJob) setCompleteJobTarget(null); }}>
          <div className="portal-card" style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Mark {jobLabel(completeJobTarget)} as complete?</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>All cabinets will be marked complete. This job will move to the archive.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', opacity: completingJob ? 0.6 : 1 }} disabled={completingJob} onClick={() => { void handleCompleteJob(completeJobTarget); }}>
                {completingJob ? 'Completing…' : 'Complete Job'}
              </button>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} disabled={completingJob} onClick={() => setCompleteJobTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Permanently delete an archived job ── */}
      {deleteArchiveTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }} onClick={() => setDeleteArchiveTarget(null)}>
          <div className="portal-card" style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>Delete {jobLabel(deleteArchiveTarget)} permanently?</div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-mute)', lineHeight: 1.5 }}>This cannot be undone. The job will be removed entirely.</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setDeleteArchiveTarget(null)}>Cancel</button>
              <button className="btn" style={{ flex: 1, justifyContent: 'center', background: '#F87171', color: '#1a0606', fontWeight: 700 }} onClick={() => { const t = deleteArchiveTarget; setDeleteArchiveTarget(null); void handleDeleteJob(t.id); }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast msg={toast.msg} error={toast.error} />}

      {viewerFile && <FileViewer file={viewerFile} onClose={() => setViewerFile(null)} />}

      {/* ── Plan version-conflict modal ── */}
      {versionConflict && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 20 }} onClick={() => setVersionConflict(null)}>
          <div className="portal-card" style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 16 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Plan already exists</h3>
            <p style={{ fontSize: 13.5, color: 'var(--ink-dim)', lineHeight: 1.6, margin: 0 }}>
              A plan named <b style={{ color: 'var(--ink)' }}>{versionConflict.label || versionConflict.file_name}</b> already exists for this job. What would you like to do?
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => { if (pendingJobCtx) void performPlanUpload(versionConflict, pendingJobCtx.jobNumber, pendingJobCtx.jobPath); }}>
                Replace (new version v{(versionConflict.version ?? 1) + 1})
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: 'center' }} onClick={() => { if (pendingJobCtx) void performPlanUpload(null, pendingJobCtx.jobNumber, pendingJobCtx.jobPath); }}>
                Keep both
              </button>
              <button className="btn btn-ghost" style={{ justifyContent: 'center', color: 'var(--ink-mute)' }} onClick={() => { setVersionConflict(null); setPendingJobCtx(null); }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
