import { test, expect } from 'vitest';
import { estimateRescoreCost, formatRescoreCostSummary } from '../utils/rescoreCost';
import { initialJobs } from '../data';

test('estimateRescoreCost covers all seeded roles with a sensible token band', () => {
    const est = estimateRescoreCost(
        initialJobs.map((j) => ({
            title: j.title,
            tasks: j.tasks.map((t) => ({ name: t.name })),
            employment: j.employment,
            projectedGrowth: j.projectedGrowth,
        })),
    );

    expect(est.apiCalls).toBe(50);
    expect(est.totalTasks).toBeGreaterThan(100);
    // Prompt+JSON for 50 jobs should land in the tens of thousands of tokens, not millions.
    expect(est.totalTokens).toBeGreaterThan(20_000);
    expect(est.totalTokens).toBeLessThan(200_000);
    expect(est.costUsd).toBeGreaterThan(0.1);
    expect(est.costUsd).toBeLessThan(5);
    expect(est.costUsdLow).toBeLessThan(est.costUsdHigh);

    const summary = formatRescoreCostSummary(est);
    expect(summary).toMatch(/50 Claude calls/);
    expect(summary).toMatch(/\$/);
});
