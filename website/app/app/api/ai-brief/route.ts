import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'claude-sonnet-4-6';

type CrewRow    = { worker_name: string; dept: string; clock_in: string };
type NeedRow    = { item: string; dept: string | null; qty: number | null; status: string | null };
type DamageRow  = { part_name: string; dept: string | null; notes: string | null; status: string | null; created_at?: string | null };
type MsgRow     = { sender_name: string; dept: string | null; body: string };
type BuildRow   = { worker_name: string; notes: string | null; clock_in: string; clock_out: string | null };
type LogRow     = { date: string; responses: Record<string, string> };

type AnalyticsRow = { event_type: string; payload: Record<string, unknown>; shop_size: string | null };

interface Benchmarks {
  avgShiftHours: number | null;
  qcPassRate: number | null;
  topDamageCategory: string | null;
  sampleSize: number;
  shopSizeFilter: string | null;
}

/* ── Production pipeline context (fetched server-side via service role) ───── */
type JobPipeline = {
  job: string;            // job_path or job_name
  dueDate: string | null;
  installDate: string | null;
  status: string | null;
  cabinetsTotal: number;
  cabinetsCut: number;
  cabinetsInAssembly: number;
  cabinetsComplete: number;
  partsTotal: number;
  partsCut: number;
  daysToDue: number | null;
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchPipeline(tenantId: string | undefined): Promise<JobPipeline[]> {
  if (!tenantId) return [];
  const db = admin();
  if (!db) return [];
  try {
    const { data: jobs } = await db.from('jobs')
      .select('job_number, job_name, job_path, status, due_date, install_date')
      .eq('tenant_id', tenantId).eq('status', 'active').limit(100);
    if (!jobs || jobs.length === 0) return [];

    const { data: cabs } = await db.from('cabinet_units')
      .select('id, job_number, status, production_status').eq('tenant_id', tenantId).limit(2000);
    const { data: parts } = await db.from('parts')
      .select('cabinet_unit_id, job_number, production_status, status').eq('tenant_id', tenantId).limit(20000);

    const now = Date.now();
    const cut = (s: string | null | undefined) => s === 'cut' || s === 'qa_passed' || s === 'in_assembly' || s === 'complete';
    return jobs.map((j) => {
      const jc = (cabs ?? []).filter((c) => c.job_number === j.job_number);
      const jp = (parts ?? []).filter((p) => p.job_number === j.job_number);
      const daysToDue = j.due_date ? Math.ceil((new Date(j.due_date).getTime() - now) / 86400000) : null;
      return {
        job: j.job_path || j.job_name || j.job_number || 'Unnamed',
        dueDate: j.due_date ?? null,
        installDate: j.install_date ?? null,
        status: j.status ?? null,
        cabinetsTotal: jc.length,
        cabinetsCut: jc.filter((c) => cut(c.production_status)).length,
        cabinetsInAssembly: jc.filter((c) => c.production_status === 'in_assembly' || c.status === 'in_assembly').length,
        cabinetsComplete: jc.filter((c) => c.production_status === 'complete' || c.status === 'complete').length,
        partsTotal: jp.length,
        partsCut: jp.filter((p) => cut(p.production_status)).length,
        daysToDue,
      };
    });
  } catch {
    return []; // migration may not be applied yet — degrade gracefully
  }
}

async function fetchBenchmarks(shopSize: string | null): Promise<Benchmarks> {
  const db = admin();
  if (!db) return { avgShiftHours: null, qcPassRate: null, topDamageCategory: null, sampleSize: 0, shopSizeFilter: shopSize };
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
  const avgShiftHours = shiftHours.length > 0 ? Math.round((shiftHours.reduce((a, b) => a + b, 0) / shiftHours.length) * 10) / 10 : null;
  const qcPasses = qcs.filter((r) => r.payload.result === 'pass').length;
  const qcPassRate = qcs.length > 0 ? Math.round((qcPasses / qcs.length) * 100) : null;
  const damageCounts: Record<string, number> = {};
  damages.forEach((r) => { const cat = String(r.payload.resolution_type ?? r.payload.category ?? 'unknown'); damageCounts[cat] = (damageCounts[cat] ?? 0) + 1; });
  const topDamageCategory = Object.keys(damageCounts).length > 0 ? Object.entries(damageCounts).sort((a, b) => b[1] - a[1])[0][0] : null;

  return { avgShiftHours, qcPassRate, topDamageCategory, sampleSize: rows.length, shopSizeFilter: shopSize };
}

/* ── Structured brief → flat insight cards (keeps existing UI working) ────── */
type RichBrief = {
  priority_alerts?: { level?: string; title?: string; detail?: string; action?: string }[];
  job_risks?: { job?: string; risk?: string; recommendation?: string }[];
  crew_insights?: { insight?: string }[];
  wins?: { win?: string }[];
  suggested_focus?: string;
};
type Card = { type: 'alert' | 'watch' | 'info'; title: string; detail: string };

function toCards(b: RichBrief): Card[] {
  const cards: Card[] = [];
  for (const a of b.priority_alerts ?? []) {
    const type: Card['type'] = a.level === 'urgent' ? 'alert' : a.level === 'warning' ? 'watch' : 'info';
    cards.push({ type, title: a.title ?? 'Alert', detail: [a.detail, a.action ? `→ ${a.action}` : null].filter(Boolean).join(' ') });
  }
  for (const r of b.job_risks ?? []) {
    cards.push({ type: 'watch', title: `Risk: ${r.job ?? 'Job'}`, detail: [r.risk, r.recommendation ? `→ ${r.recommendation}` : null].filter(Boolean).join(' ') });
  }
  for (const c of b.crew_insights ?? []) {
    if (c.insight) cards.push({ type: 'info', title: 'Crew insight', detail: c.insight });
  }
  for (const w of b.wins ?? []) {
    if (w.win) cards.push({ type: 'info', title: 'Win', detail: w.win });
  }
  if (b.suggested_focus) cards.push({ type: 'info', title: "Today's focus", detail: b.suggested_focus });
  return cards;
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

  const { crew, needs, damage, messages, builds, logs, tenantId } = await req.json() as {
    crew: CrewRow[]; needs: NeedRow[]; damage: DamageRow[];
    messages: MsgRow[]; builds: BuildRow[]; logs: LogRow[]; tenantId?: string;
  };

  const n = crew.length;
  const shopSize = n <= 5 ? 'small' : n <= 15 ? 'medium' : 'large';
  const [benchmarks, pipeline] = await Promise.all([fetchBenchmarks(shopSize), fetchPipeline(tenantId)]);

  const todayStr = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const activeBuilds = builds.filter((b) => !b.clock_out);
  const ageDays = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null);

  const pipelineText = pipeline.length === 0
    ? 'No active jobs with production data (run job_path + production_handoff migrations to enable).'
    : pipeline.map((p) => {
        const due = p.daysToDue != null ? (p.daysToDue < 0 ? `OVERDUE by ${-p.daysToDue}d` : `due in ${p.daysToDue}d`) : 'no due date';
        return `- ${p.job} (${due}): ${p.cabinetsCut}/${p.cabinetsTotal} cabinets cut, ${p.cabinetsInAssembly} in assembly, ${p.cabinetsComplete} complete · ${p.partsCut}/${p.partsTotal} parts cut`;
      }).join('\n');

  const system = `You are an expert shop floor operations manager for a high-end cabinet shop. Analyze the data provided and generate a morning brief.

Be specific and actionable. Reference real job names, real numbers, real crew members. Never be generic.

Format your response as JSON ONLY (no markdown, no prose):
{
  "priority_alerts": [{ "level": "urgent|warning|info", "title": string, "detail": string, "action": string }],
  "job_risks": [{ "job": string, "risk": string, "recommendation": string }],
  "crew_insights": [{ "insight": string }],
  "wins": [{ "win": string }],
  "suggested_focus": string
}

Priority alerts should include: jobs at risk of missing deadlines; damage reports unresolved 48+ hours; cabinets stuck in production too long; crew departments with no activity; repeated damage on same part type.
Job risks should flag: jobs where cut rate won't meet ship date; jobs with flagged cabinets blocking assembly; jobs with pending inventory items.
Wins should celebrate: cabinets completed ahead of schedule; crew with 100% productive shifts; jobs moving faster than average.
Always return at least 3 priority_alerts (use level "info" when things are healthy) and a suggested_focus.`;

  const prompt = `Today is ${todayStr}.

PRODUCTION PIPELINE (active jobs):
${pipelineText}

CREW CLOCKED IN (${crew.length}):
${crew.length === 0 ? 'No crew clocked in.' : crew.map((c) => `- ${c.worker_name} (${c.dept}) @ ${new Date(c.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`).join('\n')}

OPEN INVENTORY NEEDS (${needs.length}):
${needs.length === 0 ? 'None.' : needs.map((x) => `- ${x.item}${x.dept ? ` [${x.dept}]` : ''}${x.qty ? ` ×${x.qty}` : ''} — ${x.status ?? 'pending'}`).join('\n')}

OPEN DAMAGE REPORTS (${damage.length}):
${damage.length === 0 ? 'None.' : damage.map((d) => { const a = ageDays(d.created_at); return `- ${d.part_name}${d.dept ? ` [${d.dept}]` : ''}${a != null ? ` (${a}d old)` : ''}: ${d.notes ?? 'No details'} — ${d.status ?? 'open'}`; }).join('\n')}

MESSAGES LAST 24H (${messages.length}):
${messages.length === 0 ? 'None.' : messages.slice(0, 12).map((m) => `- ${m.sender_name}${m.dept ? ` (${m.dept})` : ''}: "${m.body}"`).join('\n')}

CRAFTSMAN ACTIVE BUILDS (${activeBuilds.length}):
${activeBuilds.length === 0 ? 'None.' : activeBuilds.map((b) => `- ${b.worker_name}: ${b.notes ?? 'No description'}`).join('\n')}

SUPERVISOR DAILY LOGS (last 7 days):
${logs.length === 0 ? 'No logs yet.' : logs.slice(0, 7).map((l) => { const r = l.responses; return `- ${l.date}: Production ${r.production_rating ?? '?'}/5${r.crew_issues ? ` | Crew: ${r.crew_issues}` : ''}${r.biggest_challenge ? ` | Challenge: ${r.biggest_challenge}` : ''}`; }).join('\n')}

INDUSTRY BENCHMARKS (last 30 days, ${shopSize} shops — ${benchmarks.sampleSize} points):
${benchmarks.sampleSize === 0 ? 'No benchmark data yet.' : [
  benchmarks.avgShiftHours !== null ? `- Platform avg shift: ${benchmarks.avgShiftHours}h` : null,
  benchmarks.qcPassRate    !== null ? `- Platform QC pass rate: ${benchmarks.qcPassRate}%` : null,
  benchmarks.topDamageCategory     ? `- Most common damage type: ${benchmarks.topDamageCategory}` : null,
].filter(Boolean).join('\n')}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1600,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });

    const data = await res.json() as { content: { type: string; text: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return NextResponse.json({ error: 'Unexpected response format', raw: text }, { status: 502 });

    const rich = JSON.parse(match[0]) as RichBrief;
    // Return both: flat `insights` for the current UI + the rich structure for richer cards.
    return NextResponse.json({ insights: toCards(rich), brief: rich });
  } catch (err) {
    console.error('[ai-brief]', err);
    return NextResponse.json({ error: 'Brief generation failed. Please try again.' }, { status: 500 });
  }
}
