'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { LogoMark, Nav, Footer, BgLayers } from '@/components/shared';

/* ── Icons ────────────────────────────────────────────────── */
function SvgIcon({ size = 18, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const ArrowIcon = ({ size = 16 }: { size?: number }) => (
  <SvgIcon size={size}><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></SvgIcon>
);
const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5"/>
  </svg>
);
const SparkIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M12 3v4"/><path d="M12 17v4"/><path d="M3 12h4"/><path d="M17 12h4"/>
    <path d="m5.6 5.6 2.8 2.8"/><path d="m15.6 15.6 2.8 2.8"/>
    <path d="m5.6 18.4 2.8-2.8"/><path d="m15.6 8.4 2.8-2.8"/>
  </SvgIcon>
);
const CommandIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </SvgIcon>
);
const TrackIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>
  </SvgIcon>
);
const CostIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></SvgIcon>
);
const DamageIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <path d="M12 9v4"/><path d="M12 17h.01"/>
  </SvgIcon>
);
const InvIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <path d="M16.5 9.4 7.55 4.24"/><path d="m3.3 7 8.7 5 8.7-5"/>
  </SvgIcon>
);

/* ── All capability icons ─────────────────────────────────── */
const ScanIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/>
    <path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
    <path d="M7 12h10"/>
  </SvgIcon>
);
const ClockIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></SvgIcon>
);
const SwapIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M7 4 3 8l4 4"/><path d="M3 8h13a4 4 0 0 1 4 4"/>
    <path d="m17 20 4-4-4-4"/><path d="M21 16H8a4 4 0 0 1-4-4"/>
  </SvgIcon>
);
const BriefIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M12 3v3"/><path d="M5.6 5.6 7.7 7.7"/><path d="M3 12h3"/>
    <path d="M18 12h3"/><path d="m16.3 7.7 2.1-2.1"/>
    <circle cx="12" cy="14" r="6"/><path d="M9 14h6"/>
  </SvgIcon>
);
const CraftIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </SvgIcon>
);
const MsgIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
  </SvgIcon>
);
const DocIcon = ({ size = 18 }: { size?: number }) => (
  <SvgIcon size={size}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/>
  </SvgIcon>
);

/* ── Crew phone mini ─────────────────────────────────────────── */
function CrewPhoneMini() {
  return (
    <div style={{
      width: 130, flexShrink: 0, aspectRatio: '9/19',
      borderRadius: 22, background: '#000', border: '1px solid rgba(94,234,212,0.3)',
      padding: 4, boxShadow: '0 20px 50px rgba(0,0,0,0.6), 0 0 30px rgba(45,225,201,0.12)',
    }}>
      <div style={{ background: '#050608', height: '100%', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 8px 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 7, color: '#9AAAA7' }}>9:41</span>
          <div style={{ width: 6, height: 6, borderRadius: 3, background: '#34D399' }} />
        </div>
        <div style={{ padding: '4px 10px 8px' }}>
          <div style={{ fontSize: 7, color: '#9AAAA7' }}>Hello,</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#E6F0EE', letterSpacing: '-0.02em' }}>Jake</div>
        </div>
        <div style={{ margin: '0 8px', background: '#0a0d10', borderRadius: 8, border: '1.5px solid rgba(45,225,201,0.2)', padding: '8px 10px' }}>
          <div style={{ fontSize: 7, color: '#9AAAA7', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>On Job</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#E6F0EE', marginBottom: 1 }}>JOB-2841</div>
          <div style={{ fontSize: 8, color: '#5EEAD4' }}>Door Frames · 1h 22m</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ margin: '0 8px 8px', background: '#2DE1C9', borderRadius: 8, padding: '8px 0', textAlign: 'center' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: '#001917' }}>Scan New Part</span>
        </div>
      </div>
    </div>
  );
}

