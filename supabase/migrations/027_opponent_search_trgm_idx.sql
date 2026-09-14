-- ============================================================
-- 027 - Trigram index for opponent name search.
--
-- Context: found during the 2026-09-14 scheduled production health
-- audit. searchLocalOpponents (lib/crucible/opponentSearch.ts) runs
-- `.ilike("opponent_display_name", "%query%")` scoped by
-- viewer_user_id on crucible_encounters, on every search keystroke.
-- A leading-wildcard ILIKE can't use a plain btree index, and none of
-- this table's existing indexes (crucible_encounters_pair_idx,
-- crucible_encounters_mode_idx, crucible_encounters_history_idx) cover
-- opponent_display_name at all. The codebase's own comments elsewhere
-- document accounts with 8,700+ unique opponents / 22k+ encounters, so
-- this is a real per-user sequential scan, not a theoretical one.
--
-- A GIN trigram index lets Postgres satisfy the wildcard match
-- directly and combine it with the existing viewer_user_id btree
-- index via a bitmap AND, instead of a full per-user sequential scan
-- and row-by-row pattern match.
-- ============================================================

create extension if not exists pg_trgm;

create index if not exists crucible_encounters_opponent_name_trgm_idx
  on crucible_encounters using gin (opponent_display_name gin_trgm_ops);
