-- 027 - Covering index for per-user Trials-win lookups.
--
-- get_trials_backfill_candidates_for_user() (migrations 024a/024b) is called
-- once per registered account, every 15 minutes, by the sync-trials-kd cron
-- (app/api/cron/sync-trials-kd/route.ts). Its query filters
-- crucible_encounters by (viewer_user_id, viewer_won is true), and none of
-- the table's existing indexes (crucible_encounters_pair_idx/_mode_idx/
-- _history_idx, migration 002) cover viewer_won - every call falls back to
-- an index scan on viewer_user_id followed by a heap fetch per row just to
-- check viewer_won, reading a user's entire encounter history from disk on
-- every single cron tick, forever. Confirmed via pg_stat_statements as this
-- project's single largest disk I/O consumer by a wide margin (182k calls,
-- ~38.7M shared_blks_read - 15x+ the next-highest query).
--
-- This partial index covers exactly the (viewer_user_id, viewer_won is true)
-- access pattern and carries the columns the query selects
-- (opponent_membership_id, opponent_membership_type, played_at), so a
-- vacuumed table can answer the call with an index-only scan instead of
-- touching the heap at all.
--
-- CONCURRENTLY avoids locking crucible_encounters against the PGCR
-- importer's writes while it builds. This file must contain this single
-- statement only - CONCURRENTLY cannot run inside a transaction block, and
-- scripts/db-query.mjs sends a file's contents as one query; a second
-- statement here would make Postgres wrap both in an implicit transaction.

create index concurrently if not exists crucible_encounters_viewer_win_idx
  on public.crucible_encounters(viewer_user_id, opponent_membership_id, opponent_membership_type, played_at desc)
  where viewer_won is true;
