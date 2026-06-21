-- Fix the SELECT-then-INSERT/UPDATE race in the two learned-pattern tables.
--
-- Before this migration, every learner (lib/partActions.ts learnRouting, the
-- classify-units route Step 4, SortListTab.assign, and CraftsmanTab assign/keep)
-- did: SELECT existing row → if found UPDATE else INSERT. Two concurrent calls
-- for the same natural key both see "no row" and both INSERT → duplicate rows.
--
-- part_routing_patterns already carries UNIQUE(tenant_id, part_name_pattern,
-- from_dept, to_dept) (verified live), so it only needs an atomic upsert RPC.
-- craftsman_classifications has NO unique constraint (verified: duplicate inserts
-- with part_name_pattern NULL are currently allowed), so we add one. Because
-- part_name_pattern is nullable and this database is PostgreSQL 14.5 (no
-- UNIQUE ... NULLS NOT DISTINCT, which is 15+), the index is built over
-- COALESCE(part_name_pattern, '') so NULL and '' collapse to one logical key.
--
-- Both RPCs do INSERT ... ON CONFLICT DO UPDATE with a Postgres-side increment of
-- times_confirmed — a true atomic upsert, never a read-then-write. SECURITY
-- INVOKER: they run with the caller's privileges so existing RLS / table grants
-- apply exactly as they did for the direct writes they replace.

-- ── 1. Collapse any pre-existing duplicates in craftsman_classifications ───────
-- Survivor of each natural-key group = the OLDEST row (ORDER BY created_at, then
-- id as a deterministic tiebreak). id is uuid: Postgres has no min/max aggregate
-- for uuid, so we never aggregate on it — uuid DOES have an ordering, so
-- ROW_NUMBER() ... ORDER BY ... id is valid. The UPDATE and the DELETE use the
-- IDENTICAL ranking so they agree on which row survives. times_confirmed (the
-- only thing summed) is an integer.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, unit_label_pattern, assigned_dept, coalesce(part_name_pattern, '')
      ORDER BY created_at NULLS FIRST, id
    ) AS rn,
    sum(coalesce(times_confirmed, 1)) OVER (
      PARTITION BY tenant_id, unit_label_pattern, assigned_dept, coalesce(part_name_pattern, '')
    ) AS group_total
  FROM public.craftsman_classifications
)
UPDATE public.craftsman_classifications c
SET times_confirmed = ranked.group_total
FROM ranked
WHERE c.id = ranked.id
  AND ranked.rn = 1;

DELETE FROM public.craftsman_classifications c
USING (
  SELECT id,
         row_number() OVER (
           PARTITION BY tenant_id, unit_label_pattern, assigned_dept, coalesce(part_name_pattern, '')
           ORDER BY created_at NULLS FIRST, id
         ) AS rn
  FROM public.craftsman_classifications
) d
WHERE c.id = d.id
  AND d.rn > 1;

-- ── 2. Natural-key unique index (NULL part_name_pattern folded to '') ─────────
CREATE UNIQUE INDEX IF NOT EXISTS craftsman_classifications_natural_key
  ON public.craftsman_classifications
  (tenant_id, unit_label_pattern, assigned_dept, coalesce(part_name_pattern, ''));

-- ── 3. Atomic upsert for part_routing_patterns ───────────────────────────────
CREATE OR REPLACE FUNCTION public.learn_routing_pattern(
  p_tenant_id          uuid,
  p_part_name_pattern  text,
  p_from_dept          text,
  p_to_dept            text,
  p_count              integer DEFAULT 1
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.part_routing_patterns
    (tenant_id, part_name_pattern, from_dept, to_dept, times_confirmed, confidence_score, updated_at)
  VALUES
    (p_tenant_id, p_part_name_pattern, p_from_dept, p_to_dept, greatest(p_count, 1), 1, now())
  ON CONFLICT (tenant_id, part_name_pattern, from_dept, to_dept)
  DO UPDATE SET
    times_confirmed = public.part_routing_patterns.times_confirmed + greatest(p_count, 1),
    updated_at      = now();
$$;

-- ── 4. Atomic upsert for craftsman_classifications ───────────────────────────
-- ON CONFLICT targets the COALESCE expression so it matches the index above.
-- confirmed_by is written only on first insert; the conflict path touches only
-- times_confirmed + updated_at (mirrors the old UPDATE branch).
CREATE OR REPLACE FUNCTION public.learn_craftsman_classification(
  p_tenant_id           text,
  p_unit_label_pattern  text,
  p_assigned_dept       text,
  p_part_name_pattern   text    DEFAULT NULL,
  p_count               integer DEFAULT 1,
  p_confirmed_by        text    DEFAULT NULL
) RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.craftsman_classifications
    (tenant_id, unit_label_pattern, assigned_dept, part_name_pattern, times_confirmed, confirmed_by, updated_at)
  VALUES
    (p_tenant_id, p_unit_label_pattern, p_assigned_dept, p_part_name_pattern, greatest(p_count, 1), p_confirmed_by, now())
  ON CONFLICT (tenant_id, unit_label_pattern, assigned_dept, coalesce(part_name_pattern, ''))
  DO UPDATE SET
    times_confirmed = coalesce(public.craftsman_classifications.times_confirmed, 0) + greatest(p_count, 1),
    updated_at      = now();
$$;

-- ── 5. Expose to the API roles + refresh PostgREST's schema cache ─────────────
GRANT EXECUTE ON FUNCTION public.learn_routing_pattern(uuid, text, text, text, integer)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.learn_craftsman_classification(text, text, text, text, integer, text)
  TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
