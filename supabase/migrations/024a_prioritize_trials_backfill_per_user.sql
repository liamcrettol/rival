-- Prioritize lifetime Trials lookups for opponents actually beaten by
-- signed-in users instead of sweeping the entire global opponent universe.
select cron.unschedule('refresh-trials-backfill-candidates')
where exists (select 1 from cron.job where jobname = 'refresh-trials-backfill-candidates');

drop function if exists public.get_trials_backfill_candidates(integer);
drop materialized view if exists public.trials_backfill_candidates;

create or replace function public.get_trials_backfill_candidates_for_user(
  p_viewer_user_id text,
  p_limit integer default 100
)
returns table(membership_id text, membership_type integer)
language sql stable security definer set search_path = public
as $$
  select
    opponent_membership_id,
    (array_agg(opponent_membership_type order by played_at desc)
      filter (where opponent_membership_type is not null))[1]
  from public.crucible_encounters
  where viewer_user_id = p_viewer_user_id
    and viewer_won is true
  group by opponent_membership_id
  order by max(played_at) desc
  limit greatest(1, least(p_limit, 500));
$$;

revoke all on function public.get_trials_backfill_candidates_for_user(text, integer) from public;
grant execute on function public.get_trials_backfill_candidates_for_user(text, integer) to service_role;
