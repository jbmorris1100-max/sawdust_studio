import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── AI cabinet-unit classifier ───────────────────────────────────────────────
// POST { tenantId, jobNumber }
// After a CSV cut list is parsed into cabinet_units + parts, this route decides
// which units are CRAFTSMAN builds (custom skilled pieces) vs STANDARD builds
// (normal box construction → production/assembly) and writes cabinet_units.assigned_dept.
//
// Order of operations:
//   1. Check learned patterns (craftsman_classifications). times_confirmed >= 3
//      → auto-assign without an AI call. < 3 → passed to the AI as a hint.
//   2. Claude classifies the remaining units.
//   3. Apply by confidence: >=85 auto, 70-84 assign (review), <70 default standard.
//   4. Upsert learned patterns so the shop gets smarter on every upload.
//
// Fire-and-forget from the upload flow — never blocks the upload.

const MODEL = 'claude-sonnet-4-20250514';
const AUTO_CONFIRM_THRESHOLD = 3;   // learned-pattern confidence floor for AI-free assignment
const HIGH_CONFIDENCE = 85;
const REVIEW_CONFIDENCE = 70;

type DbPart = {
  id: string;
  cabinet_unit_id: string;
  part_name: string;
  material: string | null;
  width: number | null;
  height: number | null;
};

type DbUnit = { id: string; unit_label: string };

type Classification = { dept: 'craftsman' | 'production'; reason: string };

type AiItem = {
  unit_id: string;
  classification: 'craftsman' | 'standard';
  confidence: number;
  reasoning: string;
};

type LearnedPattern = {
  unit_label_pattern: string;
  assigned_dept: string;
  times_confirmed: number;
};

// Keywords that reliably indicate a custom craftsman build. Used both to extract
// a reusable learned pattern from a label and as a cheap pre-AI hint.
const CRAFTSMAN_KEYWORDS = [
  'countertop', 'counter top', 'butcher block', 'slab', 'floating shelf', 'float shelf',
  'vent hood', 'range hood', 'hood', 'wine rack', 'mantle', 'mantel', 'fireplace',
  'surround', 'bench seat', 'window seat', 'bench', 'corbel', 'waterfall', 'display',
  'custom', 'trim', 'panel slab',
];

function admin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// Extract a short, reusable learned-pattern keyword from a unit label.
// Prefers a known craftsman keyword; falls back to the longest alpha word.
function patternFromLabel(label: string): string {
  const lower = label.toLowerCase();
  for (const kw of CRAFTSMAN_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3);
  return words.sort((a, b) => b.length - a.length)[0] ?? lower.trim().slice(0, 40);
}

