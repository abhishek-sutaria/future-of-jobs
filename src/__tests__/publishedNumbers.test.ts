/**
 * Every number on the role page must be the published one, identical for every
 * visitor. A live Analyze run used to overwrite a role's scores and forecast, so
 * the same role read 30%, 34% or 39% depending on whose browser ran the call.
 */

import { describe, it, expect } from 'vitest';
import { useStore } from '../store';
import { alignAnalysisToTasks } from '../utils/analysis';
import { forecastPathPoints } from '../utils/terrainMath';
import { RESILIENCE_LABELS, YEAR_MIN, YEAR_MAX } from '../config/constants';

const jobs = () => useStore.getState().jobs;

describe('live Analyze cannot change published numbers', () => {
    it('the store exposes no way to overwrite a role from a live analysis', () => {
        const state = useStore.getState() as unknown as Record<string, unknown>;
        expect(state.updateJobFromLiveAnalysis).toBeUndefined();
        expect(state.updateJobForecast).toBeUndefined();
    });
});

describe('Analyze modal rows', () => {
    const job = jobs().find((j) => j.title === 'IT Project Manager')!;

    it('keep the published scores and take only reasoning from the live run', () => {
        const live = job.tasks.map((t, i) => ({ task_text: t.name, ai_exposure_score: 0.99, human_criticality_score: 0.01, reasoning: `r${i}` }));
        const rows = alignAnalysisToTasks(job.tasks, live);
        rows.forEach((r, i) => {
            expect(r.ai).toBe(job.tasks[i].aiCapabilityScore);
            expect(r.human).toBe(job.tasks[i].humanCriticalityScore);
            expect(r.reasoning).toBe(`r${i}`);
        });
    });

    it('attach reasoning to paraphrased rows by position', () => {
        const live = job.tasks.map((_, i) => ({ task_text: `Paraphrased ${i}`, reasoning: `p${i}` }));
        expect(alignAnalysisToTasks(job.tasks, live).map((r) => r.reasoning)).toEqual(job.tasks.map((_, i) => `p${i}`));
    });

    it('prefer an exact name over a position', () => {
        const [first, second] = job.tasks;
        const live = [{ task_text: second.name, reasoning: 'second' }, { task_text: first.name, reasoning: 'first' }];
        const rows = alignAnalysisToTasks([first, second], live);
        expect(rows.map((r) => r.reasoning)).toEqual(['first', 'second']);
    });

    it('leave reasoning empty rather than inventing one', () => {
        expect(alignAnalysisToTasks(job.tasks, []).every((r) => r.reasoning === '')).toBe(true);
    });

    it('produce a headline equal to the panel gauge for every role', () => {
        for (const j of jobs()) {
            const rows = alignAnalysisToTasks(j.tasks, []);
            const mean = rows.reduce((s, r) => s + r.ai, 0) / rows.length;
            expect((parseFloat(mean.toFixed(2)) * 100).toFixed(0)).toBe((j.automationCostIndex * 100).toFixed(0));
        }
    });
});

describe('headline tiles are published', () => {
    it('every role has a resilience label from the shared vocabulary', () => {
        const vocab: string[] = Object.values(RESILIENCE_LABELS);
        for (const j of jobs()) expect(vocab).toContain(j.humanResilienceLabel);
    });

    it('every role has a complete forecast path', () => {
        for (const j of jobs()) {
            const points = forecastPathPoints(j.yearlyForecast);
            expect(points).not.toBeNull();
            expect(points!.length).toBe(YEAR_MAX - YEAR_MIN + 1);
            expect(points![points!.length - 1]).toBe(j.yearlyForecast!.find((f) => f.year === YEAR_MAX)!.growthImpact);
        }
    });

    it('returns no path for an incomplete forecast rather than drawing an invented one', () => {
        expect(forecastPathPoints(undefined)).toBeNull();
        expect(forecastPathPoints([])).toBeNull();
        expect(forecastPathPoints([{ year: YEAR_MIN, growthImpact: 0 }])).toBeNull();
    });
});
