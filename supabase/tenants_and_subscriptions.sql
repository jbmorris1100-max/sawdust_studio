-- ============================================================
-- InlineIQ Web Auth — Tenants & Subscriptions
-- Run in Supabase SQL Editor (Project → SQL Editor → New Query)
-- ============================================================

-- ── Tenants ─────────────────────────────────────────────────
create table if not exists tenants (
  id                  uuid        primary key default gen_random_uuid(),
  company_name        text        not null,
  owner_email         text        not null,
  owner_user_id       uuid        references auth.users(id) on delete set null,
  subscription_status text        not null default 'trial'
    check (subscription_status in ('trial', 'active', 'cancelled', 'expired')),
  trial_ends_at       timestamptz,
  created_at          timestamptz not null default now()
);

-- Unique email so upsert works reliably in the seed script
create unique index if not exists tenants_owner_email_key on tenants (owner_email);
create unique index if not exists tenants_owner_user_id_key on tenants (owner_user_id)
  where owner_user_id is not null;

-- ── Subscriptions ────────────────────────────────────────────
create table if not exists subscriptions (
  id                     uuid        primary key default gen_random_uuid(),
  tenant_id              uuid        not null references tenants(id) on delete cascade,
  stripe_customer_id     text,
  stripe_subscription_id text,
  plan                   text        not null default 'starter'
    check (plan in ('starter', 'shop', 'operations')),
  status                 text        not null default 'trial',
  current_period_end     timestamptz,
  created_at             timestamptz not null default now()
);

-- ── Indexes ──────────────────────────────────────────────────
create index if not exists idx_tenants_owner_user_id  on tenants (owner_user_id);
create index if not exists idx_subscriptions_tenant   on subscriptions (tenant_id);

-- ── Row Level Security ───────────────────────────────────────
alter table tenants       enable row level security;
alter table subscriptions enable row level security;

-- Tenant owner: full read/update on their own row
create policy "owner can read own tenant"
  on tenants for select
  using (owner_user_id = auth.uid());

create policy "owner can update own tenant"
  on tenants for update
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Authenticated users can insert their own tenant row (signup flow uses anon key)
create policy "user can insert own tenant"
  on tenants for insert
  with check (owner_user_id = auth.uid());

-- Subscriptions: owners can read their tenant's subscription rows
create policy "owner can read own subscriptions"
  on subscriptions for select
  using (
    tenant_id in (
      select id from tenants where owner_user_id = auth.uid()
    )
  );