/* ── Hero visual (supervisor dash mini) ─────────────────────── */
function SupervisorDashMini() {
  return (
    <div style={{ height: 'calc(100% - 28px)', background: '#05080c', display: 'flex', overflow: 'hidden' }}>
      <div style={{
        width: 40, background: '#040608', borderRight: '1px solid rgba(94,234,212,0.1)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px 0', gap: 14,
      }}>
        <div style={{ width: 20, height: 20, borderRadius: 4, background: 'rgba(94,234,212,0.15)', display: 'grid', placeItems: 'center', color: '#5EEAD4' }}>
          <CommandIcon size={10} />
        </div>
        {[TrackIcon, CostIcon, DamageIcon, InvIcon].map((Ic, i) => (
          <div key={i} style={{ color: '#5F6F6C' }}><Ic size={10} /></div>
        ))}
      </div>
      <div style={{ flex: 1, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { label: 'On Job',      val: '11',  color: '#5EEAD4' },
            { label: 'Hours',       val: '86.4',color: '#5EEAD4' },
            { label: 'Over Budget', val: '2',   color: '#FBBF24' },
            { label: 'Issues',      val: '4',   color: '#F87171' },
          ].map((k) => (
            <div key={k.label} style={{
              background: '#0a0d10', borderRadius: 6, padding: '8px',
              borderTop: `2px solid ${k.color}`,
              border: `1px solid rgba(94,234,212,0.08)`,
              borderTopWidth: 2, borderTopColor: k.color,
            }}>
              <div style={{ fontSize: 7, color: '#5F6F6C', marginBottom: 2 }}>{k.label}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: k.color }}>{k.val}</div>
            </div>
          ))}
        </div>
        <div style={{ flex: 1, background: '#08090d', borderRadius: 8, border: '1px solid rgba(94,234,212,0.08)', padding: '8px 10px', overflow: 'hidden' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: '#5F6F6C', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>Active Crew</div>
          {[
            { name: 'Marcus T.', job: 'JOB-2841 · Door Frames', badge: 'RUN',    color: '#34D399', pct: 70 },
            { name: 'Ana R.',    job: 'JOB-2839 · Drawer Fronts',badge: 'QC',    color: '#5EEAD4', pct: 82 },
            { name: 'Devon W.', job: 'CNC Maintenance',           badge: 'SWITCH',color: '#FBBF24', pct: 40 },
            { name: 'Jason P.', job: 'JOB-2841 · Damage',         badge: 'DMG',   color: '#F87171', pct: 15 },
          ].map((r) => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 18, height: 18, borderRadius: 99, background: 'rgba(94,234,212,0.12)', display: 'grid', placeItems: 'center', fontSize: 8, fontWeight: 700, color: '#5EEAD4', flexShrink: 0 }}>
                {r.name[0]}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: '#E6F0EE' }}>{r.name}</div>
                <div style={{ fontSize: 8, color: '#5F6F6C', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.job}</div>
                <div style={{ height: 3, background: 'rgba(94,234,212,0.08)', borderRadius: 2, marginTop: 3 }}>
                  <div style={{ height: '100%', width: `${r.pct}%`, background: r.color, borderRadius: 2 }} />
                </div>
              </div>
              <div style={{ fontSize: 7, fontWeight: 700, color: r.color, flexShrink: 0 }}>{r.badge}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Hero ───────────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="hero">
      <div className="container hero-grid">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
            <span className="pill" style={{ fontSize: 11 }}>● Live on the floor</span>
            <span style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Cabinetry · Metalwork · Stone · Custom Fab</span>
          </div>
          <h1>InlineIQ runs your shop <em>so you can run your business.</em></h1>
          <p className="hero-sub">
            The 1–2 tap shop floor system that captures every minute, every part, and every dollar — then turns it into the data your bids have always been missing.
          </p>
          <div className="hero-actions">
            <Link href="/signup" className="btn btn-primary">Start free trial <ArrowIcon /></Link>
            <a href="#features" className="btn btn-ghost">See it work</a>
          </div>
          <div className="hero-meta">
            <div className="item"><b>1–2 taps</b><span>per action</span></div>
            <div className="item"><b>100%</b><span>labor logged</span></div>
            <div className="item"><b>6 AM</b><span>AI brief, daily</span></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="laptop">
            <div className="laptop-bar">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <div className="url">app.inlineiq.com / supervisor</div>
            </div>
            <SupervisorDashMini />
          </div>
          <div style={{
            position: 'absolute', bottom: -16, right: -16, zIndex: 10,
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.6))',
          }}>
            <CrewPhoneMini />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Capabilities grid ────────────────────────────────────────── */
