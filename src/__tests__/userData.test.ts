/**
 * Tests src/lib/userData.ts against a fake Supabase client (see
 * ./fakeSupabase.ts). This is the ONLY module that touches Supabase tables —
 * these tests are the second lock behind Row Level Security (which cannot be
 * exercised without a real Postgres instance; see scripts/verify_rls.mjs for
 * the manual two-user check that covers RLS itself).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createFakeSupabase, type FakeSupabase } from './fakeSupabase';

let fake: FakeSupabase;

vi.mock('../lib/supabase', () => ({
    get HAS_SUPABASE() { return true; },
    getSupabase: () => fake,
}));

// Imported AFTER the mock so userData.ts picks up the mocked module.
import {
    saveRole, unsaveRole, recordJobView, recordUpskill,
    saveArtifact, loadArtifact, deleteArtifact,
    loadUserActivity, deleteMyData, resumeCacheKey,
    scenarioCacheKey, roadmapCacheKey,
} from '../lib/userData';

describe('resumeCacheKey', () => {
    it('is deterministic for the same input', async () => {
        const a = await resumeCacheKey('Experienced software engineer, Python, React.');
        const b = await resumeCacheKey('Experienced software engineer, Python, React.');
        expect(a).toBe(b);
    });

    it('differs for different input', async () => {
        const a = await resumeCacheKey('Resume A');
        const b = await resumeCacheKey('Resume B');
        expect(a).not.toBe(b);
    });

    it('normalises whitespace so trivial formatting differences still hit the cache', async () => {
        const a = await resumeCacheKey('Python   Developer\n\nReact');
        const b = await resumeCacheKey('Python Developer React');
        expect(a).toBe(b);
    });

    it('never contains the original text (it is a cache key, not the resume)', async () => {
        const secret = 'John Doe, SSN 123-45-6789, lives at 42 Wallaby Way';
        const key = await resumeCacheKey(secret);
        expect(key).not.toContain('John');
        expect(key).not.toContain('Wallaby');
        expect(key.length).toBeLessThan(secret.length);
    });
});

describe('scenarioCacheKey / roadmapCacheKey', () => {
    it('scenario key is just the job id', () => {
        expect(scenarioCacheKey('job-15')).toBe('job-15');
    });

    it('roadmap key is specific to the exact task transition', () => {
        const a = roadmapCacheKey('job-15', 'Draft ad copy', 'Lead client strategy');
        const b = roadmapCacheKey('job-15', 'Draft ad copy', 'Manage budgets');
        expect(a).not.toBe(b);
    });
});

describe('saved roles', () => {
    beforeEach(() => { fake = createFakeSupabase({ id: 'user-a' }); });

    it('saves and lists a role', async () => {
        const ok = await saveRole('job-15', 'Marketing Manager');
        expect(ok).toBe(true);
        const activity = await loadUserActivity();
        expect(activity.savedRoles).toEqual([
            expect.objectContaining({ jobId: 'job-15', jobTitle: 'Marketing Manager' }),
        ]);
    });

    it('upsert is idempotent — saving the same role twice does not duplicate it', async () => {
        await saveRole('job-15', 'Marketing Manager');
        await saveRole('job-15', 'Marketing Manager');
        const activity = await loadUserActivity();
        expect(activity.savedRoles).toHaveLength(1);
    });

    it('unsaving removes it', async () => {
        await saveRole('job-15', 'Marketing Manager');
        const ok = await unsaveRole('job-15');
        expect(ok).toBe(true);
        const activity = await loadUserActivity();
        expect(activity.savedRoles).toHaveLength(0);
    });
});

describe('job views', () => {
    beforeEach(() => { fake = createFakeSupabase({ id: 'user-a' }); });

    it('increments view_count on repeat views of the same job', async () => {
        await recordJobView('job-15', 'Marketing Manager');
        await recordJobView('job-15', 'Marketing Manager');
        await recordJobView('job-15', 'Marketing Manager');
        const activity = await loadUserActivity();
        expect(activity.recentViews).toHaveLength(1);
        expect(activity.recentViews[0].viewCount).toBe(3);
    });

    it('tracks separate jobs independently', async () => {
        await recordJobView('job-15', 'Marketing Manager');
        await recordJobView('job-9', 'Software Developer');
        const activity = await loadUserActivity();
        expect(activity.recentViews.map((v) => v.jobId).sort()).toEqual(['job-15', 'job-9']);
    });
});

describe('upskill completions', () => {
    beforeEach(() => { fake = createFakeSupabase({ id: 'user-a' }); });

    it('records a completion', async () => {
        const ok = await recordUpskill('job-15', 'Draft ad copy');
        expect(ok).toBe(true);
        const activity = await loadUserActivity();
        expect(activity.upskillCompletions).toEqual([
            expect.objectContaining({ jobId: 'job-15', taskName: 'Draft ad copy' }),
        ]);
    });

    it('is idempotent per (job, task) pair', async () => {
        await recordUpskill('job-15', 'Draft ad copy');
        await recordUpskill('job-15', 'Draft ad copy');
        const activity = await loadUserActivity();
        expect(activity.upskillCompletions).toHaveLength(1);
    });
});

describe('generated artifacts (scenario / roadmap / startup ideas / skills)', () => {
    beforeEach(() => { fake = createFakeSupabase({ id: 'user-a' }); });

    it('round-trips a saved artifact by (kind, cacheKey)', async () => {
        const payload = { story: 'In 2030...', keyChanges: ['a', 'b', 'c'] };
        const ok = await saveArtifact('scenario', 'job-15', payload, { jobId: 'job-15', jobTitle: 'Marketing Manager' });
        expect(ok).toBe(true);

        const loaded = await loadArtifact('scenario', 'job-15');
        expect(loaded).toEqual(payload);
    });

    it('returns null for a cache key that was never saved', async () => {
        const loaded = await loadArtifact('roadmap', 'job-99|X|Y');
        expect(loaded).toBeNull();
    });

    it('different artifact kinds with the same cacheKey do not collide', async () => {
        await saveArtifact('scenario', 'job-15', { a: 1 });
        await saveArtifact('roadmap', 'job-15', { b: 2 });
        expect(await loadArtifact('scenario', 'job-15')).toEqual({ a: 1 });
        expect(await loadArtifact('roadmap', 'job-15')).toEqual({ b: 2 });
    });

    it('overwrites on re-save with the same (kind, cacheKey)', async () => {
        await saveArtifact('scenario', 'job-15', { story: 'v1' });
        await saveArtifact('scenario', 'job-15', { story: 'v2' });
        const loaded = await loadArtifact('scenario', 'job-15');
        expect(loaded).toEqual({ story: 'v2' });
    });

    it('deletes an artifact', async () => {
        await saveArtifact('scenario', 'job-15', { story: 'v1' });
        const ok = await deleteArtifact('scenario', 'job-15');
        expect(ok).toBe(true);
        expect(await loadArtifact('scenario', 'job-15')).toBeNull();
    });
});

describe('cross-user isolation', () => {
    it('user B sees none of user A\'s saved roles, views, upskills, or artifacts', async () => {
        fake = createFakeSupabase({ id: 'user-a' });
        await saveRole('job-15', 'Marketing Manager');
        await recordJobView('job-15', 'Marketing Manager');
        await recordUpskill('job-15', 'Draft ad copy');
        await saveArtifact('scenario', 'job-15', { story: 'user A story' });

        // Switch the fake session to a different user, as sign-out + a fresh
        // sign-in would in the real app.
        fake._setUser({ id: 'user-b' });

        const activityB = await loadUserActivity();
        expect(activityB.savedRoles).toHaveLength(0);
        expect(activityB.recentViews).toHaveLength(0);
        expect(activityB.upskillCompletions).toHaveLength(0);
        expect(activityB.artifacts).toHaveLength(0);
        expect(await loadArtifact('scenario', 'job-15')).toBeNull();

        // User A's data is untouched by user B's session existing.
        fake._setUser({ id: 'user-a' });
        const activityA = await loadUserActivity();
        expect(activityA.savedRoles).toHaveLength(1);
        expect(await loadArtifact('scenario', 'job-15')).toEqual({ story: 'user A story' });
    });

    it('user B saving the same jobId/cacheKey does not overwrite user A\'s row', async () => {
        fake = createFakeSupabase({ id: 'user-a' });
        await saveArtifact('scenario', 'job-15', { story: 'A' });

        fake._setUser({ id: 'user-b' });
        await saveArtifact('scenario', 'job-15', { story: 'B' });

        fake._setUser({ id: 'user-a' });
        expect(await loadArtifact('scenario', 'job-15')).toEqual({ story: 'A' });
    });
});

describe('deleteMyData', () => {
    it('erases everything for the current user only', async () => {
        fake = createFakeSupabase({ id: 'user-a' });
        await saveRole('job-15', 'Marketing Manager');
        await recordUpskill('job-15', 'Draft ad copy');
        await saveArtifact('scenario', 'job-15', { story: 'A' });

        fake._setUser({ id: 'user-b' });
        await saveRole('job-9', 'Software Developer');

        fake._setUser({ id: 'user-a' });
        const ok = await deleteMyData();
        expect(ok).toBe(true);

        const activityA = await loadUserActivity();
        expect(activityA.savedRoles).toHaveLength(0);
        expect(activityA.upskillCompletions).toHaveLength(0);
        expect(activityA.artifacts).toHaveLength(0);

        fake._setUser({ id: 'user-b' });
        const activityB = await loadUserActivity();
        expect(activityB.savedRoles).toHaveLength(1);
    });
});

describe('failure / unconfigured states', () => {
    it('every write no-ops (does not throw) when nobody is signed in', async () => {
        fake = createFakeSupabase(null);
        await expect(saveRole('job-15', 'Marketing Manager')).resolves.toBe(false);
        await expect(recordUpskill('job-15', 'x')).resolves.toBe(false);
        await expect(saveArtifact('scenario', 'job-15', {})).resolves.toBe(false);
        await expect(deleteMyData()).resolves.toBe(false);
    });

    it('every read returns an empty/null result (never throws) when nobody is signed in', async () => {
        fake = createFakeSupabase(null);
        await expect(loadUserActivity()).resolves.toEqual({
            savedRoles: [], recentViews: [], upskillCompletions: [], artifacts: [],
        });
        await expect(loadArtifact('scenario', 'job-15')).resolves.toBeNull();
    });

    it('a thrown getUser error degrades to signed-out behaviour rather than throwing', async () => {
        fake = createFakeSupabase({ id: 'user-a' });
        fake.auth.getUser = vi.fn().mockRejectedValue(new Error('network down'));
        await expect(saveRole('job-15', 'Marketing Manager')).resolves.toBe(false);
        await expect(loadUserActivity()).resolves.toEqual({
            savedRoles: [], recentViews: [], upskillCompletions: [], artifacts: [],
        });
    });
});
