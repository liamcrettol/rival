-- ============================================================
-- 032 - Make materialize_sitewide_crucible_viewers incremental per user.
--
-- With p_user_ids (sign-in, dashboard every 15 min, new users from the
-- roster sync), the 014 version re-joined the user's ENTIRE history: every
-- match they ever played, every opponent in it, and an ON CONFLICT check
-- per row. Measured on Lightsail 2026-10-16: 10 s for the heaviest user
-- (30,835 matches), against a 1.2-5 s client budget.
--
-- Now it only looks at the user's matches that either
--   - have no crucible_match_viewers row yet, or
--   - were re-imported (crucible_matches.updated_at moved) after this user's
--     encounters for that match were last derived,
-- and records encounters_checked_at on the viewer row once derived. Same
-- rows get inserted as before; the p_user_ids IS NULL (cron, last hour) path
-- is unchanged.
--
-- encounters_checked_at is nullable with no default, so adding it does not
-- rewrite the table. Existing rows fall back to created_at.
-- ============================================================

alter table public.crucible_match_viewers
  add column if not exists encounters_checked_at timestamptz;

create or replace function public.materialize_sitewide_crucible_viewers(
  p_user_ids text[] default null
)
returns table(viewers_inserted bigint, encounters_inserted bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_ids is null then
    -- Unchanged from 014: matches touched in the last hour, all accounts.
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
      where matches.updated_at >= now() - interval '1 hour'
      on conflict (viewer_user_id, instance_id) do nothing
      returning 1
    )
    select count(*) into viewers_inserted from inserted;

    with inserted as (
      insert into public.crucible_encounters (
        viewer_user_id, viewer_membership_id, opponent_membership_id,
        opponent_membership_type, opponent_display_name, instance_id,
        mode_bucket, viewer_won, played_at
      )
      select
        accounts.user_id, accounts.membership_id, opponent.membership_id,
        opponent.membership_type, opponent.display_name, matches.instance_id,
        matches.mode_bucket, viewer.is_win, matches.period
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
      where matches.updated_at >= now() - interval '1 hour'
      on conflict (viewer_user_id, opponent_membership_id, instance_id) do nothing
      returning 1
    )
    select count(*) into encounters_inserted from inserted;

    return next;
    return;
  end if;

  -- Per-user path: only matches that are new to the user or re-imported since
  -- their encounters were last derived.
  drop table if exists pg_temp.materialize_candidates;
  create temp table materialize_candidates on commit drop as
  select
    accounts.user_id,
    accounts.membership_id,
    viewer.instance_id,
    viewer.team_id,
    viewer.is_win,
    matches.period,
    matches.mode_bucket
  from public.bungie_accounts accounts
  join public.crucible_match_players viewer
    on viewer.membership_id = accounts.membership_id
  join public.crucible_matches matches
    on matches.instance_id = viewer.instance_id
  left join public.crucible_match_viewers existing
    on existing.viewer_user_id = accounts.user_id
   and existing.instance_id = viewer.instance_id
  where accounts.user_id = any(p_user_ids)
    and (
      existing.instance_id is null
      or matches.updated_at > coalesce(existing.encounters_checked_at, existing.created_at)
    );

  with inserted as (
    insert into public.crucible_match_viewers (
      viewer_user_id, viewer_membership_id, instance_id, played_at
    )
    select user_id, membership_id, instance_id, period
    from materialize_candidates
    on conflict (viewer_user_id, instance_id) do nothing
    returning 1
  )
  select count(*) into viewers_inserted from inserted;

  with inserted as (
    insert into public.crucible_encounters (
      viewer_user_id, viewer_membership_id, opponent_membership_id,
      opponent_membership_type, opponent_display_name, instance_id,
      mode_bucket, viewer_won, played_at
    )
    select
      candidate.user_id, candidate.membership_id, opponent.membership_id,
      opponent.membership_type, opponent.display_name, candidate.instance_id,
      candidate.mode_bucket, candidate.is_win, candidate.period
    from materialize_candidates candidate
    join public.crucible_match_players opponent
      on opponent.instance_id = candidate.instance_id
     and candidate.team_id is not null
     and opponent.team_id is not null
     and opponent.team_id <> candidate.team_id
    on conflict (viewer_user_id, opponent_membership_id, instance_id) do nothing
    returning 1
  )
  select count(*) into encounters_inserted from inserted;

  update public.crucible_match_viewers viewers
  set encounters_checked_at = now()
  from materialize_candidates candidate
  where viewers.viewer_user_id = candidate.user_id
    and viewers.instance_id = candidate.instance_id;

  return next;
end;
$$;

revoke all on function public.materialize_sitewide_crucible_viewers(text[]) from public, anon, authenticated;
grant execute on function public.materialize_sitewide_crucible_viewers(text[]) to service_role;
