-- Trials K/D leaderboard: "your record against the best Trials players you
-- have faced." The opponents' lifetime Trials K/D itself is fetched from
-- Bungie's public stats endpoint and cached in Appwrite (see
-- lib/crucible/trialsStatsStore.ts), not Postgres - this repo already uses
-- Appwrite for PGCR blobs and keeps that boundary for external/cached data.
-- These two functions only expose the locally-owned half of the leaderboard:
-- the viewer's own W/L record against opponents faced in Trials matches.

-- All Trials opponents the viewer has faced, with the viewer's W/L record
-- against each. Unranked - the API route ranks these by the opponent's
-- Appwrite-cached Trials K/D once both halves are joined in application code.
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
  last_played_at timestamptz
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
    max(encounters.played_at) as last_played_at
  from public.crucible_encounters encounters
  where encounters.viewer_user_id = p_viewer_user_id
    and encounters.mode_bucket = 'trials'
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

-- Every distinct opponent ever faced in a Trials match, across all viewers,
-- ordered by how many total encounters they're involved in. The sync-trials-kd
-- cron walks this list (checking Appwrite for what's already cached/stale) to
-- decide who to fetch next, so the most-relevant opponents get backfilled
-- first instead of an arbitrary order.
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
  where encounters.mode_bucket = 'trials'
  group by encounters.opponent_membership_id
  order by count(*) desc
  limit greatest(1, least(p_limit, 1000));
$$;

revoke all on function public.get_distinct_trials_opponents(integer) from public;
grant execute on function public.get_distinct_trials_opponents(integer) to service_role;
