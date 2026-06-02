'use client';
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Tenant } from '@/lib/auth';

const DEPT_OPTIONS = ['Production', 'Assembly', 'Finishing', 'Craftsman'];

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(5,6,8,0.98)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: '24px 20px',
  } as React.CSSProperties,
  card: {
    width: '100%', maxWidth: 480, position: 'relative',
    background: '#0a0d10', border: '1px solid rgba(94,234,212,0.14)',
    borderRadius: 20, padding: '36px 32px',
  } as React.CSSProperties,
  skip: {
    position: 'absolute', top: 16, right: 20,
    fontSize: 12, color: '#8BA5A0', cursor: 'pointer',
    background: 'none', border: 'none', fontFamily: 'inherit',
    textDecoration: 'underline', padding: 0,
  } as React.CSSProperties,
  stepLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, color: '#8BA5A0', marginBottom: 10,
  },
  h2: {
    fontSize: 24, fontWeight: 800, color: '#E6F0EE',
    letterSpacing: '-0.4px', marginBottom: 8,
  } as React.CSSProperties,
  sub: {
    fontSize: 14, color: '#8BA5A0', lineHeight: 1.6, marginBottom: 28,
  } as React.CSSProperties,
  label: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase' as const, color: '#8BA5A0', marginBottom: 6,
    display: 'block',
  },
  input: {
    width: '100%', background: '#0f1418',
    border: '1px solid rgba(94,234,212,0.15)', borderRadius: 12,
    padding: '13px 16px', color: '#E6F0EE', fontSize: 15,
    fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const,
  },
  btnPrimary: (disabled: boolean): React.CSSProperties => ({
    display: 'block', width: '100%', background: '#2DE1C9',
    color: '#001917', border: 'none', borderRadius: 12,
    padding: '15px', fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, fontFamily: 'inherit', marginTop: 8,
  }),
  btnGhost: {
    background: 'none', border: '1px solid rgba(94,234,212,0.15)',
    color: '#9AAAA7', borderRadius: 12, padding: '13px 16px',
    fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
};

// ── Dot progress indicator ────────────────────────────────────────────────────

function Dots({ step }: { step: 1 | 2 | 3 | 4 }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 32 }}>
      {([1, 2, 3, 4] as const).map((n) => (
        <div
          key={n}
          style={{
            width: n === step ? 24 : 8, height: 8, borderRadius: 4,
            background:
              n === step  ? '#2DE1C9' :
              n < step    ? 'rgba(45,225,201,0.35)' :
                            'rgba(94,234,212,0.12)',
            transition: 'all 0.25s',
          }}
        />
      ))}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

interface Props {
  tenant: Tenant;
  onComplete: () => void;
}

