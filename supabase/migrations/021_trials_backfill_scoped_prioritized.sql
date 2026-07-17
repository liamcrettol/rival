-- Rework the Trials K/D backfill from "fetch a lifetime K/D for every one of
-- the ~73k opponents anyone has ever faced" (a 9+ day, never-catches-up
-- treadmill against a shared, throttled Bungie API key) to a bounded,
-- prioritized working set.
--
-- Two facts drive this:
--   1. We only ever DISPLAY a viewer's ~15 highest-K/D beaten opponents, so a
--      low-K/D opponent's lifetime number is never shown and never worth a
--      Bungie call.
--   2. We already store per-player, per-match kills/deaths in
--      crucible_match_players (ingested from PGCRs, the same source Trials
--      Report builds on). That sample is too sparse to BE the lifetime K/D
--      (most players appear in a single game), but it's a good cheap signal
--      for PRIORITIZING which opponents to spend a real Bungie lookup on.
--
-- So: only consider opponents a registered viewer has actually beaten (in any
-- mode), ranked highest-apparent-skill first. The cron caches down this list,
-- so the high-K/D players that surface on leaderboards get cached first and
-- the long low-K/D tail can lag forever without affecting any board.
--
-- The ranking changes slowly and re-aggregating ~188k Trials PGCR rows on every
-- 2-minute cron run was ~3.5s (past PostgREST's statement timeout), so the
-- whole ordered candidate list is precomputed into an indexed materialized
-- view and refreshed hourly; the cron just reads the top N (~100ms). A viewer's
-- own freshly-beaten opponents are covered immediately by the leaderboard
-- route's inline top-up, so an hour-stale candidate list is fine.

drop function if exists public.get_distinct_trials_opponents(integer);

create materialized view if not exists public.trials_backfill_candidates as
  with beaten as (
    select
      encounters.opponent_membership_id as membership_id,
      (array_agg(encounters.opponent_membership_type order by encounters.played_at desc)
        filter (where encounters.opponent_membership_type is not null))[1] as membership_type
    from public.crucible_encounters encounters
    where encounters.viewer_won is true
    group by encounters.opponent_membership_id
  ),
  sampled as (
    -- Our own sampled Trials K/D from stored PGCR player rows. Used only to
    -- order the fetch queue, never shown; the displayed K/D is always the real
    -- Bungie lifetime value cached in Appwrite.
    select
      players.membership_id,
      sum(players.kills) as kills,
      sum(players.deaths) as deaths,
      count(*) as games
    from public.crucible_match_players players
    join public.crucible_matches matches
      on matches.instance_id = players.instance_id
     and matches.mode_bucket = 'trials'
    group by players.membership_id
  )
  select
    beaten.membership_id,
    beaten.membership_type,
    (case when coalesce(sampled.deaths, 0) > 0
          then sampled.kills::numeric / sampled.deaths
          else sampled.kills::numeric end) as priority,
    coalesce(sampled.games, 0) as games
  from beaten
  left join sampled on sampled.membership_id = beaten.membership_id;

-- Unique index is both the join/lookup key and a hard requirement for
-- REFRESH ... CONCURRENTLY below.
create unique index if not exists trials_backfill_candidates_pk
  on public.trials_backfill_candidates(membership_id);
create index if not exists trials_backfill_candidates_priority_idx
  on public.trials_backfill_candidates(priority desc nulls last, games desc);

create or replace function public.get_trials_backfill_candidates(
  p_limit integer default 500
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
  select membership_id, membership_type
  from public.trials_backfill_candidates
  order by priority desc nulls last, games desc
  limit greatest(1, least(p_limit, 2000));
$$;

revoke all on function public.get_trials_backfill_candidates(integer) from public;
grant execute on function public.get_trials_backfill_candidates(integer) to service_role;

-- Refresh the candidate ranking hourly. CONCURRENTLY keeps it readable during
-- the refresh (needs the unique index above and an already-populated view,
-- both true by the time this runs). Reuses pg_cron from migration 010.
select cron.schedule(
  'refresh-trials-backfill-candidates',
  '11 * * * *',
  $$refresh materialized view concurrently public.trials_backfill_candidates$$
);
