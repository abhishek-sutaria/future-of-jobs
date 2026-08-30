/**
 * User identity + persisted activity.
 *
 * WHY A SEPARATE STORE: src/store.ts is a single 546-line store covering the
 * visualisation domain. Auth is a genuinely separate concern that must stay
 * decoupled from the Claude API-key mechanism, and giving it its own store
 * avoids refactoring working code. Conventions are copied from store.ts
 * deliberately — no middleware, hand-rolled immutable updates, pure helpers at
 * module scope, and the {source, loadedAt, isLoading} provenance triple used
 * by blsSource / scoresSource.
 *
 * ANONYMOUS-FIRST: a visitor gets a real (anonymous) Supabase user on first
 * load, so activity persists with zero friction and the 3D/map experience is
 * never gated behind a login wall. Attaching an email later upgrades that SAME
 * user record, so nothing is lost on upgrade.
 */

import { create } from 'zustand';
import type { User } from '@supabase/supabase-js';
import { getSupabase, HAS_SUPABASE } from './lib/supabase';
import { useStore } from './store';
import {
    loadUserActivity,
    saveRole as dbSaveRole,
    unsaveRole as dbUnsaveRole,
    recordJobView as dbRecordJobView,
    recordUpskill as dbRecordUpskill,
    deleteMyData as dbDeleteMyData,
    EMPTY_ACTIVITY,
    type UserActivity,
} from './lib/userData';

/**
 * Re-apply persisted upskill boosts for one job (or every job when omitted) by
 * replaying store.ts's own `upskillTask` mutation.
 *
 * WHY THIS EXISTS: store.ts's `applyAnalysesToJobs` overwrites a job's task
 * scores wholesale from a fresh Claude analysis (see its comment in
 * src/store.ts), which silently erases any in-memory upskill boost. Call this
 * right after any store.ts action that runs `applyAnalysesToJobs` — auto/manual
 * Analyze, or a full re-score — to restore boosts for tasks the user has
 * actually completed. Lives here, not in store.ts, so store.ts never needs to
 * import the user store (auth stays a one-way dependency: this layer knows
 * about the visualisation store, never the reverse).
 */
export function reapplyUpskillCompletions(jobId?: string): void {
    const completions = useUserStore.getState().activity.upskillCompletions;
    if (completions.length === 0) return;
    const upskillTask = useStore.getState().upskillTask;
    for (const c of completions) {
        if (jobId && c.jobId !== jobId) continue;
        upskillTask(c.jobId, c.taskName);
    }
}

/**
 * disabled  — no Supabase configured; app runs exactly as it did pre-accounts
 * loading   — hydration in flight
 * anonymous — real user row, no email attached yet
 * identified— email attached; history follows them across devices
 */
export type AuthStatus = 'disabled' | 'loading' | 'anonymous' | 'identified';

export type ActivitySource = 'none' | 'server';

interface UserState {
    // ── identity ──
    user: User | null;
    authStatus: AuthStatus;
    authError: string | null;

    // ── activity ──
    activity: UserActivity;
    isLoadingActivity: boolean;
    activitySource: ActivitySource;
    activityLoadedAt: number | null;

    // ── ui ──
    accountModalOpen: boolean;
    openAccountModal: () => void;
    closeAccountModal: () => void;

    // ── actions ──
    hydrateUserSession: () => Promise<void>;
    refreshActivity: () => Promise<void>;
    signInWithEmail: (email: string) => Promise<{ ok: boolean; message: string }>;
    signOut: () => Promise<void>;
    deleteMyData: () => Promise<boolean>;

    toggleSavedRole: (jobId: string, jobTitle: string) => Promise<void>;
    isRoleSaved: (jobId: string) => boolean;
    recordJobView: (jobId: string, jobTitle: string) => Promise<void>;
    recordUpskillCompletion: (jobId: string, taskName: string) => Promise<void>;
}

/** An email is the signal that a user has moved beyond an anonymous session. */
function statusForUser(user: User | null): AuthStatus {
    if (!HAS_SUPABASE) return 'disabled';
    if (!user) return 'loading';
    return user.email ? 'identified' : 'anonymous';
}

