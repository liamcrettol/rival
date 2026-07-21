-- 016 - Track when a user's sitewide-known Crucible matches were last
-- materialized via materialize_sitewide_crucible_viewers(), so the direct
-- Rival sign-in path can call that RPC without re-scanning on every
-- dashboard render for a user who is still mid-backfill.
alter table public.crucible_sync_state
  add column if not exists known_matches_materialized_at timestamptz;
