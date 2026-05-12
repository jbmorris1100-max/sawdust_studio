import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Fields allowed in the anonymized payload — no names, job numbers, or identifiers
const SAFE_KEYS = new Set([
  'hours', 'dept', 'had_job', 'resolution_type', 'days_open',
  'result', 'material_type', 'activity_type', 'category',
]);

function sanitize(payload: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SAFE_KEYS.has(k)) safe[k] = v;
  }
  return safe;
}

function shopSize(n: number): string {
  if (n <= 5)  return 'small';
  if (n <= 15) return 'medium';
  return 'large';
}

export async function POST(req: Request) {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const { tenantId, event_type, payload } = await req.json() as {
    tenantId?: string;
    event_type?: string;
    payload?: Record<string, unknown>;
  };

  if (!tenantId || !event_type) {
    return NextResponse.json({ error: 'tenantId and event_type required' }, { status: 400 });
  }

  const db = createClient(url, serviceKey);

  // Check opt-in — skip silently if not enabled
  const { data: tenant } = await db
    .from('tenants')
    .select('ai_data_sharing')
    .eq('id', tenantId)
    .single();

  if (!tenant?.ai_data_sharing) {
    return NextResponse.json({ success: true, skipped: true });
  }

  // Estimate shop size from active crew today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: crewCount } = await db
    .from('time_clock')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('clock_out', null)
    .gte('clock_in', todayStart.toISOString());

  const { error } = await db.from('platform_analytics').insert({
    event_type,
    payload:   sanitize(payload ?? {}),
    shop_size: shopSize(crewCount ?? 0),
    industry:  'cabinet',
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
