/**
 * Supabase client factory.
 *
 * DESIGN: auth is entirely OPTIONAL. When VITE_SUPABASE_URL /
 * VITE_SUPABASE_ANON_KEY are absent — CI, a fresh clone, a contributor who
 * has not set up a project — this module returns null and every persistence
 * call becomes a no-op. The app then behaves exactly as it did before user
 * accounts existed. Nothing here may ever throw at import time.
 *
 * SECURITY: the anon key is a publishable identifier, not a secret. It grants
 * no table privileges on its own; access is decided by Row Level Security in
 * supabase/migrations/0001_user_activity.sql. The service-role key must NEVER
 * appear in this file or anywhere else under src/.
 *
 * DECOUPLING: this is deliberately unrelated to the Claude API key mechanism.
 * The Claude key lives in localStorage and travels as an `x-user-api-key`
 * header to /api/claude/messages. Supabase sessions travel as the client's own
 * Authorization bearer token to a different origin. Neither can shadow the
 * other, and signing out does not disturb the Claude key.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

/** True when this build has a Supabase project configured. */
export const HAS_SUPABASE = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

if (HAS_SUPABASE) {
    try {
        client = createClient(url, anonKey, {
            auth: {
                // Keep the session across reloads; that is the whole point of
                // "returning users get their history back".
                persistSession: true,
                autoRefreshToken: true,
                // The app is a plain SPA with no OAuth redirect routes wired
                // up yet; magic links land back on '/' and are handled there.
                detectSessionInUrl: true,
                storageKey: 'foj_supabase_auth',
            },
        });
    } catch (err) {
        // A malformed URL must degrade to local-only rather than blank the app.
        console.warn('[supabase] client init failed; continuing without accounts:', err);
        client = null;
    }
}

/** The Supabase client, or null when accounts are not configured. */
export function getSupabase(): SupabaseClient | null {
    return client;
}
