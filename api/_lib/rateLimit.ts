/**
 * Per-visitor limit on NEW Claude answers made with the server key. Works on
 * serverless: the counts live in Supabase (table public.ai_rate_limits,
 * function public.ai_rate_take, supabase/migrations/0003_shared_ai_answers.sql),
 * so every function instance sees the same numbers.
 *
 * What counts: only a request that is about to call Claude on the server key.
 * A saved shared answer, a request with the visitor's own key, a refused
 * request and the status check never count.
 *
 * Buckets, all fixed windows (UTC):
 *   visitor per hour   FOJ_RATE_PER_HOUR        default 30
 *   visitor per day    FOJ_RATE_PER_DAY         default 100
 *   whole app per day  FOJ_RATE_GLOBAL_PER_DAY  default 1000 (a spend ceiling)
 *
 * A visitor is a SHA-256 of their IP address (the raw IP is never stored).
 * Students on one campus network can share an IP, which is why shared answers
 * matter: after the first student, a role's answers cost nothing.
 *
 * Without Supabase, or if Supabase errors, it falls back to counting in this
 * function instance's memory: weaker (each instance counts alone), never off.
 */

import { createHash } from 'node:crypto';
import { serviceHeaders, SupabaseError, type FetchLike, type ServerEnv, type SupabaseConfig } from './supabaseRest.js';

export interface RateLimits {
    perHour: number;
    perDay: number;
    globalPerDay: number;
}

export const DEFAULT_LIMITS: RateLimits = { perHour: 30, perDay: 100, globalPerDay: 1000 };

const positiveInt = (raw: string | undefined, fallback: number): number => {
    const n = Number.parseInt((raw ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function limitsFromEnv(env: ServerEnv): RateLimits {
    return {
        perHour: positiveInt(env.FOJ_RATE_PER_HOUR, DEFAULT_LIMITS.perHour),
        perDay: positiveInt(env.FOJ_RATE_PER_DAY, DEFAULT_LIMITS.perDay),
        globalPerDay: positiveInt(env.FOJ_RATE_GLOBAL_PER_DAY, DEFAULT_LIMITS.globalPerDay),
    };
}

export type Window = 'hour' | 'day' | 'global-day';

export interface Bucket {
    key: string;
    limit: number;
    window: Window;
    /** End of the window, epoch ms. */
    resetsAt: number;
}

export type TakeResult =
    | { allowed: true }
    | { allowed: false; window: Window; limit: number; retryAfterSeconds: number };

export interface RateLimiter {
    take(visitor: string, nowMs: number): Promise<TakeResult>;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Visitor id from the request: SHA-256 of the client IP (Vercel sets x-forwarded-for). */
export function visitorId(headers: Record<string, string | string[] | undefined>, remoteAddress?: string): string {
    const first = (name: string) => {
        const v = headers[name];
        const s = Array.isArray(v) ? v[0] : v;
        return typeof s === 'string' ? s.split(',')[0].trim() : '';
    };
    const ip = first('x-forwarded-for') || first('x-real-ip') || remoteAddress || 'unknown';
    return createHash('sha256').update(`foj-visitor|${ip}`).digest('hex').slice(0, 32);
}

/** The three buckets one new answer takes from, sorted so concurrent takes lock in one order. */
export function bucketsFor(visitor: string, nowMs: number, limits: RateLimits): Bucket[] {
    const hour = Math.floor(nowMs / HOUR);
    const day = Math.floor(nowMs / DAY);
    return [
        { key: `v:${visitor}:h:${hour}`, limit: limits.perHour, window: 'hour' as const, resetsAt: (hour + 1) * HOUR },
        { key: `v:${visitor}:d:${day}`, limit: limits.perDay, window: 'day' as const, resetsAt: (day + 1) * DAY },
        { key: `g:d:${day}`, limit: limits.globalPerDay, window: 'global-day' as const, resetsAt: (day + 1) * DAY },
    ].sort((a, b) => a.key.localeCompare(b.key));
}

function blocked(b: Bucket, nowMs: number): TakeResult {
    return { allowed: false, window: b.window, limit: b.limit, retryAfterSeconds: Math.max(1, Math.ceil((b.resetsAt - nowMs) / 1000)) };
}

/** Counts in this instance's memory. Used when Supabase is not configured or fails. */
export function memoryRateLimiter(limits: RateLimits): RateLimiter {
    const counts = new Map<string, { n: number; resetsAt: number }>();
    return {
        async take(visitor, nowMs) {
            for (const [k, v] of counts) if (v.resetsAt <= nowMs) counts.delete(k);
            const buckets = bucketsFor(visitor, nowMs, limits);
            for (const b of buckets) {
                if ((counts.get(b.key)?.n ?? 0) >= b.limit) return blocked(b, nowMs);
            }
            for (const b of buckets) counts.set(b.key, { n: (counts.get(b.key)?.n ?? 0) + 1, resetsAt: b.resetsAt });
            return { allowed: true };
        },
    };
}

/** Atomic check-and-count in Postgres (public.ai_rate_take). */
export function supabaseRateLimiter(cfg: SupabaseConfig, fetchImpl: FetchLike, limits: RateLimits, fallback: RateLimiter): RateLimiter {
    return {
        async take(visitor, nowMs) {
            const buckets = bucketsFor(visitor, nowMs, limits);
            try {
                const res = await fetchImpl(`${cfg.url}/rest/v1/rpc/ai_rate_take`, {
                    method: 'POST',
                    headers: serviceHeaders(cfg),
                    body: JSON.stringify({
                        p_keys: buckets.map((b) => b.key),
                        p_limits: buckets.map((b) => b.limit),
                        p_expires: buckets.map((b) => new Date(b.resetsAt).toISOString()),
                    }),
                });
                if (!res.ok) throw new SupabaseError('rate limit', res.status);
                const blockedKey = (await res.json()) as string | null;
                if (!blockedKey) return { allowed: true };
                const b = buckets.find((x) => x.key === blockedKey) ?? buckets[0];
                return blocked(b, nowMs);
            } catch (err) {
                console.warn('[ai-gateway] rate limit store unavailable, counting in memory:', err instanceof Error ? err.message : 'error');
                return fallback.take(visitor, nowMs);
            }
        },
    };
}
