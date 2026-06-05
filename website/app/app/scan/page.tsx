'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

// The QR clock-in landing page now lives at the top-level /scan route (matching
// the printed QR URL https://inlineiq.app/scan). This legacy /app/scan path
// simply forwards there, preserving the action/tenant query string.
function Redirect() {
  const params = useSearchParams();
  useEffect(() => {
    const qs = params.toString();
    window.location.replace(`/scan${qs ? `?${qs}` : ''}`);
  }, [params]);
  return null;
}

export default function LegacyScanRedirect() {
  return (
    <Suspense>
      <Redirect />
    </Suspense>
  );
}
