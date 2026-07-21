-- Small, indexed aggregation for the dashboard's most-won-against and
-- most-lost-against lists. Each encounter is already unique per viewer,
-- opponent, and match, so no additional match deduplication is required.
create or replace function public.get_h2h_rivalry_leaders(
  p_viewer_user_id text,
  p_limit integer default 5
)
returns table(
  leader_type text,
  rank bigint,
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
  with aggregates as (
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
    group by encounters.opponent_membership_id
  ),
  win_leaders as (
    select
      'wins'::text as leader_type,
      row_number() over (order by wins desc, encounters desc, last_played_at desc) as rank,
      aggregates.*
    from aggregates
    where wins > 0
  ),
  loss_leaders as (
    select
      'losses'::text as leader_type,
      row_number() over (order by losses desc, encounters desc, last_played_at desc) as rank,
      aggregates.*
    from aggregates
    where losses > 0
  )
  select leader_type, rank, opponent_membership_id, opponent_membership_type,
    opponent_display_name, encounters, wins, losses, unknown, last_played_at
  from win_leaders
  where rank <= greatest(1, least(p_limit, 10))
  union all
  select leader_type, rank, opponent_membership_id, opponent_membership_type,
    opponent_display_name, encounters, wins, losses, unknown, last_played_at
  from loss_leaders
  where rank <= greatest(1, least(p_limit, 10))
  order by leader_type, rank;
$$;

revoke all on function public.get_h2h_rivalry_leaders(text, integer) from public;
grant execute on function public.get_h2h_rivalry_leaders(text, integer) to service_role;
