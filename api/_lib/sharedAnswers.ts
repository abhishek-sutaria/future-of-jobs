/**
 * Saved shared answers: one Claude answer per role, feature, prompt version
 * and exact request, stored in Supabase table public.ai_shared_answers
 * (supabase/migrations/0003_shared_ai_answers.sql) and served to every later
 * visitor with no new Claude call.
 *
 * The key is (role_key, feature, prompt_version, input_hash). input_hash is
 * the SHA-256 of the exact Anthropic request body (model, max_tokens and the
 * prompt built from the inputs), so a changed title, task, score or prompt
 * text never shows an old answer.
 *
 * Only the gateway writes, and only answers that passed the feature's check.
 * To make one answer again, delete it: scripts/shared_answers.mjs.
 */

import { createHash } from 'node:crypto';
import { serviceHeaders, SupabaseError, type FetchLike, type SupabaseConfig } from './supabaseRest.js';

export const SHARED_ANSWERS_TABLE = 'ai_shared_answers';

export interface SharedAnswerKey {
    roleKey: string;
    feature: string;
    promptVersion: string;
    inputHash: string;
}

export interface SavedAnswer {
    payload: unknown;
    createdAt: string | null;
}

export interface SharedAnswerStore {
    get(key: SharedAnswerKey): Promise<SavedAnswer | null>;
    /** Saves unless an answer with this key exists; returns the answer now stored. */
    put(key: SharedAnswerKey, payload: unknown, meta: { model: string }): Promise<SavedAnswer>;
}

export const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Hash of the exact request body sent to Claude (minus `stream`, which never changes the answer). */
export function requestHash(body: { model: string; max_tokens: number; messages: unknown; thinking?: unknown }): string {
    return sha256Hex(JSON.stringify({ model: body.model, max_tokens: body.max_tokens, thinking: body.thinking ?? null, messages: body.messages }));
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

export function supabaseSharedAnswers(cfg: SupabaseConfig, fetchImpl: FetchLike): SharedAnswerStore {
    const base = `${cfg.url}/rest/v1/${SHARED_ANSWERS_TABLE}`;
    const filter = (k: SharedAnswerKey) =>
        `role_key=${eq(k.roleKey)}&feature=${eq(k.feature)}&prompt_version=${eq(k.promptVersion)}&input_hash=${eq(k.inputHash)}`;

    const get = async (key: SharedAnswerKey): Promise<SavedAnswer | null> => {
        const res = await fetchImpl(`${base}?select=payload,created_at&${filter(key)}&limit=1`, {
            method: 'GET',
            headers: serviceHeaders(cfg),
        });
        if (!res.ok) throw new SupabaseError('read', res.status);
        const rows = (await res.json()) as { payload: unknown; created_at: string | null }[];
        return rows.length > 0 ? { payload: rows[0].payload, createdAt: rows[0].created_at ?? null } : null;
    };

    return {
        get,
        async put(key, payload, meta) {
            const res = await fetchImpl(`${base}?on_conflict=role_key,feature,prompt_version,input_hash`, {
                method: 'POST',
                headers: serviceHeaders(cfg, { prefer: 'resolution=ignore-duplicates,return=minimal' }),
                body: JSON.stringify([{
                    role_key: key.roleKey,
                    feature: key.feature,
                    prompt_version: key.promptVersion,
                    input_hash: key.inputHash,
                    model: meta.model,
                    payload,
                }]),
            });
            if (!res.ok) throw new SupabaseError('write', res.status);
            // Two first visitors can race: whichever answer landed first is the
            // one everyone sees from now on, so read back what is stored.
            return (await get(key)) ?? { payload, createdAt: null };
        },
    };
}
