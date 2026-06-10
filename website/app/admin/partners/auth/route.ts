import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { signAdminToken } from '@/lib/adminToken';

// ── Partner admin login ──────────────────────────────────────────────────────
// POST { username, password }. Compares against ADMIN_USERNAME / ADMIN_PASSWORD
// (server-side env only — never sent to the client). On match, returns a signed
// 8-hour HMAC token. Credentials are never logged.

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const username = String(body.username ?? '');
  const password = String(body.password ?? '');
  const U = process.env.ADMIN_USERNAME;
  const P = process.env.ADMIN_PASSWORD;
  if (!U || !P) {
    return NextResponse.json({ ok: false, error: 'Admin auth not configured' }, { status: 500 });
  }

  const match = safeEqual(username, U) && safeEqual(password, P);
  if (!match) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const token = signAdminToken();
    return NextResponse.json({ ok: true, token });
  } catch {
    return NextResponse.json({ ok: false, error: 'Token secret not configured' }, { status: 500 });
  }
}
