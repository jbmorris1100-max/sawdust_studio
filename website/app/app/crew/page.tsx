'use client';
import Link from 'next/link';
import { useEffect, useState, useCallback, useRef } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft } from '@/lib/auth';

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeEntry = {
  id: string;
  worker_name: string;
  dept: string;
  clock_in: string;
  clock_out: string | null;
  status: string | null;
};

type Message = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
};

type Drawing = {
  id: string;
  job_number: string | null;
  job_id: string | null;
  plan_name: string | null;
  label: string | null;
  file_url: string | null;
  external_url: string | null;
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

type ModalType = 'clock' | 'inventory' | 'damage' | 'plans' | 'sops' | 'switchDept' | 'editName' | 'buildTimer' | 'parts' | null;
type ClockStep = 'lookup' | 'clockin' | 'clockout';
type BuildTimerStep = 'form' | 'summary';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
  const { loading: sessionLoading, tenant, email } = useSession();

  // Page data
  const [clockEntries, setClockEntries] = useState<TimeEntry[]>([]);
  const [messages,     setMessages]     = useState<Message[]>([]);
  const [dataLoading,  setDataLoading]  = useState(true);

  // Crew identity (persisted in localStorage)
  const [crewName, setCrewName] = useState('');
  const [crewDept, setCrewDept] = useState('');
  // Ref so realtime closure always reads current dept without re-subscribing
  const crewDeptRef = useRef('');
  useEffect(() => { crewDeptRef.current = crewDept; }, [crewDept]);

  // New-message notification banner
  const [msgNotification, setMsgNotification] = useState<string | null>(null);
  const notifTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modal state
  const [modal,     setModal]     = useState<ModalType>(null);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState<{ msg: string; error?: boolean } | null>(null);
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
  const [dmgPhoto,        setDmgPhoto]        = useState<File | null>(null);
  const [dmgPhotoPreview, setDmgPhotoPreview] = useState<string | null>(null);
  const [dmgScanStep,     setDmgScanStep]     = useState<'camera' | 'preview'>('camera');
  const [dmgShowDetails,  setDmgShowDetails]  = useState(false);
  const [dmgFlash,        setDmgFlash]        = useState(false);

  // Plans modal
  const [drawings,     setDrawings]     = useState<Drawing[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

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
  const [replySaving, setReplySaving] = useState(false);

  // Load localStorage identity + restore any in-progress craftsman build timer
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
  }, []);

  // Tick every second while a build timer is running
  useEffect(() => {
    if (!buildStart) return;
    const iv = setInterval(() => setTimerTick((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [buildStart]);

  // Load page data — fetch all tenant messages and filter client-side by dept
  useEffect(() => {
    if (!tenant) return;
    async function load() {
      try {
        const [clockRes, msgRes] = await Promise.all([
          supabase
            .from('time_clock')
            .select('id, worker_name, dept, clock_in, clock_out, status')
            .eq('tenant_id', tenant!.id)
            .order('clock_in', { ascending: false })
            .limit(8),
          supabase
            .from('messages')
            .select('id, sender_name, dept, body, created_at')
            .eq('tenant_id', tenant!.id)
            .order('created_at', { ascending: false })
            .limit(200),
        ]);
        if (clockRes.data) setClockEntries(clockRes.data as TimeEntry[]);
        if (msgRes.data)   setMessages(msgRes.data as Message[]);
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
          } else if (payload.eventType === 'DELETE') {
            setMessages((prev) => prev.filter((m) => m.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(msgCh); };
  }, [tenant]);

  // Start / stop the camera stream whenever the camera step becomes active/inactive
  useEffect(() => {
    const isCamera =
      (modal === 'damage' && dmgScanStep === 'camera') ||
      (modal === 'parts'  && partsMode === 'log' && partScanStep === 'camera');
    if (isCamera) {
      void startCamera();
    } else {
      stopCamera();
    }
    return () => { stopCamera(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, dmgScanStep, partScanStep, partsMode]);

  const showToast = useCallback((msg: string, error = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, error });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const reloadClock = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data } = await supabase
        .from('time_clock')
        .select('id, worker_name, dept, clock_in, clock_out, status')
        .eq('tenant_id', tenant.id)
        .order('clock_in', { ascending: false })
        .limit(8);
      if (data) setClockEntries(data as TimeEntry[]);
    } catch (_) {}
  }, [tenant]);

  const reloadMessages = useCallback(async () => {
    if (!tenant) return;
    try {
      const { data } = await supabase
        .from('messages')
        .select('id, sender_name, dept, body, created_at')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (data) setMessages(data as Message[]);
    } catch (_) {}
  }, [tenant]);

  function saveIdentity(name: string, dept: string) {
    localStorage.setItem('crew_name', name);
    localStorage.setItem('crew_dept', dept);
    setCrewName(name);
    setCrewDept(dept);
  }

  // ── Open modal helpers ──────────────────────────────────────────────────────

  function openClock() {
    setClockStep('lookup');
    setClockName(crewName);
    setClockDept(crewDept);
    setOpenEntry(null);
    setModal('clock');
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
    setDmgPhoto(null);
    setDmgPhotoPreview(null);
    setDmgScanStep('camera');
    setDmgShowDetails(false);
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
    // 4. Best-effort: sync device_tokens push token row
    try {
      await supabase.from('device_tokens').update({ dept: newDept }).eq('name', crewName);
    } catch (_) {}
    closeModal();
    showToast(`Department changed to ${newDept} ✓`);
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
      showToast('Name updated ✓');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setNameSaving(false);
    }
  }

  async function openPlans() {
    setDrawings([]);
    setModal('plans');
    setPlansLoading(true);
    try {
      const { data } = await supabase
        .from('job_drawings')
        .select('id, job_number, job_id, plan_name, label, file_url, external_url, file_name, uploaded_by, created_at')
        .eq('tenant_id', tenant!.id)
        .order('created_at', { ascending: false });
      if (data) setDrawings(data as Drawing[]);
    } catch (_) {}
    setPlansLoading(false);
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
      showToast('Build timer started ✓');
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
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function closeModal() {
    setModal(null);
    setSaving(false);
    stopCamera();
  }

  // ── Clock handlers ──────────────────────────────────────────────────────────

  async function handleClockLookup() {
    const name = clockName.trim();
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
        setClockStep('clockout');
      } else {
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
    setSaving(true);
    try {
      const now  = new Date().toISOString();
      const date = new Date().toISOString().split('T')[0];
      const payload = {
        worker_name: name,
        dept,
        clock_in:    now,
        clock_out:   null,
        date,
        status:      'active',
        tenant_id:   tenant!.id,
      };
      console.log('[clock-in] inserting:', payload);
      const { error } = await supabase.from('time_clock').insert(payload);
      if (error) {
        console.error('[clock-in] error:', error);
        throw error;
      }
      saveIdentity(name, dept);
      await reloadClock();
      closeModal();
      showToast(`${name} clocked in ✓`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[clock-in] caught:', err);
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  async function handleClockOut() {
    if (!openEntry || saving) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase.from('time_clock').update({ clock_out: now }).eq('id', openEntry.id);
      if (error) throw error;
      await reloadClock();
      closeModal();
      showToast(`${openEntry.worker_name} clocked out ✓`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      showToast(msg, true);
    } finally {
      setSaving(false);
    }
  }

  // ── Inventory handler ───────────────────────────────────────────────────────

  async function handleInventorySubmit() {
    const item = invItem.trim();
    const dept = invDept.trim();
    if (!item || !dept || saving) return;
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
      saveIdentity(crewName, dept);
      closeModal();
      showToast('Inventory need logged ✓');
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
    setSaving(true);
    try {
      let photoUrl: string | null = null;
      if (dmgPhoto) {
        try { photoUrl = await uploadPhoto(dmgPhoto, 'damage-photos'); }
        catch (_) { /* photo upload failed — continue without it */ }
      }
      const dept = dmgDept.trim() || crewDept || 'Unknown';
      const { error } = await supabase.from('damage_reports').insert({
        part_name: dmgWhat.trim() || 'Damage report',
        dept,
        notes:     null,
        photo_url: photoUrl,
        status:    'open',
        tenant_id: tenant!.id,
      });
      if (error) throw error;
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

  async function handleCrewReply() {
    const body = replyBody.trim();
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
    };
    setMessages((prev) => [optimistic, ...prev]);
    setReplyBody('');
    try {
      const { data, error } = await supabase
        .from('messages')
        .insert({ sender_name: crewName || 'Crew', dept, body, tenant_id: tenant!.id })
        .select('id, sender_name, dept, body, created_at')
        .single();
      if (error) throw error;
      setMessages((prev) => prev.map((m) => m.id === optimisticId ? (data as Message) : m));
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
    setQcActioning((prev) => ({ ...prev, [id]: true }));
    setPartsQcList((prev) => prev.filter((p) => p.id !== id));
    try {
      const { error } = await supabase.from('parts_log').update({ status: newStatus }).eq('id', id);
      if (error) throw error;
      showToast(newStatus === 'Passed QC' ? 'Part approved ✓' : 'Marked for rework ✓');
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
  const activeCrew = clockEntries.filter((e) => !e.clock_out || e.status === 'active');

  // Strict dept isolation: only crew's own dept + broadcasts (dept = null)
  // NEVER include messages from other departments
  const relevantMsgs = messages.filter(
    (m) => m.dept === null || m.dept === crewDept
  );

  // Supervisor thread: all messages where dept = crewDept OR dept IS NULL
  const supervisorMsgs = [...relevantMsgs]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const supervisorLastMsg = supervisorMsgs[0] ?? null;

  // Conversation messages sorted oldest-first for display
  const openThreadMsgs = openThread === 'supervisor' ? [...supervisorMsgs].reverse() : [];

  // Group drawings by job number for plans modal
  const drawingGroups: Record<string, Drawing[]> = {};
  drawings.forEach((d) => {
    const key = d.job_number || d.job_id || 'Unknown';
    if (!drawingGroups[key]) drawingGroups[key] = [];
    drawingGroups[key].push(d);
  });

  // ── Render ─────────────────────────────────────────────────────────────────

  const quickActions = [
    {
      label: 'Clock In / Out',
      color: '#2DE1C9', bg: 'rgba(45,225,201,0.08)',
      onClick: openClock,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    },
    {
      label: 'Log Inventory Need',
      color: '#5EEAD4', bg: 'rgba(94,234,212,0.08)',
      onClick: openInventory,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
    },
    {
      label: 'Report Damage',
      color: '#F87171', bg: 'rgba(248,113,113,0.08)',
      onClick: openDamage,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
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
    {
      label: 'Scan Part / QC',
      color: '#60A5FA', bg: 'rgba(96,165,250,0.08)',
      onClick: openParts,
      icon: <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    },
    ...(crewDept === 'Craftsman' ? ([
      {
        label: buildStart ? 'Stop Build Timer' : 'Start Build Timer',
        color: buildStart ? '#F87171' : '#2DE1C9',
        bg:    buildStart ? 'rgba(248,113,113,0.08)' : 'rgba(45,225,201,0.08)',
        onClick: buildStart ? () => { void handleStopTimer(); } : openBuildTimerModal,
        icon: buildStart
          ? <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          : <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      },
    ] as { label: string; color: string; bg: string; onClick: () => void; icon: React.ReactNode }[]) : []),
  ];

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
        {msgNotification && <NewMsgBanner preview={msgNotification} onDismiss={() => { setMsgNotification(null); if (notifTimer.current) clearTimeout(notifTimer.current); }} />}

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div className="eyebrow">Crew View</div>
              <Link
                href="/app"
                style={{ fontSize: 12, color: 'var(--ink-mute)', display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
              >
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
                Switch Role
              </Link>
            </div>
            <h2 style={{ fontSize: 28 }}>{tenant?.shop_name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 14, color: 'var(--ink-dim)' }}>
                {activeCrew.length} crew member{activeCrew.length !== 1 ? 's' : ''} clocked in
              </span>
              {crewName && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>As</span>
                  <b style={{ fontSize: 13, color: 'var(--teal)' }}>{crewName}</b>
                  <button
                    onClick={openEditName}
                    title="Edit name"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: 2, display: 'flex', lineHeight: 1 }}
                  >
                    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                </div>
              )}
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

          {/* Quick actions */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Quick Actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              {quickActions.map(({ label, color, bg, onClick, icon }) => (
                <button
                  key={label}
                  onClick={onClick}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 10, padding: '20px 16px',
                    background: 'var(--bg-1)', border: '1px solid var(--line)',
                    borderRadius: 14, cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    textAlign: 'center', fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line-strong)'; (e.currentTarget as HTMLButtonElement).style.background = '#0e1418'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-1)'; }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

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

          {/* ── Messages ──────────────────────────────────────────────────────── */}
          <div style={{ marginBottom: 32 }}>

            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              {openThread !== null && (
                <button
                  onClick={() => { setOpenThread(null); setReplyBody(''); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-mute)', padding: '2px 4px', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'inherit', fontSize: 13, transition: 'color 0.1s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--ink-mute)'; }}
                >
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                  Inbox
                </button>
              )}
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)' }}>
                {openThread !== null ? 'Supervisor' : 'Messages'}
              </div>
            </div>

            {/* Content */}
            {dataLoading ? (
              <div className="portal-card" style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
            ) : openThread === null ? (

              /* ── Inbox: Supervisor thread only ── */
              <button
                onClick={() => setOpenThread('supervisor')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '16px',
                  borderRadius: 12, background: 'var(--bg-1)',
                  border: '1px solid var(--line)',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(94,234,212,0.35)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--line)'; }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 12, background: 'rgba(94,234,212,0.1)', color: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Supervisor</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                      {supervisorMsgs.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10, background: 'rgba(94,234,212,0.12)', color: 'var(--teal)' }}>
                          {supervisorMsgs.length}
                        </span>
                      )}
                      {supervisorLastMsg && (
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{formatDate(supervisorLastMsg.created_at)}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--ink-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {supervisorLastMsg
                      ? (supervisorLastMsg.body.length > 65 ? supervisorLastMsg.body.slice(0, 62) + '…' : supervisorLastMsg.body)
                      : 'No messages yet'
                    }
                  </div>
                </div>
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginLeft: 4 }}><polyline points="9 18 15 12 9 6"/></svg>
              </button>

            ) : (

              /* ── Conversation view ── */
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                  {openThreadMsgs.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--ink-mute)', padding: '12px 0' }}>No messages yet.</div>
                  ) : (
                    openThreadMsgs.map((msg) => {
                      const isSelf = msg.sender_name !== 'Supervisor';
                      return (
                        <div
                          key={msg.id}
                          style={{
                            padding: '12px 14px', borderRadius: 12,
                            background: isSelf ? 'rgba(255,255,255,0.02)' : 'rgba(94,234,212,0.04)',
                            border: isSelf ? '1px solid var(--line)' : '1px solid rgba(94,234,212,0.15)',
                            alignSelf: isSelf ? 'flex-end' : 'flex-start',
                            maxWidth: '82%',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5, gap: 12 }}>
                            <span style={{ fontSize: 12, fontWeight: 700, color: isSelf ? 'var(--ink)' : 'var(--teal)' }}>
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
                <div style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                  <textarea
                    className="form-input"
                    placeholder="Reply to Supervisor…"
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCrewReply(); }}
                    rows={3}
                    style={{ resize: 'none', marginBottom: 10 }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>⌘↵ to send</span>
                    <button
                      className="btn btn-primary"
                      style={{ opacity: (!replyBody.trim() || replySaving) ? 0.5 : 1, padding: '8px 20px' }}
                      onClick={handleCrewReply}
                      disabled={!replyBody.trim() || replySaving}
                    >
                      {replySaving ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── Recent Clock Activity ──────────────────────────────────────────── */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>Recent Clock Activity</div>
            <div className="portal-card">
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : clockEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No clock activity yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {clockEntries.map((entry) => (
                    <div key={entry.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'rgba(94,234,212,0.03)', border: '1px solid var(--line)' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{entry.worker_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{entry.dept}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {entry.clock_out ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 6 }}>Out {formatTime(entry.clock_out)}</span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', padding: '3px 8px', borderRadius: 6 }}>In since {formatTime(entry.clock_in)}</span>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>{formatDate(entry.clock_in)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </main>
      </div>

      {/* ── Clock Modal ─────────────────────────────────────────────────────── */}
      {modal === 'clock' && (
        <ModalOverlay onClose={closeModal} title="Clock In / Out">
          {clockStep === 'lookup' && (
            <>
              <Field label="Your Name">
                <input className="form-input" placeholder="e.g. Mike Torres" value={clockName} onChange={(e) => setClockName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleClockLookup(); }} autoFocus />
              </Field>
              <button
                className="btn btn-primary"
                style={{ width: '100%', justifyContent: 'center', opacity: (!clockName.trim() || checking) ? 0.5 : 1 }}
                onClick={handleClockLookup}
                disabled={!clockName.trim() || checking}
              >
                {checking ? 'Checking…' : 'Look Up Status'}
              </button>
            </>
          )}

          {clockStep === 'clockin' && (
            <>
              <p style={{ fontSize: 13, color: 'var(--ink-dim)', marginBottom: 20 }}>
                No open shift found for <b style={{ color: 'var(--ink)' }}>{clockName}</b>. Fill in the details to clock in.
              </p>
              <Field label="Department">
                <select className="form-input" value={clockDept} onChange={(e) => setClockDept(e.target.value)} autoFocus style={{ cursor: 'pointer' }}>
                  <option value="">Select department…</option>
                  <option value="Production">Production</option>
                  <option value="Assembly">Assembly</option>
                  <option value="Finishing">Finishing</option>
                  <option value="Craftsman">Craftsman</option>
                </select>
              </Field>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setClockStep('lookup')}>Back</button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2, justifyContent: 'center', opacity: (!clockDept || saving) ? 0.5 : 1 }}
                  onClick={handleClockIn}
                  disabled={!clockDept || saving}
                >
                  {saving ? 'Clocking In…' : 'Clock In'}
                </button>
              </div>
            </>
          )}

          {clockStep === 'clockout' && openEntry && (
            <>
              <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(45,225,201,0.05)', border: '1px solid rgba(45,225,201,0.15)', marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{openEntry.worker_name}</div>
                <div style={{ fontSize: 13, color: 'var(--ink-dim)', marginTop: 4 }}>{openEntry.dept}</div>
                <div style={{ fontSize: 13, color: '#2DE1C9', marginTop: 6 }}>Clocked in since {formatTime(openEntry.clock_in)} · {formatDate(openEntry.clock_in)}</div>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setClockStep('lookup')}>Back</button>
                <button
                  className="btn btn-primary"
                  style={{ flex: 2, justifyContent: 'center', opacity: saving ? 0.5 : 1 }}
                  onClick={handleClockOut}
                  disabled={saving}
                >
                  {saving ? 'Clocking Out…' : 'Clock Out'}
                </button>
              </div>
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
          <Field label="Job Number (optional)">
            <input className="form-input" placeholder="e.g. P-26-1001" value={invJobNum} onChange={(e) => setInvJobNum(e.target.value)} />
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
                    const name = d.plan_name || d.label || 'Untitled';
                    const badge = fileTypeBadge(d.file_name);
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                        {badge && (
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 5, background: badge.bg, color: badge.color, flexShrink: 0 }}>{badge.label}</span>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
                          <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 2 }}>{d.uploaded_by ? `${d.uploaded_by} · ` : ''}{formatDate(d.created_at)}</div>
                        </div>
                        {url ? (
                          <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, fontWeight: 700, color: '#A78BFA', background: 'rgba(167,139,250,0.1)', padding: '5px 12px', borderRadius: 8, textDecoration: 'none', flexShrink: 0 }}>Open</a>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--ink-mute)' }}>No link</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
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
              <option value="Production">Production</option>
              <option value="Assembly">Assembly</option>
              <option value="Finishing">Finishing</option>
              <option value="Craftsman">Craftsman</option>
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
              <Field label="Job Number (optional)">
                <input className="form-input" placeholder="e.g. P-26-1001" value={bmJobNum} onChange={(e) => setBmJobNum(e.target.value)} />
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
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-mute)', marginBottom: 5 }}>Job Number</div>
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
                  <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
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
                          ✓ Approve
                        </button>
                        <button
                          onClick={() => handleQcAction(p.id, 'Failed QC / Rework')}
                          disabled={!!qcActioning[p.id]}
                          style={{ flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 700, borderRadius: 8, border: '1px solid rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)', color: '#F87171', cursor: qcActioning[p.id] ? 'not-allowed' : 'pointer', opacity: qcActioning[p.id] ? 0.5 : 1, fontFamily: 'inherit' }}
                        >
                          ✗ Rework
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

      {/* Hidden canvas for video frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {toast && <Toast msg={toast.msg} error={toast.error} />}

      {/* ── Success flash overlays ── */}
      {(dmgFlash || partFlash) && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,6,8,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, pointerEvents: 'none' }}>
          <div style={{ background: '#052E16', border: '1px solid #34D399', borderRadius: 16, padding: '22px 40px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#34D399' }}>{partFlash ? 'Part Logged' : 'Damage Reported'}</span>
          </div>
        </div>
      )}
    </>
  );
}
