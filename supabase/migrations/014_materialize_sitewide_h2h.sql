-- Any PGCR already known to Rival can establish viewer ownership directly:
-- the signed site's Destiny membership id appears in crucible_match_players.
-- This recovers H2H for private-history users and keeps shared matches useful
-- even when Bungie will not enumerate that user's activity feed.
create index if not exists crucible_matches_updated_at_idx
  on public.crucible_matches(updated_at desc);

drop function if exists public.materialize_sitewide_crucible_viewers();
drop function if exists public.materialize_sitewide_crucible_viewers(text[]);

create function public.materialize_sitewide_crucible_viewers(
  p_user_ids text[] default null
)
returns table(viewers_inserted bigint, encounters_inserted bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  with inserted as (
    insert into public.crucible_match_viewers (
      viewer_user_id, viewer_membership_id, instance_id, played_at
    )
    select accounts.user_id, accounts.membership_id, matches.instance_id, matches.period
    from public.bungie_accounts accounts
    join public.crucible_match_players viewer
      on viewer.membership_id = accounts.membership_id
    join public.crucible_matches matches
      on matches.instance_id = viewer.instance_id
    where (
      (p_user_ids is not null and accounts.user_id = any(p_user_ids))
      or
      (p_user_ids is null and matches.updated_at >= now() - interval '1 hour')
    )
    on conflict (viewer_user_id, instance_id) do nothing
    returning 1
  )
  select count(*) into viewers_inserted from inserted;

  with inserted as (
    insert into public.crucible_encounters (
      viewer_user_id,
      viewer_membership_id,
      opponent_membership_id,
      opponent_membership_type,
      opponent_display_name,
      instance_id,
      mode_bucket,
      viewer_won,
      played_at
    )
    select
      accounts.user_id,
      accounts.membership_id,
      opponent.membership_id,
      opponent.membership_type,
      opponent.display_name,
      matches.instance_id,
      matches.mode_bucket,
      viewer.is_win,
      matches.period
    from public.bungie_accounts accounts
    join public.crucible_match_players viewer
      on viewer.membership_id = accounts.membership_id
    join public.crucible_matches matches
      on matches.instance_id = viewer.instance_id
    join public.crucible_match_players opponent
      on opponent.instance_id = viewer.instance_id
     and viewer.team_id is not null
     and opponent.team_id is not null
     and opponent.team_id <> viewer.team_id
    where (
      (p_user_ids is not null and accounts.user_id = any(p_user_ids))
      or
      (p_user_ids is null and matches.updated_at >= now() - interval '1 hour')
    )
    on conflict (viewer_user_id, opponent_membership_id, instance_id) do nothing
    returning 1
  )
  select count(*) into encounters_inserted from inserted;

  return next;
end;
$$;

revoke all on function public.materialize_sitewide_crucible_viewers(text[]) from public;
grant execute on function public.materialize_sitewide_crucible_viewers(text[]) to service_role;
