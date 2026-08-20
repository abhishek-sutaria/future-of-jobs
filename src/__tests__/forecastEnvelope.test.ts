import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { parseJobAnalysis } from '../utils/taskScoring';
import scoresFile from '../data/ai_scores.json';

// Guards against the class of bug found in the 2026-08-20 data audit: baked
// forecasts that overshoot or reverse the BLS 10-year projection they're
// supposed to be grounded in (28 of 50 roles violated this, 5 of them on the
// wrong side of zero). Reuses parseJobAnalysis (the same function
// scripts/generate_ai_scores.ts re-validates the cache against) rather than
// re-implementing the interval/tolerance rules here — a second copy would
// silently drift out of sync the next time those rules are tuned, which is
// exactly the class of bug this test exists to prevent.

interface BakedScoreEntry {
    tasks: { taskName?: string; aiCapabilityScore: number; humanCriticalityScore: number }[];
    yearlyForecast?: { year: number; growthImpact: number; reasoning?: string }[];
}

const scores = (scoresFile as { scores?: Record<string, BakedScoreEntry> }).scores ?? {};

describe('baked forecasts respect the BLS envelope', () => {
    it('every baked forecast passes current validation rules', () => {
        const violations: string[] = [];
        for (const job of initialJobs) {
            const entry = scores[job.id];
            if (!entry?.yearlyForecast) continue;
            const yearlyForecast = entry.yearlyForecast;
            const taskNames = job.tasks.map((t) => t.name);
            try {
                parseJobAnalysis({ tasks: entry.tasks, yearlyForecast }, taskNames, job.projectedGrowth);
            } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                violations.push(`${job.title}: ${reason}`);
            }
        }
        expect(violations).toEqual([]);
    });
});
