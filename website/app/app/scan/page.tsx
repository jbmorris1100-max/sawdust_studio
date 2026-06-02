'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function ScanContent() {
  const params     = useSearchParams();
  const action     = params.get('action')   ?? '';
  const location   = params.get('location') ?? '';
  const tenantParam = params.get('tenant')  ?? '';

  return (
    <div style={{
      minHeight: '100vh', background: '#050608',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 32, fontFamily: 'inherit',
    }}>
      <div style={{
        background: '#0a0d10', border: '1px solid rgba(94,234,212,0.2)',
        borderRadius: 20, padding: '40px 32px', maxWidth: 420, width: '100%',
        textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <svg width={48} height={48} viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#5EEAD4', marginBottom: 8 }}>
            inlineIQ
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#E2E8F0', margin: 0 }}>
            QR Clock-in
          </h1>
          <p style={{ fontSize: 14, color: '#8BA5A0', marginTop: 8, lineHeight: 1.6, marginBottom: 0 }}>
            Coming soon — scan to clock in and out automatically.
          </p>
        </div>

        {(action || location) && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(94,234,212,0.06)', border: '1px solid rgba(94,234,212,0.15)',
            fontSize: 12, color: '#8BA5A0', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            {action   && <span><span style={{ color: '#5EEAD4', fontWeight: 700 }}>Action:</span> {action}</span>}
            {location && <span><span style={{ color: '#5EEAD4', fontWeight: 700 }}>Location:</span> {location}</span>}
            {tenantParam && <span><span style={{ color: '#5EEAD4', fontWeight: 700 }}>Shop:</span> {tenantParam}</span>}
          </div>
        )}

        <Link
          href="/app/crew"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 10,
            background: 'rgba(94,234,212,0.1)', border: '1px solid rgba(94,234,212,0.25)',
            color: '#5EEAD4', fontSize: 14, fontWeight: 700, textDecoration: 'none',
          }}
        >
          Go to Crew App
        </Link>
      </div>
    </div>
  );
}

export default function ScanPage() {
  return (
    <Suspense>
      <ScanContent />
    </Suspense>
  );
}
