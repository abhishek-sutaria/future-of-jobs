import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    analyzeFingerprint,
    loadAnalyzeCacheEntry,
    saveAnalyzeCacheEntry,
    type JobAnalysis,
} from '../utils/analysis';

const CACHE_KEY = 'foj_analyze_cache_v1';

function installLocalStorage() {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
    });
}

const sample: JobAnalysis = {
    strategic_insight: 'stable',
    tasks: [
        {
            task_text: 'Define scope',
            ai_exposure_score: 0.46,
            human_criticality_score: 0.79,
            reasoning: 'test',
        },
    ],
    yearlyForecast: [{ year: 2025, growthImpact: 0, reasoning: 'baseline' }],
    likely_replacements: ['tool'],
    human_centric_traits: ['judgment'],
    human_resilience_label: 'High',
    salary_volatility_label: 'Medium',
    salary_forecast: [100, 101, 102, 103, 104, 105],
};

describe('analyzeJob cache', () => {
    beforeEach(() => installLocalStorage());
    afterEach(() => vi.unstubAllGlobals());

    it('returns a saved Analyze result for the same job fingerprint', () => {
        const fingerprint = analyzeFingerprint('IT Project Manager', ['Define scope'], {
            employment: 1000,
            projectedGrowth: 6,
        });
        saveAnalyzeCacheEntry('job-43', fingerprint, sample);

        expect(loadAnalyzeCacheEntry('job-43', fingerprint)).toEqual(sample);
        expect(localStorage.getItem(CACHE_KEY)).toContain('job-43');
    });

    it('misses when task list / BLS inputs change', () => {
        const fp1 = analyzeFingerprint('IT Project Manager', ['Define scope'], {
            employment: 1000,
            projectedGrowth: 6,
        });
        saveAnalyzeCacheEntry('job-43', fp1, sample);

        const fp2 = analyzeFingerprint('IT Project Manager', ['Define scope', 'New task'], {
            employment: 1000,
            projectedGrowth: 6,
        });
        expect(loadAnalyzeCacheEntry('job-43', fp2)).toBeNull();
    });
});
