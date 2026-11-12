import type { Job } from '../types';
import { meanPercent, percentOf } from './scoreRounding';

/**
 * Pure helpers for the Task view. Kept out of the React component so ordering,
 * averages, and contrast-pair selection can be unit-tested without mounting UI.
 */

/** Published role risk — same field the role page gauge reads. */
export const publishedRisk = (job: Job): number => job.automationCostIndex;

export const taskSpread = (job: Job): number => {
    if (!job.tasks.length) return 0;
    const m = publishedRisk(job);
    return Math.sqrt(
        job.tasks.reduce((s, t) => s + (t.aiCapabilityScore - m) ** 2, 0) / job.tasks.length,
    );
};

/** Lowest-risk first; employment breaks ties so larger roles sit later in a band. */
export function orderRolesByRisk(jobs: readonly Job[]): Job[] {
    return [...jobs].sort(
        (a, b) => publishedRisk(a) - publishedRisk(b) || b.employment - a.employment,
    );
}

/** Plain average of published risk across the listed roles (not employment-weighted), a whole percent rounded from whole hundredths. */
export function averageRiskPct(jobs: readonly Job[]): number {
    return meanPercent(jobs.map(publishedRisk));
}

/**
 * Workers behind the listed roles: BLS Employment Projections 2025 (every
 * worker, self-employed included), the same "workers" as everywhere else in the
 * app. Kelley titles that share a SOC each carry their equal share.
 */
export function totalWorkers(jobs: readonly Job[]): number {
    return jobs.reduce((a, job) => a + (job.epEmployment2025 ?? 0), 0);
}

/**
 * Two roles with the same rounded headline risk but the largest task-spread gap.
 * Returns [moreVaried, moreUniform], or null when no same-score pair exists.
 */
export function findContrastPair(jobs: readonly Job[]): [Job, Job] | null {
    let best: { a: Job; b: Job; gap: number } | null = null;
    for (let i = 0; i < jobs.length; i++) {
        for (let j = i + 1; j < jobs.length; j++) {
            const a = jobs[i];
            const b = jobs[j];
            if (percentOf(publishedRisk(a)) !== percentOf(publishedRisk(b))) continue;
            const gap = Math.abs(taskSpread(a) - taskSpread(b));
            if (!best || gap > best.gap) best = { a, b, gap };
        }
    }
    if (!best) return null;
    return taskSpread(best.a) >= taskSpread(best.b)
        ? [best.a, best.b]
        : [best.b, best.a];
}
