-- 010: Schedule the Crucible backfill cron inside Postgres (pg_cron + pg_net),
-- same pattern as Rerolled's 056.
--
-- Before running this migration, add two Vault secrets to THIS Supabase
-- project (Dashboard -> Project Settings -> Vault):
--   cron_app_url = https://rival.rerolled.io   (no trailing slash)
--   cron_secret  = the same value as the CRON_SECRET env var on Vercel
-- Rotate by updating the Vault entries; no redeploy or migration needed.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.ping_cron_endpoint(path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  bearer text;
  request_id bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'cron_app_url';
  select decrypted_secret into bearer from vault.decrypted_secrets where name = 'cron_secret';
  if base_url is null or bearer is null then
    raise exception 'Vault secrets cron_app_url / cron_secret are missing';
  end if;

  -- 90s timeout: the endpoint caps at maxDuration 60s, so pg_net must not
  -- hang up first (an early client abort risks killing the invocation).
  select net.http_get(
    url := base_url || path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || bearer),
    timeout_milliseconds := 90000
  ) into request_id;

  return request_id;
end;
$$;

revoke all on function public.ping_cron_endpoint(text) from public, anon, authenticated;

-- cron.schedule upserts by job name, so re-running this migration is safe.
select cron.schedule('ping-sync-crucible', '*/10 * * * *', $$select public.ping_cron_endpoint('/api/cron/sync-crucible')$$);
