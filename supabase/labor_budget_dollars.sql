-- ============================================================
-- Job labor budget in DOLLARS
-- Adds a dollar-denominated labor budget to jobs, distinct from
-- labor_est (which is tracked in HOURS) and material_est (dollars).
-- Lets the Job Cost report compare actual labor cost ($, = net hours ×
-- hourly_rate) against a dollar budget, separately from the
-- hours-actual-vs-hours-estimate comparison.
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS labor_budget_dollars numeric;
