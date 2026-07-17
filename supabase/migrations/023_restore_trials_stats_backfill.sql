-- Restore the shared lifetime Trials K/D backfill used by Match Hall of Fame.
create materialized view if not exists public.trials_backfill_candidates as
with beaten as (
  select
    opponent_membership_id as membership_id,
    (array_agg(opponent_membership_type order by played_at desc) filter (where opponent_membership_type is not null))[1] as membership_type
  from public.crucible_encounters
  where viewer_won is true
  group by opponent_membership_id
), sampled as (
  select membership_id, sum(kills) as kills, sum(deaths) as deaths, count(*) as games
  from public.crucible_match_players players
  join public.crucible_matches matches using (instance_id)
  group by membership_id
)
select beaten.membership_id, beaten.membership_type,
  case when coalesce(sampled.deaths, 0) > 0 then sampled.kills::numeric / sampled.deaths else sampled.kills::numeric end as priority,
  coalesce(sampled.games, 0) as games
from beaten left join sampled using (membership_id);

create unique index if not exists trials_backfill_candidates_pk on public.trials_backfill_candidates(membership_id);
create index if not exists trials_backfill_candidates_priority_idx on public.trials_backfill_candidates(priority desc nulls last, games desc);

create or replace function public.get_trials_backfill_candidates(p_limit integer default 500)
returns table(membership_id text, membership_type integer)
language sql stable security definer set search_path = public
as $$
  select membership_id, membership_type
  from public.trials_backfill_candidates
  order by priority desc nulls last, games desc
  limit greatest(1, least(p_limit, 2000));
$$;
revoke all on function public.get_trials_backfill_candidates(integer) from public;
grant execute on function public.get_trials_backfill_candidates(integer) to service_role;

select cron.schedule('ping-sync-trials-kd', '*/2 * * * *', $$select public.ping_cron_endpoint('/api/cron/sync-trials-kd')$$)
where not exists (select 1 from cron.job where jobname = 'ping-sync-trials-kd');
select cron.schedule('refresh-trials-backfill-candidates', '11 * * * *', $$refresh materialized view concurrently public.trials_backfill_candidates$$)
where not exists (select 1 from cron.job where jobname = 'refresh-trials-backfill-candidates');