/**
 * Guards against React StrictMode's double-invoked effects in dev, which would
 * otherwise fire two anonymous sign-ins and create a duplicate user row.
 * store.ts guards fetchRealData the same way.
 */
let hydrationInFlight: Promise<void> | null = null;

export const useUserStore = create<UserState>((set, get) => ({
    user: null,
    authStatus: HAS_SUPABASE ? 'loading' : 'disabled',
    authError: null,

    activity: EMPTY_ACTIVITY,
    isLoadingActivity: false,
    activitySource: 'none',
    activityLoadedAt: null,

    accountModalOpen: false,
    openAccountModal: () => set({ accountModalOpen: true }),
    closeAccountModal: () => set({ accountModalOpen: false, authError: null }),

    hydrateUserSession: async () => {
        if (!HAS_SUPABASE) {
            set({ authStatus: 'disabled' });
            return;
        }
        if (hydrationInFlight) return hydrationInFlight;

        hydrationInFlight = (async () => {
            const db = getSupabase();
            if (!db) {
                set({ authStatus: 'disabled' });
                return;
            }
            try {
                let { data: { session } } = await db.auth.getSession();

                // No session yet -> create an anonymous one so activity can be
                // saved immediately without asking anyone to sign up.
                if (!session) {
                    const { data, error } = await db.auth.signInAnonymously();
                    if (error) {
                        // Anonymous sign-ins are off by default in Supabase.
                        // Surface it, but leave the app fully usable.
                        console.warn('[userStore] anonymous sign-in unavailable:', error.message);
                        set({
                            user: null,
                            authStatus: 'disabled',
                            authError: 'Accounts are unavailable right now.',
                        });
                        return;
                    }
                    session = data.session;
                }

                const user = session?.user ?? null;
                set({ user, authStatus: statusForUser(user), authError: null });

                // React to sign-in/out/upgrade from anywhere (including another tab).
                db.auth.onAuthStateChange((_event, nextSession) => {
                    const nextUser = nextSession?.user ?? null;
                    const prevId = get().user?.id;
                    set({ user: nextUser, authStatus: statusForUser(nextUser) });
                    if (nextUser && nextUser.id !== prevId) void get().refreshActivity();
                });

                if (user) await get().refreshActivity();
            } catch (err) {
                console.warn('[userStore] hydration failed:', err);
                set({ authStatus: 'disabled', authError: 'Could not reach the account service.' });
            } finally {
                hydrationInFlight = null;
            }
        })();

        return hydrationInFlight;
    },

    refreshActivity: async () => {
        if (!HAS_SUPABASE) return;
        set({ isLoadingActivity: true });
        try {
            const activity = await loadUserActivity();
            set({
                activity,
                activitySource: 'server',
                activityLoadedAt: Date.now(),
            });
        } catch (err) {
            console.warn('[userStore] activity load failed:', err);
        } finally {
            set({ isLoadingActivity: false });
        }
    },

    signInWithEmail: async (email) => {
        const db = getSupabase();
        if (!db) return { ok: false, message: 'Accounts are not configured for this build.' };

        const trimmed = email.trim();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
            return { ok: false, message: 'Enter a valid email address.' };
        }

        try {
            const { user } = get();
            // An anonymous user gets UPGRADED in place, which preserves their
            // uid and therefore every row they have already saved. A signed-out
            // visitor gets a normal magic link instead.
            if (user && !user.email) {
                const { error } = await db.auth.updateUser({ email: trimmed });
                if (error) {
                    // This specific failure means the email is already the
                    // PRIMARY address of a different auth.users row (e.g. they
                    // upgraded on another device/browser before). Supabase can't
                    // just reassign it — the only correct move is to sign them
                    // into that existing account instead of failing outright.
                    // Note: this browser's guest activity does NOT auto-merge
                    // into it; that would require a server-side migration this
                    // app doesn't perform, since it would need a privileged key.
                    if (/already (registered|exists)/i.test(error.message)) {
                        const { error: otpError } = await db.auth.signInWithOtp({
                            email: trimmed,
                            options: { emailRedirectTo: window.location.origin },
                        });
                        if (otpError) {
                            set({ authError: otpError.message });
                            return { ok: false, message: otpError.message };
                        }
                        return {
                            ok: true,
                            message:
                                `${trimmed} is already linked to an account. We sent a sign-in link ` +
                                `instead — note that activity saved in this browser as a guest won't ` +
                                `automatically transfer to it.`,
                        };
                    }
                    set({ authError: error.message });
                    return { ok: false, message: error.message };
                }
                return {
                    ok: true,
                    message: `Confirmation sent to ${trimmed}. Your saved activity stays with this account.`,
                };
            }

            const { error } = await db.auth.signInWithOtp({
                email: trimmed,
                options: { emailRedirectTo: window.location.origin },
            });
            if (error) {
                set({ authError: error.message });
                return { ok: false, message: error.message };
            }
            return { ok: true, message: `Sign-in link sent to ${trimmed}.` };
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Sign-in failed.';
            set({ authError: message });
            return { ok: false, message };
        }
    },

    signOut: async () => {
        const db = getSupabase();
        if (!db) return;
        try {
            await db.auth.signOut();
        } catch (err) {
            console.warn('[userStore] sign-out failed:', err);
        }
        // Clear in-memory user data immediately so nothing from the previous
        // account can be observed by whoever uses this browser next. NOTE: the
        // Claude API key is deliberately left untouched — it is a separate
        // browser-local concern, not part of the user account.
        set({
            user: null,
            authStatus: HAS_SUPABASE ? 'loading' : 'disabled',
            activity: EMPTY_ACTIVITY,
            activitySource: 'none',
            activityLoadedAt: null,
            accountModalOpen: false,
        });
        // Start a fresh anonymous session so saving still works right away.
        void get().hydrateUserSession();
    },

    deleteMyData: async () => {
        const ok = await dbDeleteMyData();
        if (ok) {
            set({
                activity: EMPTY_ACTIVITY,
                activitySource: 'server',
                activityLoadedAt: Date.now(),
            });
        }
        return ok;
    },

    toggleSavedRole: async (jobId, jobTitle) => {
        const { activity, isRoleSaved } = get();
        const currentlySaved = isRoleSaved(jobId);

        // Optimistic: the account panel should feel instant. Reconciled by the
        // refreshActivity() call below if the server disagrees.
        set({
            activity: {
                ...activity,
                savedRoles: currentlySaved
                    ? activity.savedRoles.filter((r) => r.jobId !== jobId)
                    : [{ jobId, jobTitle, createdAt: new Date().toISOString() }, ...activity.savedRoles],
            },
        });

        const ok = currentlySaved ? await dbUnsaveRole(jobId) : await dbSaveRole(jobId, jobTitle);
        if (!ok) await get().refreshActivity();
    },

    isRoleSaved: (jobId) => get().activity.savedRoles.some((r) => r.jobId === jobId),

    recordJobView: async (jobId, jobTitle) => {
        if (!HAS_SUPABASE) return;
        await dbRecordJobView(jobId, jobTitle);
        const { activity } = get();
        const existing = activity.recentViews.find((v) => v.jobId === jobId);
        const updated = {
            jobId,
            jobTitle,
            viewCount: (existing?.viewCount ?? 0) + 1,
            lastViewedAt: new Date().toISOString(),
        };
        set({
            activity: {
                ...activity,
                recentViews: [updated, ...activity.recentViews.filter((v) => v.jobId !== jobId)].slice(0, 50),
            },
        });
    },

    recordUpskillCompletion: async (jobId, taskName) => {
        if (!HAS_SUPABASE) return;
        const ok = await dbRecordUpskill(jobId, taskName);
        if (!ok) return;
        const { activity } = get();
        if (activity.upskillCompletions.some((u) => u.jobId === jobId && u.taskName === taskName)) return;
        set({
            activity: {
                ...activity,
                upskillCompletions: [
                    ...activity.upskillCompletions,
                    { jobId, taskName, completedAt: new Date().toISOString() },
                ],
            },
        });
    },
}));
