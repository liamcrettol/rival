-- 001: Rival core schema.
--
-- Identity + OAuth + the immutable PGCR cache, extracted from Rerolled's
-- migrations 001/002/003/021/028 so Rival's database starts clean. The
-- crucible_* tables land in 002 (a verbatim copy of Rerolled's 049) and the
-- follow-up migrations 003-009 mirror Rerolled's later crucible/pgcr changes,
-- so a Rerolled pg_dump of these tables restores into this schema unchanged.
--
-- All tables are server-only: RLS enabled, no anon policies. Every access
-- goes through the service-role client (lib/supabase/admin.ts).

create extension if not exists "uuid-ossp";

create table if not exists users (
  id text primary key,                   -- Bungie membershipId (string)
  display_name text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists bungie_accounts (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null references users(id) on delete cascade,
  membership_id text not null,
  membership_type integer not null,
  access_token_enc text not null,        -- AES-256-GCM encrypted
  refresh_token_enc text,
  expires_at timestamptz,
  updated_at timestamptz default now(),
  unique (user_id)
);

-- Short-lived codes minted by the OAuth callback and exchanged for a session.
create table if not exists auth_codes (
  code text primary key,
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);
create index if not exists auth_codes_expires_idx on auth_codes(expires_at);

-- CSRF state for the Bungie OAuth round-trip.
create table if not exists oauth_states (
  state text primary key,
  expires_at timestamptz not null,
  created_at timestamptz default now(),
  return_to text
);
create index if not exists oauth_states_expires_idx on oauth_states(expires_at);

-- Immutable PGCR cache (Rerolled 028). Rival never prunes this: raw PGCRs are
-- the durable head-to-head source data (with the Appwrite archive layered on
-- in migration 009).
create table if not exists pgcr_cache (
  instance_id text primary key,
  source text not null default 'bungie_api',
  raw_pgcr jsonb,
  normalized_pgcr jsonb,
  fetched_at timestamptz,
  expires_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'fetched', 'normalized', 'failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pgcr_cache_status_idx on pgcr_cache(status);
create index if not exists pgcr_cache_expires_at_idx on pgcr_cache(expires_at);

alter table users enable row level security;
alter table bungie_accounts enable row level security;
alter table auth_codes enable row level security;
alter table oauth_states enable row level security;
alter table pgcr_cache enable row level security;
