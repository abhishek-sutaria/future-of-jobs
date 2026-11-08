/// <reference types="vite/client" />

// Vite asset URL imports (e.g. import x from 'foo?url')
declare module '*?url' {
    const src: string;
    export default src;
}

// Published BLS AI scores, served by scripts/lib/blsScoresPlugin.ts.
declare module 'virtual:bls-scores' {
    export const meta: import('./utils/blsScoresData').BlsBundleMeta | null;
    export const risks: Record<string, number>;
    export const fieldLoaders: Record<string, () => Promise<{ default: import('./utils/blsScoresData').RawBlsFile }>>;
}

interface ImportMetaEnv {
    readonly VITE_BLS_API_KEY: string;
    readonly VITE_HAS_DEFAULT_CLAUDE_KEY: boolean;
    /**
     * Supabase project URL and anon (publishable) key.
     * The anon key is designed to be public — it carries no privileges of its
     * own and every table is gated by Row Level Security. Absent values are
     * expected and supported: the app degrades to local-only, no-account mode.
     */
    readonly VITE_SUPABASE_URL: string;
    readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
