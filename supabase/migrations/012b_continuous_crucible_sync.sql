-- Keep every Bungie-linked Rival account in the Crucible sync lifecycle.
-- Missing rows receive a full backfill. Completed rows are re-queued after a
-- short freshness window so new matches are ingested even when the user does
-- not revisit the dashboard. Failed auth rows remain parked until sign-in.

create or replace function public.queue_due_crucible_syncs(
  p_stale_minutes integer default 15
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
  v_updated integer := 0;
  v_now timestamptz := statement_timestamp();
  v_stale interval := make_interval(mins => greatest(coalesce(p_stale_minutes, 15), 1));
begin
  insert into public.crucible_sync_state (
    user_id,
    status,
    sync_started_at,
    requested_at,
    updated_at
  )
  select
    accounts.user_id,
    'queued',
    v_now,
    v_now,
    v_now
  from public.bungie_accounts as accounts
  where not exists (
    select 1
    from public.crucible_sync_state as state
    where state.user_id = accounts.user_id
  )
  on conflict (user_id) do nothing;
  get diagnostics v_inserted = row_count;

  update public.crucible_sync_state
  set status = 'queued',
      next_page = 0,
      active_character_index = 0,
      character_ids = '[]'::jsonb,
      sync_started_at = v_now,
      requested_at = v_now,
      locked_by = null,
      locked_until = null,
      last_error = null,
      attempts = 0,
      updated_at = v_now
  where status = 'complete'
    and coalesce(last_incremental_sync_at, backfill_completed_at, updated_at)
      <= v_now - v_stale;
  get diagnostics v_updated = row_count;

  return v_inserted + v_updated;
end;
$$;

revoke all on function public.queue_due_crucible_syncs(integer) from public;
grant execute on function public.queue_due_crucible_syncs(integer) to service_role;

