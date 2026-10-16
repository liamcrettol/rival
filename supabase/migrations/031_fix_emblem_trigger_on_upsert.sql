-- ============================================================
-- 031 - Fix 029a's emblem trigger dropping emblems on re-import.
--
-- importMatch.ts upserts rosters (INSERT ... ON CONFLICT DO UPDATE SET
-- emblem_path = excluded.emblem_path, ...). The BEFORE INSERT run of the
-- 029a trigger interned the path into emblem_id and nulled emblem_path on
-- the proposed row. On conflict, EXCLUDED is that proposed row, so the
-- update copied emblem_path = NULL and never copied emblem_id (it is not in
-- the payload). The BEFORE UPDATE run then saw no emblem: every re-imported
-- roster lost its emblem from 2026-10-16 ~00:57 UTC.
--
-- Now:
--   - INSERT: set emblem_id but KEEP emblem_path, so an ON CONFLICT update
--     still carries the path. (New rows keep the path inline until their
--     next update; that is a few KB a day.)
--   - UPDATE: intern whatever path arrives and null it. If none arrives,
--     keep the old emblem_id, or intern the row's old inline path, so an
--     update never erases an emblem.
-- ============================================================

create or replace function public.intern_crucible_emblem_path(p_path text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_id integer;
begin
  if nullif(p_path, '') is null then
    return null;
  end if;
  select id into v_id from public.crucible_emblems where path = p_path;
  if v_id is null then
    insert into public.crucible_emblems (path) values (p_path)
    on conflict (path) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.crucible_emblems where path = p_path;
    end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.intern_crucible_player_emblem()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.emblem_id := coalesce(public.intern_crucible_emblem_path(new.emblem_path), new.emblem_id);
    return new;
  end if;

  -- UPDATE
  new.emblem_id := coalesce(
    public.intern_crucible_emblem_path(new.emblem_path),
    new.emblem_id,
    old.emblem_id,
    public.intern_crucible_emblem_path(old.emblem_path)
  );
  new.emblem_path := null;
  return new;
end;
$$;

revoke all on function public.intern_crucible_emblem_path(text) from public, anon, authenticated;
