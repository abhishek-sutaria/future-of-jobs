-- ============================================================================
-- Fix: grant the `authenticated` role basic table access.
--
-- WHY THIS IS NEEDED
-- -------------------
-- Row Level Security (0001_user_activity.sql) controls WHICH ROWS a role can
-- see/modify, but Postgres also requires a separate, more basic GRANT before
-- a role may attempt a query on a table AT ALL. Supabase projects normally
-- default-grant this to `authenticated` automatically, but that default is
-- tied to the "Automatically expose new tables" project setting — which this
-- project has off (the more security-conscious choice for the `anon` role,
-- but it also suppressed the `authenticated` grant these tables need).
--
-- Without this, every request from a signed-in (including anonymous) user was
-- rejected with 403 before RLS was ever evaluated — RLS was never the
-- problem, the tables were simply ungranted.
--
-- RLS still fully applies after this: this grant says "authenticated users
-- may attempt SELECT/INSERT/UPDATE/DELETE on this table", and the policies
-- from 0001 still decide which rows they actually see.
-- ============================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.profiles             to authenticated;
grant select, insert, update, delete on public.saved_roles          to authenticated;
grant select, insert, update, delete on public.job_views            to authenticated;
grant select, insert, update, delete on public.upskill_completions  to authenticated;
grant select, insert, update, delete on public.generated_artifacts  to authenticated;

grant execute on function public.delete_my_data() to authenticated;
