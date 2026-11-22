-- ============================================================================
-- 0005 · Saved answers are made again when they are too old
-- ============================================================================
-- api/_lib/gateway.ts treats a saved answer older than its feature's max age
-- (90 days by default, FOJ_SHARED_MAX_AGE_DAYS) as missing. The next
-- visitor's new answer must then REPLACE the old row, which 0003's
-- "insert ... on conflict do nothing" cannot do. ai_shared_answer_put does it
-- in one statement:
--   - no row with this key: insert it;
--   - a row saved before p_stale_before: replace payload, model and
--     data_version, and set created_at to now();
--   - a row saved since: keep it (two visitors at once: the first answer
--     saved wins, the second visitor gets it too, nobody gets an error);
-- then returns the stored { payload, created_at }.
--
-- data_version: the app's data vintages (src/shared/dataVersion.ts). It is
-- already inside input_hash, so a data refresh is a new key; the column only
-- shows which data a row was made from.
--
-- Same security model as 0003: server only, service role only.
-- Apply after 0004. Safe to run twice. supabase/setup_shared_answers.sql
-- holds 0003 + 0004 + this file, for a new project.
-- ============================================================================

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
