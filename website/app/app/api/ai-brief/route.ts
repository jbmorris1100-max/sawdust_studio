import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'claude-sonnet-4-6';

type CrewRow    = { worker_name: string; dept: string; clock_in: string };
type NeedRow    = { item: string; dept: string | null; qty: number | null; status: string | null };
type DamageRow  = { part_name: string; dept: string | null; notes: string | null; status: string | null };
type MsgRow     = { sender_name: string; dept: string | null; body: string };
type BuildRow   = { worker_name: string; notes: string | null; clock_in: string; clock_out: string | null };
type LogRow     = { date: string; responses: Record<string, string> };

type AnalyticsRow = {
  event_type: string;
  payload: Record<string, unknown>;
  shop_size: string | null;
};

interface Benchmarks {
  avgShiftHours: number | null;
  qcPassRate: number | null;
  topDamageCategory: string | null;
  sampleSize: number;
  shopSizeFilter: string | null;
}

async function fetchBenchmarks(shopSize: string | null): Promise<Benchmarks> {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return { avgShiftHours: null, qcPassRate: null, topDamageCategory: null, sampleSize: 0, shopSizeFilter: shopSize };

  const db = createClient(url, serviceKey);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  let q = db.from('platform_analytics').select('event_type, payload, shop_size').gte('created_at', thirtyDaysAgo);
  if (shopSize) q = q.eq('shop_size', shopSize);

  const { data } = await q.limit(2000);
  if (!data || data.length === 0) return { avgShiftHours: null, qcPassRate: null, topDamageCategory: null, sampleSize: 0, shopSizeFilter: shopSize };

  const rows = data as AnalyticsRow[];

  const shifts  = rows.filter((r) => r.event_type === 'shift_complete');
  const qcs     = rows.filter((r) => r.event_type === 'qc_result');
  const damages = rows.filter((r) => r.event_type === 'damage_resolved');

  const shiftHours  = shifts.map((r) => Number(r.payload.hours)).filter((h) => h > 0 && h < 24);
  const avgShiftHours = shiftHours.length > 0
    ? Math.round((shiftHours.reduce((a, b) => a + b, 0) / shiftHours.length) * 10) / 10
    : null;

  const qcPasses = qcs.filter((r) => r.payload.result === 'pass').length;
  const qcPassRate = qcs.length > 0 ? Math.round((qcPasses / qcs.length) * 100) : null;

  const damageCounts: Record<string, number> = {};
  damages.forEach((r) => {
    const cat = String(r.payload.resolution_type ?? r.payload.category ?? 'unknown');
    damageCounts[cat] = (damageCounts[cat] ?? 0) + 1;
  });
  const topDamageCategory = Object.keys(damageCounts).length > 0
    ? Object.entries(damageCounts).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return { avgShiftHours, qcPassRate, topDamageCategory, sampleSize: rows.length, shopSizeFilter: shopSize };
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { crew, needs, damage, messages, builds, logs } = await req.json() as {
    crew: CrewRow[]; needs: NeedRow[]; damage: DamageRow[];
    messages: MsgRow[]; builds: BuildRow[]; logs: LogRow[];
    tenantId?: string;
  };

  // Determine shop size for benchmark comparison
  const n = crew.length;
  const shopSize = n <= 5 ? 'small' : n <= 15 ? 'medium' : 'large';
  const benchmarks = await fetchBenchmarks(shopSize);

  const todayStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const activeBuilds = builds.filter((b) => !b.clock_out);

  const prompt = `You are an AI assistant for a woodworking/cabinet shop supervisor. Analyze the following real-time shop data and provide a morning brief with actionable insights.

Today is ${todayStr}.

CREW CLOCKED IN (${crew.length} workers):
${crew.length === 0
  ? 'No crew clocked in.'
  : crew.map((c) => `- ${c.worker_name} (${c.dept}) clocked in at ${new Date(c.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`).join('\n')}

OPEN INVENTORY NEEDS (${needs.length}):
${needs.length === 0
  ? 'None.'
  : needs.map((n) => `- ${n.item}${n.dept ? ` [${n.dept}]` : ''}${n.qty ? ` × ${n.qty}` : ''} — ${n.status ?? 'pending'}`).join('\n')}

OPEN DAMAGE REPORTS (${damage.length}):
${damage.length === 0
  ? 'None.'
  : damage.map((d) => `- ${d.part_name}${d.dept ? ` [${d.dept}]` : ''}: ${d.notes ?? 'No details'} — ${d.status ?? 'open'}`).join('\n')}

MESSAGES LAST 24H (${messages.length}):
${messages.length === 0
  ? 'None.'
  : messages.slice(0, 12).map((m) => `- ${m.sender_name}${m.dept ? ` (${m.dept})` : ''}: "${m.body}"`).join('\n')}

CRAFTSMAN ACTIVE BUILDS (${activeBuilds.length}):
${activeBuilds.length === 0
  ? 'None.'
  : activeBuilds.map((b) => `- ${b.worker_name}: ${b.notes ?? 'No description'} (started ${new Date(b.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })})`).join('\n')}

SUPERVISOR DAILY LOGS (last 7 days):
${logs.length === 0
  ? 'No logs yet.'
  : logs.slice(0, 7).map((l) => {
      const r = l.responses;
      const parts = [
        `${l.date}: Production ${r.production_rating ?? '?'}/5`,
        r.crew_issues ? `Crew: ${r.crew_issues}` : null,
        r.biggest_challenge ? `Challenge: ${r.biggest_challenge}` : null,
        r.time_variance ? `Time variance: ${r.time_variance}` : null,
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    }).join('\n')}

INDUSTRY BENCHMARKS (last 30 days, ${shopSize} shops — ${benchmarks.sampleSize} data points):
${benchmarks.sampleSize === 0
  ? 'No benchmark data available yet — as more shops opt in to data sharing, comparisons will appear here.'
  : [
      benchmarks.avgShiftHours !== null ? `- Platform avg shift: ${benchmarks.avgShiftHours}h` : null,
      benchmarks.qcPassRate    !== null ? `- Platform QC pass rate: ${benchmarks.qcPassRate}%` : null,
      benchmarks.topDamageCategory     ? `- Most common damage type: ${benchmarks.topDamageCategory}` : null,
    ].filter(Boolean).join('\n')}

${benchmarks.sampleSize > 0 ? `When benchmarks are available, include 1–2 insights comparing this shop to platform averages. Highlight if they are above or below average and why it might matter for a cabinet shop.` : ''}

Generate a morning brief with 4–8 insights. Respond ONLY with valid JSON matching this exact format — no extra text:
{
  "insights": [
    {
      "type": "alert",
      "title": "Short title under 60 chars",
      "detail": "Actionable 1–2 sentence detail referencing real data."
    }
  ]
}

Rules:
- "alert" = urgent, needs immediate attention today
- "watch" = worth monitoring, may need action soon
- "info"  = positive observation or FYI

Be specific: use actual names, departments, and numbers from the data. If there are no issues, say so with info cards. Always produce at least 3 insights.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: errText }, { status: res.status });
    }

    const data = await res.json() as { content: { type: string; text: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return NextResponse.json({ error: 'Unexpected response format', raw: text }, { status: 500 });
    }

    const parsed = JSON.parse(match[0]) as { insights: unknown[] };
    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
