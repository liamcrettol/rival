-- Resolve one current-enough emblem per search result without returning every
-- historical appearance of that player to the application.
create or replace function public.get_latest_player_emblems(p_membership_ids text[])
returns table(membership_id text, emblem_path text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (players.membership_id)
    players.membership_id,
    players.emblem_path
  from public.crucible_match_players players
  where players.membership_id = any(p_membership_ids)
    and players.emblem_path is not null
    and players.emblem_path <> ''
  order by players.membership_id, players.updated_at desc;
$$;

revoke all on function public.get_latest_player_emblems(text[]) from public;
grant execute on function public.get_latest_player_emblems(text[]) to service_role;
