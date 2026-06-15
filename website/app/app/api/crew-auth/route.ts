import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

// ── Crew authentication route ─────────────────────────────────────────────────
// POST { action, ...params }
//
// Actions:
//   set-pin        { tenantId, crewMemberId, pin, supToken, deviceId } → { ok }
//   verify-pin     { tenantId, crewMemberId, pin } → { ok, registrationToken?, sessionToken? }
//   reg-options    { tenantId, crewMemberId, registrationToken } → WebAuthn options
//   reg-verify     { tenantId, crewMemberId, registrationToken, credential, deviceName } → { ok, sessionToken }
//   auth-options   { tenantId, crewMemberId } → WebAuthn options
//   auth-verify    { tenantId, crewMemberId, credential } → { ok, sessionToken }
//   verify-session { tenantId, crewMemberId, sessionToken } → { ok }
//   reset-pin      { tenantId, crewMemberId, supToken, deviceId } → { ok }
//
// Built for @simplewebauthn/server v13: registrationInfo.credential carries
// { id, publicKey, counter }; verifyAuthenticationResponse takes `credential`.

const APP_SECRET = process.env.SUPERVISOR_PIN_SECRET;
const RP_NAME    = 'InlineIQ';
const SESSION_DAYS = 90;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function getRpId(req: Request): string {
  const host = req.headers.get('host') ?? 'inlineiq.app';
  return host.split(':')[0];
}

function hashPin(pin: string, crewMemberId: string): string {
  if (!APP_SECRET) throw new Error('APP_SECRET not set');
  return createHmac('sha256', APP_SECRET)
    .update(`crew:${crewMemberId}:${pin}`)
    .digest('hex');
}

