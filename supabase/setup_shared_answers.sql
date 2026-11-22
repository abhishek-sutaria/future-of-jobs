-- ============================================================================
-- Future of Jobs: saved shared answers + rate limits. ONE paste, new project.
-- ============================================================================
-- For the server-only Supabase project (docs/shared-answers-setup.md):
-- paste this whole file into Supabase -> SQL Editor -> New query -> Run.
-- Safe to run twice: every statement is "if not exists", "or replace", or a
-- grant/revoke that gives the same result again. It deletes nothing.
--
-- It holds supabase/migrations 0003 (tables, ai_rate_take), 0004
-- (ai_rate_give) and 0005 (data_version, ai_shared_answer_put: an old saved
-- answer is replaced, never kept forever). aiGateway.test.ts fails if a
-- statement from those files is missing here.
--
-- SECURITY: server only. RLS is on with NO policies, and anon/authenticated
-- get nothing, so a browser key cannot read or write any of it. Only the
-- service role (SUPABASE_SERVICE_ROLE_KEY, a Vercel env var used inside
-- api/ only) can.
--
-- Visitor accounts are NOT in this project: they stay in the other Supabase
-- project (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, migrations 0001-0002).
-- ============================================================================


-- ── 0003: tables, row security, ai_rate_take ────────────────────────────────

create table if not exists public.ai_shared_answers (
    role_key       text not null,          -- 'job-15' (Kelley) or 'soc:29-1141'
    feature        text not null check (feature in ('analyze', 'scenario', 'roadmap', 'upskill')),
    prompt_version text not null,
    input_hash     text not null check (input_hash ~ '^[0-9a-f]{64}$'),
    model          text not null,
    data_version   text,                   -- src/shared/dataVersion.ts (also inside input_hash)
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

grant select, insert, update, delete on public.ai_shared_answers to service_role;
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

-- ── 0004: ai_rate_give ──────────────────────────────────────────────────────

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

-- ── 0005: data_version, ai_shared_answer_put ────────────────────────────────

alter table public.ai_shared_answers add column if not exists data_version text;

grant select, insert, update, delete on public.ai_shared_answers to service_role;

create or replace function public.ai_shared_answer_put(
    p_role_key       text,
    p_feature        text,
    p_prompt_version text,
    p_input_hash     text,
    p_model          text,
    p_data_version   text,
    p_payload        jsonb,
    p_stale_before   timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    r public.ai_shared_answers%rowtype;
begin
    insert into public.ai_shared_answers as a
        (role_key, feature, prompt_version, input_hash, model, data_version, payload, created_at)
    values
        (p_role_key, p_feature, p_prompt_version, p_input_hash, p_model, p_data_version, p_payload, now())
    on conflict (role_key, feature, prompt_version, input_hash) do update
        set model        = excluded.model,
            data_version = excluded.data_version,
            payload      = excluded.payload,
            created_at   = now()
        where a.created_at < p_stale_before;

    select * into r
      from public.ai_shared_answers
     where role_key = p_role_key
       and feature = p_feature
       and prompt_version = p_prompt_version
       and input_hash = p_input_hash;

    return jsonb_build_object('payload', r.payload, 'created_at', r.created_at);
end;
$$;

revoke all on function public.ai_shared_answer_put(text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_shared_answer_put(text, text, text, text, text, text, jsonb, timestamptz) to service_role;

-- Tell the Supabase API about the new functions right away.
notify pgrst, 'reload schema';
