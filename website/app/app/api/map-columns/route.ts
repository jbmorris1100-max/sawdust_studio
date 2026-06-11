import { NextResponse } from 'next/server';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a cabinet shop data mapper. Given CSV headers and sample rows from a cabinet cutlist, map each column to these fields:
- cabinet_unit_id (cabinet/unit identifier)
- part_name (name of the part)
- room (room or location)
- material (material type)
- width (numeric width)
- height (numeric height)
- depth (numeric depth)
Return ONLY a JSON object like:
{
  cabinet_unit_id: 'Cabinet Number',
  part_name: 'Part Name',
  room: 'Room',
  material: 'Material',
  width: 'Width',
  height: 'Height',
  depth: 'Depth'
}
Use null for any field you cannot confidently map.
Never guess — only map when confident.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });
  }

  const { headers, sampleRows } = await req.json() as {
    headers: string[];
    sampleRows: Record<string, string>[];
  };

  const userMessage =
    `Headers: ${headers.join(', ')}\n` +
    `Sample rows: ${JSON.stringify((sampleRows ?? []).slice(0, 3))}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
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

    const parsed = JSON.parse(match[0]) as Record<string, string | null>;
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[map-columns]', err);
    return NextResponse.json({ error: 'Column mapping failed. Please try again.' }, { status: 500 });
  }
}
