/**
 * Guards the consistency between the Automation Risk gauge and the two task
 * columns beneath it.
 *
 * Reported from production: Financial Analyst and Operations Research Analyst
 * showed a gauge of 39% and 48% above a column reading "No automatable tasks",
 * which reads as a contradiction and undermines trust in the numbers. The
 * cause was that the gauge averages AI exposure over every task while the
 * columns classified whole tasks with a rule requiring LOW human criticality,
 * which 193 of 250 tasks fail. These tests exist so the two can never drift
 * apart again.
 */

import { describe, it, expect } from 'vitest';
import { initialJobs } from '../data';
import { RISK_THRESHOLDS, UI } from '../config/constants';
import { partitionRoleTasks, isHybridTask, pickRoadmapPair, emptyColumnNote } from '../utils/taskPartition';
import bakedScores from '../data/ai_scores.json';

type Task = { name: string; aiCapabilityScore: number; humanCriticalityScore: number };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scores = bakedScores as any;

/** The scores a user actually sees: baked AI scores where present. */
function displayedTasks(jobId: string, fallback: Task[]): Task[] {
    const baked = scores?.scores?.[jobId]?.tasks;
    if (!baked?.length) return fallback;
    return baked.map((t: { taskName: string; aiCapabilityScore: number; humanCriticalityScore: number }) => ({
        name: t.taskName,
        aiCapabilityScore: t.aiCapabilityScore,
        humanCriticalityScore: t.humanCriticalityScore,
    }));
}

/** Same formula as store.ts's automationCostIndex, which drives the gauge. */
const gauge = (tasks: Task[]) => tasks.reduce((s, t) => s + t.aiCapabilityScore, 0) / tasks.length;

describe('every task is visible somewhere', () => {
    it('places each task in exactly one column, for every role', () => {
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed, resistant } = partitionRoleTasks(tasks);
            expect(exposed.length + resistant.length).toBe(tasks.length);
            const names = [...exposed, ...resistant].map((t) => t.name);
            expect(new Set(names).size).toBe(tasks.length);
        }
    });

    it('never drops a task into an unrendered middle bucket', () => {
        // The old three-way classification left 10 tasks in neither column.
        let placed = 0, total = 0;
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed, resistant } = partitionRoleTasks(tasks);
            placed += exposed.length + resistant.length;
            total += tasks.length;
        }
        expect(placed).toBe(total);
    });
});

describe('the gauge and the columns agree', () => {
    it('always puts a task in the risk column once the gauge reaches the exposure line', () => {
        // The exact guarantee: an average at or above the line needs at least one
        // task at or above it. Below the line an empty column is allowed and the
        // panel explains it on screen.
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            if (gauge(tasks) >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE) {
                expect(partitionRoleTasks(tasks).exposed.length).toBeGreaterThan(0);
            }
        }
    });

    it('holds for any scores, not just the bundled ones', () => {
        // A live Analyze run can return any scores, so test the property itself.
        // Park-Miller: 16807 * (2^31 - 1) stays below 2^53, so every step is exact.
        let seed = 42;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let n = 0; n < 2000; n++) {
            const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
                name: `t${i}`, aiCapabilityScore: rand(), humanCriticalityScore: rand(),
            }));
            const { exposed, resistant } = partitionRoleTasks(tasks);
            expect(exposed.length + resistant.length).toBe(5);
            if (gauge(tasks) >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE) expect(exposed.length).toBeGreaterThan(0);
            if (exposed.length === 0) {
                expect(Math.max(...tasks.map((t) => t.aiCapabilityScore))).toBeLessThan(RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE);
            }
        }
    });

    it('only leaves the risk column empty when no task is meaningfully exposed', () => {
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed } = partitionRoleTasks(tasks);
            if (exposed.length === 0) {
                const max = Math.max(...tasks.map((t) => t.aiCapabilityScore));
                expect(max).toBeLessThan(RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE);
            }
        }
    });

    it('puts every task at or above the exposure line in the risk column', () => {
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed, resistant } = partitionRoleTasks(tasks);
            for (const t of exposed) expect(t.aiCapabilityScore).toBeGreaterThanOrEqual(RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE);
            for (const t of resistant) expect(t.aiCapabilityScore).toBeLessThan(RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE);
        }
    });
});

describe('ordering', () => {
    it('sorts the risk column by exposure and the human column by criticality', () => {
        const tasks: Task[] = [
            { name: 'a', aiCapabilityScore: 0.55, humanCriticalityScore: 0.2 },
            { name: 'b', aiCapabilityScore: 0.90, humanCriticalityScore: 0.2 },
            { name: 'c', aiCapabilityScore: 0.10, humanCriticalityScore: 0.4 },
            { name: 'd', aiCapabilityScore: 0.20, humanCriticalityScore: 0.95 },
        ];
        const { exposed, resistant } = partitionRoleTasks(tasks);
        expect(exposed.map((t) => t.name)).toEqual(['b', 'a']);
        expect(resistant.map((t) => t.name)).toEqual(['d', 'c']);
    });

    it('floats a trained task to the top of its own column without moving it', () => {
        const tasks: Task[] = [
            { name: 'high', aiCapabilityScore: 0.90, humanCriticalityScore: 0.2 },
            { name: 'trained', aiCapabilityScore: 0.55, humanCriticalityScore: 0.2 },
        ];
        const { exposed, resistant } = partitionRoleTasks(tasks, (t) => t.name === 'trained');
        expect(exposed.map((t) => t.name)).toEqual(['trained', 'high']);
        expect(resistant).toHaveLength(0);
    });
});

