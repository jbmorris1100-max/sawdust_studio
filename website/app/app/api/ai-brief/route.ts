import { NextResponse } from 'next/server';

const MODEL = 'claude-sonnet-4-6';

type CrewRow    = { worker_name: string; dept: string; clock_in: string };
type NeedRow    = { item: string; dept: string | null; qty: number | null; status: string | null };
type DamageRow  = { part_name: string; dept: string | null; notes: string | null; status: string | null };
type MsgRow     = { sender_name: string; dept: string | null; body: string };
type BuildRow   = { worker_name: string; notes: string | null; clock_in: string; clock_out: string | null };
type LogRow     = { date: string; responses: Record<string, string> };

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { crew, needs, damage, messages, builds, logs } = await req.json() as {
    crew: CrewRow[]; needs: NeedRow[]; damage: DamageRow[];
    messages: MsgRow[]; builds: BuildRow[]; logs: LogRow[];
  };

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
