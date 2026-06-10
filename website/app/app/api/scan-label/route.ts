import { NextResponse } from 'next/server';

// ── Claude Vision label reader ────────────────────────────────────────────────
// POST { imageBase64 } — a base64 JPEG frame captured from the crew device's
// camera. Sends it to Claude Vision and returns the handwritten cabinet label
// exactly as written ({ label }), or "UNREADABLE" when no label can be read.
// The Anthropic key never leaves the server; the client posts here instead of
// calling the Anthropic API directly.

const MODEL = 'claude-sonnet-4-20250514';

const PROMPT = `This image shows a handwritten cabinet label on a piece of wood or tape in a cabinet shop.
Extract the cabinet label exactly as written. Cabinet labels follow patterns like:
K01-SinkBase36, L01-Upper36, MB01-Vanity60, CT04-BathTop, FS01-FloatShelf48, K04-Pantry2496
The label has a prefix (letters), a number, a dash, then a description.
Return ONLY the label text, nothing else. If you cannot read a label, return "UNREADABLE".`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

  let body: { imageBase64?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Accept either a raw base64 string or a full data: URL.
  const imageBase64 = (body.imageBase64 ?? '').replace(/^data:image\/\w+;base64,/, '').trim();
  if (!imageBase64) return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const label = (data.content?.find((c) => c.type === 'text')?.text ?? '').trim();
    if (!label) return NextResponse.json({ error: 'Empty response from vision model' }, { status: 502 });
    return NextResponse.json({ label });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
