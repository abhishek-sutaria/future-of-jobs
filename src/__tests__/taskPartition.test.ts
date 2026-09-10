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
import { partitionRoleTasks, isHybridTask } from '../utils/taskPartition';
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
    it('never shows a mid or high gauge above an empty Automation Risk column', () => {
        const offenders: string[] = [];
        for (const job of initialJobs) {
            const tasks = displayedTasks(job.id, job.tasks);
            const { exposed } = partitionRoleTasks(tasks);
            if (exposed.length === 0 && gauge(tasks) >= RISK_THRESHOLDS.AUTOMATABLE_AI_SCORE * 0.9) {
                offenders.push(`${job.title} (${Math.round(gauge(tasks) * 100)}%)`);
            }
        }
        expect(offenders).toEqual([]);
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
