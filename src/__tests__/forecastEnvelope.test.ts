import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import scoresFile from '../data/ai_scores.json';

// Guards against the class of bug found in the 2026-08-20 data audit: baked
// forecasts that overshoot or reverse the BLS 10-year projection they're
// supposed to be grounded in (28 of 50 roles violated this, 5 of them on the
// wrong side of zero). See assertValidYearlyForecast in taskScoring.ts for
// the same rule enforced at generation time — this test guards the
// *committed* data, which can silently drift out of sync with that rule if
// scripts/generate_ai_scores.ts is ever run without re-validating the cache.

interface BakedForecastPoint {
    year: number;
    growthImpact: number;
}

interface BakedScoreEntry {
    yearlyForecast?: BakedForecastPoint[];
}

const scores = (scoresFile as { scores?: Record<string, BakedScoreEntry> }).scores ?? {};

describe('baked forecasts respect the BLS envelope', () => {
    it('never leaves [0, projectedGrowth] in any year', () => {
        const violations: string[] = [];
        for (const job of initialJobs) {
            const entry = scores[job.id];
            if (!entry?.yearlyForecast) continue;
            const lo = Math.min(0, job.projectedGrowth);
            const hi = Math.max(0, job.projectedGrowth);
            for (const f of entry.yearlyForecast) {
                if (f.growthImpact < lo - 1e-6 || f.growthImpact > hi + 1e-6) {
                    violations.push(
                        `${job.title} ${f.year}: ${f.growthImpact}% outside [${lo}, ${hi}] (BLS ${job.projectedGrowth}%)`,
                    );
                }
            }
        }
        expect(violations).toEqual([]);
    });

    it('starts every forecast at a 2025 baseline of ~0', () => {
        for (const job of initialJobs) {
            const y2025 = scores[job.id]?.yearlyForecast?.find((f) => f.year === 2025);
            if (y2025) expect(Math.abs(y2025.growthImpact)).toBeLessThanOrEqual(0.08);
        }
    });
});
