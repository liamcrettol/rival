-- Retry PGCR payloads retained in the Supabase outbox after a transient
-- Appwrite upload, verification, or metadata-stamp failure. The endpoint is
-- bounded below Vercel's hard timeout and only clears raw_pgcr after the
-- Appwrite object has been downloaded and checksum-verified.
--
-- DO NOT run this migration until Appwrite is configured (APPWRITE_ENDPOINT /
-- APPWRITE_PROJECT_ID / APPWRITE_API_KEY / APPWRITE_PGCR_BUCKET_ID set, and
-- PGCR_ARCHIVE_WRITES=1 turned on deliberately). Until then every pgcr_cache
-- row has a null appwrite_migrated_at, so the reconciliation worker would
-- treat every row as pending and burn cron invocations retrying uploads with
-- no credentials to do them.

do $$
begin
  if to_regprocedure('public.ping_cron_endpoint(text)') is null then
    raise exception 'ping_cron_endpoint(text) is missing; apply migration 010 first';
  end if;
end;
$$;

select cron.schedule(
  'ping-reconcile-pgcr',
  '*/5 * * * *',
  $$select public.ping_cron_endpoint('/api/cron/reconcile-pgcr')$$
);
