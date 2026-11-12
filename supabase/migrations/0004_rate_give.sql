-- ============================================================================
-- 0004 · Give a rate-limit slot back when Claude's answer fails
-- ============================================================================
-- api/_lib/gateway.ts counts a NEW Claude answer on the server key against
-- the visitor's hour and day buckets (ai_rate_take, 0003) before it calls
-- Claude. If that call then fails (an upstream error, or an answer that fails
-- parsing or the app's checks), the gateway calls ai_rate_give with the
-- visitor's own bucket keys, so a failed click does not use up a slot. The
-- whole-app day bucket ('g:d:<day>') is never given back: the call was still
-- paid for, and that bucket is the spend ceiling.
--
-- Same security model as 0003: server only, service role only.
-- Apply after 0003: paste into the Supabase SQL editor, or `supabase db push`.
-- Until it is applied, the gateway logs a warning and the slot stays used
-- (the app still works).
-- ============================================================================

create or replace function public.ai_rate_give(p_keys text[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
    update public.ai_rate_limits
       set count = greatest(count - 1, 0)
     where bucket = any (p_keys)
       and bucket like 'v:%';
end;
$$;

revoke all on function public.ai_rate_give(text[]) from public, anon, authenticated;
grant execute on function public.ai_rate_give(text[]) to service_role;
