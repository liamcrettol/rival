-- Remove the obsolete lifetime Trials K/D leaderboard pipeline.
select cron.unschedule('ping-sync-trials-kd')
where exists (select 1 from cron.job where jobname = 'ping-sync-trials-kd');

select cron.unschedule('refresh-trials-backfill-candidates')
where exists (select 1 from cron.job where jobname = 'refresh-trials-backfill-candidates');

drop function if exists public.get_trials_encounter_aggregate(text);
drop function if exists public.get_distinct_trials_opponents(integer);
drop function if exists public.get_trials_backfill_candidates(integer);
drop materialized view if exists public.trials_backfill_candidates;
