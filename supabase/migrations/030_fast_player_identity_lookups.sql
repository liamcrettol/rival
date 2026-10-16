-- ============================================================
-- 030 - Make the identity/emblem lookups read one row per player.
--
-- get_latest_player_identities (018/029a) and get_latest_player_emblems
-- (015/029a) sorted EVERY roster row a player has ever had to pick one.
-- Heavy players have tens of thousands of rows, so after the move to the
-- Lightsail server (cold cache) these took 3-6 s and blew Rival's 5 s
-- budget: rosters fell back to initials instead of emblems.
--
-- Same results, new shape: walk the player's rows newest-first through a
-- (membership_id, updated_at desc) index and stop at the first row that
-- passes. For identities, branch 1 is the best tier (real name, real
-- platform, has an emblem), which is exactly what the old ORDER BY put
-- first. Only players with no such row fall through to the old full sort.
--
-- Run the CREATE INDEX statement on its own (CONCURRENTLY cannot run inside
-- a transaction block), then the rest of the file.
-- ============================================================

create index concurrently if not exists crucible_match_players_member_updated_idx
  on public.crucible_match_players (membership_id, updated_at desc);

create or replace function public.get_latest_player_identities(p_membership_ids text[])
returns table(
  membership_id text,
  membership_type integer,
  display_name text,
  emblem_path text
)
language sql
stable
security definer
set search_path = public
as $$
  select picked.membership_id, picked.membership_type, picked.display_name, picked.emblem_path
  from (select distinct unnest(p_membership_ids) as id) ids
  cross join lateral (
    (
      select players.membership_id, players.membership_type, players.display_name,
             coalesce(nullif(players.emblem_path, ''), emblems.path) as emblem_path
      from public.crucible_match_players players
      left join public.crucible_emblems emblems on emblems.id = players.emblem_id
      where players.membership_id = ids.id
        and lower(trim(players.display_name)) not in ('guardian', 'destiny')
        and coalesce(players.membership_type, 0) <> 0
        and coalesce(nullif(players.emblem_path, ''), emblems.path) is not null
      order by players.updated_at desc
      limit 1
    )
    union all
    (
      select players.membership_id, players.membership_type, players.display_name,
             coalesce(nullif(players.emblem_path, ''), emblems.path) as emblem_path
      from public.crucible_match_players players
      left join public.crucible_emblems emblems on emblems.id = players.emblem_id
      where players.membership_id = ids.id
      order by
        case when lower(trim(players.display_name)) in ('guardian', 'destiny') then 1 else 0 end,
        case when coalesce(players.membership_type, 0) = 0 then 1 else 0 end,
        case when coalesce(nullif(players.emblem_path, ''), emblems.path) is null then 1 else 0 end,
        players.updated_at desc
      limit 1
    )
    limit 1
  ) picked;
$$;

revoke all on function public.get_latest_player_identities(text[]) from public, anon, authenticated;
grant execute on function public.get_latest_player_identities(text[]) to service_role;

create or replace function public.get_latest_player_emblems(p_membership_ids text[])
returns table(membership_id text, emblem_path text)
language sql
stable
security definer
set search_path = public
as $$
  select picked.membership_id, picked.emblem_path
  from (select distinct unnest(p_membership_ids) as id) ids
  cross join lateral (
    select players.membership_id,
           coalesce(nullif(players.emblem_path, ''), emblems.path) as emblem_path
    from public.crucible_match_players players
    left join public.crucible_emblems emblems on emblems.id = players.emblem_id
    where players.membership_id = ids.id
      and coalesce(nullif(players.emblem_path, ''), emblems.path) is not null
    order by players.updated_at desc
    limit 1
  ) picked;
$$;

revoke all on function public.get_latest_player_emblems(text[]) from public, anon, authenticated;
grant execute on function public.get_latest_player_emblems(text[]) to service_role;
