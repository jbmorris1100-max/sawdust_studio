// Pure part-name normalization, shared by the routing-pattern learner
// (lib/partActions) and the rework suppression matcher (lib/rework). Extracted to
// its own module so the server-side rework detector can reuse the EXACT same
// normalization without importing partActions (which pulls the browser supabase
// client). One definition -> the suppression key the UI writes and the key the
// detector matches against can never drift.

// Derive a reusable pattern from a part name: lowercase, drop dimensions and
// punctuation, keep the meaningful words. "Base 24 Door 23.5x30" -> "base door".
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'qty', 'pcs', 'pc', 'x']);

export function patternFromPartName(name: string): string {
  const cleaned = (name || '')
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?/g, ' ')   // strip dimension numbers
    .replace(/["'#x×]/g, ' ')             // strip quote/× separators
    .replace(/[^a-z\s]/g, ' ');           // strip remaining punctuation
  const words = cleaned.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const pattern = words.slice(0, 4).join(' ').trim();
  return pattern || (name || '').trim().toLowerCase().slice(0, 40);
}
