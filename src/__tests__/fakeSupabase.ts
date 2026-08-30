/**
 * Minimal in-memory fake of the Supabase client, purpose-built for testing
 * src/lib/userData.ts and src/userStore.ts without a real database.
 *
 * Models just enough of the real client's chainable query-builder shape
 * (.from().select().eq().maybeSingle(), .upsert(), .delete(), thenable
 * results) to exercise the exact call patterns userData.ts uses. Not a
 * general-purpose Supabase mock — extend it if a new query shape is needed.
 *
 * Not a *.test.ts file itself, so vitest does not pick it up as a suite.
 */

import { vi } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface FakeUser {
    id: string;
    email?: string;
}

function matches(row: Row, filters: [string, unknown][]): boolean {
    return filters.every(([k, v]) => row[k] === v);
}

export function createFakeSupabase(initialUser: FakeUser | null = null) {
    const tables: Record<string, Row[]> = {
        profiles: [],
        saved_roles: [],
        job_views: [],
        upskill_completions: [],
        generated_artifacts: [],
    };

    let currentUser: FakeUser | null = initialUser;

    function makeBuilder(table: string) {
        let mode: 'select' | 'upsert' | 'delete' = 'select';
        let payload: Row | null = null;
        let onConflict: string | undefined;
        const eqFilters: [string, unknown][] = [];
        let orderBy: { col: string; ascending: boolean } | null = null;
        let limitN: number | null = null;

        function resolve(single: boolean) {
            const rows = tables[table];

            if (mode === 'upsert' && payload) {
                const keys = (onConflict ?? 'id').split(',');
                const idx = rows.findIndex((r) => keys.every((k) => r[k] === payload![k]));
                const withId = { id: payload.id ?? `${table}-${rows.length}-${Math.random().toString(36).slice(2)}`, ...payload };
                if (idx >= 0) rows[idx] = { ...rows[idx], ...payload };
                else rows.push(withId);
                return { data: null, error: null };
            }
            if (mode === 'delete') {
                tables[table] = rows.filter((r) => !matches(r, eqFilters));
                return { data: null, error: null };
            }

            let filtered = rows.filter((r) => matches(r, eqFilters));
            if (orderBy) {
                const { col, ascending } = orderBy;
                filtered = [...filtered].sort((a, b) => {
                    const cmp = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
                    return ascending ? cmp : -cmp;
                });
            }
            if (limitN != null) filtered = filtered.slice(0, limitN);
            return single ? { data: filtered[0] ?? null, error: null } : { data: filtered, error: null };
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const builder: any = {
            select() { mode = 'select'; return builder; },
            upsert(row: Row, opts?: { onConflict?: string }) {
                mode = 'upsert';
                payload = row;
                onConflict = opts?.onConflict;
                return builder;
            },
            delete() { mode = 'delete'; return builder; },
            eq(col: string, val: unknown) { eqFilters.push([col, val]); return builder; },
            order(col: string, opts?: { ascending?: boolean }) {
                orderBy = { col, ascending: opts?.ascending ?? true };
                return builder;
            },
            limit(n: number) { limitN = n; return builder; },
            maybeSingle: () => Promise.resolve(resolve(true)),
            // Makes the builder itself awaitable, matching supabase-js's
            // PostgrestFilterBuilder (userData.ts does `await c.db.from(...).upsert(...)`
            // without a terminal method).
            then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
                return Promise.resolve(resolve(false)).then(onFulfilled, onRejected);
            },
        };
        return builder;
    }

    return {
        _tables: tables,
        _setUser(user: FakeUser | null) { currentUser = user; },
        from: vi.fn((table: string) => makeBuilder(table)),
        auth: {
            getUser: vi.fn(async () => ({ data: { user: currentUser }, error: currentUser ? null : { message: 'no session' } })),
            getSession: vi.fn(async () => ({ data: { session: currentUser ? { user: currentUser } : null } })),
            signInAnonymously: vi.fn(async (): Promise<{ data: { session: { user: FakeUser } | null }; error: { message: string } | null }> => {
                if (!currentUser) currentUser = { id: `anon-${Math.random().toString(36).slice(2)}` };
                return { data: { session: { user: currentUser } }, error: null };
            }),
            updateUser: vi.fn(async ({ email }: { email: string }): Promise<{ data: { user: FakeUser | null }; error: { message: string } | null }> => {
                if (currentUser) currentUser = { ...currentUser, email };
                return { data: { user: currentUser }, error: null };
            }),
            signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
            signOut: vi.fn(async () => { currentUser = null; return { error: null }; }),
            onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
        },
        rpc: vi.fn(async (fn: string) => {
            if (fn === 'delete_my_data' && currentUser) {
                for (const t of Object.keys(tables)) {
                    tables[t] = tables[t].filter((r) => r.user_id !== currentUser!.id && r.id !== currentUser!.id);
                }
            }
            return { data: null, error: null };
        }),
    };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
