-- ── Structured department configuration ──────────────────────────────────────
-- Adds a per-department tracking-unit "template" layer alongside the legacy
-- tenant.departments string array (which is still written for back-compat with
-- every getDepartments(tenant) read path). This migration is schema + a one-time
-- backfill only; the template components and transitions wiring land later.
--
-- tenant_id is uuid (matches tenants.id and the convention used by every other
-- tenant-scoped table — confirmed against live schema, NOT the text the original
-- spec drafted).

CREATE TABLE IF NOT EXISTS departments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                text NOT NULL,
  template            text NOT NULL CHECK (template IN ('part','cabinet','group_auto','group_manual','sheet','qc')),
  group_by_field      text,              -- only meaningful for group_auto: 'room_number' | 'color'
  completion_behavior text,              -- 'auto_route_to_qc' | 'push_picker' | null
  sort_order          integer NOT NULL DEFAULT 0,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS departments_tenant_idx ON departments (tenant_id, sort_order);

CREATE TABLE IF NOT EXISTS department_transitions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_dept_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  to_dept_id   uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── One-time backfill ─────────────────────────────────────────────────────────
-- For every tenant, materialize one departments row per name currently in
-- tenant.departments (falling back to DEFAULT_DEPARTMENTS when null/empty),
-- mapping known names to their tracking template + default completion behavior.
-- Idempotent: tenants that already have rows are skipped, so re-running is safe.
--
-- tenants.departments is jsonb, stored TWO ways across legacy rows (verified
-- against live data):
--   • a real jsonb array         ->  ["Production","Assembly",...]
--   • a double-encoded jsonb STRING (scalar) whose text is a JSON array
--                                ->  "[\"Production\",\"Assembly\",...]"
-- jsonb_array_elements_text() throws on the scalar-string form, so we normalize
-- both shapes to a jsonb array first, then fall back to DEFAULT_DEPARTMENTS when
-- the value is null / not an array / empty / unparseable.
DO $$
DECLARE
  t         RECORD;
  deps      jsonb;
  arr       text[];
  dept_name text;
  idx       int;
  tmpl      text;
  gbf       text;
  cb        text;
BEGIN
  FOR t IN SELECT id, departments FROM tenants LOOP
    IF EXISTS (SELECT 1 FROM departments WHERE tenant_id = t.id) THEN
      CONTINUE;
    END IF;

    -- Normalize the jsonb value to a jsonb array (or NULL).
    deps := t.departments;
    IF deps IS NOT NULL AND jsonb_typeof(deps) = 'string' THEN
      BEGIN
        deps := (deps #>> '{}')::jsonb;   -- unwrap scalar string text, re-parse as jsonb
      EXCEPTION WHEN others THEN
        deps := NULL;                      -- unparseable string -> fall back below
      END;
    END IF;

    IF deps IS NULL OR jsonb_typeof(deps) <> 'array' THEN
      arr := ARRAY['Production','Assembly','Finishing','Craftsman'];
    ELSE
      -- Empty array -> array_agg over zero rows is NULL -> COALESCE to fallback.
      arr := COALESCE(
        (SELECT array_agg(value) FROM jsonb_array_elements_text(deps)),
        ARRAY['Production','Assembly','Finishing','Craftsman']
      );
    END IF;

    idx := 0;
    FOREACH dept_name IN ARRAY arr LOOP
      CASE lower(dept_name)
        WHEN 'production' THEN tmpl := 'part';       gbf := NULL;          cb := NULL;
        WHEN 'assembly'   THEN tmpl := 'cabinet';    gbf := NULL;          cb := 'auto_route_to_qc';
        WHEN 'craftsman'  THEN tmpl := 'cabinet';    gbf := NULL;          cb := 'push_picker';
        WHEN 'finishing'  THEN tmpl := 'group_auto'; gbf := 'room_number'; cb := NULL;
        WHEN 'qc'         THEN tmpl := 'qc';         gbf := NULL;          cb := NULL;
        ELSE                   tmpl := 'part';       gbf := NULL;          cb := NULL;  -- custom dept → safe default
      END CASE;
      INSERT INTO departments (tenant_id, name, template, group_by_field, completion_behavior, sort_order)
      VALUES (t.id, dept_name, tmpl, gbf, cb, idx);
      idx := idx + 1;
    END LOOP;
  END LOOP;
END $$;
