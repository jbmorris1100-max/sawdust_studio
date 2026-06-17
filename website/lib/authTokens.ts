// Shared signed-token verification used by both the crew-auth route (which
// mints these tokens) and the notify route (which must validate them before
// sending a push). Kept secret-only / stateless — no DB access here.

import { createHmac, timingSafeEqual } from 'crypto';

export const APP_SECRET = process.env.SUPERVISOR_PIN_SECRET;

// Verify a crew session token (tenantId:crewMemberId:credentialId:expiry:sig).
export function verifySessionToken(token: string, tenantId: string, crewMemberId: string): boolean {
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

// Verify the supervisor trust token so only supervisors can perform supervisor
// actions. Mirrors the token shape minted by /app/api/supervisor-auth
// (tenantId:deviceId:expiry:sig).
export function verifySupervisorToken(token: string, tenantId: string, deviceId: string): boolean {
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
