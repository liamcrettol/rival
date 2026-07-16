-- A minority of legacy/cross-save PGCR entries expose membershipType 0 and
-- the placeholder name "Guardian" even when another PGCR identifies the same
-- membership correctly. Resolve identity by membership id, preferring a real
-- name and usable platform type over the newest placeholder row.
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
  select distinct on (players.membership_id)
    players.membership_id,
    players.membership_type,
    players.display_name,
    players.emblem_path
  from public.crucible_match_players players
  where players.membership_id = any(p_membership_ids)
  order by
    players.membership_id,
    case when lower(trim(players.display_name)) in ('guardian', 'destiny') then 1 else 0 end,
    case when coalesce(players.membership_type, 0) = 0 then 1 else 0 end,
    case when nullif(players.emblem_path, '') is null then 1 else 0 end,
    players.updated_at desc;
$$;

revoke all on function public.get_latest_player_identities(text[]) from public;
grant execute on function public.get_latest_player_identities(text[]) to service_role;

-- Repair existing report rosters where the same membership has a known real
-- identity. Do not touch a genuine name or invent one for fully redacted IDs.
with canonical as materialized (
  select distinct on (players.membership_id)
    players.membership_id,
    players.membership_type,
    players.display_name,
    players.emblem_path
  from public.crucible_match_players players
  where lower(trim(players.display_name)) not in ('guardian', 'destiny')
  order by
    players.membership_id,
    case when coalesce(players.membership_type, 0) = 0 then 1 else 0 end,
    case when nullif(players.emblem_path, '') is null then 1 else 0 end,
    players.updated_at desc
)
update public.crucible_match_players stale
set display_name = canonical.display_name,
    membership_type = case
      when coalesce(stale.membership_type, 0) = 0 then canonical.membership_type
      else stale.membership_type
    end,
    emblem_path = coalesce(nullif(stale.emblem_path, ''), canonical.emblem_path),
    updated_at = now()
from canonical
where stale.membership_id = canonical.membership_id
  and lower(trim(stale.display_name)) in ('guardian', 'destiny');

with canonical as materialized (
  select distinct on (players.membership_id)
    players.membership_id,
    players.membership_type,
    players.display_name
  from public.crucible_match_players players
  where lower(trim(players.display_name)) not in ('guardian', 'destiny')
  order by
    players.membership_id,
    case when coalesce(players.membership_type, 0) = 0 then 1 else 0 end,
    players.updated_at desc
)
update public.crucible_encounters stale
set opponent_display_name = canonical.display_name,
    opponent_membership_type = case
      when coalesce(stale.opponent_membership_type, 0) = 0 then canonical.membership_type
      else stale.opponent_membership_type
    end
from canonical
where stale.opponent_membership_id = canonical.membership_id
  and lower(trim(stale.opponent_display_name)) in ('guardian', 'destiny');
