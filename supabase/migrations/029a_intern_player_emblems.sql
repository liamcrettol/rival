-- ============================================================
-- 029a - Store each emblem path once instead of on every roster row.
--
-- Measured 2026-10-15: crucible_match_players has ~7.1M rows and
-- emblem_path averages 68 bytes, but there are only ~1,000 distinct
-- paths. That is ~450 MB of repeated strings in the biggest table.
--
-- After this migration:
--   - crucible_emblems holds each path once.
--   - crucible_match_players.emblem_id points at it.
--   - A BEFORE trigger interns emblem_path on every insert/update and
--     stores NULL in the old column, so importMatch.ts keeps upserting
--     emblem_path unchanged.
--   - An upsert without an emblem keeps the row's existing emblem
--     instead of blanking it.
--
-- Readers resolve coalesce(emblem_path, crucible_emblems.path), so this is
-- safe to apply before, during and after the 029b backfill.
-- Apply this BEFORE deploying the matchHistory.ts change that embeds
-- crucible_emblems (PostgREST needs the foreign key to exist).
-- ============================================================

create table if not exists public.crucible_emblems (
  id integer generated always as identity primary key,
  path text not null unique
);

alter table public.crucible_emblems enable row level security;
revoke all on public.crucible_emblems from anon, authenticated;

-- Nullable, no default: adding it does not rewrite the table.
alter table public.crucible_match_players
  add column if not exists emblem_id integer references public.crucible_emblems(id);

create or replace function public.intern_crucible_player_emblem()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_id integer;
begin
  if nullif(new.emblem_path, '') is not null then
    select id into v_id from public.crucible_emblems where path = new.emblem_path;
    if v_id is null then
      insert into public.crucible_emblems (path) values (new.emblem_path)
      on conflict (path) do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from public.crucible_emblems where path = new.emblem_path;
      end if;
    end if;
    new.emblem_id := v_id;
  elsif tg_op = 'UPDATE' then
    new.emblem_id := coalesce(new.emblem_id, old.emblem_id);
  end if;
  new.emblem_path := null;
  return new;
end;
$$;

drop trigger if exists crucible_match_players_intern_emblem on public.crucible_match_players;
create trigger crucible_match_players_intern_emblem
  before insert or update on public.crucible_match_players
  for each row execute function public.intern_crucible_player_emblem();

-- Same signature and ordering as 018, reading the emblem through the new table.
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
    coalesce(nullif(players.emblem_path, ''), emblems.path) as emblem_path
  from public.crucible_match_players players
  left join public.crucible_emblems emblems on emblems.id = players.emblem_id
  where players.membership_id = any(p_membership_ids)
  order by
    players.membership_id,
    case when lower(trim(players.display_name)) in ('guardian', 'destiny') then 1 else 0 end,
    case when coalesce(players.membership_type, 0) = 0 then 1 else 0 end,
    case when coalesce(nullif(players.emblem_path, ''), emblems.path) is null then 1 else 0 end,
    players.updated_at desc;
$$;

revoke all on function public.get_latest_player_identities(text[]) from public;
grant execute on function public.get_latest_player_identities(text[]) to service_role;

-- Same signature as 015.
create or replace function public.get_latest_player_emblems(p_membership_ids text[])
returns table(membership_id text, emblem_path text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (players.membership_id)
    players.membership_id,
    coalesce(nullif(players.emblem_path, ''), emblems.path) as emblem_path
  from public.crucible_match_players players
  left join public.crucible_emblems emblems on emblems.id = players.emblem_id
  where players.membership_id = any(p_membership_ids)
    and coalesce(nullif(players.emblem_path, ''), emblems.path) is not null
  order by players.membership_id, players.updated_at desc;
$$;

revoke all on function public.get_latest_player_emblems(text[]) from public;
grant execute on function public.get_latest_player_emblems(text[]) to service_role;
