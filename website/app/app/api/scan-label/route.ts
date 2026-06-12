import { NextResponse } from 'next/server';

// ── Claude Vision label reader ────────────────────────────────────────────────
// POST { imageBase64 } — a base64 JPEG frame captured from the crew device's
// camera. Sends it to Claude Vision and returns the handwritten cabinet label
// exactly as written ({ label }), or "UNREADABLE" when no label can be read.
// The Anthropic key never leaves the server; the client posts here instead of
// calling the Anthropic API directly.

const MODEL = 'claude-sonnet-4-6';

const PROMPT = `This image shows a handwritten or printed cabinet label in a cabinet shop.
Extract ALL visible text from the label exactly as written. Do not interpret, reformat, or correct it.
Cabinet shops use many labeling conventions depending on their software:
- Some use job prefix + cabinet ID: "AND K02", "SMI B04", "PEG K1C2"
- Some use Mozaik format: "R1C2" (Room 1 Cabinet 2), "R2C14"
- Some use Cabinet Vision or custom codes: "K02-Base24", "L01-Upper36"
- Some write just a cabinet number: "K02", "B04", "14"
- Some include job name abbreviations before the cabinet code
Return ONLY the exact text visible on the label, preserving spaces, capitalization, and all characters.
If the image contains no readable text at all, return "UNREADABLE".
Never return "UNREADABLE" just because the format looks unusual — extract whatever text is visible.`;

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
      signal: AbortSignal.timeout(15000),
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
    console.error('[scan-label]', err);
    return NextResponse.json({ error: 'Label scan failed. Please try again.' }, { status: 500 });
  }
}
