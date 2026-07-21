-- ============================================================
-- 026 - Right-size the cron cadence, close the last RLS gap, and
-- drop an index nothing reads.
--
-- Context: the live schedules had drifted well past what migration
-- 010 declared. ping-sync-crucible was running every minute (010
-- specifies */10), which meant ~1,440 runs/day against a backfill
-- queue that is empty, and each of those runs re-mirrors the whole
-- Rerolled user roster (lib/crucible/siteRoster.ts) regardless of
-- whether anything is due.
--
-- Slowing these does NOT slow down what users see. The dashboard's
-- on-view path (/api/crucible/refresh) imports the viewer's newest
-- activity page inline on page load, and queue_due_crucible_syncs
-- is freshness-gated at 15 minutes. These crons are deep-backfill
-- only, so their cadence sets how fast history fills in behind the
-- user, not how fresh the dashboard looks.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cron cadence
-- cron.schedule upserts by job name, so this is idempotent and is
-- also what re-aligns the live schedule with a migration file.
-- ------------------------------------------------------------

-- Every minute -> every 5. Backfill still drains continuously; a
-- deep account just advances 12 pages/hour instead of 60, and the
-- queue is empty the overwhelming majority of the time anyway.
select cron.schedule(
  'ping-sync-crucible',
  '*/5 * * * *',
  $$select public.ping_cron_endpoint('/api/cron/sync-crucible')$$
);

-- Every 2 minutes -> every 15. This one fans out one RPC per
-- Bungie account plus an Appwrite read on every single run, so the
-- idle cost scales with user count. Trials lifetime K/D moves on
-- the order of days; 15 minutes is far finer than the data.
select cron.schedule(
  'ping-sync-trials-kd',
  '*/15 * * * *',
  $$select public.ping_cron_endpoint('/api/cron/sync-trials-kd')$$
);

-- Every 5 minutes -> hourly. Steady-state backlog is 4 rows out of
-- 65,459; the archive write already happens inline in
-- lib/pgcr/service.ts, so this sweep only catches stragglers.
select cron.schedule(
  'ping-reconcile-pgcr',
  '7 * * * *',
  $$select public.ping_cron_endpoint('/api/cron/reconcile-pgcr')$$
);

-- ------------------------------------------------------------
-- 2. Close the last RLS gap
-- Every other table in this database has RLS enabled with zero
-- policies (default-deny; the service-role client bypasses RLS).
-- match_hall_of_fame_cache was created without it in migration 025.
-- Rival ships no browser Supabase client at all - lib/supabase/
-- contains only admin.ts - so this is defense in depth rather than
-- a live exposure, but it also clears the Supabase linter warning.
-- ------------------------------------------------------------
alter table public.match_hall_of_fame_cache enable row level security;
revoke all on public.match_hall_of_fame_cache from anon, authenticated;

-- ------------------------------------------------------------
-- 3. Drop an index nothing reads
-- (mode_bucket, period DESC) has 0 scans since the last stats reset
-- (2026-06-30). crucible_matches is only ever queried by primary key
-- via .in("instance_id", ...) - see lib/crucible/matchHallOfFame.ts
-- and lib/crucible/headToHead.ts. The mode_bucket filters in
-- headToHead.ts target crucible_encounters, which keeps its own
-- crucible_encounters_mode_idx (that one IS used - do not drop it).
--
-- crucible_matches is on the hot import path, so this also removes a
-- per-insert index write.
-- ------------------------------------------------------------
drop index if exists public.crucible_matches_mode_period_idx;
