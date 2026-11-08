/**
 * Minimal server-side Supabase access (PostgREST over fetch) with the
 * SERVICE key. Server only: this file is under api/, never imported by src/,
 * so the service key can never reach the browser bundle.
 *
 * Env (Vercel → Project Settings → Environment Variables):
 *   SUPABASE_URL               project URL (falls back to VITE_SUPABASE_URL, already set for accounts)
 *   SUPABASE_SERVICE_ROLE_KEY  service role / secret key: the one the owner must add
 *
 * Never logs or returns a key. With either missing, `supabaseConfig` returns
 * the missing names and callers fall back (no saved answers, in-memory limit).
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ServerEnv {
    ANTHROPIC_API_KEY?: string;
    SUPABASE_URL?: string;
    VITE_SUPABASE_URL?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
    FOJ_RATE_PER_HOUR?: string;
    FOJ_RATE_PER_DAY?: string;
    FOJ_RATE_GLOBAL_PER_DAY?: string;
}

export interface SupabaseConfig {
    url: string;
    key: string;
}

export function supabaseConfig(env: ServerEnv): { config: SupabaseConfig | null; missing: string[] } {
    const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    const missing: string[] = [];
    if (!url) missing.push('SUPABASE_URL');
    if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
    return { config: missing.length === 0 ? { url, key } : null, missing };
}

/**
 * Headers for a service-key request. New-style secret keys (sb_secret_…) go in
 * `apikey` only; legacy service_role JWTs also go in Authorization.
 */
export function serviceHeaders(cfg: SupabaseConfig, extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { apikey: cfg.key, 'content-type': 'application/json', ...extra };
    if (!cfg.key.startsWith('sb_')) h.authorization = `Bearer ${cfg.key}`;
    return h;
}

export class SupabaseError extends Error {
    readonly status: number;
    constructor(op: string, status: number) {
        // Status only: a PostgREST body can echo request details.
        super(`Supabase ${op} failed (HTTP ${status})`);
        this.name = 'SupabaseError';
        this.status = status;
    }
}
