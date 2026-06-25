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

async function callClaude(system: string, content: unknown, maxTokens = 1500, apiKey?: string, timeoutMs = 30000) {
  const res = await fetch(API_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
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

// Document-type classifier for an uploaded shop PDF. Tags the file into one of a
// fixed set of doc types so downstream steps know whether/how to parse it. The
// patterns below double as the few-shot examples (file-name → expected type).
const CLASSIFY_DOC_SYSTEM =
  `You are a cabinet shop document classifier. Given an uploaded shop PDF's file ` +
  `name and first-page text, classify it as EXACTLY ONE doc_type and give a ` +
  `one-line reason. Return ONLY valid JSON: {"doc_type": string, "reason": string}\n\n` +
  `doc_type must be one of:\n` +
  `- "cabinet_roster": a "cabinet list" — a structured TABLE with ONE ROW PER ` +
  `cabinet (columns like Room, Cabinet ID/#, Name, Width, Height, Depth), meant ` +
  `to be PARSED into cabinet records. It reads like a spreadsheet/list, not like ` +
  `a drawing. (example: "cabinet list")\n` +
  `  IMPORTANT — cabinet_roster vs reference: a plan / elevation / shop-drawing ` +
  `document is NOT a roster, even when its text contains cabinet-style dimension ` +
  `language (widths, heights, depths, cabinet numbers). Drawings are laid out as ` +
  `figures/elevations with callouts and scattered dimension labels — NOT as a ` +
  `clean one-row-per-cabinet table — and are meant for crew to VIEW as-is, not to ` +
  `extract rows from. Tag those "reference". Only tag "cabinet_roster" when the ` +
  `text is clearly a tabular list you could read row-by-row into cabinet_units. ` +
  `When in doubt between cabinet_roster and reference, choose "reference" and say ` +
  `in the reason that it is a drawing/plan, not a parseable roster table.\n` +
  `- "room_roster": a "room list" — maps each Room name to a cabinet-number range.\n` +
  `- "cut_list_primary": a per-sheet nest table where each ROW is ONE discrete ` +
  `physical part tied to ONE cabinet — columns like #, W x L, Name, Cab#, Room. ` +
  `(example: "nest"). This is the preferred parts source.\n` +
  `- "cut_list_aggregated": a cut list grouped by spec where quantity is aggregated ` +
  `across multiple cabinets in a single row (e.g. a "Cabinet (Qty): 21, 24, 27, 30" ` +
  `cell). (examples: "std cut list", "door list", "drawers", "moulding")\n` +
  `- "cut_list_detail": a richer detail report of the SAME physical items as an ` +
  `aggregated list — e.g. full door specs. (example: "door report", same doors as ` +
  `"door list")\n` +
  `- "reference": material/cost summaries, machine logs, visual diagrams/drawings, ` +
  `OR a duplicate of another doc — anything that should NOT be parsed for parts/` +
  `cabinets. (examples: "Mat sum", "sheet goods", "Planit_Optimize", "cnc", ` +
  `"cnc parts deco bottom rails", "nest parts deco bottom rails" (a visual diagram), ` +
  `"Assembly" (drawings), plan / elevation / shop drawings (e.g. a "...Prod..." or ` +
  `"...Ph 3..." cabinet plan set that shows cabinets as elevation figures with ` +
  `dimension callouts — view-only, NOT a roster table), and "labels" — a label ` +
  `sheet that duplicates the cabinet roster, so it is reference, NOT ` +
  `cabinet_roster, to avoid double-counting)\n` +
  `- "unparseable": the first page is blank/corrupt with no usable text — flag it, ` +
  `do NOT guess a content type.\n\n` +
  `Use the file name AND the actual text content together; the text wins when the ` +
  `name is ambiguous.`;

// Cabinet-roster extractor. Reads a 'cabinet_roster' PDF's text and returns one
// row per cabinet. Dimensions are decimal inches; null when not present.
const ROSTER_SYSTEM =
  `You are a cabinet shop data expert. The text below is a cabinet roster ` +
  `("cabinet list") — a Room → Cabinet table. Extract EVERY cabinet row. ` +
  `Return ONLY valid JSON: { "cabinets": [{ "room": string|null, ` +
  `"cabinet_id": string, "qty": number, "name": string|null, ` +
  `"width": number|null, "height": number|null, "depth": number|null, ` +
  `"lr": string|null }] }\n` +
  `Rules: cabinet_id is the cabinet number/identifier exactly as printed. qty ` +
  `defaults to 1 when not shown. width/height/depth are decimal inches (parse ` +
  `e.g. 30 1/2 → 30.5); use null if a dimension is absent. lr is the L-R / hand ` +
  `field if present, else null. Do not invent cabinets that are not in the text.`;

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

    /* ── Document classification (first-page text) ────────────────────── */
    // Read-only: tags an uploaded PDF as one of the known doc types. Creates no
    // parts/cabinets. Empty first-page text → 'unparseable' without an AI call.
    if (mode === 'classify-doc') {
      const fileName = String(payload.fileName ?? 'unknown');
      const firstPageText = String(payload.firstPageText ?? '').slice(0, 6000);
      if (!firstPageText.trim()) {
        return NextResponse.json({ doc_type: 'unparseable', reason: 'First page has no extractable text (blank/corrupt render).' });
      }
      const user = `File name: ${fileName}\n\nFirst-page text:\n${firstPageText}`;
      const text = await callClaude(CLASSIFY_DOC_SYSTEM, user, 200, apiKey);
      const parsed = extractJson<{ doc_type?: string; reason?: string }>(text);
      if (!parsed?.doc_type) {
        return NextResponse.json({ doc_type: 'unparseable', reason: 'Classifier returned no recognizable type.' });
      }
      return NextResponse.json({ doc_type: parsed.doc_type, reason: parsed.reason ?? '' });
    }

    /* ── Cabinet-roster extraction (text → cabinet rows) ──────────────── */
    // For PDFs tagged 'cabinet_roster'. Returns cabinet rows only; the caller
    // inserts cabinet_units (no parts here — cut-list explosion is a later phase).
    if (mode === 'extract-cabinet-roster') {
      const fileName = String(payload.fileName ?? 'unknown');
      const docText = String(payload.docText ?? payload.firstPageText ?? '').slice(0, 30000);
      if (!docText.trim()) return NextResponse.json({ cabinets: [] });
      const user = `File name: ${fileName}\n\nCabinet roster text:\n${docText}`;
      const text = await callClaude(ROSTER_SYSTEM, user, 8000, apiKey, 90000);
      const parsed = extractJson<{ cabinets?: unknown[] }>(text);
      return NextResponse.json({ cabinets: parsed?.cabinets ?? [] });
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
