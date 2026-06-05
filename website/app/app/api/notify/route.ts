import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

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
    // Env presence — log without ever exposing secret values.
    console.log('VAPID public key present:', !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);
    console.log('VAPID private key present:', !!process.env.VAPID_PRIVATE_KEY);
    console.log('Service role key present:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    };
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { tenant_id, target = 'all', dept_target, title, body, url: clickUrl } = payload;

    console.log('Notify route called with:', {
      tenant_id,
      target,
      dept_target,
      title,
      body,
    });

    if (!tenant_id || !title || !body) {
      return NextResponse.json({ error: 'tenant_id, title and body required' }, { status: 400 });
    }

    // Service-role client — reads all subscriptions for the tenant.
    const db = createClient(url, serviceKey, { auth: { persistSession: false } });

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
