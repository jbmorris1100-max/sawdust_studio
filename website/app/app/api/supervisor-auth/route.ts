import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// ── Supervisor PIN auth ───────────────────────────────────────────────────────
// POST { tenantId, action: 'verify', pin } → { ok, token? }
// POST { tenantId, action: 'set', pin, newPin } → { ok }
// POST { tenantId, action: 'check-token', token } → { ok }
//
// PIN is hashed with HMAC-SHA256 using the tenant id as salt.
// Trust token = HMAC-SHA256(tenantId + deviceId + expiry) so it can be
// verified server-side without storing it.

const TRUST_DAYS = 30;
const APP_SECRET = process.env.SUPERVISOR_PIN_SECRET;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function hashPin(pin: string, tenantId: string): string {
  return createHmac('sha256', APP_SECRET!)
    .update(`${tenantId}:${pin}`)
    .digest('hex');
}

function makeToken(tenantId: string, deviceId: string): string {
  const expiry = Date.now() + TRUST_DAYS * 86400000;
  const payload = `${tenantId}:${deviceId}:${expiry}`;
  const sig = createHmac('sha256', APP_SECRET!).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifyToken(token: string, tenantId: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 4) return false;
    const [tid, deviceId, expiry, sig] = parts;
    if (tid !== tenantId) return false;
    if (Date.now() > parseInt(expiry)) return false;
    const payload = `${tid}:${deviceId}:${expiry}`;
    const expected = createHmac('sha256', APP_SECRET!).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!process.env.SUPERVISOR_PIN_SECRET) {
    console.error('[supervisor-auth] SUPERVISOR_PIN_SECRET is not set — refusing all requests');
    return NextResponse.json({ ok: false, error: 'Auth not configured' }, { status: 500 });
  }
  const db = admin();
  if (!db) return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });

  let body: { tenantId?: string; action?: string; pin?: string; newPin?: string; token?: string; deviceId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { tenantId, action, pin, newPin, token, deviceId } = body;
  if (!tenantId || !action) {
    return NextResponse.json({ ok: false, error: 'tenantId and action required' }, { status: 400 });
  }

  // ── check-token ────────────────────────────────────────────────────────────
  if (action === 'check-token') {
    if (!token || !deviceId) return NextResponse.json({ ok: false });
    return NextResponse.json({ ok: verifyToken(token, tenantId) });
  }

  // Load tenant PIN
  const { data: tenant } = await db.from('tenants')
    .select('supervisor_pin')
    .eq('id', tenantId)
    .single();
  const stored = (tenant as { supervisor_pin: string | null } | null)?.supervisor_pin ?? null;

  // ── set (first-time or change) ─────────────────────────────────────────────
  if (action === 'set') {
    if (!newPin || newPin.length < 4) {
      return NextResponse.json({ ok: false, error: 'PIN must be at least 4 digits' }, { status: 400 });
    }
    // If a PIN already exists, require the current PIN first
    if (stored) {
      if (!pin) return NextResponse.json({ ok: false, error: 'Current PIN required' }, { status: 403 });
      const currentHash = hashPin(pin, tenantId);
      const storedBuf = Buffer.from(stored, 'hex');
      const currentBuf = Buffer.from(currentHash, 'hex');
      if (storedBuf.length !== currentBuf.length || !timingSafeEqual(storedBuf, currentBuf)) {
        return NextResponse.json({ ok: false, error: 'Current PIN incorrect' }, { status: 403 });
      }
    }
    const newHash = hashPin(newPin, tenantId);
    await db.from('tenants').update({ supervisor_pin: newHash }).eq('id', tenantId);
    return NextResponse.json({ ok: true });
  }

  // ── verify ────────────────────────────────────────────────────────────────
  if (action === 'verify') {
    if (!pin) return NextResponse.json({ ok: false, error: 'PIN required' }, { status: 400 });
    // No PIN set yet — only the authenticated tenant owner can create it.
    // Verify the request carries a valid Supabase session for this tenant.
    if (!stored) {
      if (pin.length < 4) {
        return NextResponse.json({ ok: false, error: 'PIN must be at least 4 digits' }, { status: 400 });
      }
      // Verify Supabase session from Authorization header
      const authHeader = req.headers.get('authorization') ?? '';
      const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!jwt) {
        return NextResponse.json({ ok: false, error: 'Authentication required to set PIN' }, { status: 401 });
      }
      // Verify the JWT belongs to the owner of this tenant
      const { createClient: createAnonClient } = await import('@supabase/supabase-js');
      const userClient = createAnonClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${jwt}` } } }
      );
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) {
        return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 });
      }
      // Confirm this user owns the tenant
      const { data: tenantRow } = await db.from('tenants')
        .select('owner_user_id')
        .eq('id', tenantId)
        .single();
      if (!tenantRow || (tenantRow as { owner_user_id: string }).owner_user_id !== user.id) {
        return NextResponse.json({ ok: false, error: 'Not authorized for this tenant' }, { status: 403 });
      }
      const hash = hashPin(pin, tenantId);
      await db.from('tenants').update({ supervisor_pin: hash }).eq('id', tenantId);
      const safeDeviceId = deviceId ?? randomBytes(16).toString('hex');
      return NextResponse.json({ ok: true, token: makeToken(tenantId, safeDeviceId), firstTime: true });
    }
    // Verify against stored hash
    const attempt = hashPin(pin, tenantId);
    const storedBuf = Buffer.from(stored, 'hex');
    const attemptBuf = Buffer.from(attempt, 'hex');
    if (storedBuf.length !== attemptBuf.length || !timingSafeEqual(storedBuf, attemptBuf)) {
      return NextResponse.json({ ok: false, error: 'Incorrect PIN' }, { status: 403 });
    }
    const safeDeviceId = deviceId ?? randomBytes(16).toString('hex');
    return NextResponse.json({ ok: true, token: makeToken(tenantId, safeDeviceId) });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
