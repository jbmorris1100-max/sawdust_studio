// ── Crew session gate ─────────────────────────────────────────────────────────
// Single source of truth for "is this device an authenticated crew member?".
// The crew app has no Supabase Auth session — crew authenticate at /join via
// PIN/WebAuthn (see app/api/crew-auth), which stores a signed session token in
// localStorage. Every action that must be *attributed to a real crew member*
// (notably clock-in) verifies that token here before proceeding, and resolves
// the authoritative identity (crew_member_id + name + dept) from the
// crew_members row — never from free-text the user typed.
//
// Token verification is server-side: the crew-auth route validates the token
// with verifySessionToken (lib/authTokens.ts). We reach it over fetch because
// the signing secret is server-only.
import { supabase } from './supabase';

export type CrewIdentity = {
  crewMemberId: string;
  sessionToken: string;
  name: string;
  dept: string | null;
};

const SESSION_KEY = (tenantId: string) => `crew_session_${tenantId}`;
const CREW_ID_KEY = (tenantId: string) => `crew_member_id_${tenantId}`;

// Read the stored (unverified) crew session for a tenant. null if none.
// Safe to call offline — it only touches localStorage.
export function readCrewSession(tenantId: string): { crewMemberId: string; sessionToken: string } | null {
  try {
    const sessionToken = localStorage.getItem(SESSION_KEY(tenantId));
    const crewMemberId = localStorage.getItem(CREW_ID_KEY(tenantId));
    if (sessionToken && crewMemberId) return { crewMemberId, sessionToken };
  } catch { /* localStorage unavailable */ }
  return null;
}

export function clearCrewSession(tenantId: string): void {
  try {
    localStorage.removeItem(SESSION_KEY(tenantId));
    localStorage.removeItem(CREW_ID_KEY(tenantId));
  } catch { /* ignore */ }
}

// Verify a crew session token server-side via crew-auth (verifySessionToken).
// Requires a network connection. Returns false on any failure — callers treat
// a false result as "not authenticated".
export async function verifyCrewSessionToken(tenantId: string, crewMemberId: string, sessionToken: string): Promise<boolean> {
  try {
    const res = await fetch('/app/api/crew-auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'verify-session', tenantId, crewMemberId, sessionToken }),
    });
    const { ok } = (await res.json()) as { ok: boolean };
    return !!ok;
  } catch {
    return false;
  }
}

// Full gate for attributed actions: read the stored session, verify it
// server-side, then resolve the real crew_members identity tied to that id.
// Returns null (and clears an invalid token) when the device is not a verified,
// active crew member — callers must then route the user to /join to sign in.
export async function requireCrewIdentity(tenantId: string): Promise<CrewIdentity | null> {
  const stored = readCrewSession(tenantId);
  if (!stored) return null;
  const ok = await verifyCrewSessionToken(tenantId, stored.crewMemberId, stored.sessionToken);
  if (!ok) { clearCrewSession(tenantId); return null; }
  try {
    const { data } = await supabase
      .from('crew_members')
      .select('name, department, status')
      .eq('id', stored.crewMemberId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    const cm = data as { name: string; department: string | null; status: string | null } | null;
    if (!cm || cm.status === 'inactive') return null;
    return { crewMemberId: stored.crewMemberId, sessionToken: stored.sessionToken, name: cm.name, dept: cm.department };
  } catch {
    return null;
  }
}
