/* ============================================================================
 * Part 3 — AI Parsing Layer  (parse-file)
 * ----------------------------------------------------------------------------
 * One endpoint, several modes. The AI handles all file interpretation; the user
 * never maps columns manually after the first successful upload of a format.
 *
 *   mode 'csv'          → map CSV headers → cabinet fields (checks shop memory)
 *   mode 'save-mapping' → persist a successful mapping to tenant.file_formats
 *   mode 'pdf'          → extract cabinets/parts from PDF first-page text
 *   mode 'image'        → extract cabinets/parts from a photo (vision)
 *
 * NOTE: lives under app/app/api/ to match the existing route tree. The original
 * spec path was website/app/api/parse-file — adjusted to the real structure.
 * ========================================================================== */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'claude-sonnet-4-6';
const API_URL = 'https://api.anthropic.com/v1/messages';

type Field = 'cabinet_unit_id' | 'part_name' | 'room' | 'material' | 'width' | 'height' | 'depth' | 'quantity' | 'notes';
type Mapping = Partial<Record<Field, string | null>>;

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/** Stable key for a header set so identical formats reuse the same mapping. */
function headersKey(headers: string[]): string {
  const norm = headers.map((h) => h.trim().toLowerCase()).sort().join('|');
  let h = 0;
  for (let i = 0; i < norm.length; i++) { h = (Math.imul(31, h) + norm.charCodeAt(i)) | 0; }
  return 'custom_' + (h >>> 0).toString(16);
}

/** Does a stored mapping's source columns all exist in the uploaded headers? */
function mappingMatches(mapping: Mapping, headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  const required = [mapping.cabinet_unit_id, mapping.part_name].filter(Boolean) as string[];
  if (required.length < 1) return false;
  return required.every((col) => set.has(col.trim().toLowerCase()));
}

async function callClaude(system: string, content: unknown, maxTokens = 1500, apiKey?: string) {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      'x-api-key': apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { content: { type: string; text: string }[] };
  return data.content?.find((c) => c.type === 'text')?.text ?? '';
}

function extractJson<T>(text: string): T | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as T; } catch { return null; }
}

/* ---- mode handlers ------------------------------------------------------- */
const CSV_SYSTEM =
  `You are a cabinet shop data expert. Map CSV columns to cabinet fields. ` +
  `Return ONLY valid JSON, no markdown, no explanation.\n` +
  `Required fields: cabinet_unit_id, part_name\n` +
  `Optional: room, material, width, height, depth, quantity, notes\n` +
  `Return null for fields you cannot map confidently.`;

const EXTRACT_SYSTEM =
  `You are a cabinet shop data expert. Extract cabinet and parts data from this plan description. ` +
  `Return JSON with this shape or null if you cannot extract:\n` +
  `{ "cabinets": [{ "id": string, "name": string, "room": string, ` +
  `"parts": [{ "name": string, "width": number, "height": number, "depth": number, ` +
  `"material": string, "quantity": number }] }] }`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const payload = await req.json().catch(() => ({})) as Record<string, unknown>;
  const mode = String(payload.mode ?? 'csv');

  try {
    /* ── save a confirmed mapping ─────────────────────────────────────── */
    if (mode === 'save-mapping') {
      const db = admin();
      if (!db) return NextResponse.json({ error: 'service role not configured' }, { status: 500 });
      const tenantId = String(payload.tenantId ?? '');
      const mapping = payload.mapping as Mapping;
      const headers = (payload.headers as string[]) ?? [];
      const key = String(payload.source || (payload.key as string) || headersKey(headers));
      if (!tenantId || !mapping) return NextResponse.json({ error: 'tenantId and mapping required' }, { status: 400 });

      const { data: tenant } = await db.from('tenants').select('file_formats').eq('id', tenantId).single();
      const formats = (tenant?.file_formats as Record<string, Mapping>) ?? {};
      formats[key] = mapping;
      const { error } = await db.from('tenants').update({ file_formats: formats }).eq('id', tenantId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ saved: true, key });
    }

    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

    /* ── CSV column mapping (checks shop memory first) ────────────────── */
    if (mode === 'csv') {
      const headers = (payload.headers as string[]) ?? [];
      const sampleRows = (payload.sampleRows as Record<string, string>[]) ?? [];
      const tenantId = payload.tenantId ? String(payload.tenantId) : null;

      // STEP 1 — shop memory
      if (tenantId) {
        const db = admin();
        if (db) {
          const { data: tenant } = await db.from('tenants').select('file_formats').eq('id', tenantId).single();
          const formats = (tenant?.file_formats as Record<string, Mapping>) ?? {};
          for (const [key, mapping] of Object.entries(formats)) {
            if (mappingMatches(mapping, headers)) {
              return NextResponse.json({ mapping, fromMemory: true, source: key });
            }
          }
        }
      }

      // STEP 2 — ask Claude
      const user =
        `Source: ${payload.source ? String(payload.source) : 'unknown'}\n` +
        `Headers: ${headers.join(', ')}\n` +
        `Sample rows: ${JSON.stringify(sampleRows.slice(0, 5))}`;
      const text = await callClaude(CSV_SYSTEM, user, 300, apiKey);
      const mapping = extractJson<Mapping>(text);
      if (!mapping) return NextResponse.json({ error: 'Unexpected response format', raw: text }, { status: 502 });
      return NextResponse.json({ mapping, fromMemory: false, suggestedKey: payload.source ? String(payload.source) : headersKey(headers) });
    }

    /* ── PDF extraction (first-page text) ─────────────────────────────── */
    if (mode === 'pdf') {
      const user =
        `This PDF is named ${String(payload.fileName ?? 'unknown')} for job ` +
        `${String(payload.jobPath ?? 'unknown')}. Page count: ${Number(payload.pageCount ?? 0)}.\n` +
        `First page text content: ${String(payload.firstPageText ?? '').slice(0, 6000)}`;
      const text = await callClaude(EXTRACT_SYSTEM, user, 2000, apiKey);
      const extracted = extractJson<{ cabinets?: unknown[] }>(text);
      return NextResponse.json({ extracted: extracted?.cabinets?.length ? extracted : null });
    }

    /* ── Image extraction (vision) ────────────────────────────────────── */
    if (mode === 'image') {
      const imageUrl = String(payload.imageUrl ?? '');
      if (!imageUrl) return NextResponse.json({ error: 'imageUrl required' }, { status: 400 });
      const content = [
        { type: 'image', source: { type: 'url', url: imageUrl } },
        { type: 'text', text: `This image is named ${String(payload.fileName ?? 'unknown')} for job ${String(payload.jobPath ?? 'unknown')}. Extract any visible cabinet numbers, part names, and dimensions.` },
      ];
      const text = await callClaude(EXTRACT_SYSTEM, content, 2000, apiKey);
      const extracted = extractJson<{ cabinets?: unknown[] }>(text);
      return NextResponse.json({ extracted: extracted?.cabinets?.length ? extracted : null });
    }

    return NextResponse.json({ error: `unknown mode: ${mode}` }, { status: 400 });
  } catch (err) {
    console.error('[parse-file]', err);
    return NextResponse.json({ error: 'File processing failed. Please try again.' }, { status: 500 });
  }
}
