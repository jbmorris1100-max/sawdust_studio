// Server-only HMAC-SHA256 token for the partner admin panel. No external deps
// (jose is not installed). A token is `base64url(payload).base64url(sig)` where
// sig = HMAC-SHA256(payload, secret). The secret is ADMIN_JWT_SECRET, falling
// back to ADMIN_PASSWORD. NEVER import this from a client component — it reads
// server-side secrets. The browser only needs to read the (unverified) exp from
// the payload, which it can do without the secret.
import { createHmac, timingSafeEqual } from 'crypto';

const TTL_SECONDS = 8 * 60 * 60; // 8 hours

type AdminPayload = { sub: 'admin'; iat: number; exp: number };

function secret(): string {
  return process.env.ADMIN_JWT_SECRET || process.env.ADMIN_PASSWORD || '';
}

function sign(body: string, key: string): string {
  return createHmac('sha256', key).update(body).digest('base64url');
}

// Issue a fresh admin token. Throws if no secret is configured.
export function signAdminToken(ttlSeconds = TTL_SECONDS): string {
  const key = secret();
  if (!key) throw new Error('admin token secret not configured');
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AdminPayload = { sub: 'admin', iat: nowSec, exp: nowSec + ttlSeconds };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, key)}`;
}

// Constant-time string compare via the HMAC sigs' raw bytes.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function verifyAdminTokenString(token: string): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [body, sig] = parts;
  if (!safeEqual(sig, sign(body, key))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<AdminPayload>;
    if (payload.sub !== 'admin') return false;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// Read `Authorization: Bearer <token>` from a request and verify it. Returns
// true only for a well-formed, correctly-signed, unexpired admin token.
export function verifyAdminToken(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return verifyAdminTokenString(token);
}
