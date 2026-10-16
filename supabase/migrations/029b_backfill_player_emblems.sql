-- ============================================================
-- 029b - Move existing emblem_path values into crucible_emblems.
--
-- Requires 029a. Runs as a pg_cron job, one batch of matches a minute,
-- walking crucible_match_players by its primary key so every batch is an
-- index range rather than a table scan. The job unschedules itself when the
-- cursor runs past the last match. Rerunning this file is safe: the
-- function only touches rows that still carry an emblem_path.
--
-- The UPDATE sets emblem_path to NULL in the same statement, so the 029a
-- trigger leaves emblem_id alone. updated_at is deliberately not bumped:
-- get_latest_player_identities orders by it.
--
-- Each update shrinks a row by ~68 bytes, so most new versions fit on the
-- same page as HOT updates and the indexes do not grow. The lowered
-- autovacuum threshold below keeps dead rows recycled during the run; it
-- is reset when the job finishes.
--
-- Progress: select * from public.crucible_emblem_backfill;
-- ============================================================

insert into public.crucible_emblems (path)
select distinct emblem_path
from public.crucible_match_players
where nullif(emblem_path, '') is not null
on conflict (path) do nothing;

create table if not exists public.crucible_emblem_backfill (
  id boolean primary key default true check (id),
  last_instance_id text not null default '',
  rows_updated bigint not null default 0,
  finished_at timestamptz
);
alter table public.crucible_emblem_backfill enable row level security;
revoke all on public.crucible_emblem_backfill from anon, authenticated;
insert into public.crucible_emblem_backfill (id) values (true) on conflict (id) do nothing;

alter table public.crucible_match_players set (autovacuum_vacuum_scale_factor = 0.01);

create or replace function public.backfill_crucible_player_emblems(p_matches integer default 20000)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from text;
  v_to text;
  v_updated bigint;
begin
  select last_instance_id into v_from from public.crucible_emblem_backfill where id;

  select max(instance_id) into v_to
  from (
    select distinct instance_id
    from public.crucible_match_players
    where instance_id > v_from
    order by instance_id
    limit greatest(p_matches, 1)
  ) batch;

  if v_to is null then
    update public.crucible_emblem_backfill set finished_at = now() where id and finished_at is null;
    alter table public.crucible_match_players reset (autovacuum_vacuum_scale_factor);
    perform cron.unschedule('backfill-crucible-emblems')
    where exists (select 1 from cron.job where jobname = 'backfill-crucible-emblems');
    return 0;
  end if;

  update public.crucible_match_players players
  set emblem_id = coalesce(
        (select emblems.id from public.crucible_emblems emblems
         where emblems.path = nullif(players.emblem_path, '')),
        players.emblem_id
      ),
      emblem_path = null
  where players.instance_id > v_from
    and players.instance_id <= v_to
    and players.emblem_path is not null;
  get diagnostics v_updated = row_count;

  update public.crucible_emblem_backfill
  set last_instance_id = v_to,
      rows_updated = rows_updated + v_updated
  where id;

  return v_updated;
end;
$$;

revoke all on function public.backfill_crucible_player_emblems(integer) from public, anon, authenticated;

-- cron.schedule upserts by job name.
select cron.schedule(
  'backfill-crucible-emblems',
  '* * * * *',
  $$select public.backfill_crucible_player_emblems(20000)$$
);
