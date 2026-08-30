/**
 * Tests src/userStore.ts session lifecycle and the upskill-persistence
 * interaction with src/store.ts (applyAnalysesToJobs wiping in-memory boosts —
 * see AGENTS.md and reapplyUpskillCompletions's own comment).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

// vi.mock factories are hoisted above imports/module-scope declarations, so the
// mutable test state they close over must be created via vi.hoisted().
const mockState = vi.hoisted(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fake: null as any,
    hasSupabase: true,
}));

vi.mock('../lib/supabase', () => ({
    get HAS_SUPABASE() { return mockState.hasSupabase; },
    getSupabase: () => (mockState.hasSupabase ? mockState.fake : null),
}));

// Thin local aliases so the rest of the file reads naturally; every write
// goes through these setters so mockState (what the mocked module sees)
// always stays in sync.
let fake: FakeSupabase;
const setFake = (f: FakeSupabase) => { fake = f; mockState.fake = f; };
const setHasSupabase = (v: boolean) => { mockState.hasSupabase = v; };

vi.mock('../utils/bls', () => ({
    fetchLaborStats: vi.fn(() => Promise.resolve({ values: new Map(), source: 'live', fetchedAt: Date.now() })),
    getSeriesIdForJob: vi.fn(() => null),
}));
vi.mock('../utils/onet', () => ({ getRealOnetTasks: vi.fn(() => []), MAP_TITLE_TO_SOC: {} }));
vi.mock('../data/geo_real.json', () => ({ default: {} }));

// Imported after the mocks so both stores pick up the mocked Supabase module.
import { useUserStore, reapplyUpskillCompletions } from '../userStore';
import { useStore } from '../store';
import { initialJobs } from '../data';

// This suite runs in vitest's default 'node' environment (no jsdom — see
// vite.config.ts), which has no `window` global. signInWithEmail's
// signInWithOtp calls read `window.location.origin` for the magic-link
// redirect, which is always present in the real browser runtime; stub it here
// the same way analyzeCache.test.ts/bakedScores.test.ts stub `localStorage`.
vi.stubGlobal('window', { location: { origin: 'http://localhost:5173' } });

describe('session lifecycle', () => {
    beforeEach(() => {
        setHasSupabase(true);
        setFake(createFakeSupabase(null));
        useUserStore.setState({
            user: null, authStatus: 'loading', authError: null,
            activity: { savedRoles: [], recentViews: [], upskillCompletions: [], artifacts: [] },
            activitySource: 'none', activityLoadedAt: null,
        });
    });

    it('bootstraps a real anonymous user with no explicit sign-in', async () => {
        await useUserStore.getState().hydrateUserSession();
        const state = useUserStore.getState();
        expect(state.authStatus).toBe('anonymous');
        expect(state.user?.id).toBeTruthy();
        expect(state.user?.email).toBeFalsy();
    });

    it('does not double-sign-in when hydrateUserSession is called twice concurrently (StrictMode)', async () => {
        const p1 = useUserStore.getState().hydrateUserSession();
        const p2 = useUserStore.getState().hydrateUserSession();
        await Promise.all([p1, p2]);
        expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });

    it('upgrading an anonymous session to email preserves the same user id', async () => {
        await useUserStore.getState().hydrateUserSession();
        const anonId = useUserStore.getState().user?.id;

        const res = await useUserStore.getState().signInWithEmail('person@example.com');
        expect(res.ok).toBe(true);
        expect(fake.auth.updateUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'person@example.com' }));
        // updateUser in the fake mutates currentUser in place; re-check via getUser.
        const { data } = await fake.auth.getUser();
        expect(data.user?.id).toBe(anonId);
        expect(data.user?.email).toBe('person@example.com');
    });

    it('an email already claimed by a different account falls back to signing into THAT account', async () => {
        await useUserStore.getState().hydrateUserSession();
        // Simulates Supabase's real response when the email is the primary
        // address of a different auth.users row (e.g. upgraded on another
        // device already) — this is the exact error hit in practice.
        fake.auth.updateUser = vi.fn(async () => ({
            data: { user: null },
            error: { message: 'User already exists with email address: absutari@iu.edu' },
        }));

        const res = await useUserStore.getState().signInWithEmail('absutari@iu.edu');

        expect(res.ok).toBe(true);
        expect(res.message).toMatch(/already linked/i);
        expect(fake.auth.signInWithOtp).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'absutari@iu.edu' })
        );
    });

    it('handles Supabase\'s actual updateUser conflict wording ("...has already been registered")', async () => {
        await useUserStore.getState().hydrateUserSession();
        // This is the literal message Supabase's GoTrue API returns from
        // updateUser() on an email conflict — confirmed against the real
        // error a user hit in production. It differs from the wording in
        // the test above ("already exists") by the inserted "been", which
        // previously fell through the regex and surfaced as a dead-end
        // raw error instead of triggering the sign-in-link fallback.
        fake.auth.updateUser = vi.fn(async () => ({
            data: { user: null },
            error: { message: 'A user with this email address has already been registered' },
        }));

        const res = await useUserStore.getState().signInWithEmail('absutari@iu.edu');

        expect(res.ok).toBe(true);
        expect(res.message).toMatch(/already linked/i);
        expect(fake.auth.signInWithOtp).toHaveBeenCalledWith(
            expect.objectContaining({ email: 'absutari@iu.edu' })
        );
    });

    it('rejects an invalid email without calling the backend', async () => {
        await useUserStore.getState().hydrateUserSession();
        const res = await useUserStore.getState().signInWithEmail('not-an-email');
        expect(res.ok).toBe(false);
        expect(fake.auth.updateUser).not.toHaveBeenCalled();
        expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it('sign-out clears in-memory activity and starts a fresh anonymous session', async () => {
        await useUserStore.getState().hydrateUserSession();
        const firstId = useUserStore.getState().user?.id;
        await useUserStore.getState().toggleSavedRole('job-15', 'Marketing Manager');
        expect(useUserStore.getState().activity.savedRoles).toHaveLength(1);

        await useUserStore.getState().signOut();
        // Sign-out synchronously clears state before re-hydrating.
        expect(useUserStore.getState().activity.savedRoles).toHaveLength(0);

        // Wait for the fresh anonymous session hydrateUserSession() kicks off.
        await new Promise((r) => setTimeout(r, 0));
        const secondId = useUserStore.getState().user?.id;
        expect(secondId).toBeTruthy();
        expect(secondId).not.toBe(firstId);
    });

    it('degrades to disabled with no error thrown when Supabase is not configured', async () => {
        setHasSupabase(false);
        useUserStore.setState({ authStatus: 'disabled' });
        await useUserStore.getState().hydrateUserSession();
        expect(useUserStore.getState().authStatus).toBe('disabled');
        expect(useUserStore.getState().activity.savedRoles).toHaveLength(0);
    });

    it('anonymous sign-ins disabled on the backend degrades gracefully, not to a crash', async () => {
        fake.auth.signInAnonymously = vi.fn(async () => ({
            data: { session: null },
            error: { message: 'Anonymous sign-ins are disabled' },
        }));
        await useUserStore.getState().hydrateUserSession();
        expect(useUserStore.getState().authStatus).toBe('disabled');
        expect(useUserStore.getState().authError).toBeTruthy();
    });
});

describe('saved-role toggle (optimistic update)', () => {
    beforeEach(async () => {
        setHasSupabase(true);
        setFake(createFakeSupabase(null));
        useUserStore.setState({
            user: null, authStatus: 'loading', authError: null,
            activity: { savedRoles: [], recentViews: [], upskillCompletions: [], artifacts: [] },
            activitySource: 'none', activityLoadedAt: null,
        });
        await useUserStore.getState().hydrateUserSession();
    });

    it('toggling saves then un-saves a role', async () => {
        expect(useUserStore.getState().isRoleSaved('job-15')).toBe(false);
        await useUserStore.getState().toggleSavedRole('job-15', 'Marketing Manager');
        expect(useUserStore.getState().isRoleSaved('job-15')).toBe(true);
        await useUserStore.getState().toggleSavedRole('job-15', 'Marketing Manager');
        expect(useUserStore.getState().isRoleSaved('job-15')).toBe(false);
    });
});

describe('reapplyUpskillCompletions (survives applyAnalysesToJobs overwriting task scores)', () => {
    beforeEach(async () => {
        setHasSupabase(true);
        setFake(createFakeSupabase(null));
        useUserStore.setState({
            user: null, authStatus: 'loading', authError: null,
            activity: { savedRoles: [], recentViews: [], upskillCompletions: [], artifacts: [] },
            activitySource: 'none', activityLoadedAt: null,
        });
        await useUserStore.getState().hydrateUserSession();
        // useStore is a module-scoped singleton, not re-created per test — reset
        // it to pristine seed data so upskillTask boosts from one test don't
        // accumulate into (and clamp out) the next.
        useStore.setState({ jobs: initialJobs, selectedJob: null });
    });

    it('a fresh analysis wipes the boost, and reapplyUpskillCompletions restores it', () => {
        const job = useStore.getState().jobs[0];
        const task = job.tasks[0];

        // Complete an upskill: this is the same mutation UpskillModal triggers.
        useStore.getState().upskillTask(job.id, task.name);
        const boosted = useStore.getState().jobs.find((j) => j.id === job.id)!.tasks[0];
        expect(boosted.humanCriticalityScore).toBeGreaterThan(task.humanCriticalityScore);

        // Record it as persisted activity (what UpskillModal does after upskillTask).
        useUserStore.setState({
            activity: {
                ...useUserStore.getState().activity,
                upskillCompletions: [{ jobId: job.id, taskName: task.name, completedAt: new Date().toISOString() }],
            },
        });

        // Simulate a fresh Analyze overwriting scores wholesale for this job —
        // same store.ts helper applyAnalysesToJobs uses internally, reached here
        // via updateJobFromLiveAnalysis with a result that reverts the score.
        useStore.getState().updateJobFromLiveAnalysis(job.id, {
            strategic_insight: '',
            tasks: job.tasks.map((t) => ({
                task_text: t.name,
                ai_exposure_score: t.aiCapabilityScore,
                human_criticality_score: t.humanCriticalityScore, // back to pre-boost value
                reasoning: '',
            })),
            yearlyForecast: [],
            likely_replacements: [],
            human_centric_traits: [],
            human_resilience_label: '—',
            salary_volatility_label: '—',
            salary_forecast: [],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const wiped = useStore.getState().jobs.find((j) => j.id === job.id)!.tasks[0];
        expect(wiped.humanCriticalityScore).toBe(task.humanCriticalityScore); // boost gone

        reapplyUpskillCompletions(job.id);

        const restored = useStore.getState().jobs.find((j) => j.id === job.id)!.tasks[0];
        expect(restored.humanCriticalityScore).toBeGreaterThan(task.humanCriticalityScore);
        expect(restored.humanCriticalityScore).toBe(boosted.humanCriticalityScore);
    });

    it('does nothing when there are no persisted completions', () => {
        const job = useStore.getState().jobs[0];
        const before = useStore.getState().jobs.find((j) => j.id === job.id);
        reapplyUpskillCompletions(job.id);
        const after = useStore.getState().jobs.find((j) => j.id === job.id);
        expect(after).toEqual(before);
    });

    it('scoped to jobId only re-applies that job\'s completions, not another job\'s', () => {
        const [jobA, jobB] = useStore.getState().jobs;
        useUserStore.setState({
            activity: {
                ...useUserStore.getState().activity,
                upskillCompletions: [
                    { jobId: jobA.id, taskName: jobA.tasks[0].name, completedAt: new Date().toISOString() },
                    { jobId: jobB.id, taskName: jobB.tasks[0].name, completedAt: new Date().toISOString() },
                ],
            },
        });

        reapplyUpskillCompletions(jobA.id);

        const a = useStore.getState().jobs.find((j) => j.id === jobA.id)!.tasks[0];
        const b = useStore.getState().jobs.find((j) => j.id === jobB.id)!.tasks[0];
        expect(a.humanCriticalityScore).toBeGreaterThan(jobA.tasks[0].humanCriticalityScore);
        expect(b.humanCriticalityScore).toBe(jobB.tasks[0].humanCriticalityScore); // untouched
    });
});
