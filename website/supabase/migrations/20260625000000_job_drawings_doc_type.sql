-- ============================================================
-- Phase 1 — document classification tags on job_drawings
-- Each uploaded PDF plan is classified by the AI (parse-file mode
-- 'classify-doc') into one of a fixed set of doc types, with a
-- one-line reason. These two columns hold that tag so downstream
-- steps (cabinet-roster seeding, cut-list explosion) know whether
-- and how to parse the file. Read-only classification — no parts or
-- cabinet_units are created by Phase 1. Safe to re-run.
--
-- doc_type values written by the classifier:
--   cabinet_roster | room_roster | cut_list_primary |
--   cut_list_aggregated | cut_list_detail | reference | unparseable
-- ============================================================

ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS doc_type        text;
ALTER TABLE job_drawings ADD COLUMN IF NOT EXISTS doc_type_reason text;
