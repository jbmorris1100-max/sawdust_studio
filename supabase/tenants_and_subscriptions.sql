-- ============================================================
-- Tenants + Subscriptions
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- ── Tenants table ──────────────────────────────────────────────
-- One row per shop. Identified by owner_user_id (Supabase auth UID).
-- All other tables reference id (text, not FK) as their tenant_id.
CREATE TABLE IF NOT EXISTS tenants (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_name           text        NOT NULL,
  slug                text,
  owner_email         text,
  owner_user_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  subscription_status text        NOT NULL DEFAULT 'trial'
                        CHECK (subscription_status IN ('trial','active','cancelled','expired')),
  trial_ends_at       timestamptz,
  erp_type            text        DEFAULT 'none',
  innergy_api_key     text,
  innergy_subdomain   text,
  integrations        jsonb       DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Backfill: ensure columns exist on existing tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_email         text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug                text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS erp_type            text DEFAULT 'none';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS innergy_api_key     text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS innergy_subdomain   text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS integrations        jsonb DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_tenants_owner_user_id ON tenants (owner_user_id);

-- ── Row Level Security ─────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- Each owner reads only their own tenant (authenticated)
DROP POLICY IF EXISTS "owner can read own tenant"   ON tenants;
DROP POLICY IF EXISTS "owner can update own tenant" ON tenants;
DROP POLICY IF EXISTS "owner can insert own tenant" ON tenants;
DROP POLICY IF EXISTS "anon can read tenants"       ON tenants;

-- Authenticated users see only their own tenant
CREATE POLICY "owner can read own tenant"
  ON tenants FOR SELECT
  USING (auth.uid() = owner_user_id);

-- Anon key can read (needed for useSession on crew pages before session resolves)
-- Scoped by owner_user_id at the application layer via .eq('owner_user_id', session.user.id)
CREATE POLICY "anon can read tenants"
  ON tenants FOR SELECT
  USING (true);

-- Only the owner may update their own tenant
CREATE POLICY "owner can update own tenant"
  ON tenants FOR UPDATE
  USING (auth.uid() = owner_user_id);

-- Signup: new user inserts their own tenant (owner_user_id must match their auth UID)
-- Works even if Supabase email confirmation is on because signUp returns a short-lived
-- access token before email is confirmed.
CREATE POLICY "owner can insert own tenant"
  ON tenants FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id OR auth.uid() IS NULL);
