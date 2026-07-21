-- 012: Expose the current database size to service-role cron code.

create or replace function public.database_size_bytes()
returns bigint
language sql
security definer
set search_path = pg_catalog
stable
as $$
  select pg_database_size(current_database());
$$;

revoke all on function public.database_size_bytes() from public, anon, authenticated;
grant execute on function public.database_size_bytes() to service_role;