type CapIcon = React.ComponentType<{ size?: number }>;
const CAPS: [CapIcon, string, string][] = [
  [ScanIcon,    'QR + AI Part Scanning',    'Scan a part, time logs to the right job. No label? Camera ID by photo.'],
  [ClockIcon,   'Automatic Time Tracking',  'Every scan opens an entry. Every switch closes one. Zero timesheets.'],
  [SwapIcon,    'Quick Switch',             'One tap moves crew between jobs, cleaning, maintenance — every transition stamped.'],
  [BriefIcon,   'AI Morning Brief',         '6 AM, on your phone: jobs over budget, materials to order, what matters.'],
  [TrackIcon,   'Real-Time Part Tracking',  'Every scan confirms a part. Where it is, who touched it, and when.'],
  [DamageIcon,  'Damage Reporting',         'Photo + one sentence. Supervisor notified, system flagged, in 30 seconds.'],
  [InvIcon,     'Inventory Needs',          'Crew submits a need in one field. Materials get ordered before work stops.'],
  [CraftIcon,   'Craftsman QC Workflow',    'Live timer for raw lumber and custom millwork. True cost, finally captured.'],
  [CommandIcon, 'Supervisor Command View',  "Who's on what, for how long. Damage and inventory resolved in one tap."],
  [CostIcon,    'Job Costing Intelligence', 'Actual hours vs estimate — per job, per crew. The data that tightens bids.'],
  [MsgIcon,     'Crew Messaging',           'Department-scoped chat. Mention a job number, it posts as a job note.'],
  [DocIcon,     'SOPs & Job Drawings',      'Right SOP, right plan, right moment. No binders, no email digging.'],
];