export default function SetupWizard({ tenant, onComplete }: Props) {
  const [step,     setStep]     = useState<1 | 2 | 3 | 4>(1);
  const [shopName, setShopName] = useState(tenant.shop_name ?? '');
  const [depts,    setDepts]    = useState<string[]>([]);
  const [jobNum,   setJobNum]   = useState('');
  const [jobName,  setJobName]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [copied,   setCopied]   = useState(false);

  const inviteUrl = `https://inlineiq.app/join?tenant=${tenant.id}`;

  const completeWizard = useCallback(async () => {
    await supabase.from('tenants').update({ setup_complete: true }).eq('id', tenant.id);
    onComplete();
  }, [tenant.id, onComplete]);

  // Step 1 → 2
  async function goStep2() {
    if (!shopName.trim() || saving) return;
    setSaving(true);
    try {
      await supabase.from('tenants').update({ shop_name: shopName.trim() }).eq('id', tenant.id);
    } finally { setSaving(false); }
    setStep(2);
  }

  // Step 2 → 3
  async function goStep3() {
    if (depts.length === 0 || saving) return;
    setSaving(true);
    try {
      await supabase.from('tenants').update({ departments: depts }).eq('id', tenant.id);
    } finally { setSaving(false); }
    setStep(3);
  }

  // Step 3 → 4 (skip=true skips job insert)
  async function goStep4(skip: boolean) {
    if (saving) return;
    if (!skip && jobNum.trim()) {
      setSaving(true);
      try {
        await supabase.from('jobs').insert({
          job_number: jobNum.trim(),
          job_name:   jobName.trim() || null,
          tenant_id:  tenant.id,
          status:     'active',
          source:     'manual',
        });
      } finally { setSaving(false); }
    }
    setStep(4);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_) { /* clipboard denied */ }
  }

  return (
    <div style={S.overlay}>
      <div style={S.card}>
        {/* Skip setup */}
        <button style={S.skip} onClick={completeWizard}>Skip setup</button>

        <Dots step={step} />

        {/* ── STEP 1 — Welcome ─────────────────────────────────────── */}
        {step === 1 && (
          <>
            <div style={S.stepLabel}>Step 1 of 4</div>
            <h2 style={S.h2}>Welcome to InlineIQ</h2>
            <p style={S.sub}>Let&apos;s get your shop set up in under 2 minutes.</p>

            <div style={{ marginBottom: 24 }}>
              <label style={S.label} htmlFor="wiz-shop">Shop Name</label>
              <input
                id="wiz-shop"
                style={S.input}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="Your shop name"
                onKeyDown={(e) => e.key === 'Enter' && goStep2()}
              />
            </div>

            <button
              style={S.btnPrimary(!shopName.trim() || saving)}
              onClick={goStep2}
              disabled={!shopName.trim() || saving}
            >
              {saving ? 'Saving…' : "Let's go →"}
            </button>
          </>
        )}

        {/* ── STEP 2 — Departments ─────────────────────────────────── */}
        {step === 2 && (
          <>
            <div style={S.stepLabel}>Step 2 of 4</div>
            <h2 style={S.h2}>Which departments does your shop have?</h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 28 }}>
              {DEPT_OPTIONS.map((d) => {
                const sel = depts.includes(d);
                return (
                  <button
                    key={d}
                    onClick={() => setDepts((prev) => sel ? prev.filter((x) => x !== d) : [...prev, d])}
                    style={{
                      padding: '14px 16px', borderRadius: 12, cursor: 'pointer',
                      fontFamily: 'inherit', fontSize: 14, fontWeight: sel ? 700 : 500,
                      textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
                      background: sel ? 'rgba(45,225,201,0.08)' : '#0f1418',
                      border: `1.5px solid ${sel ? '#2DE1C9' : 'rgba(94,234,212,0.15)'}`,
                      color: sel ? '#2DE1C9' : '#9AAAA7',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                      border: `1.5px solid ${sel ? '#2DE1C9' : 'rgba(94,234,212,0.25)'}`,
                      background: sel ? '#2DE1C9' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {sel && (
                        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#001917" strokeWidth="3.5" strokeLinecap="round">
                          <path d="M20 6 9 17l-5-5"/>
                        </svg>
                      )}
                    </span>
                    {d}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btnGhost} onClick={() => setStep(1)}>← Back</button>
              <button
                style={{ ...S.btnPrimary(depts.length === 0 || saving), flex: 2, marginTop: 0 }}
                onClick={goStep3}
                disabled={depts.length === 0 || saving}
              >
                {saving ? 'Saving…' : 'Next →'}
              </button>
            </div>
          </>
        )}

        {/* ── STEP 3 — First job ───────────────────────────────────── */}
        {step === 3 && (
          <>
            <div style={S.stepLabel}>Step 3 of 4</div>
            <h2 style={S.h2}>Add your first job</h2>
            <p style={S.sub}>You can add more from the supervisor dashboard.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 16 }}>
              <div>
                <label style={S.label} htmlFor="wiz-jobnum">
                  Job Number <span style={{ color: '#F87171' }}>*</span>
                </label>
                <input
                  id="wiz-jobnum"
                  style={S.input}
                  value={jobNum}
                  onChange={(e) => setJobNum(e.target.value)}
                  placeholder="e.g. J-2401"
                  onKeyDown={(e) => e.key === 'Enter' && jobNum.trim() && goStep4(false)}
                />
              </div>
              <div>
                <label style={S.label} htmlFor="wiz-jobname">
                  Job Name <span style={{ color: '#8BA5A0', fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  id="wiz-jobname"
                  style={S.input}
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g. Smith Kitchen Remodel"
                />
              </div>
            </div>

            <button
              style={S.btnPrimary(!jobNum.trim() || saving)}
              onClick={() => goStep4(false)}
              disabled={!jobNum.trim() || saving}
            >
              {saving ? 'Saving…' : 'Next →'}
            </button>

            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button style={S.btnGhost} onClick={() => setStep(2)}>← Back</button>
              <button
                style={{ ...S.btnGhost, flex: 2, textAlign: 'center' as const }}
                onClick={() => goStep4(true)}
              >
                Skip for now
              </button>
            </div>
          </>
        )}

        {/* ── STEP 4 — Invite crew ─────────────────────────────────── */}
        {step === 4 && (
          <>
            <div style={S.stepLabel}>Step 4 of 4</div>
            <h2 style={S.h2}>Your crew joins with one link</h2>
            <p style={S.sub}>
              Share this link with your crew — they tap it and they&apos;re in.
              No account needed.
            </p>

            {/* URL display + copy */}
            <div style={{
              background: '#0f1418', border: '1px solid rgba(94,234,212,0.15)',
              borderRadius: 12, padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
            }}>
              <span style={{
                flex: 1, fontSize: 12, color: '#5EEAD4',
                wordBreak: 'break-all', lineHeight: 1.5,
              }}>
                {inviteUrl}
              </span>
              <button
                onClick={copyLink}
                style={{
                  flexShrink: 0,
                  background: copied ? 'rgba(52,211,153,0.12)' : 'rgba(45,225,201,0.08)',
                  border: `1px solid ${copied ? '#34D399' : 'rgba(45,225,201,0.25)'}`,
                  color: copied ? '#34D399' : '#2DE1C9',
                  borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                  transition: 'all 0.15s',
                }}
              >
                {copied ? '✓ Copied!' : 'Copy Link'}
              </button>
            </div>

            {/* WhatsApp */}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Join our shop on InlineIQ: ${inviteUrl}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                width: '100%', padding: '13px', borderRadius: 12, marginBottom: 10,
                background: 'rgba(37,211,102,0.07)', border: '1px solid rgba(37,211,102,0.2)',
                color: '#25D366', fontSize: 14, fontWeight: 600,
                textDecoration: 'none', boxSizing: 'border-box',
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Open WhatsApp
            </a>

            {/* Done */}
            <button
              style={S.btnPrimary(saving)}
              onClick={completeWizard}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Done — Go to Dashboard'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button style={{ ...S.btnGhost, padding: '8px 20px', fontSize: 13 }} onClick={() => setStep(3)}>
                ← Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
