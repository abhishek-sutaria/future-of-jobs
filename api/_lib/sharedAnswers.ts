/**
 * Saved shared answers: one Claude answer per role, feature, prompt version
 * and exact request, stored in Supabase table public.ai_shared_answers
 * (supabase/setup_shared_answers.sql) and served to every later visitor with
 * no new Claude call.
 *
 * The key is (role_key, feature, prompt_version, input_hash). input_hash is
 * the SHA-256 of DATA_VERSION (src/shared/dataVersion.ts) plus the exact
 * Anthropic request body (model, max_tokens, thinking and the prompt built
 * from the inputs), so a changed title, task, score, prompt text, model or
 * data vintage never shows an old answer.
 *
 * Max age: an answer older than its feature's max age (sharedMaxAgeDays:
 * the feature's own `maxAgeDays`, else FOJ_SHARED_MAX_AGE_DAYS, else 90 days)
 * is treated as missing. The next visitor's fresh answer then REPLACES the
 * old row (rpc ai_shared_answer_put), with a new created_at. A fresh row is
 * never overwritten: when two visitors race, the first answer saved is the
 * one both, and everyone after, get.
 *
 * Only the gateway writes, and only answers that passed the feature's check.
 * To make one answer again, delete it: scripts/shared_answers.mjs.
 */

import { createHash } from 'node:crypto';
import { serviceHeaders, SupabaseError, type FetchLike, type ServerEnv, type SupabaseConfig } from './supabaseRest.js';

export const SHARED_ANSWERS_TABLE = 'ai_shared_answers';
export const SHARED_ANSWER_PUT_RPC = 'ai_shared_answer_put';

/** A saved answer older than this many days is made again (env FOJ_SHARED_MAX_AGE_DAYS). */
export const SHARED_ANSWER_MAX_AGE_DAYS = 90;

const DAY_MS = 86_400_000;

export interface SharedAnswerKey {
    roleKey: string;
    feature: string;
    promptVersion: string;
    /** DATA_VERSION, also inside inputHash; stored so a row shows its data. */
    dataVersion: string;
    inputHash: string;
}

export interface SavedAnswer {
    payload: unknown;
    createdAt: string | null;
}

export interface SharedAnswerStore {
    get(key: SharedAnswerKey): Promise<SavedAnswer | null>;
    /**
     * Saves the answer, replacing a stored one only if that one was saved
     * before `staleBefore` (ISO time); returns the answer now stored.
     */
    put(key: SharedAnswerKey, payload: unknown, meta: { model: string; staleBefore: string }): Promise<SavedAnswer>;
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Hash of the data version and the exact request body sent to Claude (minus
 * `stream`, which never changes the answer).
 */
export function requestHash(body: { model: string; max_tokens: number; messages: unknown; thinking?: unknown }, dataVersion: string): string {
    return sha256Hex(JSON.stringify({ dataVersion, model: body.model, max_tokens: body.max_tokens, thinking: body.thinking ?? null, messages: body.messages }));
}

const positiveNumber = (raw: string | undefined): number | null => {
    const n = Number((raw ?? '').trim());
    return (raw ?? '').trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

/** Max age in days: the feature's own override, else FOJ_SHARED_MAX_AGE_DAYS, else 90. */
export function sharedMaxAgeDays(feature: { maxAgeDays?: number }, env: ServerEnv): number {
    if (typeof feature.maxAgeDays === 'number' && feature.maxAgeDays > 0) return feature.maxAgeDays;
    return positiveNumber(env.FOJ_SHARED_MAX_AGE_DAYS) ?? SHARED_ANSWER_MAX_AGE_DAYS;
}

/** The time before which a saved answer counts as too old. */
export const staleBefore = (nowMs: number, maxAgeDays: number): string => new Date(nowMs - maxAgeDays * DAY_MS).toISOString();

/** A saved answer is fresh if saved at or after `staleBefore`; no date (never from the database) counts as fresh. */
export function isFresh(saved: SavedAnswer, staleBeforeIso: string): boolean {
    if (!saved.createdAt) return true;
    const t = Date.parse(saved.createdAt);
    return Number.isNaN(t) || t >= Date.parse(staleBeforeIso);
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

export function supabaseSharedAnswers(cfg: SupabaseConfig, fetchImpl: FetchLike): SharedAnswerStore {
    const base = `${cfg.url}/rest/v1/${SHARED_ANSWERS_TABLE}`;
    const filter = (k: SharedAnswerKey) =>
        `role_key=${eq(k.roleKey)}&feature=${eq(k.feature)}&prompt_version=${eq(k.promptVersion)}&input_hash=${eq(k.inputHash)}`;

    return {
        async get(key) {
            const res = await fetchImpl(`${base}?select=payload,created_at&${filter(key)}&limit=1`, {
                method: 'GET',
                headers: serviceHeaders(cfg),
            });
            if (!res.ok) throw new SupabaseError('read', res.status);
            const rows = (await res.json()) as { payload: unknown; created_at: string | null }[];
            return rows.length > 0 ? { payload: rows[0].payload, createdAt: rows[0].created_at ?? null } : null;
        },
        async put(key, payload, meta) {
            // One atomic statement in the database: insert, or replace a row
            // saved before staleBefore, then return what is stored. Not
            // PostgREST's "on conflict do nothing", which would keep an old row forever.
            const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/${SHARED_ANSWER_PUT_RPC}`, {
                method: 'POST',
                headers: serviceHeaders(cfg),
                body: JSON.stringify({
                    p_role_key: key.roleKey,
                    p_feature: key.feature,
                    p_prompt_version: key.promptVersion,
                    p_input_hash: key.inputHash,
                    p_model: meta.model,
                    p_data_version: key.dataVersion,
                    p_payload: payload,
                    p_stale_before: meta.staleBefore,
                }),
            });
            if (!res.ok) throw new SupabaseError('write', res.status);
            const row = (await res.json()) as { payload?: unknown; created_at?: string | null } | null;
            if (!row || row.payload === undefined) return { payload, createdAt: null };
            return { payload: row.payload, createdAt: row.created_at ?? null };
        },
    };
}
