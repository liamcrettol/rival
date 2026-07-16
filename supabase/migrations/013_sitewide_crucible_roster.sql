-- Mirror the main site's Bungie roster without copying OAuth credentials.
-- Public Destiny history only needs the application API key; users who sign
-- into Rival later are upgraded to the normal encrypted OAuth-token path.
alter table public.bungie_accounts
  add column if not exists public_history_sync boolean not null default false;

comment on column public.bungie_accounts.public_history_sync is
  'True for site-roster mirrors that use public, API-key-only Destiny history reads.';

-- Keep a sitewide historical backlog moving continuously. Completed accounts
-- are still gated by queue_due_crucible_syncs' 15-minute freshness window, so
-- minute-level invocations are cheap/idle once there is no work left.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'ping-sync-crucible';
  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule => '* * * * *');
  end if;
exception when undefined_table then
  null;
end;
$$;
