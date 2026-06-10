-- Partner account fields on tenants.
-- Run this against your Supabase project (SQL editor or `psql`):
--   psql "$DATABASE_URL" -f website/supabase/partner_fields.sql
-- Idempotent — safe to run more than once.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_partner boolean DEFAULT false;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS partner_discount integer DEFAULT 0;

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS partner_trial_ends_at timestamptz;