function Capabilities() {
  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">The system</span>
          <h2>Twelve capabilities. <span className="text-teal">One unified shop floor.</span></h2>
          <p>Every InlineIQ feature is built around the same rule: 1–2 taps on the floor, real data in the office. Nothing else.</p>
        </div>
        <div className="cap-grid">
          {CAPS.map(([Ico, title, desc]) => (
            <div className="cap" key={title}>
              <div className="cap-icon"><Ico size={18} /></div>
              <h4>{title}</h4>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Deep dive components ────────────────────────────────────── */
function ScanLine() {
  const [pos, setPos] = useState(0);
  const dir = useRef(1);
  useEffect(() => {
    const id = setInterval(() => {
      setPos((p) => {
        const n = p + dir.current * 2;
        if (n >= 98) { dir.current = -1; return 98; }
        if (n <= 2)  { dir.current =  1; return 2; }
        return n;
      });
    }, 20);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, top: `${pos}%`, height: 2,
      background: 'linear-gradient(90deg, transparent, #5EEAD4, transparent)',
      boxShadow: '0 0 10px #5EEAD4',
    }} />
  );
}

function ScanMock() {
  return (
    <div style={{
      border: '1px solid var(--line-strong)', borderRadius: 18, padding: 24,
      background: 'linear-gradient(180deg, rgba(10,14,17,0.9), rgba(5,7,9,0.95))',
      display: 'flex', gap: 20, alignItems: 'center',
    }}>
      <div style={{
        width: 160, flexShrink: 0, aspectRatio: '9/19',
        borderRadius: 22, background: '#000', border: '1px solid var(--line-strong)',
        padding: 5, boxShadow: '0 20px 50px rgba(0,0,0,0.5), 0 0 40px rgba(45,225,201,0.1)',
      }}>
        <div style={{ background: '#0a0d10', height: '100%', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 10px', fontSize: 8, color: '#9AAAA7', display: 'flex', justifyContent: 'space-between' }}>
            <span>9:41</span><span>5G</span>
          </div>
          <div style={{ flex: 1, margin: '0 10px', borderRadius: 10, border: '1px dashed rgba(94,234,212,0.3)', position: 'relative', background: '#020303', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', inset: '22% 14%', borderRadius: 6, background: 'linear-gradient(135deg, #1a1410, #2d2218)', display: 'grid', placeItems: 'center' }}>
              <div style={{ width: 32, height: 32, background: '#fff', borderRadius: 2 }} />
            </div>
            <ScanLine />
            {(['TL','TR','BL','BR'] as const).map((c) => (
              <div key={c} style={{
                position: 'absolute', width: 12, height: 12, borderColor: '#5EEAD4', borderStyle: 'solid', borderWidth: 0,
                top: c[0]==='T' ? 8 : undefined, bottom: c[0]==='B' ? 8 : undefined,
                left: c[1]==='L' ? 8 : undefined, right: c[1]==='R' ? 8 : undefined,
                borderTopWidth: c[0]==='T' ? 2 : 0, borderBottomWidth: c[0]==='B' ? 2 : 0,
                borderLeftWidth: c[1]==='L' ? 2 : 0, borderRightWidth: c[1]==='R' ? 2 : 0,
              }} />
            ))}
          </div>
          <div style={{ padding: '8px 10px', fontSize: 9, color: '#9AAAA7', textAlign: 'center' }}>Identifying part…</div>
        </div>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: '#5EEAD4', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 700, marginBottom: 8 }}>
          AI Match Found
        </div>
        <div style={{ fontSize: 17, color: '#E6F0EE', fontWeight: 700, marginBottom: 12, letterSpacing: '-0.02em' }}>
          Door Panel · 18″ × 30″ · Maple
        </div>
        {[['Work Order','JOB-2841'],['Stage','Production'],['Confidence','98.2%']].map(([l,v]) => (
          <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
            <span style={{ color: '#9AAAA7' }}>{l}</span>
            <span style={{ color: l === 'Confidence' ? '#5EEAD4' : '#E6F0EE', fontFamily: 'var(--font-mono)' }}>{v}</span>
          </div>
        ))}
        <div style={{ marginTop: 14, padding: '10px 14px', background: '#2DE1C9', color: '#001917', borderRadius: 8, textAlign: 'center', fontSize: 13, fontWeight: 700 }}>
          Confirm — Start Time
        </div>
      </div>
    </div>
  );
}

function TimeTrackMock() {
  return (
    <div style={{
      border: '1px solid var(--line-strong)', borderRadius: 18, padding: 24,
      background: 'linear-gradient(180deg, rgba(10,14,17,0.9), rgba(5,7,9,0.95))',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: '#9AAAA7', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Marcus T. · Tuesday</div>
          <div style={{ fontSize: 17, color: '#E6F0EE', fontWeight: 700, marginTop: 3, letterSpacing: '-0.02em' }}>8h 04m logged · 100% accounted</div>
        </div>
        <div style={{ fontSize: 11, color: '#5EEAD4', display: 'flex', alignItems: 'center', gap: 6 }}>
          <CheckIcon size={12} /> Auto-tracked
        </div>
      </div>
      <div style={{ display: 'flex', height: 36, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--line)' }}>
        <div style={{ flex: 3, background: 'rgba(52,211,153,0.5)', display: 'grid', placeItems: 'center', fontSize: 10, color: '#001917', fontWeight: 700 }}>JOB-2841</div>
        <div style={{ flex: 0.4, background: 'rgba(251,191,36,0.4)', display: 'grid', placeItems: 'center', fontSize: 9, color: '#001917', fontWeight: 700 }}>SW</div>
        <div style={{ flex: 1.5, background: 'rgba(94,234,212,0.4)', display: 'grid', placeItems: 'center', fontSize: 10, color: '#001917', fontWeight: 700 }}>Assembly</div>
        <div style={{ flex: 0.3, background: 'rgba(167,139,250,0.4)' }} />
        <div style={{ flex: 2.4, background: 'rgba(52,211,153,0.5)', display: 'grid', placeItems: 'center', fontSize: 10, color: '#001917', fontWeight: 700 }}>JOB-2843</div>
        <div style={{ flex: 0.4, background: 'rgba(251,191,36,0.4)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', fontSize: 9, color: '#5F6F6C', fontFamily: 'var(--font-mono)' }}>
        {['6:00','7:00','9:00','10:30','12:00','13:00','15:00'].map((t) => <span key={t}>{t}</span>)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
        {[
          ['06:02','Scan',          'JOB-2841 · Door Panel',    '#34D399'],
          ['09:14','Quick Switch',  'Assembly',                  '#5EEAD4'],
          ['10:48','Scan',          'JOB-2843 · Drawer Fronts', '#34D399'],
          ['14:31','Damage Report', 'JOB-2843 · photo + note',  '#F87171'],
        ].map(([t,ev,det,c], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '56px 110px 1fr', gap: 10, fontSize: 12, alignItems: 'center', padding: '6px 0', borderTop: i===0 ? 'none' : '1px solid var(--line)' }}>
            <span style={{ color: '#9AAAA7', fontFamily: 'var(--font-mono)' }}>{t}</span>
            <span style={{ color: c, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>{ev}</span>
            <span style={{ color: '#E6F0EE' }}>{det}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AIBriefMock() {
  return (
    <div style={{
      border: '1px solid var(--line-strong)', borderRadius: 18, padding: 24,
      background: 'linear-gradient(180deg, rgba(45,225,201,0.04), rgba(5,7,9,0.9))',
      display: 'flex', flexDirection: 'column', gap: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(94,234,212,0.1)', display: 'grid', placeItems: 'center', color: '#5EEAD4' }}>
            <SparkIcon size={14} />
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#9AAAA7', letterSpacing: '0.1em', textTransform: 'uppercase' }}>AI Morning Brief</div>
            <div style={{ fontSize: 13, color: '#E6F0EE', fontWeight: 700 }}>Tuesday · 6:00 AM</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: '#5EEAD4' }}>● Live</div>
      </div>
      {[
        { color: '#F87171', label: '2 Jobs Over Budget', detail: 'JOB-2841 at 118% · JOB-2839 at 104%. Both still in production.', bg: 'rgba(248,113,113,0.04)' },
        { color: '#FBBF24', label: 'Order Today',        detail: '3/4" maple ply · soft-close hinges (×24) · drawer slides 18".', bg: 'rgba(251,191,36,0.04)' },
        { color: '#5EEAD4', label: 'Yesterday',          detail: '14 crew · 112.4 hrs logged · 8 parts confirmed · 1 damage report.', bg: 'transparent' },
      ].map((row) => (
        <div key={row.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, border: '1px solid var(--line)', borderRadius: 10, background: row.bg }}>
          <div style={{ width: 6, height: 6, borderRadius: 99, background: row.color, marginTop: 6, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: row.color, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>{row.label}</div>
            <div style={{ fontSize: 13, color: '#E6F0EE', marginTop: 3 }}>{row.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function DeepDive({ flip, eyebrow, title, body, bullets, visual }: {
  flip?: boolean; eyebrow: string; title: React.ReactNode; body: string; bullets: string[]; visual: React.ReactNode;
}) {
  return (
    <div className="deep" style={flip ? { direction: 'rtl' } : {}}>
      <div className="deep-copy" style={{ direction: 'ltr' }}>
        <span className="eyebrow">{eyebrow}</span>
        <h2 style={{ marginTop: 12 }}>{title}</h2>
        <p style={{ marginTop: 12 }}>{body}</p>
        <ul className="deep-list">
          {bullets.map((b, i) => <li key={i}><span className="dot" />{b}</li>)}
        </ul>
      </div>
      <div style={{ direction: 'ltr' }}>{visual}</div>
    </div>
  );
}

function Deepdives() {
  return (
    <section className="section-tight" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="container">
        <DeepDive
          eyebrow="01 · The scan"
          title={<>One tap on the floor. <span className="text-teal">Every minute, on the right job.</span></>}
          body="A QR scan or — when the label is gone — a photo. The AI matches material, dimensions, and markings to the active work order. The crew confirms once. Time logs. The part is marked confirmed."
          bullets={[
            'AI part identification from photo when QR is missing or damaged',
            'Confirms material, dimensions, and the active work order in under 2 seconds',
            'Opens the time entry automatically — no manual start/stop',
          ]}
          visual={<ScanMock />}
        />
        <DeepDive
          flip
          eyebrow="02 · The labor log"
          title={<>Every hour accounted for. <span className="text-teal">Without anyone filling out a timesheet.</span></>}
          body="Every scan opens a time entry. Every Quick Switch closes the previous one and opens a new one. Every End Day closes the final entry. The labor log writes itself — accurately — for every employee, every day."
          bullets={[
            'Automatic time entries on scan, switch, and end-of-day',
            'Quick Switch covers production, cleaning, maintenance, receiving',
            'Job-level actuals feed straight into costing and bids',
          ]}
          visual={<TimeTrackMock />}
        />
        <DeepDive
          eyebrow="03 · The morning brief"
          title={<>Walk in already knowing <span className="text-teal">what matters.</span></>}
          body="Every morning at 6 AM, InlineIQ analyzes your floor data and delivers a complete shop status to your phone. Jobs over budget. Materials to order. Open damage reports. Yesterday's crew summary. Before anyone asks you a question, you have the answer."
          bullets={[
            "Daily 6 AM brief, generated from yesterday's floor data",
            'Surfaces over-budget jobs, low materials, and open issues first',
            'Gets sharper the longer InlineIQ runs in your shop',
          ]}
          visual={<AIBriefMock />}
        />
      </div>
    </section>
  );
}

/* ── Intelligence ────────────────────────────────────────────── */
function Intel() {
  return (
    <section className="section" id="intel">
      <div className="container">
        <div className="intel">
          <div className="intel-grid">
            <div>
              <span className="eyebrow">Intelligence Layer</span>
              <h2 style={{ marginTop: 14 }}>AI that <span className="text-teal">learns your shop.</span></h2>
              <p style={{ marginTop: 16 }}>
                InlineIQ doesn't just collect data — it gets smarter the longer you use it. The AI learns your production patterns, your job types, your crew behaviors, and your cost structures over time. The morning brief gets sharper. Part identification gets faster. Cost comparisons get more accurate.
              </p>
              <p style={{ marginTop: 14 }}>Every shop is different. InlineIQ adapts to yours.</p>
              <div className="intel-pills">
                {['Pattern recognition','Job type modeling','Bid calibration','Anomaly detection','Photo → Part matching'].map((p) => (
                  <span key={p} className="pill">{p}</span>
                ))}
              </div>
            </div>
            <div style={{ position: 'relative', minHeight: 280, border: '1px solid var(--line-strong)', borderRadius: 14, background: '#06080a', padding: 24, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 40%, rgba(45,225,201,0.18), transparent 50%)' }} />
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 10, color: '#9AAAA7', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bid Calibration · 90 days</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', alignItems: 'baseline', gap: 8 }}>
                  <div style={{ fontSize: 13, color: '#E6F0EE' }}>Estimate accuracy</div>
                  <div style={{ fontSize: 32, color: '#5EEAD4', fontWeight: 700, letterSpacing: '-0.02em' }}>+18.4%</div>
                </div>
                <svg viewBox="0 0 300 90" style={{ width: '100%', height: 90 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#5EEAD4" stopOpacity="0.4"/>
                      <stop offset="1" stopColor="#5EEAD4" stopOpacity="0"/>
                    </linearGradient>
                  </defs>
                  <path d="M0,70 L30,68 L60,60 L90,62 L120,52 L150,48 L180,42 L210,30 L240,28 L270,18 L300,12 L300,90 L0,90 Z" fill="url(#g1)"/>
                  <path d="M0,70 L30,68 L60,60 L90,62 L120,52 L150,48 L180,42 L210,30 L240,28 L270,18 L300,12" fill="none" stroke="#5EEAD4" strokeWidth="1.5"/>
                </svg>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 8 }}>
                  {[['Days','90'],['Jobs','184'],['Hours','11.2k']].map(([l,v]) => (
                    <div key={l} style={{ padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 8 }}>
                      <div style={{ fontSize: 9, color: '#9AAAA7', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{l}</div>
                      <div style={{ fontSize: 18, color: '#E6F0EE', fontWeight: 700, marginTop: 3, letterSpacing: '-0.02em' }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing ─────────────────────────────────────────────────── */
const PRICING = [
  {
    name: 'Starter', priceLabel: 'Free', period: '30-day trial', featured: false,
    desc: 'Get the full system in your shop for a month. No credit card.',
    cta: 'Start 30-day free trial', ctaHref: '/signup',
    features: ['Full crew + supervisor apps','Scan + automatic time tracking','Damage & inventory reports','Email support','Convert anytime'],
  },
  {
    name: 'Shop', price: 399, period: 'per shop / month', featured: true,
    desc: 'The full InlineIQ system for a working production shop.',
    cta: 'Start free trial', ctaHref: '/signup',
    features: ['Unlimited crew per shop','AI Part Identification','AI Morning Brief','Job Costing Intelligence','Crew messaging + SOPs','Priority support'],
  },
  {
    name: 'Operations', price: 599, period: 'per shop / month', featured: false,
    desc: 'For multi-shop operators and custom-fab businesses that need more.',
    cta: 'Talk to sales', ctaHref: 'mailto:hello@inlineiq.app',
    features: ['Everything in Shop','Multi-shop rollouts','API + ERP integrations','Custom AI tuning','Dedicated success manager','SSO + audit logs'],
  },
];

function PricingSection() {
  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">Pricing</span>
          <h2>One price per shop. <span className="text-teal">Unlimited crew.</span></h2>
          <p>No per-seat math. Add every supervisor, every crew member, every department — one flat monthly price for the whole floor.</p>
        </div>
        <div className="price-grid">
          {PRICING.map((t) => (
            <div key={t.name} className={`price-card${t.featured ? ' featured' : ''}`}>
              {t.featured && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: -8 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#001917', background: '#2DE1C9', borderRadius: 999, padding: '3px 14px' }}>
                    Most Popular
                  </span>
                </div>
              )}
              <div className="price-name">{t.name}</div>
              <div>
                <div className="price-amount">
                  {t.price ? <><b>${t.price}</b><span>/ {t.period}</span></> : <b>{t.priceLabel}</b>}
                </div>
                {!t.price && <div style={{ fontSize: 13, color: 'var(--ink-mute)', marginTop: 4 }}>{t.period}</div>}
                <p className="price-desc" style={{ marginTop: 10 }}>{t.desc}</p>
              </div>
              <Link href={t.ctaHref} className={`btn ${t.featured ? 'btn-primary' : 'btn-ghost'}`} style={{ justifyContent: 'center' }}>
                {t.cta}
              </Link>
              <ul className="price-features">
                {t.features.map((f) => (
                  <li key={f}>
                    <span style={{ color: 'var(--teal)', flexShrink: 0 }}><CheckIcon /></span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Final CTA + Footer ──────────────────────────────────────── */
function FinalCTA() {
  return (
    <section className="final" id="cta">
      <div className="container">
        <span className="eyebrow">Keep your shop sharp</span>
        <h2 style={{ marginTop: 18 }}>Connect your floor to your business <span className="text-teal">in under a week.</span></h2>
        <p style={{ marginTop: 16, marginBottom: 36 }}>30-day free trial. No credit card. Bring one supervisor and one crew member — we'll have them scanning before lunch.</p>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
          <Link href="/signup" className="btn btn-primary">Start free trial <ArrowIcon /></Link>
          <a href="mailto:hello@inlineiq.app" className="btn btn-ghost">Book a demo</a>
        </div>
      </div>
    </section>
  );
}

/* ── Root page ───────────────────────────────────────────────── */
export default function HomePage() {
  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <Nav />
        <main>
          <Hero />
          <Capabilities />
          <Deepdives />
          <Intel />
          <PricingSection />
          <FinalCTA />
        </main>
        <Footer />
      </div>
    </>
  );
}
