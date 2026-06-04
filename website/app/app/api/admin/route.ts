import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── Admin platform-overview endpoint ───────────────────────────────────────
// Reads ALL tenants + cross-tenant aggregates using the service role key.
// Access is gated on the caller's email matching NEXT_PUBLIC_ADMIN_EMAIL.

type TenantRow = {
  id: string;
  shop_name: string | null;
  owner_email: string | null;
  subscription_status: 'trial' | 'active' | 'cancelled' | 'expired' | null;
  trial_ends_at: string | null;
  created_at: string;
};

function adminDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

type Db = NonNullable<ReturnType<typeof adminDb>>;

// Verify the bearer token belongs to the configured admin email.
async function verifyAdmin(req: Request, db: Db): Promise<boolean> {
  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  if (!adminEmail) return false;
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  if (!token) return false;
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data.user?.email) return false;
    return data.user.email.toLowerCase() === adminEmail.toLowerCase();
  } catch {
    return false;
  }
}

async function tableCount(db: Db, table: string): Promise<number | null> {
  try {
    const { count, error } = await db.from(table).select('id', { count: 'exact', head: true });
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const db = adminDb();
  if (!db) {
    return NextResponse.json({ error: 'Supabase service role not configured' }, { status: 500 });
  }

  const ok = await verifyAdmin(req, db);
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // ── Tenants ──────────────────────────────────────────────────────────────
    const { data: tenantsData, error: tErr } = await db
      .from('tenants')
      .select('id, shop_name, owner_email, subscription_status, trial_ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (tErr) throw tErr;
    const tenants = (tenantsData ?? []) as TenantRow[];

    // ── Per-tenant time_clock aggregates ──────────────────────────────────────
    // Pull a bounded set of clock rows and fold them in JS (admin scale = small).
    const lastActive: Record<string, string> = {};
    const crewNames: Record<string, Set<string>> = {};
    const clockCount: Record<string, number> = {};
    try {
      const { data: clockRows } = await db
        .from('time_clock')
        .select('tenant_id, worker_name, clock_in, created_at')
        .order('created_at', { ascending: false })
        .limit(20000);
      for (const r of (clockRows ?? []) as { tenant_id: string; worker_name: string | null; clock_in: string | null; created_at: string | null }[]) {
        const tid = r.tenant_id;
        if (!tid) continue;
        const ts = r.clock_in ?? r.created_at;
        if (ts && (!lastActive[tid] || ts > lastActive[tid])) lastActive[tid] = ts;
        if (r.worker_name) (crewNames[tid] ??= new Set()).add(r.worker_name);
        clockCount[tid] = (clockCount[tid] ?? 0) + 1;
      }
    } catch { /* time_clock may be empty */ }

    // ── Per-tenant job counts ────────────────────────────────────────────────
    const jobCount: Record<string, number> = {};
    try {
      const { data: jobRows } = await db
        .from('jobs')
        .select('tenant_id')
        .limit(20000);
      for (const r of (jobRows ?? []) as { tenant_id: string }[]) {
        if (r.tenant_id) jobCount[r.tenant_id] = (jobCount[r.tenant_id] ?? 0) + 1;
      }
    } catch { /* jobs table optional */ }

    const now = Date.now();
    const enriched = tenants.map((t) => ({
      ...t,
      lastActive: lastActive[t.id] ?? null,
      crewCount: crewNames[t.id]?.size ?? 0,
      jobCount: jobCount[t.id] ?? 0,
      clockCount: clockCount[t.id] ?? 0,
      daysSinceSignup: Math.max(0, Math.floor((now - new Date(t.created_at).getTime()) / 86400000)),
    }));

    // ── KPIs ──────────────────────────────────────────────────────────────────
    const isTrial = (t: TenantRow) => t.subscription_status === 'trial';
    const trialActive = (t: TenantRow) => isTrial(t) && !!t.trial_ends_at && new Date(t.trial_ends_at).getTime() > now;
    const trialExpired = (t: TenantRow) => isTrial(t) && (!t.trial_ends_at || new Date(t.trial_ends_at).getTime() < now);
    const kpis = {
      totalShops: tenants.length,
      activeTrials: tenants.filter(trialActive).length,
      expiredTrials: tenants.filter(trialExpired).length,
      activePaid: tenants.filter((t) => t.subscription_status === 'active').length,
      cancelled: tenants.filter((t) => t.subscription_status === 'cancelled').length,
      mrr: 0, // placeholder until Stripe
    };

    // ── Activity feed (signups + upcoming trial expirations) ──────────────────
    type Event = { ts: string; shop: string; event: string };
    const events: Event[] = [];
    for (const t of enriched) {
      events.push({ ts: t.created_at, shop: t.shop_name ?? 'Unknown shop', event: 'Signed up' });
      if (trialActive(t) && t.trial_ends_at) {
        const days = Math.ceil((new Date(t.trial_ends_at).getTime() - now) / 86400000);
        if (days >= 0 && days <= 7) {
          events.push({
            ts: t.trial_ends_at,
            shop: t.shop_name ?? 'Unknown shop',
            event: days === 0 ? 'Trial expires today' : `Trial expires in ${days} day${days !== 1 ? 's' : ''}`,
          });
        }
      }
    }
    events.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const activity = events.slice(0, 50);

    // ── Churn risk: trial expiring within 7 days + low activity (<5 clock-ins) ─
    const churnRisk = enriched
      .filter((t) => {
        if (!trialActive(t) || !t.trial_ends_at) return false;
        const days = Math.ceil((new Date(t.trial_ends_at).getTime() - now) / 86400000);
        return days >= 0 && days <= 7 && t.clockCount < 5;
      })
      .map((t) => ({
        id: t.id,
        shop_name: t.shop_name,
        trial_ends_at: t.trial_ends_at,
        clockCount: t.clockCount,
      }));

    // ── Platform health ───────────────────────────────────────────────────────
    let buckets: { name: string }[] = [];
    try {
      const { data: bucketData } = await db.storage.listBuckets();
      buckets = (bucketData ?? []).map((b) => ({ name: b.name }));
    } catch { /* storage may be unavailable */ }

    const [timeClockTotal, messagesTotal, partsTotal, cabinetUnitsTotal] = await Promise.all([
      tableCount(db, 'time_clock'),
      tableCount(db, 'messages'),
      tableCount(db, 'parts_log'),
      tableCount(db, 'cabinet_units'),
    ]);

    const health = {
      supabaseConnected: true,
      buckets,
      tableCounts: {
        time_clock: timeClockTotal,
        messages: messagesTotal,
        parts: partsTotal,
        cabinet_units: cabinetUnitsTotal,
      },
    };

    return NextResponse.json({ kpis, tenants: enriched, activity, churnRisk, health });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load admin data' },
      { status: 500 },
    );
  }
}

