'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BgLayers, LogoMark } from '@/components/shared';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/useSession';
import { trialDaysLeft } from '@/lib/auth';

type TimeEntry = {
  id: string;
  employee_name: string;
  dept: string;
  clock_in: string;
  clock_out: string | null;
  job_name: string | null;
  work_order_id: string | null;
};

type Message = {
  id: string;
  sender_name: string;
  dept: string | null;
  body: string;
  created_at: string;
};

function Spinner() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#050608',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%',
        border: '2px solid rgba(94,234,212,0.2)',
        borderTopColor: '#5EEAD4',
        animation: 'spin 0.7s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function TrialBanner({ days }: { days: number }) {
  return (
    <div style={{
      position: 'sticky', top: 64, zIndex: 50,
      background: 'rgba(251,191,36,0.06)',
      borderBottom: '1px solid rgba(251,191,36,0.25)',
      padding: '10px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
    }}>
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#FBBF24" strokeWidth="2" strokeLinecap="round">
        <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <path d="M12 9v4"/><path d="M12 17h.01"/>
      </svg>
      <span style={{ fontSize: 13, color: '#FBBF24' }}>
        <b>{days} day{days !== 1 ? 's' : ''}</b> left in trial —
      </span>
      <Link href="/pricing" style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', textDecoration: 'underline' }}>
        Upgrade
      </Link>
    </div>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CrewPage() {
  const { loading: sessionLoading, tenant, email } = useSession();
  const [clockEntries, setClockEntries] = useState<TimeEntry[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    async function load() {
      const [clockRes, msgRes] = await Promise.all([
        supabase
          .from('time_clock')
          .select('id, employee_name, dept, clock_in, clock_out, job_name, work_order_id')
          .eq('tenant_id', tenant!.id)
          .order('clock_in', { ascending: false })
          .limit(5),
        supabase
          .from('messages')
          .select('id, sender_name, dept, body, created_at')
          .eq('tenant_id', tenant!.id)
          .order('created_at', { ascending: false })
          .limit(6),
      ]);
      if (clockRes.data) setClockEntries(clockRes.data as TimeEntry[]);
      if (msgRes.data) setMessages(msgRes.data as Message[]);
      setDataLoading(false);
    }
    load();
  }, [tenant]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.replace('/');
  };

  if (sessionLoading) return <Spinner />;

  const isTrial = tenant?.subscription_status === 'trial';
  const days = trialDaysLeft(tenant?.trial_ends_at ?? null);
  const activeCrew = clockEntries.filter((e) => !e.clock_out);

  return (
    <>
      <BgLayers />
      <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

        {/* Nav */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 100,
          background: 'rgba(5,6,8,0.85)', backdropFilter: 'blur(14px)',
          borderBottom: '1px solid var(--line)',
          height: 64, display: 'flex', alignItems: 'center', padding: '0 32px',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Link href="/app" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink-mute)', fontSize: 13 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
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
            <button onClick={handleSignOut} className="btn btn-ghost" style={{ fontSize: 13, padding: '8px 16px' }}>
              Sign out
            </button>
          </div>
        </div>

        {isTrial && <TrialBanner days={days} />}

        <main style={{ flex: 1, padding: '40px 24px', maxWidth: 900, margin: '0 auto', width: '100%' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Crew View</div>
            <h2 style={{ fontSize: 28 }}>{tenant?.shop_name}</h2>
            <p style={{ fontSize: 14, marginTop: 6 }}>
              {activeCrew.length} crew member{activeCrew.length !== 1 ? 's' : ''} currently clocked in
            </p>
          </div>

          {/* Quick actions */}
          <div style={{ marginBottom: 40 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 14 }}>
              Quick Actions
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {[
                { label: 'Clock In / Out', color: '#2DE1C9', bg: 'rgba(45,225,201,0.08)', icon: (
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                )},
                { label: 'Log Inventory Need', color: '#5EEAD4', bg: 'rgba(94,234,212,0.08)', icon: (
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/>
                    <line x1="8" y1="12" x2="16" y2="12"/>
                  </svg>
                )},
                { label: 'Report Damage', color: '#F87171', bg: 'rgba(248,113,113,0.08)', icon: (
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <path d="M12 9v4"/><path d="M12 17h.01"/>
                  </svg>
                )},
                { label: 'View Plans', color: '#A78BFA', bg: 'rgba(167,139,250,0.08)', icon: (
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                )},
              ].map(({ label, color, bg, icon }) => (
                <div
                  key={label}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    gap: 10, padding: '20px 16px',
                    background: 'var(--bg-1)', border: '1px solid var(--line)',
                    borderRadius: 14, cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                    textAlign: 'center',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line-strong)'; (e.currentTarget as HTMLDivElement).style.background = '#0e1418'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line)'; (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-1)'; }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{label}</span>
                </div>
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 12 }}>
              Full actions available in the mobile app —
              {' '}<a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal-dim)' }}>get setup help</a>
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

            {/* Clock activity */}
            <div className="portal-card">
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
                Recent Clock Activity
              </div>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : clockEntries.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No clock activity yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {clockEntries.map((entry) => (
                    <div key={entry.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', borderRadius: 10,
                      background: 'rgba(94,234,212,0.03)', border: '1px solid var(--line)',
                    }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{entry.employee_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-mute)', marginTop: 2 }}>{entry.dept}{entry.job_name ? ` · ${entry.job_name}` : ''}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {entry.clock_out ? (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-mute)', background: 'rgba(255,255,255,0.04)', padding: '3px 8px', borderRadius: 6 }}>
                            Out {formatTime(entry.clock_out)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#2DE1C9', background: 'rgba(45,225,201,0.1)', padding: '3px 8px', borderRadius: 6 }}>
                            In since {formatTime(entry.clock_in)}
                          </span>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 3 }}>{formatDate(entry.clock_in)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="portal-card">
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-mute)', marginBottom: 16 }}>
                Recent Messages
              </div>
              {dataLoading ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>Loading…</div>
              ) : messages.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--ink-mute)' }}>No messages yet.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {messages.map((msg) => (
                    <div key={msg.id} style={{
                      padding: '10px 12px', borderRadius: 10,
                      background: 'rgba(94,234,212,0.03)', border: '1px solid var(--line)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal)' }}>{msg.sender_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)' }}>{formatDate(msg.created_at)}</span>
                      </div>
                      {msg.dept && (
                        <span style={{ fontSize: 11, color: 'var(--ink-mute)', marginBottom: 4, display: 'block' }}>{msg.dept}</span>
                      )}
                      <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: 0, lineHeight: 1.5,
                        overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                        {msg.body}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 40, padding: '20px 24px', background: 'rgba(45,225,201,0.04)', border: '1px solid rgba(45,225,201,0.12)', borderRadius: 12, textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-dim)', margin: 0 }}>
              For the complete crew experience — clock in/out, parts scanning, and morning briefs — use the
              {' '}<span style={{ color: 'var(--teal)' }}>InlineIQ mobile app</span>.
              {' '}<a href="mailto:hello@inlineiq.app" style={{ color: 'var(--teal-dim)', textDecoration: 'underline' }}>Contact us to get set up.</a>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