describe('hybrid tasks', () => {
    it('flags tasks that are high on both axes', () => {
        expect(isHybridTask({ name: 'x', aiCapabilityScore: 0.6, humanCriticalityScore: 0.65 })).toBe(true);
        expect(isHybridTask({ name: 'x', aiCapabilityScore: 0.6, humanCriticalityScore: 0.2 })).toBe(false);
        expect(isHybridTask({ name: 'x', aiCapabilityScore: 0.2, humanCriticalityScore: 0.9 })).toBe(false);
    });

    it('only ever flags tasks that live in the risk column', () => {
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { resistant } = partitionRoleTasks(tasks);
            for (const t of resistant) expect(isHybridTask(t)).toBe(false);
        }
    });
});

describe('the panel shows the whole task list, not a sample', () => {
    it('caps the preview at or above the largest role task list', () => {
        const largest = Math.max(...initialJobs.map((j) => j.tasks.length));
        // A cap below this silently hides tasks whenever one column holds them
        // all, which reads to a user exactly like the gauge/column mismatch.
        expect(UI.MAX_TASK_PREVIEW).toBeGreaterThanOrEqual(largest);
    });

    it('renders every task for every role once the cap is applied', () => {
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed, resistant } = partitionRoleTasks(tasks);
            const shown = exposed.slice(0, UI.MAX_TASK_PREVIEW).length + resistant.slice(0, UI.MAX_TASK_PREVIEW).length;
            expect(shown).toBe(tasks.length);
        }
    });
});

describe('one definition of automatable across the app', () => {
    it('the Analyze modal flags exactly the tasks the panel puts in its risk column', () => {
        // AnalysisModal red-badges a task when ai >= AUTOMATABLE_AI_SCORE, which
        // must stay identical to the panel's partition or the same task reads as
        // automatable in one view and not the other.
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed } = partitionRoleTasks(tasks);
            const flaggedByModal = tasks.filter((t) => t.aiCapabilityScore >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE);
            expect(new Set(flaggedByModal.map((t) => t.name))).toEqual(new Set(exposed.map((t) => t.name)));
        }
    });
});

describe('the gauge is the average of the numbers on screen', () => {
    // Same formulas as the app: the gauge is automationCostIndex (mean rounded to
    // 2dp, store.ts) shown via toFixed(0); each chip is one task's score rounded to
    // a whole percent. Rounding each chip moves their average by under half a
    // point, rounding the mean by at most half a point, so they can differ by 1.
    const gaugeShown = (scores: number[]) =>
        Number((parseFloat((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) * 100).toFixed(0));
    const chipAverage = (scores: number[]) =>
        scores.map((s) => Number((s * 100).toFixed(0))).reduce((a, b) => a + b, 0) / scores.length;

    it('stays within one point of the chip average for any scores', () => {
        let seed = 7;
        const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let n = 0; n < 5000; n++) {
            const scores = Array.from({ length: 5 }, () => rand());
            expect(Math.abs(gaugeShown(scores) - chipAverage(scores))).toBeLessThanOrEqual(1 + 1e-9);
        }
    });

    it('stays within one point for every bundled role', () => {
        for (const job of initialJobs) {
            const scores = displayedTasks(job.id, job.tasks).map((t) => t.aiCapabilityScore);
            expect(Math.abs(gaugeShown(scores) - chipAverage(scores))).toBeLessThanOrEqual(1 + 1e-9);
        }
    });
});

describe('empty column notes', () => {
    it('explains an empty risk column against the gauge, using the real threshold', () => {
        const note = emptyColumnNote('exposed', false);
        expect(note).toContain(`${RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE * 100}%`);
        expect(note).toMatch(/parts of many tasks/);
    });

    it('only mentions Hybrid when a task on screen is marked Hybrid', () => {
        expect(emptyColumnNote('resistant', true)).toMatch(/marked Hybrid/);
        expect(emptyColumnNote('resistant', false)).not.toMatch(/Hybrid/);
    });
});

describe('roadmap pairing', () => {
    it('never asks a user to pivot from a task to itself', () => {
        const tasks: Task[] = [
            { name: 'both', aiCapabilityScore: 0.9, humanCriticalityScore: 0.9 },
            { name: 'human', aiCapabilityScore: 0.1, humanCriticalityScore: 0.8 },
            { name: 'ai', aiCapabilityScore: 0.7, humanCriticalityScore: 0.2 },
        ];
        const { riskTask, safeTask } = pickRoadmapPair(tasks);
        expect(riskTask?.name).toBe('both');
        expect(safeTask?.name).toBe('human');
    });

    it('picks two distinct tasks for every bundled role', () => {
        for (const job of initialJobs) {
            const { riskTask, safeTask } = pickRoadmapPair(displayedTasks(job.id, job.tasks));
            expect(riskTask && safeTask).toBeTruthy();
            expect(riskTask!.name).not.toBe(safeTask!.name);
        }
    });
});

describe("Ray's reported roles specifically", () => {
    it.each(['Financial Analyst', 'Operations Research Analyst'])(
        '%s no longer shows a non-zero gauge above an empty risk column',
        (title) => {
            const job = initialJobs.find((j) => j.title === title)!;
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed } = partitionRoleTasks(tasks);
            expect(gauge(tasks)).toBeGreaterThan(0.2);
            expect(exposed.length).toBeGreaterThan(0);
        },
    );
});
