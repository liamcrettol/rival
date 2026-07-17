-- get_trials_backfill_candidates_for_user ordered strictly by recency
-- ("order by max(played_at) desc"), so the cron's per-user top-N was always
-- the same small "most recently faced" window - an opponent only ever beaten
-- in matches from a year ago could never surface, no matter how many cron
-- cycles ran. Only 7 registered accounts exist, so there's no scaling reason
-- to bias toward recency; order by total win-encounter count instead (a
-- frequency signal, not a time-window one) and raise the cap so the cron can
-- eventually reach every historical opponent, not just recent ones.

create or replace function public.get_trials_backfill_candidates_for_user(
  p_viewer_user_id text,
  p_limit integer default 300
)
returns table(
  membership_id text,
  membership_type integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    opponent_membership_id,
    (array_agg(opponent_membership_type order by played_at desc)
      filter (where opponent_membership_type is not null))[1]
  from public.crucible_encounters
  where viewer_user_id = p_viewer_user_id
    and viewer_won is true
  group by opponent_membership_id
  order by count(*) desc
  limit greatest(1, least(p_limit, 5000));
$$;
