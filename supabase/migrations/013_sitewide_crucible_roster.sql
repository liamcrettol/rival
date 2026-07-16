-- Mirror the main site's Bungie roster without copying OAuth credentials.
-- Public Destiny history only needs the application API key; users who sign
-- into Rival later are upgraded to the normal encrypted OAuth-token path.
alter table public.bungie_accounts
  add column if not exists public_history_sync boolean not null default false;

comment on column public.bungie_accounts.public_history_sync is
  'True for site-roster mirrors that use public, API-key-only Destiny history reads.';