export async function POST(req: Request) {
  const db = admin();
  if (!db) return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });

  let body: { tenantId?: string; jobNumber?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { tenantId, jobNumber } = body;
  if (!tenantId || !jobNumber) {
    return NextResponse.json({ error: 'tenantId and jobNumber required' }, { status: 400 });
  }

  // ── Load the job's units + parts and the tenant's learned patterns ──────────
  let units: DbUnit[] = [];
  let parts: DbPart[] = [];
  let learned: LearnedPattern[] = [];
  try {
    const [unitsRes, learnedRes] = await Promise.all([
      db.from('cabinet_units').select('id, unit_label').eq('tenant_id', tenantId).eq('job_number', jobNumber),
      db.from('craftsman_classifications').select('unit_label_pattern, assigned_dept, times_confirmed').eq('tenant_id', tenantId),
    ]);
    units = (unitsRes.data as DbUnit[] | null) ?? [];
    learned = (learnedRes.data as LearnedPattern[] | null) ?? [];
    if (units.length > 0) {
      const ids = units.map((u) => u.id);
      const { data: partsData } = await db
        .from('parts')
        .select('id, cabinet_unit_id, part_name, material, width, height')
        .in('cabinet_unit_id', ids);
      parts = (partsData as DbPart[] | null) ?? [];
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
  if (units.length === 0) return NextResponse.json({ classified: 0, note: 'No units for job' });

  const partsByUnit = new Map<string, DbPart[]>();
  for (const p of parts) {
    const arr = partsByUnit.get(p.cabinet_unit_id) ?? [];
    arr.push(p);
    partsByUnit.set(p.cabinet_unit_id, arr);
  }

  // ── STEP 1 — learned-pattern pass ───────────────────────────────────────────
  const decided = new Map<string, Classification>();
  const hints = new Map<string, string>(); // unit_id → "matched 'shelf' → craftsman (2x)"
  const remaining: DbUnit[] = [];

  for (const unit of units) {
    const lower = unit.unit_label.toLowerCase();
    // Strongest matching learned pattern (highest times_confirmed).
    let best: LearnedPattern | null = null;
    for (const lp of learned) {
      if (lp.unit_label_pattern && lower.includes(lp.unit_label_pattern.toLowerCase())) {
        if (!best || lp.times_confirmed > best.times_confirmed) best = lp;
      }
    }
    if (best && best.times_confirmed >= AUTO_CONFIRM_THRESHOLD) {
      const dept = best.assigned_dept === 'craftsman' ? 'craftsman' : 'production';
      decided.set(unit.id, { dept, reason: `Learned pattern "${best.unit_label_pattern}" (${best.times_confirmed}× confirmed)` });
    } else {
      if (best) hints.set(unit.id, `prior: "${best.unit_label_pattern}" → ${best.assigned_dept} (${best.times_confirmed}×)`);
      remaining.push(unit);
    }
  }

  // ── STEP 2 — AI classification for the remaining units ──────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (remaining.length > 0 && apiKey) {
    const SYSTEM = `You are a cabinet shop production expert. Classify each cabinet unit as either 'craftsman' or 'standard' based on its label and parts.

CRAFTSMAN builds are custom pieces requiring skilled woodworking beyond standard cabinet box construction:
- Countertops (butcher block, solid wood slabs)
- Floating shelves
- Vent hoods / range hoods
- Wine racks
- Mantles / fireplace surrounds
- Bench seats / window seats
- Specialty display units
- Corbels / decorative trim
- Waterfall edges
- Any single-slab piece
- Anything with 'custom' in the label

STANDARD builds go to normal production/assembly:
- Base cabinets
- Wall cabinets
- Tall cabinets / pantries
- Drawer bases
- Standard shelves (cut plywood pieces)
- Vanity bases
- Any box construction with sides/bottom/back

For each unit return classification and confidence (0-100).
Return ONLY a valid JSON array:
[{"unit_id": string, "classification": "craftsman" | "standard", "confidence": number, "reasoning": string}]`;

    const learnedSummary = learned.length
      ? learned.map((l) => `- "${l.unit_label_pattern}" → ${l.assigned_dept} (${l.times_confirmed}× confirmed)`).join('\n')
      : '(none yet)';

    const unitsPayload = remaining.map((u) => ({
      unit_id: u.id,
      unit_label: u.unit_label,
      hint: hints.get(u.id) ?? undefined,
      parts: (partsByUnit.get(u.id) ?? []).slice(0, 30).map((p) => ({
        part_name: p.part_name,
        material: p.material,
        width: p.width,
        height: p.height,
      })),
    }));

    const userMessage = `Shop learned patterns:\n${learnedSummary}\n\nUnits to classify:\n${JSON.stringify(unitsPayload, null, 2)}`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 4096,
          system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { content: { type: string; text: string }[] };
        const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
        const m = text.match(/\[[\s\S]*\]/);
        if (m) {
          const items = JSON.parse(m[0]) as AiItem[];
          for (const item of items) {
            if (!item || !item.unit_id) continue;
            const conf = typeof item.confidence === 'number' ? item.confidence : 0;
            let dept: 'craftsman' | 'production';
            if (conf < REVIEW_CONFIDENCE) {
              dept = 'production'; // low confidence → safe default to standard
            } else {
              dept = item.classification === 'craftsman' ? 'craftsman' : 'production';
            }
            const tag = conf >= HIGH_CONFIDENCE ? '' : conf >= REVIEW_CONFIDENCE ? ' (review)' : ' (low-confidence default)';
            decided.set(item.unit_id, { dept, reason: `AI ${conf}%${tag}: ${item.reasoning ?? ''}`.trim() });
          }
        }
      }
    } catch {
      /* AI failed — units without a decision fall through to the keyword default below */
    }
  }

  // Any unit still undecided (no AI key, AI failure, or omitted from AI output):
  // fall back to a keyword check, else standard.
  for (const unit of remaining) {
    if (decided.has(unit.id)) continue;
    const lower = unit.unit_label.toLowerCase();
    const isCraft = CRAFTSMAN_KEYWORDS.some((kw) => lower.includes(kw));
    decided.set(unit.id, { dept: isCraft ? 'craftsman' : 'production', reason: isCraft ? 'Keyword match (no AI)' : 'Default standard' });
  }

  // ── STEP 3 — apply assignments ──────────────────────────────────────────────
  let classified = 0;
  for (const [unitId, c] of decided) {
    try {
      await db.from('cabinet_units').update({ assigned_dept: c.dept }).eq('id', unitId).eq('tenant_id', tenantId);
      classified++;
    } catch { /* skip this unit */ }
  }

  // ── STEP 4 — upsert learned patterns ────────────────────────────────────────
  // Aggregate (pattern, dept) → count across this batch, then merge into the table.
  const batch = new Map<string, { pattern: string; dept: string; count: number }>();
  for (const unit of units) {
    const c = decided.get(unit.id);
    if (!c) continue;
    const pattern = patternFromLabel(unit.unit_label);
    if (!pattern) continue;
    const key = `${pattern}::${c.dept}`;
    const cur = batch.get(key);
    if (cur) cur.count++;
    else batch.set(key, { pattern, dept: c.dept, count: 1 });
  }
  for (const { pattern, dept, count } of batch.values()) {
    try {
      const { data: existing } = await db
        .from('craftsman_classifications')
        .select('id, times_confirmed')
        .eq('tenant_id', tenantId)
        .eq('unit_label_pattern', pattern)
        .eq('assigned_dept', dept)
        .is('part_name_pattern', null)
        .maybeSingle();
      if (existing) {
        await db.from('craftsman_classifications')
          .update({ times_confirmed: ((existing as { times_confirmed: number }).times_confirmed ?? 0) + count, updated_at: new Date().toISOString() })
          .eq('id', (existing as { id: string }).id);
      } else {
        await db.from('craftsman_classifications').insert({
          tenant_id: tenantId,
          unit_label_pattern: pattern,
          assigned_dept: dept,
          times_confirmed: count,
        });
      }
    } catch { /* learning is best-effort */ }
  }

  return NextResponse.json({ classified, total: units.length });
}