// ── Extend a tenant's trial by 30 days ─────────────────────────────────────
export async function POST(req: Request) {
  const db = adminDb();
  if (!db) {
    return NextResponse.json({ error: 'Supabase service role not configured' }, { status: 500 });
  }

  const ok = await verifyAdmin(req, db);
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { tenantId, action } = await req.json() as { tenantId?: string; action?: string };
    if (!tenantId || action !== 'extend_trial') {
      return NextResponse.json({ error: 'tenantId and action=extend_trial required' }, { status: 400 });
    }

    const { data: tenant, error: fErr } = await db
      .from('tenants')
      .select('trial_ends_at')
      .eq('id', tenantId)
      .single();
    if (fErr) throw fErr;

    // Extend from the later of (now, current trial end) so it always adds runway.
    const current = (tenant as { trial_ends_at: string | null }).trial_ends_at;
    const base = current && new Date(current).getTime() > Date.now() ? new Date(current).getTime() : Date.now();
    const newEnd = new Date(base + 30 * 86400000).toISOString();

    const { error: uErr } = await db
      .from('tenants')
      .update({ trial_ends_at: newEnd, subscription_status: 'trial' })
      .eq('id', tenantId);
    if (uErr) throw uErr;

    return NextResponse.json({ ok: true, trial_ends_at: newEnd });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to extend trial' },
      { status: 500 },
    );
  }
}
