import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import bakedFile from '../data/ai_scores.json';
import { getBakedScores, resolveInitialScores } from '../utils/bakedScores';
import { CACHE_VERSION } from '../utils/taskScoring';

const CACHE_KEY = 'foj_ai_scores_v1';

/** Minimal localStorage stand-in (tests run in the node environment). */
function installLocalStorage() {
    const store = new Map<string, string>();
    const mock = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    };
    vi.stubGlobal('localStorage', mock);
    return mock;
}

const anAnalysis = (score: number) => ({
    tasks: [{ taskName: 'x', aiCapabilityScore: score, humanCriticalityScore: 0.5 }],
    yearlyForecast: [
        { year: 2025, growthImpact: 0, reasoning: '' },
        { year: 2026, growthImpact: 1, reasoning: '' },
        { year: 2027, growthImpact: 2, reasoning: '' },
        { year: 2028, growthImpact: 3, reasoning: '' },
        { year: 2029, growthImpact: 4, reasoning: '' },
        { year: 2030, growthImpact: 5, reasoning: '' },
    ],
});

describe('baked score resolution', () => {
    beforeEach(() => installLocalStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('ships precomputed scores for every job at the current schema version', () => {
        const baked = getBakedScores();
        expect(baked).not.toBeNull();
        expect(bakedFile.version).toBe(CACHE_VERSION);
        expect(Object.keys(baked!.scores).length).toBe(50);
        expect(baked!.source).toBe('baked');
    });

    it('uses precomputed scores when no cache exists', () => {
        const resolved = resolveInitialScores();
        expect(resolved.source).toBe('baked');
        expect(Object.keys(resolved.scores).length).toBe(50);
    });

    it('prefers a newer cache but keeps precomputed scores for jobs it lacks', () => {
        // A re-score skips jobs whose response fails validation, so its cache can
        // cover fewer jobs than the precomputed file. Those must not be lost.
        const someJobId = Object.keys(getBakedScores()!.scores)[0];
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                version: CACHE_VERSION,
                timestamp: Date.now(), // newer than the committed file
                data: { [someJobId]: anAnalysis(0.99) },
            }),
        );

        const resolved = resolveInitialScores();
        expect(resolved.source).toBe('cache');
        // fresher value wins for the refreshed job...
        expect(resolved.scores[someJobId].tasks[0].aiCapabilityScore).toBe(0.99);
        // ...and every other job still has its precomputed scores
        expect(Object.keys(resolved.scores).length).toBe(50);
    });

    it('ignores a stale cache in favour of newer precomputed scores', () => {
        localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
                version: CACHE_VERSION,
                timestamp: Date.parse('2020-01-01T00:00:00Z'),
                data: { 'job-15': anAnalysis(0.01) },
            }),
        );

        const resolved = resolveInitialScores();
        expect(resolved.source).toBe('baked');
        expect(resolved.scores['job-15'].tasks[0].aiCapabilityScore).not.toBe(0.01);
    });
});
