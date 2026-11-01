import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { buildJobAnalysisPrompt, parseJobAnalysis } from '../utils/taskScoring';
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

    it('2030 reasoning does not claim the full BLS 10-year endpoint after the 5/9 rescale', () => {
        const stale: string[] = [];
        const bad = /10[- ]year cap|10[- ]year projected|10[- ]year cumulative|full realization of BLS|Flat 10-year|Reaches BLS 10|Approaching the \d+% BLS 10/i;
        for (const job of initialJobs) {
            const entry = scores[job.id];
            const f2030 = entry?.yearlyForecast?.find((f) => f.year === 2030);
            if (!f2030?.reasoning) continue;
            if (bad.test(f2030.reasoning) && !/5\/9|in-app/.test(f2030.reasoning)) {
                stale.push(`${job.title}: ${f2030.reasoning}`);
            }
        }
        expect(stale).toEqual([]);
    });
});

describe('the forecast check uses the cap the prompt states', () => {
    const YEARS = [2025, 2026, 2027, 2028, 2029, 2030];
    const check = (projectedGrowth: number, end: number) =>
        parseJobAnalysis(
            {
                tasks: [{ aiCapabilityScore: 0.5, humanCriticalityScore: 0.5 }],
                yearlyForecast: YEARS.map((year, i) => ({ year, growthImpact: Number(((end * i) / 5).toFixed(2)) })),
            },
            ['A task'],
            projectedGrowth,
        );

    it('growth 1.4 accepts 0.78 and rejects 0.79', () => {
        expect(() => check(1.4, 0.78)).not.toThrow();
        expect(() => check(1.4, 0.79)).toThrow(/outside the BLS envelope/);
    });

    it('growth -1 accepts -0.56 and rejects -0.57', () => {
        expect(() => check(-1, -0.56)).not.toThrow();
        expect(() => check(-1, -0.57)).toThrow(/outside the BLS envelope/);
    });

    it('still rejects a forecast on the wrong side of zero', () => {
        expect(() => check(1.4, -0.1)).toThrow(/outside the BLS envelope/);
        expect(() => check(-1, 0.1)).toThrow(/outside the BLS envelope/);
    });

    it('leaves the near-zero rule as it was', () => {
        expect(() => check(0, 0.8)).not.toThrow();
        expect(() => check(0, -0.8)).not.toThrow();
        expect(() => check(0, 0.81)).toThrow(/must stay within/);
        // Rounds to a 0.00 cap but is not flat, so it does not get the near-zero allowance.
        expect(() => check(0.001, 0.5)).toThrow(/outside the BLS envelope/);
    });

    it('accepts the exact cap written in the prompt, at every growth from -20% to +20%', () => {
        for (let tenths = -200; tenths <= 200; tenths++) {
            const growth = tenths / 10;
            if (growth === 0) continue;
            const stated = buildJobAnalysisPrompt('A role', ['A task'], 1000, growth).match(/\(cap = (-?\d+\.\d\d)\)/);
            expect(stated, String(growth)).not.toBeNull();
            expect(() => check(growth, Number(stated![1])), String(growth)).not.toThrow();
        }
    });

    it('all 50 published roles still pass', () => {
        expect(initialJobs).toHaveLength(50);
        for (const job of initialJobs) {
            const entry = scores[job.id];
            expect(entry?.yearlyForecast, job.title).toBeDefined();
            expect(
                () => parseJobAnalysis({ tasks: entry.tasks, yearlyForecast: entry.yearlyForecast! }, job.tasks.map((t) => t.name), job.projectedGrowth),
                job.title,
            ).not.toThrow();
        }
    });
});
