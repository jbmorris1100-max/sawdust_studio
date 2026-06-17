import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { verifySessionToken, verifySupervisorToken } from '@/lib/authTokens';

// ── Web Push send endpoint ──────────────────────────────────────────────────
// POST { tenant_id, target: 'supervisor' | 'crew' | 'all', title, body, url? }
// Fetches push_subscriptions for the tenant (filtered by target user_type),
// sends each via web-push, and prunes expired subscriptions (404 / 410 Gone).

type Target = 'supervisor' | 'crew' | 'all';

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

let vapidReady = false;
function configureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails('mailto:hello@inlineiq.app', publicKey, privateKey);
  vapidReady = true;
  return true;
}

export async function POST(req: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }
    if (!configureVapid()) {
      return NextResponse.json({ error: 'VAPID keys not configured' }, { status: 500 });
    }

    let payload: {
      tenant_id?: string;
      target?: Target;
      dept_target?: string;
      title?: string;
      body?: string;
      url?: string;
      // Caller credentials, auto-attached by sendNotify (see lib/notify.ts).
      sessionToken?: string;
      crewMemberId?: string;
      supervisorToken?: string;
      deviceId?: string;
      qcDelegateId?: string;
    };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const {
      tenant_id, target = 'all', dept_target, title, body, url: clickUrl,
      sessionToken, crewMemberId, supervisorToken, deviceId, qcDelegateId,
    } = payload;

    if (!tenant_id || !title || !body) {
      return NextResponse.json({ error: 'tenant_id, title and body required' }, { status: 400 });
    }

    // Service-role client — reads all subscriptions for the tenant.
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });

    // ── Authorize the caller against the tenant being notified ───────────────
    // Must hold a valid supervisor trust token, a valid crew session token for
    // an active crew member, or be a named active QC delegate — all scoped to
    // tenant_id. Anything else is rejected before any DB write or push send.
    let authorized = false;
    if (supervisorToken && deviceId) {
      authorized = verifySupervisorToken(supervisorToken, tenant_id, deviceId);
    } else if (sessionToken && crewMemberId) {
      if (verifySessionToken(sessionToken, tenant_id, crewMemberId)) {
        // Mirror crew-auth's verify-session: confirm the member belongs to this
        // tenant and isn't inactive.
        const { data: cm } = await db.from('crew_members')
          .select('status').eq('id', crewMemberId).eq('tenant_id', tenant_id).single();
        if (cm && (cm as { status: string }).status !== 'inactive') {
          authorized = true;
        }
      }
    } else if (qcDelegateId) {
      // QC delegates carry only their id — verify an active row exists.
      const { data: deleg } = await db.from('qc_delegates')
        .select('id').eq('tenant_id', tenant_id).eq('active', true)
        .eq('id', qcDelegateId).limit(1);
      if (deleg && deleg.length > 0) {
        authorized = true;
      }
    }
    if (!authorized) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Permanent notification log (Notification Center). Best-effort — a logging
    // failure must never block push delivery. dept_target narrows crew pushes;
    // store it as the notification's dept so the bell can filter if needed.
    try {
      await db.from('notifications').insert({
        tenant_id,
        target_type: target,
        dept: dept_target ?? null,
        title,
        body,
        url: clickUrl ?? null,
      });
    } catch (logErr) {
      console.error('Notification log insert failed:', logErr);
    }

    let query = db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('tenant_id', tenant_id);
    if (target === 'supervisor') {
      query = query.eq('user_type', 'supervisor');
    } else if (target === 'crew') {
      query = query.eq('user_type', 'crew');
      // dept_target narrows to one dept's crew; absent → all crew.
      if (dept_target) {
        query = query.eq('dept', dept_target);
      }
    }

    const { data: subs, error } = await query;
    if (error) {
      console.error('Notify route subscription query failed:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!subs || subs.length === 0) {
      return NextResponse.json({ sent: 0, skipped: true });
    }

    const notification = JSON.stringify({
      title,
      body,
      url: clickUrl || '/',
    });

    let sent = 0;
    const expiredIds: string[] = [];

    await Promise.all(
      (subs as SubRow[]).map(async (s) => {
        try {
          console.log('Sending to subscription:', s.endpoint);
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            notification
          );
          sent++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404 / 410 → subscription no longer valid, remove it.
          if (statusCode === 404 || statusCode === 410) {
            expiredIds.push(s.id);
          } else {
            console.error('Push send failed for', s.endpoint, err);
          }
        }
      })
    );

    if (expiredIds.length > 0) {
      try {
        await db.from('push_subscriptions').delete().in('id', expiredIds);
      } catch {
        /* best-effort cleanup */
      }
    }

    return NextResponse.json({ sent, pruned: expiredIds.length });
  } catch (error) {
    console.error('Notify route error:', error);
    return Response.json(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