function makeSessionToken(tenantId: string, crewMemberId: string, credentialId: string): string {
  if (!APP_SECRET) throw new Error('APP_SECRET not set');
  const expiry  = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${tenantId}:${crewMemberId}:${credentialId}:${expiry}`;
  const sig     = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64');
}

function verifySessionToken(token: string, tenantId: string, crewMemberId: string): boolean {
  if (!APP_SECRET) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length !== 5) return false;
    const [tid, mid, credId, expiry, sig] = parts;
    if (tid !== tenantId || mid !== crewMemberId) return false;
    if (Date.now() > parseInt(expiry)) return false;
    const payload  = `${tid}:${mid}:${credId}:${expiry}`;
    const expected = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

// Verify the supervisor trust token so only supervisors can set crew PINs.
// Mirrors the token shape minted by /app/api/supervisor-auth (tenantId:deviceId:expiry:sig).
function verifySupervisorToken(token: string, tenantId: string, deviceId: string): boolean {
  if (!APP_SECRET) return false;
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parts   = decoded.split(':');
    if (parts.length !== 4) return false;
    const [tid, did, expiry, sig] = parts;
    if (tid !== tenantId || did !== deviceId) return false;
    if (Date.now() > parseInt(expiry)) return false;
    const payload  = `${tid}:${did}:${expiry}`;
    const expected = createHmac('sha256', APP_SECRET).update(payload).digest('hex');
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

export async function POST(req: Request) {
  if (!APP_SECRET) {
    return NextResponse.json({ ok: false, error: 'Auth not configured' }, { status: 500 });
  }
  const db = admin();
  if (!db) return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 });

  let body: Record<string, string>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { action, tenantId, crewMemberId } = body;
  if (!action || !tenantId) {
    return NextResponse.json({ ok: false, error: 'action and tenantId required' }, { status: 400 });
  }

  // ── set-pin ────────────────────────────────────────────────────────────────
  if (action === 'set-pin') {
    const { pin, supToken, deviceId } = body;
    if (!pin || pin.length < 4) {
      return NextResponse.json({ ok: false, error: 'PIN must be at least 4 digits' }, { status: 400 });
    }
    if (!crewMemberId) {
      return NextResponse.json({ ok: false, error: 'crewMemberId required' }, { status: 400 });
    }
    // Require valid supervisor trust token
    if (!supToken || !deviceId || !verifySupervisorToken(supToken, tenantId, deviceId)) {
      return NextResponse.json({ ok: false, error: 'Supervisor auth required' }, { status: 403 });
    }
    // Confirm crew member belongs to this tenant
    const { data: cm } = await db.from('crew_members')
      .select('id').eq('id', crewMemberId).eq('tenant_id', tenantId).single();
    if (!cm) return NextResponse.json({ ok: false, error: 'Crew member not found' }, { status: 404 });

    const hash = hashPin(pin, crewMemberId);
    await db.from('crew_members').update({
      initial_pin: hash,
      pin_set_at: new Date().toISOString(),
    }).eq('id', crewMemberId).eq('tenant_id', tenantId);
    return NextResponse.json({ ok: true });
  }

  // ── reset-pin ──────────────────────────────────────────────────────────────
  if (action === 'reset-pin') {
    const { supToken, deviceId } = body;
    if (!crewMemberId) return NextResponse.json({ ok: false, error: 'crewMemberId required' }, { status: 400 });
    if (!supToken || !deviceId || !verifySupervisorToken(supToken, tenantId, deviceId)) {
      return NextResponse.json({ ok: false, error: 'Supervisor auth required' }, { status: 403 });
    }
    await db.from('crew_members').update({ initial_pin: null, pin_set_at: null })
      .eq('id', crewMemberId).eq('tenant_id', tenantId);
    // Also delete existing credentials so crew re-registers on next login
    await db.from('crew_member_credentials')
      .delete().eq('crew_member_id', crewMemberId).eq('tenant_id', tenantId);
    return NextResponse.json({ ok: true });
  }

  // ── verify-pin ─────────────────────────────────────────────────────────────
  if (action === 'verify-pin') {
    const { pin } = body;
    if (!pin || !crewMemberId) {
      return NextResponse.json({ ok: false, error: 'pin and crewMemberId required' }, { status: 400 });
    }
    const { data: cm } = await db.from('crew_members')
      .select('id, initial_pin, status').eq('id', crewMemberId).eq('tenant_id', tenantId).single();
    if (!cm) return NextResponse.json({ ok: false, error: 'Crew member not found' }, { status: 404 });
    if ((cm as { status: string }).status === 'inactive') {
      return NextResponse.json({ ok: false, error: 'Account inactive — contact your supervisor' }, { status: 403 });
    }
    const stored = (cm as { initial_pin: string | null }).initial_pin;
    if (!stored) {
      return NextResponse.json({ ok: false, error: 'No PIN set — ask your supervisor to set your PIN' }, { status: 403 });
    }
    const attempt = hashPin(pin, crewMemberId);
    const storedBuf  = Buffer.from(stored, 'hex');
    const attemptBuf = Buffer.from(attempt, 'hex');
    if (storedBuf.length !== attemptBuf.length || !timingSafeEqual(storedBuf, attemptBuf)) {
      return NextResponse.json({ ok: false, error: 'Incorrect PIN' }, { status: 403 });
    }
    // Return a short-lived registration token (10 min) so the client can proceed to WebAuthn
    const regToken = randomBytes(32).toString('hex');
    await db.from('crew_auth_challenges').insert({
      challenge:      regToken,
      crew_member_id: crewMemberId,
      tenant_id:      tenantId,
      type:           'pin-verified',
      expires_at:     new Date(Date.now() + 10 * 60000).toISOString(),
    });
    // Issue both a registration token (for WebAuthn setup) and a PIN-only
    // session token so crew who skip biometrics can still enter the app.
    const pinSessionToken = makeSessionToken(tenantId, crewMemberId, 'pin-only');
    return NextResponse.json({
      ok: true,
      registrationToken: regToken,
      sessionToken: pinSessionToken,
    });
  }

  // ── reg-options ────────────────────────────────────────────────────────────
  if (action === 'reg-options') {
    const { registrationToken } = body;
    if (!crewMemberId || !registrationToken) {
      return NextResponse.json({ ok: false, error: 'crewMemberId and registrationToken required' }, { status: 400 });
    }
    // Verify the registration token
    const { data: challenge } = await db.from('crew_auth_challenges')
      .select('id, expires_at').eq('challenge', registrationToken)
      .eq('crew_member_id', crewMemberId).eq('type', 'pin-verified').single();
    if (!challenge) return NextResponse.json({ ok: false, error: 'Invalid or expired token' }, { status: 403 });
    if (new Date((challenge as { expires_at: string }).expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: 'Token expired' }, { status: 403 });
    }

    const { data: cm } = await db.from('crew_members').select('name').eq('id', crewMemberId).single();
    const name = (cm as { name: string } | null)?.name ?? 'Crew';

    // Get existing credentials to exclude
    const { data: existingCreds } = await db.from('crew_member_credentials')
      .select('credential_id').eq('crew_member_id', crewMemberId);
    const excludeCredentials = ((existingCreds as { credential_id: string }[] | null) ?? [])
      .map((c) => ({ id: c.credential_id }));

    const options = await generateRegistrationOptions({
      rpName:                  RP_NAME,
      rpID:                    getRpId(req),
      userID:                  new TextEncoder().encode(crewMemberId),
      userName:                name,
      userDisplayName:         name,
      attestationType:         'none',
      excludeCredentials,
      authenticatorSelection:  {
        authenticatorAttachment: 'platform',
        userVerification:        'required',
        residentKey:             'preferred',
      },
    });

    // Store the challenge
    await db.from('crew_auth_challenges').insert({
      challenge:      options.challenge,
      crew_member_id: crewMemberId,
      tenant_id:      tenantId,
      type:           'registration',
      expires_at:     new Date(Date.now() + 5 * 60000).toISOString(),
    });
    return NextResponse.json(options);
  }

  // ── reg-verify ─────────────────────────────────────────────────────────────
  if (action === 'reg-verify') {
    const { registrationToken, deviceName } = body;
    let credential: RegistrationResponseJSON;
    try { credential = JSON.parse(body.credential) as RegistrationResponseJSON; } catch {
      return NextResponse.json({ ok: false, error: 'Invalid credential' }, { status: 400 });
    }
    if (!crewMemberId || !registrationToken) {
      return NextResponse.json({ ok: false, error: 'crewMemberId and registrationToken required' }, { status: 400 });
    }

    // Verify the reg token is still valid
    const { data: regChallenge } = await db.from('crew_auth_challenges')
      .select('id, expires_at').eq('challenge', registrationToken)
      .eq('crew_member_id', crewMemberId).eq('type', 'pin-verified').single();
    if (!regChallenge || new Date((regChallenge as { expires_at: string }).expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: 'Registration token expired' }, { status: 403 });
    }

    // Find the WebAuthn challenge
    const { data: wanChallenge } = await db.from('crew_auth_challenges')
      .select('id, challenge, expires_at').eq('crew_member_id', crewMemberId)
      .eq('type', 'registration').order('expires_at', { ascending: false }).limit(1).single();
    if (!wanChallenge || new Date((wanChallenge as { expires_at: string }).expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: 'WebAuthn challenge expired' }, { status: 403 });
    }

    const rpID   = getRpId(req);
    const origin = `https://${rpID}`;
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response:         credential,
        expectedChallenge: (wanChallenge as { challenge: string }).challenge,
        expectedOrigin:   origin,
        expectedRPID:     rpID,
        requireUserVerification: true,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 400 });
    }

    // v13: credential = { id (base64url string), publicKey (Uint8Array), counter }
    const { id: credentialId, publicKey, counter } = verification.registrationInfo.credential;
    await db.from('crew_member_credentials').insert({
      tenant_id:      tenantId,
      crew_member_id: crewMemberId,
      credential_id:  credentialId,
      public_key:     Buffer.from(publicKey).toString('base64'),
      sign_count:     counter,
      device_name:    deviceName ?? null,
    });

    // Clean up challenges
    await db.from('crew_auth_challenges').delete()
      .eq('crew_member_id', crewMemberId).in('type', ['pin-verified', 'registration']);

    const sessionToken = makeSessionToken(tenantId, crewMemberId, credentialId);
    return NextResponse.json({ ok: true, sessionToken });
  }

  // ── auth-options ───────────────────────────────────────────────────────────
  if (action === 'auth-options') {
    if (!crewMemberId) return NextResponse.json({ ok: false, error: 'crewMemberId required' }, { status: 400 });

    // Check crew member is active
    const { data: cm } = await db.from('crew_members')
      .select('status').eq('id', crewMemberId).eq('tenant_id', tenantId).single();
    if (!cm || (cm as { status: string }).status === 'inactive') {
      return NextResponse.json({ ok: false, error: 'Account inactive' }, { status: 403 });
    }

    const { data: creds } = await db.from('crew_member_credentials')
      .select('credential_id').eq('crew_member_id', crewMemberId).eq('tenant_id', tenantId);
    const allowCredentials = ((creds as { credential_id: string }[] | null) ?? [])
      .map((c) => ({ id: c.credential_id }));

    if (allowCredentials.length === 0) {
      return NextResponse.json({ ok: false, error: 'No credentials registered — use PIN to set up Face ID' }, { status: 404 });
    }

    const options = await generateAuthenticationOptions({
      rpID:               getRpId(req),
      allowCredentials,
      userVerification:   'required',
    });

    await db.from('crew_auth_challenges').insert({
      challenge:      options.challenge,
      crew_member_id: crewMemberId,
      tenant_id:      tenantId,
      type:           'authentication',
      expires_at:     new Date(Date.now() + 5 * 60000).toISOString(),
    });
    return NextResponse.json(options);
  }

  // ── auth-verify ─────────────────────────────────────────────────────────────
  if (action === 'auth-verify') {
    let credential: AuthenticationResponseJSON;
    try { credential = JSON.parse(body.credential) as AuthenticationResponseJSON; } catch {
      return NextResponse.json({ ok: false, error: 'Invalid credential' }, { status: 400 });
    }
    if (!crewMemberId) return NextResponse.json({ ok: false, error: 'crewMemberId required' }, { status: 400 });

    const { data: challengeRow } = await db.from('crew_auth_challenges')
      .select('id, challenge, expires_at').eq('crew_member_id', crewMemberId)
      .eq('type', 'authentication').order('expires_at', { ascending: false }).limit(1).single();
    if (!challengeRow || new Date((challengeRow as { expires_at: string }).expires_at) < new Date()) {
      return NextResponse.json({ ok: false, error: 'Challenge expired' }, { status: 403 });
    }

    const credentialId = credential.id;
    const { data: storedCred } = await db.from('crew_member_credentials')
      .select('credential_id, public_key, sign_count')
      .eq('credential_id', credentialId).eq('crew_member_id', crewMemberId).single();
    if (!storedCred) return NextResponse.json({ ok: false, error: 'Credential not found' }, { status: 404 });

    const sc = storedCred as { credential_id: string; public_key: string; sign_count: number };
    const rpID   = getRpId(req);
    const origin = `https://${rpID}`;
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response:          credential,
        expectedChallenge: (challengeRow as { challenge: string }).challenge,
        expectedOrigin:    origin,
        expectedRPID:      rpID,
        credential: {
          id:        sc.credential_id,
          publicKey: Buffer.from(sc.public_key, 'base64'),
          counter:   Number(sc.sign_count),
        },
        requireUserVerification: true,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e) }, { status: 400 });
    }

    if (!verification.verified) {
      return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 400 });
    }

    // Update sign count (replay attack prevention)
    await db.from('crew_member_credentials').update({ sign_count: verification.authenticationInfo.newCounter })
      .eq('credential_id', credentialId);

    // Clean up challenge
    await db.from('crew_auth_challenges').delete().eq('id', (challengeRow as { id: string }).id);

    const sessionToken = makeSessionToken(tenantId, crewMemberId, credentialId);
    return NextResponse.json({ ok: true, sessionToken });
  }

  // ── verify-session ─────────────────────────────────────────────────────────
  if (action === 'verify-session') {
    const { sessionToken } = body;
    if (!crewMemberId || !sessionToken) {
      return NextResponse.json({ ok: false });
    }
    // Also confirm crew member is still active
    const { data: cm } = await db.from('crew_members')
      .select('status').eq('id', crewMemberId).eq('tenant_id', tenantId).single();
    if (!cm || (cm as { status: string }).status === 'inactive') {
      return NextResponse.json({ ok: false, error: 'Account inactive' });
    }
    return NextResponse.json({ ok: verifySessionToken(sessionToken, tenantId, crewMemberId) });
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
}
