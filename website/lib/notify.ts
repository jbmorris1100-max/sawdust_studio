// Fire-and-forget Web Push trigger. Never awaited, never blocks the UI —
// any failure is swallowed so notification delivery can't break a user action.

export type NotifyTarget = 'supervisor' | 'crew' | 'all';

export function sendNotify(payload: {
  tenant_id: string;
  target: NotifyTarget;
  title: string;
  body: string;
  url?: string;
}): void {
  try {
    void fetch('/app/api/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch {
    /* push unavailable — ignore */
  }
}
