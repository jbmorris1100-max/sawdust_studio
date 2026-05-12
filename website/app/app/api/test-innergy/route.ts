import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json() as { apiKey?: string; subdomain?: string };
  const { apiKey, subdomain } = body;

  if (!apiKey || !subdomain) {
    return NextResponse.json({ error: 'API key and subdomain are required' }, { status: 400 });
  }

  const cleanSub = subdomain.trim().replace(/^https?:\/\//, '').split('.')[0];
  const url = `https://${cleanSub}.innergy.com/api/v1/jobs?limit=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return NextResponse.json({ success: true, message: 'Connected to Innergy — credentials valid ✓' });
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: 'Authentication failed — check your API key' }, { status: 401 });
    }
    if (res.status === 404) {
      return NextResponse.json({ error: `Subdomain "${cleanSub}" not found — check your Innergy URL` }, { status: 404 });
    }
    return NextResponse.json({ error: `Innergy returned HTTP ${res.status}` }, { status: 400 });
  } catch (err: unknown) {
    const isDns = err instanceof Error && err.message.toLowerCase().includes('fetch');
    const msg = isDns
      ? `Could not reach ${cleanSub}.innergy.com — check your subdomain`
      : (err instanceof Error ? err.message : 'Connection failed');
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
