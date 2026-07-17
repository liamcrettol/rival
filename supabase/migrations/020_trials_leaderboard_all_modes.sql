-- The Trials K/D leaderboard's win requirement should count a win in ANY
-- Crucible mode, not just Trials matches specifically - the opponent's
-- Trials K/D is a skill signal, not a restriction on where you beat them.
-- Also returns the most recent win's instance_id/mode so the UI can link
-- to that match's public report (crucible.report / trials.report, via
-- lib/crucible/modes.ts's crucibleGameReportUrl). Both functions changed
-- their return shape, so drop before recreate.

drop function if exists public.get_trials_encounter_aggregate(text);

create or replace function public.get_trials_encounter_aggregate(
  p_viewer_user_id text
)
returns table(
  opponent_membership_id text,
  opponent_membership_type integer,
  opponent_display_name text,
  encounters bigint,
  wins bigint,
  losses bigint,
  unknown bigint,
  last_played_at timestamptz,
  last_win_instance_id text,
  last_win_mode text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    encounters.opponent_membership_id,
    (array_agg(encounters.opponent_membership_type order by encounters.played_at desc))[1] as opponent_membership_type,
    (array_agg(encounters.opponent_display_name order by encounters.played_at desc))[1] as opponent_display_name,
    count(*) as encounters,
    count(*) filter (where encounters.viewer_won is true) as wins,
    count(*) filter (where encounters.viewer_won is false) as losses,
    count(*) filter (where encounters.viewer_won is null) as unknown,
    max(encounters.played_at) as last_played_at,
    (array_agg(encounters.instance_id order by encounters.played_at desc)
      filter (where encounters.viewer_won is true))[1] as last_win_instance_id,
    (array_agg(encounters.mode_bucket order by encounters.played_at desc)
      filter (where encounters.viewer_won is true))[1] as last_win_mode
  from public.crucible_encounters encounters
  where encounters.viewer_user_id = p_viewer_user_id
    and not exists (
      select 1
      from public.rivalry_exclusions exclusions
      join public.bungie_accounts viewer_account
        on viewer_account.membership_id = exclusions.viewer_membership_id
      where viewer_account.user_id = p_viewer_user_id
        and exclusions.excluded_membership_id = encounters.opponent_membership_id
    )
  group by encounters.opponent_membership_id;
$$;

revoke all on function public.get_trials_encounter_aggregate(text) from public;
grant execute on function public.get_trials_encounter_aggregate(text) to service_role;

-- Backfill priority should likewise consider every opponent ever faced, not
-- just ones met specifically in Trials, since a Control-only opponent can
-- still have a real (and worth-caching) lifetime Trials K/D.
drop function if exists public.get_distinct_trials_opponents(integer);

create or replace function public.get_distinct_trials_opponents(
  p_limit integer default 200
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
    encounters.opponent_membership_id as membership_id,
    (array_agg(encounters.opponent_membership_type order by encounters.played_at desc)
      filter (where encounters.opponent_membership_type is not null))[1] as membership_type
  from public.crucible_encounters encounters
  group by encounters.opponent_membership_id
  order by count(*) desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.get_distinct_trials_opponents(integer) from public;
grant execute on function public.get_distinct_trials_opponents(integer) to service_role;
