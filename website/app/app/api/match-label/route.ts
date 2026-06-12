import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── AI label matcher ────────────────────────────────────────────────────────
// POST { tenantId, rawLabel, jobPath? }
// Looks up the candidate parts across the tenant's active (non-archived) jobs,
// asks Claude to identify which part the scanned/typed label refers to, and
// returns a best match + alternatives. label_mappings is checked on the client
// BEFORE this route is ever called (instant, no AI cost).

const MODEL = 'claude-sonnet-4-6';

type Candidate = {
  part_name: string;
  cabinet_label: string;
  cabinet_unit_id: string;
  job_number: string | null;
};

type AiMatch = {
  part_name: string;
  cabinet_unit_id: string;
  cabinet_label: string;
  confidence: number;
};

type AiResult = {
  match: AiMatch | null;
  alternatives: AiMatch[];
  reasoning: string;
};

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchCandidates(tenantId: string): Promise<Candidate[]> {
  const db = admin();
  if (!db) return [];
  try {
    // Active, non-archived jobs only. (archived column may not exist pre-migration.)
    const { data: jobsRaw } = await db.from('jobs').select('job_number, archived').eq('tenant_id', tenantId);
    const activeJobNums = (jobsRaw as { job_number: string; archived?: boolean | null }[] | null ?? [])
      .filter((j) => j.archived !== true)
      .map((j) => j.job_number);

    const { data: units } = await db
      .from('cabinet_units')
      .select('id, unit_label, job_number')
      .eq('tenant_id', tenantId)
      .limit(3000);
    const unitList = (units as { id: string; unit_label: string; job_number: string | null }[] | null) ?? [];
    const unitMap = new Map(unitList.map((u) => [u.id, u]));

    const { data: parts } = await db
      .from('parts')
      .select('part_name, cabinet_unit_id, job_number')
      .eq('tenant_id', tenantId)
      .limit(20000);
    const partList = (parts as { part_name: string; cabinet_unit_id: string; job_number: string | null }[] | null) ?? [];

    const candidates: Candidate[] = [];
    for (const p of partList) {
      const u = unitMap.get(p.cabinet_unit_id);
      if (!u) continue;
      const jn = u.job_number ?? p.job_number ?? null;
      // Restrict to active jobs when we successfully resolved that list.
      if (activeJobNums.length > 0 && jn && !activeJobNums.includes(jn)) continue;
      candidates.push({
        part_name: p.part_name,
        cabinet_label: u.unit_label,
        cabinet_unit_id: p.cabinet_unit_id,
        job_number: jn,
      });
    }
    // Cap to keep the prompt bounded.
    return candidates.slice(0, 500);
  } catch {
    return [];
  }
}

const SYSTEM = `You are an expert cabinet shop parts identifier. Given a scanned label and a list of cabinet parts, identify which cabinet the label refers to.

CRITICAL: Cabinet shops use their own labeling conventions — you do not know the convention in advance. Common patterns include:
- Job prefix + cabinet ID: "AND K02" means Anderson job, cabinet K02. "SMI B04" means Smith job, cabinet B04.
- First 2-4 letters of job name are used as a prefix: "AND" = Anderson, "PEG" = Pegasus, "SMI" = Smith
- Mozaik software: "R1C2" = Room 1 Cabinet 2, "R2C14" = Room 2 Cabinet 14
- Cabinet Vision: "K02-Base24", "L01-Upper36"
- Just a cabinet number: "K02", "B04", "14"
- Room prefix: "k1c2" may mean kitchen room 1 cabinet 2

When matching:
1. Extract all alphanumeric tokens from the label (ignore spaces and punctuation)
2. Try to match each token against cabinet labels and job names
3. A job prefix token (like "AND") that matches the start of a job name is a strong signal
4. A cabinet ID token (like "K02") that appears in a cabinet label is a strong signal
5. Both matching together = very high confidence

Return ONLY valid JSON:
{
  "match": {
    "part_name": string,
    "cabinet_unit_id": string,
    "cabinet_label": string,
    "confidence": number (0-100)
  } | null,
  "alternatives": [{
    "part_name": string,
    "cabinet_unit_id": string,
    "cabinet_label": string,
    "confidence": number
  }],
  "reasoning": string
}

Always include up to 5 alternatives ranked by confidence even when a match exists.
If confidence < 70, return match: null and list all plausible candidates as alternatives.
Never return an empty alternatives array if there are any plausible candidates.`;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 });

  let body: { tenantId?: string; rawLabel?: string; jobPath?: string; broadCandidates?: { id: string; unit_label: string; job_number: string | null }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { tenantId, rawLabel, jobPath, broadCandidates } = body;
  if (!tenantId || !rawLabel) {
    return NextResponse.json({ error: 'tenantId and rawLabel required' }, { status: 400 });
  }

  const candidates = await fetchCandidates(tenantId);
  if (candidates.length === 0) {
    const empty: AiResult = { match: null, alternatives: [], reasoning: 'No active parts to match against.' };
    return NextResponse.json(empty);
  }

  // If the client provided pre-filtered broad candidates, use them as the primary
  // candidate list (they were already filtered by token match on the DB side).
  // Otherwise fall back to the full fetchCandidates list.
  let candidateList = candidates;
  if (broadCandidates && broadCandidates.length > 0) {
    // Enrich broad candidates with part names from the full candidate list
    const enriched: Candidate[] = [];
    for (const bc of broadCandidates) {
      const parts = candidates.filter((c) => c.cabinet_unit_id === bc.id);
      if (parts.length > 0) {
        enriched.push(...parts);
      } else {
        // Cabinet found but no parts in candidate list — include cabinet label as a synthetic candidate
        enriched.push({
          part_name: bc.unit_label,
          cabinet_label: bc.unit_label,
          cabinet_unit_id: bc.id,
          job_number: bc.job_number,
        });
      }
    }
    if (enriched.length > 0) candidateList = enriched;
  }

  const partsTextFinal = candidateList
    .map((c) => `- part_name: "${c.part_name}" | cabinet_label: "${c.cabinet_label}" | cabinet_unit_id: ${c.cabinet_unit_id}${c.job_number ? ` | job: ${c.job_number}` : ''}`)
    .join('\n');

  const userMessage = `Scanned label: "${rawLabel}"
Job context: ${jobPath ?? 'unknown'}

IMPORTANT: The first token(s) of the label may be a job name abbreviation (first 2-4 letters of the job name).
The remaining token(s) are likely the cabinet ID.

Available cabinets and parts:
${partsTextFinal}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      }),
    });
    if (!res.ok) return NextResponse.json({ error: await res.text() }, { status: res.status });

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ error: 'Unexpected response format', raw: text }, { status: 502 });

    const parsed = JSON.parse(m[0]) as AiResult;
    return NextResponse.json(parsed);
  } catch (err) {
    console.error('[match-label]', err);
    return NextResponse.json({ error: 'Label match failed. Please try again.' }, { status: 500 });
  }
}
