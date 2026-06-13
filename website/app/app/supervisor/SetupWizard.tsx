'use client';
import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { LogoMark } from '@/components/shared';
import type { Tenant } from '@/lib/auth';

const DEPT_OPTIONS: { name: string; desc: string }[] = [
  { name: 'Production', desc: 'Cutting, machining, and raw material work' },
  { name: 'Assembly',   desc: 'Building and assembling cabinet units' },
  { name: 'Finishing',  desc: 'Sanding, painting, staining, and coating' },
  { name: 'Craftsman',  desc: 'Custom millwork and raw lumber builds' },
];

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 200,
    background: 'rgba(5,6,8,0.98)', backdropFilter: 'blur(8px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))',
    overflowY: 'auto',
  } as React.CSSProperties,
  card: {
    width: '100%', maxWidth: 480, position: 'relative',
    background: '#0a0d10', border: '1px solid rgba(94,234,212,0.14)',
    borderRadius: 20, padding: '36px 28px',
  } as React.CSSProperties,
  skip: {
    position: 'absolute', top: 16, right: 18,
    fontSize: 12, color: '#8BA5A0', cursor: 'pointer',
    background: 'none', border: 'none', fontFamily: 'inherit',
    textDecoration: 'underline', padding: 4,
  } as React.CSSProperties,
  stepLabel: {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
    textTransform: 'uppercase' as const, color: '#8BA5A0', marginBottom: 10,
  },
  h2: {
    fontSize: 23, fontWeight: 800, color: '#E6F0EE',
    letterSpacing: '-0.4px', marginBottom: 8,
  } as React.CSSProperties,
  sub: {
    fontSize: 14, color: '#8BA5A0', lineHeight: 1.6, marginBottom: 26,
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
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    width: '100%', minHeight: 48, background: '#2DE1C9',
    color: '#001917', border: 'none', borderRadius: 12,
    padding: '0 16px', fontSize: 15, fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1, fontFamily: 'inherit', marginTop: 8,
  }),
  btnGhost: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, background: 'none', border: '1px solid rgba(94,234,212,0.15)',
    color: '#9AAAA7', borderRadius: 12, padding: '0 16px',
    fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
  } as React.CSSProperties,
};

// ── Thin-stroke icons ──────────────────────────────────────────────────────────

const ShareIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);
const CopyIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

// ── Dot progress indicator ────────────────────────────────────────────────────

