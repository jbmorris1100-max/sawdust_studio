// Fire-and-forget Web Push trigger. Never awaited, never blocks the UI —
// any failure is swallowed so notification delivery can't break a user action.

export type NotifyTarget = 'supervisor' | 'crew' | 'all';

// Credentials sendNotify transparently attaches so /api/notify can authorize
// the caller against the tenant being notified. The route accepts whichever
// shape is present; call sites never need to supply these themselves.
type AttachedCredentials =
  | { supervisorToken: string; deviceId: string }
  | { sessionToken: string; crewMemberId: string }
  | { qcDelegateId: string };

// Read whatever credential set is available for this tenant from browser
// storage, in priority order (strongest first). A supervisor previewing the
// crew view may have both supervisor and crew keys present, so the supervisor
// token wins. Returns null when no credentials are found — the request still
// fires and the route correctly rejects it with 401.
function resolveCredentials(tenant_id: string): AttachedCredentials | null {
  try {
    // 1. Supervisor trust/session token (strongest). Mirror the trust-then-
    //    session fallback order used by the supervisor page's trust gate.
    const deviceId = localStorage.getItem('sup_device_id');
    const supervisorToken =
      localStorage.getItem(`sup_trust_${tenant_id}`) ??
      sessionStorage.getItem(`sup_session_${tenant_id}`);
    if (deviceId && supervisorToken) {
      return { supervisorToken, deviceId };
    }

    // 2. Crew session token.
    const sessionToken = localStorage.getItem(`crew_session_${tenant_id}`);
    const crewMemberId = localStorage.getItem(`crew_member_id_${tenant_id}`);
    if (sessionToken && crewMemberId) {
      return { sessionToken, crewMemberId };
    }

    // 3. QC delegate — no signed token; carries only its id (verified
    //    route-side against an active qc_delegates row for this tenant).
    const qcDelegateId = localStorage.getItem('qc_delegate_id');
    if (qcDelegateId) {
      return { qcDelegateId };
    }
  } catch {
    // Private browsing / disabled storage — fall through unauthenticated.
  }
  return null;
}

export function sendNotify(payload: {
  tenant_id: string;
  target: NotifyTarget;
  dept_target?: string;
  title: string;
  body: string;
  url?: string;
}): void {
  const credentials = resolveCredentials(payload.tenant_id);
  void fetch('/app/api/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...payload, ...credentials }),
  }).catch(() => {});
}
