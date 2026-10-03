import { describe, expect, it } from 'vitest';
import {
    averageRiskPct,
    findContrastPair,
    orderRolesByRisk,
    publishedRisk,
    taskSpread,
} from '../utils/taskSplitMath';
import type { Job } from '../types';

function makeJob(
    id: string,
    title: string,
    risk: number,
    employment: number,
    taskScores: number[],
): Job {
    return {
        id,
        title,
        cluster: 'Other',
        employment,
        projectedGrowth: 5,
        automationCostIndex: risk,
        salaryVolatilityLabel: 'Stable',
        humanResilienceLabel: 'High',
        confidenceScore: 1,
        isAlias: false,
        dataSources: ['test'],
        yearlyForecast: [],
        tasks: taskScores.map((aiCapabilityScore, i) => ({
            name: `${title} task ${i}`,
            aiCapabilityScore,
            humanCriticalityScore: 1 - aiCapabilityScore,
            importance: 3,
        })),
    };
}

describe('taskSplitMath', () => {
    const varied = makeJob('a', 'Varied Role', 0.54, 50_000, [0.15, 0.25, 0.7, 0.75, 0.85]);
    const uniform = makeJob('b', 'Uniform Role', 0.54, 40_000, [0.5, 0.52, 0.54, 0.56, 0.58]);
    const safer = makeJob('c', 'Safer Role', 0.3, 80_000, [0.2, 0.3, 0.4]);

    it('reads published risk from automationCostIndex', () => {
        expect(publishedRisk(varied)).toBe(0.54);
    });

    it('orders roles by ascending risk, then employment', () => {
        const ordered = orderRolesByRisk([varied, safer, uniform]);
        expect(ordered.map((j) => j.id)).toEqual(['c', 'a', 'b']);
    });

    it('averages risk as a plain mean percentage', () => {
        expect(averageRiskPct([safer, varied])).toBeCloseTo(((0.3 + 0.54) / 2) * 100, 5);
    });

    it('finds the same-score pair with the largest task spread gap', () => {
        const pair = findContrastPair([safer, varied, uniform]);
        expect(pair).not.toBeNull();
        expect(pair![0].id).toBe('a'); // more varied first
        expect(pair![1].id).toBe('b');
        expect(taskSpread(varied)).toBeGreaterThan(taskSpread(uniform));
    });

    it('returns null when no same-score pair exists', () => {
        expect(findContrastPair([safer, varied])).toBeNull();
    });
});
