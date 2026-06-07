-- Stripe billing columns on tenants.
-- Run once in the Supabase SQL editor. Idempotent (IF NOT EXISTS).
--
-- subscription_status already exists (values: trial | active | past_due |
-- cancelled | expired). The webhook writes 'past_due' too; no migration needed
-- for that since it is a free-form text column.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS plan text DEFAULT 'trial',
  -- plan values: 'trial', 'shop_monthly', 'shop_annual',
  --              'operations_monthly', 'operations_annual',
  --              'cancelled', 'expired'
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean DEFAULT false;

-- Helpful lookups for the webhook's tenant-resolution fallbacks.
CREATE INDEX IF NOT EXISTS tenants_stripe_customer_id_idx ON tenants (stripe_customer_id);
CREATE INDEX IF NOT EXISTS tenants_stripe_subscription_id_idx ON tenants (stripe_subscription_id);
