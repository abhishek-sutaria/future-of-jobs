-- ============================================================================
-- Saved shared AI answers + rate-limit counts, for api/claude.ts.
--
-- WHAT THIS ADDS
-- --------------
-- ai_shared_answers  One saved Claude answer per (role, feature, prompt
--                    version, input hash). The first visitor to open a role's
--                    Strategic Insight, Scenario, Roadmap or Defend / Build
--                    makes it; every later visitor gets the saved answer with
--                    no new Claude call. input_hash is the SHA-256 of the exact
--                    request sent to Claude, so a changed input or prompt never
--                    shows an old answer. Only answers that passed the app's
--                    checks are written.
-- ai_rate_limits     Fixed-window counters for NEW answers made with the
--                    server key (per visitor per hour and per day, and one
--                    whole-app daily ceiling). Visitors are a SHA-256 of their
--                    IP; no raw IP is stored.
-- ai_rate_take()     Atomic check-and-count over a set of buckets.
--
-- SECURITY MODEL
-- --------------
-- Server only. RLS is on and there are NO policies, and anon/authenticated
-- get no privileges: the browser's anon key cannot read, write or delete
-- anything here. Only the service role (SUPABASE_SERVICE_ROLE_KEY, set as a
-- Vercel env var and used only inside api/) can. To make one answer again,
-- delete it with scripts/shared_answers.mjs (service key, run by the owner).
--
-- Apply after 0001 and 0002: paste into the Supabase SQL editor, or
-- `supabase db push`.
-- ============================================================================

create table if not exists public.ai_shared_answers (
    role_key       text not null,          -- 'job-15' (Kelley) or 'soc:29-1141'
    feature        text not null check (feature in ('analyze', 'scenario', 'roadmap', 'upskill')),
    prompt_version text not null,
    input_hash     text not null check (input_hash ~ '^[0-9a-f]{64}$'),
    model          text not null,
    payload        jsonb not null,
    created_at     timestamptz not null default now(),
    primary key (role_key, feature, prompt_version, input_hash)
);
create index if not exists ai_shared_answers_role_idx
    on public.ai_shared_answers (role_key, feature);

create table if not exists public.ai_rate_limits (
    bucket     text primary key,             -- 'v:<visitor>:h:<hour>', 'v:<visitor>:d:<day>', 'g:d:<day>'
    count      integer not null default 0,
    expires_at timestamptz not null
);
create index if not exists ai_rate_limits_expires_idx on public.ai_rate_limits (expires_at);

alter table public.ai_shared_answers enable row level security;
alter table public.ai_rate_limits   enable row level security;

revoke all on public.ai_shared_answers from anon, authenticated;
revoke all on public.ai_rate_limits   from anon, authenticated;

grant select, insert, delete         on public.ai_shared_answers to service_role;
grant select, insert, update, delete on public.ai_rate_limits    to service_role;

-- Returns NULL when every bucket had room (and counts one in each), or the
-- first full bucket's key (and counts nothing). The caller sends the keys
-- sorted, so concurrent calls lock rows in the same order.
create or replace function public.ai_rate_take(p_keys text[], p_limits integer[], p_expires timestamptz[])
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
    i integer;
    c integer;
begin
    delete from public.ai_rate_limits where expires_at < now() - interval '1 hour';

    for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
        insert into public.ai_rate_limits (bucket, count, expires_at)
        values (p_keys[i], 0, p_expires[i])
        on conflict (bucket) do nothing;
    end loop;

    for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
        select count into c from public.ai_rate_limits where bucket = p_keys[i] for update;
        if c >= p_limits[i] then
            return p_keys[i];
        end if;
    end loop;

    update public.ai_rate_limits set count = count + 1 where bucket = any (p_keys);
    return null;
end;
$$;

revoke all on function public.ai_rate_take(text[], integer[], timestamptz[]) from public, anon, authenticated;
grant execute on function public.ai_rate_take(text[], integer[], timestamptz[]) to service_role;