function Dots({ step }: { step: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 28 }}>
      {([1, 2, 3] as const).map((n) => (
        <div
          key={n}
          style={{
            width: n === step ? 24 : 8, height: 8, borderRadius: 4,
            background:
              n === step ? '#2DE1C9' :
              n < step   ? '#2DE1C9' :
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
  const [step,      setStep]      = useState<1 | 2 | 4>(1);
  const [shopName,  setShopName]  = useState(tenant.shop_name ?? '');
  const [depts,     setDepts]     = useState<string[]>([]);
  const [deptError, setDeptError] = useState(false);
  const [showCustom,  setShowCustom]  = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [customErr,   setCustomErr]   = useState('');
  const [saving,    setSaving]    = useState(false);
  const [copied,    setCopied]    = useState(false);

  const inviteUrl = `https://inlineiq.app/join?tenant=${tenant.id}`;

  const completeWizard = useCallback(async () => {
    setSaving(true);
    try { await supabase.from('tenants').update({ setup_complete: true }).eq('id', tenant.id); }
    catch (_) {}
    finally { setSaving(false); onComplete(); }
  }, [tenant.id, onComplete]);

  // Step 1 → 2 (save shop name)
  async function goStep2() {
    if (!shopName.trim() || saving) return;
    setSaving(true);
    try { await supabase.from('tenants').update({ shop_name: shopName.trim() }).eq('id', tenant.id); }
    catch (_) {}
    finally { setSaving(false); }
    setStep(2);
  }

  // Add a custom department (selected by default). Validates length/dupes/empty.
  function addCustomDept() {
    const v = customInput.trim();
    if (!v) { setCustomErr('Enter a department name'); return; }
    if (v.length > 20) { setCustomErr('Max 20 characters'); return; }
    const taken = [...DEPT_OPTIONS.map((o) => o.name), ...depts].some((n) => n.toLowerCase() === v.toLowerCase());
    if (taken) { setCustomErr('That department already exists'); return; }
    setDepts((prev) => [...prev, v]);
    setCustomInput(''); setCustomErr(''); setShowCustom(false); setDeptError(false);
  }

  // Custom depts = selected names that aren't one of the four defaults.
  const customDepts = depts.filter((d) => !DEPT_OPTIONS.some((o) => o.name === d));

  // Step 2 → 3 (save departments)
  async function goStep3() {
    if (depts.length === 0) { setDeptError(true); return; }
    if (saving) return;
    setSaving(true);
    try { await supabase.from('tenants').update({ departments: depts }).eq('id', tenant.id); }
    catch (_) {}
    finally { setSaving(false); }
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
        <button style={S.skip} onClick={completeWizard} disabled={saving}>Skip setup</button>

        <Dots step={step} />

        {/* ── STEP 1 — Welcome ─────────────────────────────────────── */}
        {step === 1 && (
          <div style={{ animation: 'wizFade 0.25s ease' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 18 }}>
              <LogoMark size={40} />
              <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700, color: '#E6F0EE' }}>
                inline<b style={{ color: '#2DE1C9' }}>IQ</b>
              </div>
            </div>
            <div style={S.stepLabel}>Step 1 of 3</div>
            <h2 style={S.h2}>Welcome to InlineIQ</h2>
            <p style={S.sub}>Let&apos;s get your shop set up in under 2 minutes.</p>

            <div style={{ marginBottom: 24 }}>
              <label style={S.label} htmlFor="wiz-shop">Your shop name</label>
              <input
                id="wiz-shop"
                style={S.input}
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder="Your shop name"
                onKeyDown={(e) => e.key === 'Enter' && goStep2()}
              />
            </div>

            <button style={S.btnPrimary(!shopName.trim() || saving)} onClick={goStep2} disabled={!shopName.trim() || saving}>
              {saving ? 'Saving…' : "Let's go"}
            </button>
          </div>
        )}

        {/* ── STEP 2 — Departments ─────────────────────────────────── */}
        {step === 2 && (
          <div style={{ animation: 'wizFade 0.25s ease' }}>
            <div style={S.stepLabel}>Step 2 of 3</div>
            <h2 style={S.h2}>Which departments does your shop have?</h2>
            <p style={S.sub}>Select all that apply — you can change this later.</p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {DEPT_OPTIONS.map(({ name, desc }) => {
                const sel = depts.includes(name);
                return (
                  <button
                    key={name}
                    onClick={() => { setDeptError(false); setDepts((prev) => sel ? prev.filter((x) => x !== name) : [...prev, name]); }}
                    style={{
                      padding: '14px 16px', borderRadius: 12, cursor: 'pointer', minHeight: 48,
                      fontFamily: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                      background: sel ? 'rgba(45,225,201,0.08)' : '#0f1418',
                      border: `1.5px solid ${sel ? '#2DE1C9' : 'rgba(94,234,212,0.15)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{
                      width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                      border: `1.5px solid ${sel ? '#2DE1C9' : 'rgba(94,234,212,0.25)'}`,
                      background: sel ? '#2DE1C9' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
                    }}>
                      {sel && (
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#001917" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      )}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: sel ? '#2DE1C9' : '#E6F0EE' }}>{name}</span>
                      <span style={{ display: 'block', fontSize: 12.5, color: '#8BA5A0', marginTop: 2 }}>{desc}</span>
                    </span>
                  </button>
                );
              })}

              {/* Custom department cards */}
              {customDepts.map((name) => (
                <div
                  key={name}
                  style={{
                    padding: '14px 16px', borderRadius: 12, minHeight: 48,
                    textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12,
                    background: 'rgba(45,225,201,0.08)', border: '1.5px solid #2DE1C9',
                  }}
                >
                  <span style={{
                    width: 20, height: 20, flexShrink: 0, borderRadius: 5,
                    border: '1.5px solid #2DE1C9', background: '#2DE1C9',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#001917" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 14.5, fontWeight: 700, color: '#2DE1C9' }}>{name}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#8BA5A0', marginTop: 2 }}>Custom department</span>
                  </span>
                  <button
                    onClick={() => setDepts((prev) => prev.filter((x) => x !== name))}
                    aria-label={`Remove ${name}`}
                    style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 7, background: 'none', border: '1px solid rgba(94,234,212,0.15)', color: '#8BA5A0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit' }}
                  >
                    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
              ))}
            </div>

            {/* Add custom department */}
            {!showCustom ? (
              <button
                onClick={() => { setShowCustom(true); setCustomErr(''); }}
                style={{ ...S.btnGhost, width: '100%', minHeight: 42, fontSize: 13, marginBottom: 14 }}
              >
                + Add custom department
              </button>
            ) : (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    autoFocus
                    style={{ ...S.input, flex: 1, padding: '11px 14px', fontSize: 14 }}
                    value={customInput}
                    maxLength={20}
                    placeholder="e.g. CNC, Hardware, Install Crew"
                    onChange={(e) => { setCustomInput(e.target.value); setCustomErr(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomDept(); } }}
                  />
                  <button
                    onClick={addCustomDept}
                    style={{ ...S.btnPrimary(!customInput.trim()), width: 'auto', minHeight: 44, marginTop: 0, padding: '0 20px', fontSize: 14 }}
                    disabled={!customInput.trim()}
                  >
                    Add
                  </button>
                </div>
                {customErr && <div style={{ fontSize: 12.5, color: '#F87171', marginTop: 6 }}>{customErr}</div>}
              </div>
            )}

            {deptError && depts.length === 0 && (
              <div style={{ fontSize: 13, color: '#F87171', marginBottom: 14 }}>Please select at least one department.</div>
            )}

            <div style={{ display: 'flex', gap: 10 }}>
              <button style={S.btnGhost} onClick={() => setStep(1)}>← Back</button>
              <button style={{ ...S.btnPrimary(saving), flex: 2, marginTop: 0 }} onClick={goStep3} disabled={saving}>
                {saving ? 'Saving…' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 — Invite crew ─────────────────────────────────── */}
        {step === 4 && (
          <div style={{ animation: 'wizFade 0.25s ease' }}>
            <div style={S.stepLabel}>Step 3 of 3</div>
            <h2 style={S.h2}>Your crew joins with one link</h2>
            <p style={S.sub}>Share this with your crew — they tap it and they&apos;re straight in. No account needed.</p>

            {/* URL display box */}
            <div style={{
              background: '#0f1418', border: '1px solid rgba(45,225,201,0.3)',
              borderRadius: 12, padding: '14px 16px', marginBottom: 14,
            }}>
              <span style={{ fontSize: 13, color: '#5EEAD4', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                {inviteUrl}
              </span>
            </div>

            {/* Copy Link */}
            <button
              onClick={copyLink}
              style={{ ...S.btnPrimary(false), background: copied ? '#34D399' : '#2DE1C9', marginTop: 0, marginBottom: 10 }}
            >
              <CopyIcon /> {copied ? 'Copied!' : 'Copy Link'}
            </button>

            {/* Share via WhatsApp */}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(`Join our shop on InlineIQ: ${inviteUrl}`)}`}
              target="_blank" rel="noopener noreferrer"
              style={{ ...S.btnGhost, width: '100%', color: '#5EEAD4', textDecoration: 'none', marginBottom: 18 }}
            >
              <ShareIcon /> Share via WhatsApp
            </a>

            {/* Done */}
            <button style={S.btnPrimary(saving)} onClick={completeWizard} disabled={saving}>
              {saving ? 'Saving…' : 'Done — Go to Dashboard'}
            </button>

            <div style={{ textAlign: 'center', marginTop: 12 }}>
              <button style={{ background: 'none', border: 'none', color: '#8BA5A0', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 6 }} onClick={() => setStep(2)}>← Back</button>
            </div>
          </div>
        )}

        <style>{`@keyframes wizFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
      </div>
    </div>
  );
}
