-- ============================================================
-- 025 - Cache computed match hall of fame per user
-- ============================================================
-- getMatchHallOfFame() scans a viewer's entire crucible history (matches +
-- players, unbounded by design) on every request. Recomputing that from
-- scratch on every /leaderboard visit is what blew through the Supabase
-- read quota. Cache the computed result and only recompute when the
-- viewer's encounter count has actually grown - crucible_encounters is
-- insert-only/idempotent (see importer invariant in CLAUDE.md), so a
-- stable count reliably means "nothing new to fold in".

create table if not exists match_hall_of_fame_cache (
  user_id text primary key references users(id) on delete cascade,
  encounter_count integer not null,
  entries jsonb not null,
  computed_at timestamptz not null default now()
);
