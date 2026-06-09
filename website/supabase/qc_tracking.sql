-- QC tracking + group-push schema additions.
-- Run this in the Supabase SQL Editor before deploying.
--
-- Everything here is additive and idempotent (IF NOT EXISTS), so it is safe to
-- run on an existing database. assigned_dept on parts remains the single source
-- of truth for where a part lives; these columns add the QC accountability +
-- production check-off that the rework needs.

-- ── parts ──────────────────────────────────────────────────────────────────────
-- Production crew checks each part off as it is cut. checked is the cutlist tick;
-- assigned_dept (not this column) still decides which dept the part belongs to.
ALTER TABLE public.parts            ADD COLUMN IF NOT EXISTS checked boolean NOT NULL DEFAULT false;

-- ── cabinet_units ───────────────────────────────────────────────────────────────
-- completed_by    — who marked the cabinet complete (assembly/finishing) for the
--                   QC accountability log.
-- assembly_started_at — when assembly START was first tapped (drives the
--                   supervisor Assembly tab elapsed time; the canonical timer
--                   row still lives in time_clock).
-- qc_notes        — supervisor's QC fail notes.
ALTER TABLE public.cabinet_units    ADD COLUMN IF NOT EXISTS completed_by text;
ALTER TABLE public.cabinet_units    ADD COLUMN IF NOT EXISTS assembly_started_at timestamptz;
ALTER TABLE public.cabinet_units    ADD COLUMN IF NOT EXISTS qc_notes text;

-- ── damage_reports ───────────────────────────────────────────────────────────────
-- return_dept — the dept a "Replace Part" resolution routes the part back to
--               (used when the part came from Finishing or Assembly and the
--               supervisor picks a destination).
ALTER TABLE public.damage_reports   ADD COLUMN IF NOT EXISTS return_dept text;

-- ── tenants ──────────────────────────────────────────────────────────────────────
-- ai_mode — 'learn' | 'assist' | 'autonomous'. Stored on the tenant so the crew
--           PWA (a different device with no access to the supervisor's
--           localStorage) can gate AI push suggestions. Default 'learn' means no
--           suggestions are shown to crew.
ALTER TABLE public.tenants          ADD COLUMN IF NOT EXISTS ai_mode text NOT NULL DEFAULT 'learn';

-- Helpful index for the production cutlist progress query.
CREATE INDEX IF NOT EXISTS parts_cabinet_checked ON public.parts(cabinet_unit_id, checked);
