'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft } from '@/lib/auth';
import IntegrationsTab, { SourceBadge } from './IntegrationsTab';
import ReportsTab from './ReportsTab';

// ── Types ─────────────────────────────────────────────────────────────────────

type CrewRow = {
  id: string;
  worker_name: string;
  dept: string;
  clock_in: string;
  status: string | null;
};

type Message = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
};

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
};

type JobDrawing = {
  id: string;
  job_name: string | null;
  label: string | null;
  file_url: string | null;
  file_name: string | null;
  uploaded_by: string | null;
  created_at: string;
};

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
};

type Tab = 'overview' | 'messages' | 'needs' | 'damage' | 'plans' | 'sops' | 'ai' | 'integrations' | 'reports';

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
  return (
    <div style={{ position: 'sticky', top: 64, zIndex: 50, background: 'rgba(251,191,36,0.06)', borderBottom: '1px solid rgba(251,191,36,0.25)', padding: '10px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round"><path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}><b>{days} day{days !== 1 ? 's' : ''}</b> left in trial —</span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>Upgrade</Link>
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

function fileTypeBadge(fileName: string | null): { label: string; color: string; bg: string } | null {
  if (!fileName) return null;
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, { label: string; color: string; bg: string }> = {
    pdf:  { label: 'PDF',  color: '#F87171', bg: 'rgba(248,113,113,0.1)' },
    csv:  { label: 'CSV',  color: '#34D399', bg: 'rgba(52,211,153,0.1)'  },
    xlsx: { label: 'XLS',  color: '#34D399', bg: 'rgba(52,211,153,0.1)'  },
    xls:  { label: 'XLS',  color: '#34D399', bg: 'rgba(52,211,153,0.1)'  },
    dwg:  { label: 'DWG',  color: '#5EEAD4', bg: 'rgba(94,234,212,0.1)'  },
    png:  { label: 'IMG',  color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
    jpg:  { label: 'IMG',  color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
    jpeg: { label: 'IMG',  color: '#A78BFA', bg: 'rgba(167,139,250,0.1)' },
  };
  const t = map[ext];
  return t ?? { label: ext.toUpperCase() || 'FILE', color: '#8BA5A0', bg: 'rgba(95,111,108,0.1)' };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupervisorPage() {
  const { loading: sessionLoading, tenant, email } = useSession();

  const [tab,         setTab]         = useState<Tab>('overview');
  const [activeCrew,  setActiveCrew]  = useState<CrewRow[]>([]);
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
  const [newJobNum,      setNewJobNum]      = useState('');
  const [newJobName,     setNewJobName]     = useState('');
  const [addingJob,      setAddingJob]      = useState(false);

  // Plans upload
  const [planFile,      setPlanFile]      = useState<File | null>(null);
  const [planJobNum,    setPlanJobNum]    = useState('');
  const [planLabel,     setPlanLabel]     = useState('');
  const [planUploading, setPlanUploading] = useState(false);

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

  // Resolution modal
  const [resolvingId,   setResolvingId]   = useState<string | null>(null);
  const [resType,       setResType]       = useState('Repaired in shop');
  const [resNotes,      setResNotes]      = useState('');
  const [resBy,         setResBy]         = useState('Supervisor');
  const [resCost,       setResCost]       = useState('');
  const [resSubmitting, setResSubmitting] = useState(false);

  // Toast
  const [toast,     setToast]     = useState<{ msg: string; error?: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  // ── Data load ───────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!tenant) return;
    try {
      const [crewRes, msgRes, needsRes, damageRes] = await Promise.all([
        supabase.from('time_clock').select('id, worker_name, dept, clock_in, status').eq('tenant_id', tenant.id).is('clock_out', null).order('clock_in', { ascending: true }),
        supabase.from('messages').select('id, sender_name, dept, body, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200),
        supabase.from('inventory_needs').select('id, item, dept, job_number, qty, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('damage_reports').select('id, part_name, job_id, dept, notes, photo_url, status, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (crewRes.data)   setActiveCrew(crewRes.data as CrewRow[]);
      if (msgRes.data)    setMessages(msgRes.data as Message[]);
      if (needsRes.data)  setNeeds(needsRes.data as InventoryNeed[]);
      if (damageRes.data) setDamage(damageRes.data as DamageReport[]);
    } catch (_) {}
    try {
      const [plansRes, sopsRes, buildsRes, partsRes, jobsRes] = await Promise.all([
        supabase.from('job_drawings').select('id, job_name, label, file_url, file_name, uploaded_by, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('sops').select('id, title, dept, pdf_url, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(100),
        supabase.from('time_clock').select('id, worker_name, clock_in, clock_out, notes, job_number, total_hours').eq('tenant_id', tenant.id).eq('status', 'craftsman_build').order('clock_in', { ascending: false }).limit(50),
        supabase.from('parts_log').select('*').eq('tenant_id', tenant.id).not('status', 'in', '("Archived")').order('created_at', { ascending: false }).limit(100),
        supabase.from('jobs').select('id, job_number, job_name, status, source, created_at').eq('tenant_id', tenant.id).order('created_at', { ascending: false }).limit(200),
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
      showToast('Check-in saved ✓');
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
            setActiveCrew((prev) => prev.some((r) => r.id === row.id) ? prev : [...prev, row]);
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

    return () => {
      supabase.removeChannel(clockCh);
      supabase.removeChannel(msgCh);
      supabase.removeChannel(needsCh);
      supabase.removeChannel(damageCh);
      supabase.removeChannel(partsCh);
      supabase.removeChannel(jobsCh);
    };
  }, [tenant]);

  // ── Job handlers ────────────────────────────────────────────────────────────

  async function handleAddJob() {
    const num = newJobNum.trim();
    if (!num || addingJob || !tenant) return;
    setAddingJob(true);
    try {
      const { error } = await supabase.from('jobs').insert({
        job_number: num,
        job_name:   newJobName.trim() || null,
        status:     'active',
        tenant_id:  tenant.id,
      });
      if (error) throw error;
      setNewJobNum('');
      setNewJobName('');
      showToast('Job added ✓');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Insert failed', true);
    } finally {
      setAddingJob(false);
    }
  }

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

  // ── Message send ────────────────────────────────────────────────────────────

  async function handleSendMessage() {
    const body = msgBody.trim();
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
    };
    setMessages((prev) => [optimistic, ...prev]);
    setMsgBody('');

    try {
      const { data, error } = await supabase.from('messages').insert({
        sender_name: 'Supervisor',
        dept,
        body,
        tenant_id: tenant!.id,
      }).select('id, sender_name, dept, body, created_at').single();
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? data as Message : m));
      showToast('Message sent ✓');
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

  // ── Inventory status update ─────────────────────────────────────────────────

  async function handleNeedStatus(id: string, status: string) {
    setActioning((prev) => ({ ...prev, [id]: true }));
    const prev = needs.find((n) => n.id === id);
    setNeeds((ns) => ns.map((n) => n.id === id ? { ...n, status } : n));
    try {
      const { error } = await supabase.from('inventory_needs').update({ status }).eq('id', id);
      if (error) throw error;
      showToast(`Marked as ${status} ✓`);
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
    setResolvingId(id);
    setResType('Repaired in shop');
    setResNotes('');
    setResBy('Supervisor');
    setResCost('');
  }

  async function handleResolutionConfirm() {
    if (!resolvingId || !resNotes.trim() || resSubmitting) return;
    const id = resolvingId;
    setResSubmitting(true);
    const prev = damage.find((d) => d.id === id);
    setDamage((ds) => ds.map((d) => d.id === id ? { ...d, status: 'resolved' } : d));
    setResolvingId(null);
    try {
      const { error } = await supabase.from('damage_reports').update({
        status:           'resolved',
        resolution_type:  resType,
        resolution_notes: resNotes.trim(),
        resolved_by:      resBy.trim() || 'Supervisor',
        resolution_cost:  resCost ? parseFloat(resCost) : null,
        resolved_at:      new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      showToast('Damage report resolved ✓');
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
        showToast('Resolved ✓ — run damage_resolution.sql to save full details');
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
      showToast(`Marked as ${status} ✓`);
    } catch (err: unknown) {
      if (prev) setDamage((ds) => ds.map((d) => d.id === id ? prev : d));
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setActioning((prev) => ({ ...prev, [id]: false }));
    }
  }

  // ── Plans ───────────────────────────────────────────────────────────────────

  async function handlePlanUpload() {
    if (!planFile || !planJobNum.trim() || planUploading) return;
    setPlanUploading(true);
    try {
      const ext = planFile.name.split('.').pop() ?? 'bin';
      const path = `${tenant!.id}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage.from('job-plans').upload(path, planFile, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from('job-plans').getPublicUrl(path);
      const { error: dbErr } = await supabase.from('job_drawings').insert({
        tenant_id: tenant!.id,
        job_name: planJobNum.trim(),
        label: planLabel.trim() || null,
        file_url: publicUrl,
        file_name: planFile.name,
        uploaded_by: 'Supervisor',
      });
      if (dbErr) throw dbErr;
      setPlanFile(null);
      setPlanJobNum('');
      setPlanLabel('');
      showToast('Plan uploaded ✓');
      const { data } = await supabase.from('job_drawings').select('id, job_name, label, file_url, file_name, uploaded_by, created_at').eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
      if (data) setPlans(data as JobDrawing[]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      showToast(msg, true);
    } finally {
      setPlanUploading(false);
    }
  }

  async function handlePlanDelete(id: string) {
    setPlans((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from('job_drawings').delete().eq('id', id);
      if (error) throw error;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, true);
      const { data } = await supabase.from('job_drawings').select('id, job_name, label, file_url, file_name, uploaded_by, created_at').eq('tenant_id', tenant!.id).order('created_at', { ascending: false }).limit(100);
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
      showToast('SOP uploaded ✓');
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
      showToast('✓ Status updated');
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

  // These must be above the early return so useMemo is never called conditionally
  const openNeeds  = needs.filter((n)  => !['resolved', 'closed', 'received', 'cancelled'].includes((n.status  ?? 'open').toLowerCase()));
  const openDamage = damage.filter((d) => !['resolved', 'closed'].includes((d.status ?? 'open').toLowerCase()));

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
    const allDepts = ['Production', 'Assembly', 'Finishing', 'Craftsman'];
    const activeDepts = new Set(activeCrew.map((c) => c.dept));
    allDepts.forEach((dept) => {
      if (!activeDepts.has(dept)) flags.push({
        trigger: `No ${dept} crew clocked in today`,
        action:  `Check if ${dept} is scheduled today.`,
        severity: 'watch',
      });
    });
    return flags;
  }, [activeCrew, openNeeds, openDamage]);

  if (sessionLoading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview',      label: 'Overview' },
    { key: 'messages',      label: 'Messages',    count: messages.length },
    { key: 'needs',         label: 'Inventory',   count: openNeeds.length },
    { key: 'damage',        label: 'Damage',      count: openDamage.length },
    { key: 'plans',         label: 'Plans',       count: plans.length > 0 ? plans.length : undefined },
    { key: 'sops',          label: 'SOPs',        count: sops.length > 0 ? sops.length : undefined },
    { key: 'ai',            label: 'AI' },
    { key: 'integrations',  label: 'Integrations' },
    { key: 'reports',       label: 'Reports' },
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
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)', borderBottom: '1px solid var(--line)', height: 64, display: 'flex', alignItems: 'center', padding: '0 32px', justifyContent: 'space-between' }}>
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

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Supervisor Dashboard</div>
              <h2 style={{ fontSize: 28 }}>{tenant?.shop_name}</h2>
              <Link
                href="/app"
                style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, textDecoration: 'none' }}
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                Switch Role
              </Link>
            </div>
            <button onClick={loadAll} className="btn btn-ghost" style={{ fontSize: 12, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Refresh
            </button>
          </div>

          {/* KPI strip */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 32 }}>
            {[
              { label: 'Crew Clocked In',      value: dataLoading ? '—' : String(activeCrew.length),  color: '#2DE1C9' },
              { label: 'Messages',              value: dataLoading ? '—' : String(messages.length),    color: '#5EEAD4' },
              { label: 'Open Inventory Needs',  value: dataLoading ? '—' : String(openNeeds.length),   color: '#FBBF24' },
              { label: 'Open Damage Reports',   value: dataLoading ? '—' : String(openDamage.length),  color: '#F87171' },
            ].map(({ label, value, color }) => (
              <div key={label} className="portal-card" style={{ padding: '20px 24px' }}>
                <div className="portal-stat-value" style={{ color }}>{value}</div>
                <div className="portal-stat-label" style={{ marginTop: 6 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', marginBottom: 24 }}>
            {tabs.map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => { setTab(key); setOpenThread(null); setMsgBody(''); }}
                style={{ padding: '10px 18px', fontSize: 13, fontWeight: 600, color: tab === key ? 'var(--teal)' : 'var(--ink-mute)', background: 'none', border: 'none', cursor: 'pointer', borderBottom: tab === key ? '2px solid var(--teal)' : '2px solid transparent', marginBottom: -1, display: 'flex', alignItems: 'center', gap: 7, transition: 'color 0.15s', fontFamily: 'inherit' }}
              >
                {label}
                {count !== undefined && count > 0 && (
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 20, background: tab === key ? 'rgba(94,234,212,0.15)' : 'rgba(255,255,255,0.06)', color: tab === key ? 'var(--teal)' : 'var(--ink-mute)' }}>
                    {count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Overview tab ──────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <style>{`@keyframes craftsPulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>

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
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        {['Name', 'Department', 'Status', 'Clocked In', 'Duration'].map((h) => (
                          <th key={h} style={thStyle}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeCrew.map((row) => (
                        <tr key={row.id} style={{ borderBottom: '1px solid var(--line)' }}>
                          <td style={tdBold}>{row.worker_name}</td>
                          <td style={tdStyle}>{row.dept}</td>
                          <td style={tdStyle}>{row.status ?? 'active'}</td>
                          <td style={tdStyle}>{formatTime(row.clock_in)}</td>
                          <td style={{ ...tdStyle }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', padding: '3px 8px', borderRadius: 6 }}>{elapsed(row.clock_in)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                const NEXT_DEPTS = ['Production', 'Assembly', 'Finishing', 'Craftsman', 'Installation'];
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
                                          <div style={{ fontSize: 10, color: 'var(--ink-mute)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 2 }}>Job #</div>
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
                  <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>{jobs.filter((j) => j.status === 'active').length} jobs</span>
                </div>

                {/* Add job row */}
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8 }}>
                  <input
                    className="form-input"
                    placeholder="Job #"
                    value={newJobNum}
                    onChange={(e) => setNewJobNum(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { void handleAddJob(); } }}
                    style={{ width: 100, flexShrink: 0 }}
                  />
                  <input
                    className="form-input"
                    placeholder="Job name (optional)"
                    value={newJobName}
                    onChange={(e) => setNewJobName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { void handleAddJob(); } }}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ flexShrink: 0, padding: '8px 14px', fontSize: 13, boxShadow: 'none', opacity: (!newJobNum.trim() || addingJob) ? 0.5 : 1 }}
                    onClick={handleAddJob}
                    disabled={!newJobNum.trim() || addingJob}
                  >
                    {addingJob ? '…' : '+ Add'}
                  </button>
                </div>

                {jobs.filter((j) => j.status === 'active').length === 0 ? (
                  <div style={{ padding: '16px 20px', fontSize: 13, color: 'var(--ink-mute)' }}>No active jobs. Add one above — crew will see these in the parts dropdown.</div>
                ) : (
                  jobs.filter((j) => j.status === 'active').map((j) => (
                    <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 20px', borderBottom: '1px solid var(--line)' }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{j.job_number}</span>
                        {j.job_name && <span style={{ fontSize: 13, color: 'var(--ink-dim)' }}>{j.job_name}</span>}
                        <SourceBadge source={j.source} />
                      </div>
                      <button
                        onClick={() => { void handleDeleteJob(j.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 4, display: 'flex', alignItems: 'center' }}
                        title="Delete job"
                      >
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

            </div>
          )}

          {/* ── Messages tab — Inbox ──────────────────────────────────────────── */}
          {tab === 'messages' && openThread === null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Compose new message */}
              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>New Message</div>
                <div style={{ marginBottom: 10 }}>
                  <select
                    className="form-input"
                    value={msgDept}
                    onChange={(e) => setMsgDept(e.target.value)}
                    style={{ width: '100%', cursor: 'pointer' }}
                  >
                    <option value="">All Departments (broadcast)</option>
                    <option value="Production">Production</option>
                    <option value="Assembly">Assembly</option>
                    <option value="Finishing">Finishing</option>
                    <option value="Craftsman">Craftsman</option>
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <textarea
                    className="form-input"
                    placeholder="Type a message to your crew…"
                    value={msgBody}
                    onChange={(e) => setMsgBody(e.target.value)}
                    rows={2}
                    style={{ flex: 1, resize: 'vertical', minHeight: 64 }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage(); }}
                  />
                  <button
                    className="btn btn-primary"
                    style={{ alignSelf: 'flex-end', padding: '12px 20px', opacity: (!msgBody.trim() || sending) ? 0.5 : 1 }}
                    onClick={handleSendMessage}
                    disabled={!msgBody.trim() || sending}
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 8 }}>⌘↵ or Ctrl+Enter to send</div>
              </div>

              {/* Thread list */}
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : msgThreads.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No messages yet. Send the first message above.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {msgThreads.map(({ deptKey, label, count, lastMsg }, i) => (
                    <div
                      key={deptKey}
                      style={{
                        display: 'flex', alignItems: 'center',
                        borderBottom: i < msgThreads.length - 1 ? '1px solid var(--line)' : 'none',
                      }}
                    >
                      {/* Clickable row area */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => { setOpenThread(deptKey); setMsgBody(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { setOpenThread(deptKey); setMsgBody(''); } }}
                        style={{
                          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '16px 20px',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(94,234,212,0.03)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'none'; }}
                      >
                        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(94,234,212,0.08)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 10, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)' }}>
                              {count}
                            </span>
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: lastMsg.sender_name === 'Supervisor' ? 'var(--teal)' : 'var(--ink-dim)', fontWeight: 600 }}>{lastMsg.sender_name}:</span>{' '}
                            {lastMsg.body.length > 80 ? lastMsg.body.slice(0, 77) + '…' : lastMsg.body}
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0, marginRight: 4 }}>
                          {formatDate(lastMsg.created_at)}
                        </div>
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--ink-mute)', flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                      </div>
                      {/* Thread delete button */}
                      <button
                        onClick={() => handleDeleteThread(deptKey, label)}
                        title={`Delete all ${label} messages`}
                        style={{
                          flexShrink: 0, marginRight: 16, background: 'none', border: '1px solid rgba(248,113,113,0.3)',
                          borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#F87171', fontSize: 11,
                          fontFamily: 'inherit', transition: 'background 0.1s, border-color 0.1s',
                        }}
                        onMouseEnter={(e) => { const b = e.currentTarget; b.style.background = 'rgba(248,113,113,0.08)'; b.style.borderColor = '#F87171'; }}
                        onMouseLeave={(e) => { const b = e.currentTarget; b.style.background = 'none'; b.style.borderColor = 'rgba(248,113,113,0.3)'; }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Messages tab — Conversation ───────────────────────────────────── */}
          {tab === 'messages' && openThread !== null && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Back + thread header — same style as crew page */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  onClick={() => { setOpenThread(null); setMsgBody(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 13, transition: 'color 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-mute)'; }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Inbox
                </button>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                  {openThreadLabel}
                </span>
              </div>

              {/* Bubble conversation — same structure as crew page */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {openThreadMsgs.length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '12px 0' }}>No messages in this thread.</div>
                ) : (
                  openThreadMsgs.map((msg) => {
                    const isSelf = msg.sender_name === 'Supervisor';
                    return (
                      <div
                        key={msg.id}
                        style={{
                          padding: '12px 14px', borderRadius: 12,
                          background: isSelf ? 'rgba(94,234,212,0.04)' : 'rgba(255,255,255,0.02)',
                          border: isSelf ? '1px solid rgba(94,234,212,0.15)' : '1px solid var(--line)',
                          alignSelf: isSelf ? 'flex-start' : 'flex-end',
                          maxWidth: '82%',
                          opacity: msg.id.startsWith('opt-') ? 0.6 : 1,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 12 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: isSelf ? 'var(--teal)' : 'var(--ink)' }}>
                            {msg.sender_name}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ink-mute)', flexShrink: 0 }}>
                            {formatTime(msg.created_at)}
                          </span>
                        </div>
                        <p style={{ fontSize: 14, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.55 }}>{msg.body}</p>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Reply box — same structure as crew page */}
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                <textarea
                  className="form-input"
                  placeholder={`Reply to ${openThreadLabel}…`}
                  value={msgBody}
                  onChange={(e) => setMsgBody(e.target.value)}
                  rows={3}
                  style={{ resize: 'none', marginBottom: 10, width: '100%' }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSendMessage(); }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>⌘↵ to send</span>
                  <button
                    className="btn btn-primary"
                    style={{ opacity: (!msgBody.trim() || sending) ? 0.5 : 1, padding: '8px 20px' }}
                    onClick={handleSendMessage}
                    disabled={!msgBody.trim() || sending}
                  >
                    {sending ? 'Sending…' : 'Reply'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Inventory tab ─────────────────────────────────────────────────── */}
          {tab === 'needs' && (
            <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                Inventory Needs
              </div>
              {dataLoading ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : needs.length === 0 ? (
                <div style={{ padding: 20, fontSize: 13, color: 'var(--ink-mute)' }}>No inventory needs logged.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      {['Item', 'Department', 'Job #', 'Qty', 'Date', 'Status', ''].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {needs.map((n) => {
                      const s = (n.status ?? 'pending').toLowerCase();
                      const isActionable = !['received', 'cancelled'].includes(s);
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
                              {isActionable && s !== 'ordered' && (
                                <ActionBtn label="Mark Ordered" color="#5EEAD4" onClick={() => handleNeedStatus(n.id, 'ordered')} disabled={busy} />
                              )}
                              {isActionable && (
                                <ActionBtn label="Received" color="#34D399" onClick={() => handleNeedStatus(n.id, 'received')} disabled={busy} />
                              )}
                              {isActionable && (
                                <ActionBtn label="Cancel" color="#F87171" onClick={() => handleNeedStatus(n.id, 'cancelled')} disabled={busy} />
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Damage tab ────────────────────────────────────────────────────── */}
          {tab === 'damage' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : damage.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No damage reports logged.</div>
              ) : (
                damage.map((d) => {
                  const s = (d.status ?? 'open').toLowerCase();
                  const isOpen = !['resolved', 'closed'].includes(s);
                  const busy = actioning[d.id];
                  return (
                    <div key={d.id} className="portal-card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{d.part_name}</span>
                            <StatusBadge status={d.status} />
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                            {d.dept    && <span>{d.dept}</span>}
                            {d.job_id  && <span>Job: {d.job_id}</span>}
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
                })
              )}
            </div>
          )}
          {/* ── Plans tab ────────────────────────────────────────────────────── */}
          {tab === 'plans' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div className="portal-card">
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Upload Plan</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Job Number *</label>
                    <input className="form-input" placeholder="e.g. P-26-1001" value={planJobNum} onChange={(e) => setPlanJobNum(e.target.value)} />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>Description</label>
                    <input className="form-input" placeholder="e.g. Cabinet layout, CNC file…" value={planLabel} onChange={(e) => setPlanLabel(e.target.value)} />
                  </div>
                </div>
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-mute)', display: 'block', marginBottom: 5 }}>File (PDF, CSV, DWG…) *</label>
                  <input
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls,.dwg,.png,.jpg,.jpeg"
                    onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)}
                    style={{ fontSize: 13, color: 'var(--ink-dim)', width: '100%' }}
                  />
                </div>
                <button
                  className="btn btn-primary"
                  style={{ opacity: (!planFile || !planJobNum.trim() || planUploading) ? 0.5 : 1, padding: '10px 24px' }}
                  onClick={handlePlanUpload}
                  disabled={!planFile || !planJobNum.trim() || planUploading}
                >
                  {planUploading ? 'Uploading…' : 'Upload Plan'}
                </button>
              </div>

              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : plans.length === 0 ? (
                <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No plans uploaded yet.</div>
              ) : (
                <div className="portal-card" style={{ padding: 0, overflow: 'hidden' }}>
                  {(() => {
                    const groups: Record<string, JobDrawing[]> = {};
                    plans.forEach((p) => {
                      const k = p.job_name || 'No Job Number';
                      if (!groups[k]) groups[k] = [];
                      groups[k].push(p);
                    });
                    return Object.entries(groups).map(([jobKey, items]) => (
                      <div key={jobKey}>
                        <div style={{ padding: '10px 20px', background: 'rgba(167,139,250,0.05)', borderBottom: '1px solid var(--line)', fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#A78BFA' }}>
                          {jobKey}
                        </div>
                        {items.map((p) => {
                          const badge = fileTypeBadge(p.file_name);
                          return (
                            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px', borderBottom: '1px solid var(--line)' }}>
                              {badge && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 5, background: badge.bg, color: badge.color, flexShrink: 0 }}>{badge.label}</span>
                              )}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.label || p.file_name || 'Untitled'}</div>
                                <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{formatDate(p.created_at)}</div>
                              </div>
                              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                                {p.file_url && (
                                  <a href={p.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', background: 'rgba(167,139,250,0.1)', padding: '5px 12px', borderRadius: 8, textDecoration: 'none' }}>View</a>
                                )}
                                <ActionBtn label="Delete" color="#F87171" onClick={() => handlePlanDelete(p.id)} />
                              </div>
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
                      <option value="Production">Production</option>
                      <option value="Assembly">Assembly</option>
                      <option value="Finishing">Finishing</option>
                      <option value="Craftsman">Craftsman</option>
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

              {/* Mode selector */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {([
                  { key: 'learn',      label: 'Learn' },
                  { key: 'assist',     label: 'Assist' },
                  { key: 'autonomous', label: 'Autonomous' },
                ] as { key: AiMode; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAiMode(key)}
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
                      {autoSettings.allPaused ? '▶  Resume All' : '⏸  Pause All'}
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

          {/* ── Integrations tab ─────────────────────────────────────────── */}
          {tab === 'integrations' && tenant && (
            <IntegrationsTab
              tenantId={tenant.id}
              showToast={showToast}
              jobs={jobs}
              setJobs={setJobs}
              plans={plans}
              setPlans={setPlans}
            />
          )}

          {/* ── Reports tab ──────────────────────────────────────────────── */}
          {tab === 'reports' && tenant && (
            <ReportsTab tenantId={tenant.id} showToast={showToast} />
          )}

        </main>
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

      {toast && <Toast msg={toast.msg} error={toast.error} />}
    </>
  );
}
