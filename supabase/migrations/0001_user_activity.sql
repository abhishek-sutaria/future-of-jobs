-- ============================================================================
-- Per-user activity persistence for "AI & Future of Work 2025-2030"
--
-- SECURITY MODEL
-- --------------
-- Isolation is enforced by Postgres Row Level Security, NOT by application
-- code. Every table below denies all access by default and then permits only
-- rows whose user_id equals auth.uid() (the caller's verified JWT subject).
-- A client cannot read or write another user's rows even with a hand-crafted
-- request, because the anon key carries no privileges of its own.
--
-- Both USING (governs SELECT/UPDATE/DELETE visibility) and WITH CHECK
-- (governs INSERT/UPDATE payloads) are specified. Omitting WITH CHECK would
-- let a caller insert a row bearing someone else's user_id.
--
-- Anonymous sign-ins are first-class: an anonymous visitor is a real row in
-- auth.users with a real uid, so their activity persists immediately. When
-- they later attach an email, Supabase upgrades that SAME user record, so
-- history carries over with no migration step.
--
-- PRIVACY
-- -------
-- Raw resume/CV text is never stored by this schema. Only derived results are
-- persisted, and only for artifact kinds the user explicitly opts into
-- ('startup_ideas', 'skills_analysis'). See src/lib/userData.ts.
--
-- Apply with:  supabase db push       (or paste into the SQL editor)
-- ============================================================================

-- ── profiles ────────────────────────────────────────────────────────────────
-- Optional display metadata. One row per auth user, created on demand.
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

-- ── saved_roles ─────────────────────────────────────────────────────────────
-- Explicit bookmarks. job_id/job_title are denormalised copies of bundled
-- app data (not user content) so the account panel renders without needing
-- the full job dataset loaded.
create table if not exists public.saved_roles (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    job_id     text not null,
    job_title  text not null,
    created_at timestamptz not null default now(),
    unique (user_id, job_id)
);
create index if not exists saved_roles_user_idx on public.saved_roles (user_id, created_at desc);

-- ── job_views ───────────────────────────────────────────────────────────────
-- "Recently viewed" history. Upserted with a counter rather than append-only
-- so it cannot grow without bound from repeated visits to the same role.
create table if not exists public.job_views (
    user_id        uuid not null references auth.users (id) on delete cascade,
    job_id         text not null,
    job_title      text not null,
    view_count     integer not null default 1,
    last_viewed_at timestamptz not null default now(),
    primary key (user_id, job_id)
);
create index if not exists job_views_recent_idx on public.job_views (user_id, last_viewed_at desc);

-- ── upskill_completions ─────────────────────────────────────────────────────
-- The app's only genuine progress state. Tiny, and today it is lost on reload
-- AND silently overwritten whenever a fresh Analyze rewrites task scores.
create table if not exists public.upskill_completions (
    user_id      uuid not null references auth.users (id) on delete cascade,
    job_id       text not null,
    task_name    text not null,
    completed_at timestamptz not null default now(),
    primary key (user_id, job_id, task_name)
);

-- ── generated_artifacts ─────────────────────────────────────────────────────
-- One table for every expensive Claude-generated artifact, rather than four
-- near-identical ones. cache_key is deterministic per kind, so reopening a
-- modal restores the saved result instead of re-billing a Claude call.
--
--   scenario        cache_key = job_id
--   roadmap         cache_key = job_id | riskTask | targetTask
--   startup_ideas   cache_key = sha-256 of the resume input (never the text)
--   skills_analysis cache_key = sha-256 of the resume input (never the text)
create table if not exists public.generated_artifacts (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    kind       text not null check (kind in ('scenario', 'roadmap', 'startup_ideas', 'skills_analysis')),
    job_id     text,
    job_title  text,
    cache_key  text not null,
    payload    jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (user_id, kind, cache_key)
);
create index if not exists generated_artifacts_user_kind_idx
    on public.generated_artifacts (user_id, kind, updated_at desc);

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.profiles             enable row level security;
alter table public.saved_roles          enable row level security;
alter table public.job_views            enable row level security;
alter table public.upskill_completions  enable row level security;
alter table public.generated_artifacts  enable row level security;

-- profiles keys on `id` rather than `user_id`.
drop policy if exists "profiles: own row only" on public.profiles;
create policy "profiles: own row only" on public.profiles
    for all to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

drop policy if exists "saved_roles: own rows only" on public.saved_roles;
create policy "saved_roles: own rows only" on public.saved_roles
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "job_views: own rows only" on public.job_views;
create policy "job_views: own rows only" on public.job_views
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "upskill_completions: own rows only" on public.upskill_completions;
create policy "upskill_completions: own rows only" on public.upskill_completions
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "generated_artifacts: own rows only" on public.generated_artifacts;
create policy "generated_artifacts: own rows only" on public.generated_artifacts
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- Belt and braces: the anon/publishable key is safe to ship publicly only
-- because it has no table privileges of its own. Make that explicit rather
-- than relying on the default grants of a given Supabase project version.
revoke all on public.profiles            from anon;
revoke all on public.saved_roles         from anon;
revoke all on public.job_views           from anon;
revoke all on public.upskill_completions from anon;
revoke all on public.generated_artifacts from anon;

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
    for each row execute function public.touch_updated_at();

drop trigger if exists generated_artifacts_touch on public.generated_artifacts;
create trigger generated_artifacts_touch before update on public.generated_artifacts
    for each row execute function public.touch_updated_at();

-- ── Account deletion ────────────────────────────────────────────────────────
-- Lets a user erase everything they have stored without needing a privileged
-- server route. SECURITY INVOKER (the default) means it runs as the caller,
-- so RLS still applies and it can only ever delete the caller's own rows.
create or replace function public.delete_my_data()
returns void
language sql
as $$
    delete from public.generated_artifacts where user_id = auth.uid();
    delete from public.upskill_completions  where user_id = auth.uid();
    delete from public.job_views            where user_id = auth.uid();
    delete from public.saved_roles          where user_id = auth.uid();
    delete from public.profiles             where id      = auth.uid();
$$;
